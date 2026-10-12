"""Agentic Chat Service — FastAPI entry (ChatModel replacement, Google ADK)."""
from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Ensure service root is on sys.path for `agents` and `pipeline` packages
_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.chat import router as chat_router
from app.api.routes.custom_prompts import router as custom_prompts_router
from app.api.routes.drafting import router as drafting_router
from app.core.config import get_settings
from app.middleware.payment_token_guard import PaymentTokenGuardMiddleware
from app.services.db import close_pools

# App loggers (app.services.*, agents.*) need a handler to show up in the
# uvicorn console — uvicorn only configures its own loggers.
logging.basicConfig(
    level=getattr(logging, get_settings().log_level.upper(), logging.INFO),
    format="%(levelname)s:     [%(name)s] %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info(
        "Starting %s on port %s (ADK model=%s)",
        settings.service_name,
        settings.port,
        settings.adk_model,
    )
    try:
        from app.services.drafting_service import resume_interrupted_analyses
        n = await resume_interrupted_analyses()
        if n:
            logger.info("Resumed %d interrupted template analyses", n)
    except Exception as exc:
        logger.warning("Drafting analysis resume skipped: %s", exc)
    yield
    close_pools()


def _quota_error_response(status_code: int, detail: dict) -> JSONResponse:
    """Flat JSON for 429/503 — matches payment middleware and frontend quotaError.js."""
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "code": detail.get("code"),
            "message": detail.get("message") or "Token limit reached.",
            "details": detail.get("details") if isinstance(detail.get("details"), dict) else detail,
        },
    )


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Agentic Chat Service",
        description="JuriNex ChatModel replacement — Google ADK multi-agent legal chat",
        version="1.0.0",
        lifespan=lifespan,
    )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if exc.status_code in (429, 503) and isinstance(detail, dict):
            if detail.get("ok") is False or detail.get("code"):
                return _quota_error_response(exc.status_code, detail)
        if isinstance(detail, dict) and detail.get("success") is False and detail.get("code"):
            return JSONResponse(status_code=exc.status_code, content=detail)
        return JSONResponse(status_code=exc.status_code, content={"detail": detail})
    # PaymentTokenGuardMiddleware must be added BEFORE CORSMiddleware so that
    # CORSMiddleware (outermost) wraps all responses — including 429 quota blocks.
    # Without this order the 429 JSON response is returned without CORS headers,
    # causing the browser to throw "Failed to fetch" and lose the error details.
    app.add_middleware(PaymentTokenGuardMiddleware)
    origins = settings.cors_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        return {
            "success": True,
            "message": "Agentic chat service is running",
            "service": settings.service_name,
            "adk_model": settings.adk_model,
        }

    app.include_router(custom_prompts_router)
    app.include_router(chat_router)
    app.include_router(drafting_router)
    return app


app = create_app()

# ── Central error capture (docs/error-logging.md). Vendored copy: ./errorlog ──
from errorlog import install as _install_errorlog  # noqa: E402

_install_errorlog(app, service_name="agentic-chat-service", own_code_root=_ROOT)

if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run("main:app", host=s.host, port=s.port, reload=True)
