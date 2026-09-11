from __future__ import annotations

import inspect
import logging
import sys

# Printed before the heavy FastAPI / ADK / files-router import so --reload does
# not look frozen while the child process is still loading.
print("Loading agentic-document-service (first boot can take 30-90s)...", flush=True)

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.speech import router as speech_router
from app.api.routes.cases import router as cases_router
from app.api.routes.content import router as content_router
from app.api.routes.custom_prompts import router as custom_prompts_router
from app.api.routes.files import router as files_router
from app.api.routes.health import router as health_router
from app.api.routes.memory import router as memory_router
from app.api.routes.rbac import router as rbac_router
from app.api.routes.branding import router as branding_router
from app.api.routes.summarization_config_admin import router as summarization_config_admin_router
from app.api.routes.summarize import router as summarize_router
from app.api.routes.translation import router as translation_router
from app.api.routes.batch import router as batch_router
from app.core.config import BASE_DIR, get_settings
from app.core.logging import configure_logging
from app.middleware.llm_chat_policy import LLMChatPolicyMiddleware
from app.middleware.payment_token_guard import PaymentTokenGuardMiddleware


logger = logging.getLogger(__name__)
settings = get_settings()
configure_logging(settings.log_level)
logger.info(
    "Agentic Document Service config loaded: port=%s legacy_document_service_url=%s adk_model=%s",
    settings.port,
    settings.legacy_document_service_url,
    settings.adk_model,
)


def _cors_error_response(request: Request, status_code: int, detail: str) -> JSONResponse:
    """
    Build a JSONResponse that always carries the correct CORS headers.

    FastAPI's CORSMiddleware only adds headers when the inner app returns a normal
    response.  When an unhandled exception propagates through BaseHTTPMiddleware the
    middleware stack re-raises it, which means CORSMiddleware never gets to add its
    headers.  By catching exceptions here (at the exception-handler level, before the
    middleware stack is unwound) we can inject the headers ourselves.
    """
    origin = request.headers.get("origin", "")
    allowed = set(settings.cors_origins)
    response = JSONResponse(status_code=status_code, content={"detail": detail})
    if origin and (origin in allowed or origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1")):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
    return response


def create_app() -> FastAPI:
    app = FastAPI(
        title="Agentic Document Service",
        description=(
            "Python FastAPI service for legal case intake, ingestion, grounded retrieval, "
            "and preset execution, backed by a Google ADK agent package."
        ),
        version=settings.version,
    )

    # ── Global exception handlers (run before middleware unwind) ───────────────
    from fastapi import HTTPException as _HTTPException
    from fastapi.exception_handlers import http_exception_handler as _default_http_handler

    @app.exception_handler(_HTTPException)
    async def cors_http_exception_handler(request: Request, exc: _HTTPException) -> JSONResponse:
        return _cors_error_response(request, exc.status_code, str(exc.detail))

    @app.exception_handler(Exception)
    async def cors_unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("[GlobalHandler] Unhandled exception on %s %s: %s", request.method, request.url.path, exc)
        return _cors_error_response(request, 500, "Internal server error")

    app.add_middleware(PaymentTokenGuardMiddleware)
    app.add_middleware(LLMChatPolicyMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(batch_router)
    app.include_router(branding_router)
    app.include_router(summarization_config_admin_router)
    app.include_router(summarize_router)
    app.include_router(speech_router)
    app.include_router(translation_router)
    app.include_router(cases_router)
    app.include_router(content_router)
    app.include_router(rbac_router)
    # /api/memory owns its own prefix, so the /api/files wildcard cannot shadow
    # it; registered here beside the other static prefixes for consistency.
    app.include_router(memory_router)
    # Static /api/files/custom-prompts prefix must register before the files
    # router's /api/files/{folder_name} wildcard routes.
    app.include_router(custom_prompts_router)
    app.include_router(files_router)
    if settings.enable_legacy_proxy:
        from app.api.routes.legacy_proxy import router as legacy_proxy_router

        app.include_router(legacy_proxy_router)
        logger.warning(
            "Legacy proxy is enabled. Requests may still depend on the old document-service at %s",
            settings.legacy_document_service_url,
        )
    else:
        logger.info("Legacy proxy is disabled. FastAPI is running in standalone agentic mode.")

    if settings.enable_adk_runtime:
        _mount_adk_runtime(app)

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "service": settings.service_name,
            "docs": "/docs",
            "health": "/health",
            "adk": "/adk",
        }

    return app


def _mount_adk_runtime(app: FastAPI) -> None:
    if sys.version_info >= (3, 14):
        logger.warning(
            "Skipping Google ADK runtime mount on Python %s.%s because the current "
            "google-adk/grpc stack is not stable on this interpreter yet.",
            sys.version_info.major,
            sys.version_info.minor,
        )
        return

    try:
        from google.adk.cli.fast_api import get_fast_api_app
    except Exception as exc:
        logger.warning("Unable to import Google ADK runtime; skipping mount: %s", exc)
        return

    try:
        # Newer google-adk requires keyword-only `web`. Keep the Dev UI off so
        # this process only serves Jurinex APIs (the UI is unused at /adk).
        adk_kwargs: dict = {"agents_dir": str(BASE_DIR / "agents")}
        parameters = inspect.signature(get_fast_api_app).parameters
        if "web" in parameters:
            adk_kwargs["web"] = False
        adk_app = get_fast_api_app(**adk_kwargs)
        app.mount("/adk", adk_app)
        logger.info("Mounted Google ADK runtime at /adk")
    except Exception as exc:  # pragma: no cover
        logger.warning("Unable to mount Google ADK runtime: %s", exc)


app = create_app()


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment.lower() == "development",
        log_config=None,   # prevent uvicorn from overwriting our TabularFormatter
    )
