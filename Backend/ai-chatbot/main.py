from __future__ import annotations

import logging
import logging.config
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import get_settings
from app.core.limiter import limiter
from app.api.routes import health, chat, audio, admin, demo

# ── logging ────────────────────────────────────────────────────────────────────
# Read log level early (before settings object) so dictConfig can use it.
_LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }
    },
    "root": {
        "level": _LOG_LEVEL,
        "handlers": ["console"],
    },
    "loggers": {
        "ai_chatbot":             {"level": _LOG_LEVEL,  "propagate": True},
        "ai_chatbot.audio_route": {"level": "INFO",      "propagate": True},
        "websockets.client":      {"level": "WARNING"},
        "websockets.server":      {"level": "WARNING"},
        "uvicorn.error":          {"level": "INFO"},
        "uvicorn.access":         {"level": "INFO"},
    },
})
logger = logging.getLogger("ai_chatbot")


# ── lifespan: init/close DB pool ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.db import init_pool, close_pool
    init_pool()

    # Log calendar config so misconfiguration is immediately visible in server logs
    s = get_settings()
    sa_configured = bool((s.google_service_account_json or "").strip())
    from app.services.calendar_service import _calendar_libs_available

    calendar_libs = _calendar_libs_available()
    logger.info(
        "Calendar config — GOOGLE_CALENDAR_ID=%r  GOOGLE_CALENDAR_TZ=%r  "
        "GOOGLE_CALENDAR_SUBJECT=%r  SA_JSON_set=%s  calendar_libs=%s",
        s.google_calendar_id,
        s.google_calendar_tz,
        s.google_calendar_subject,
        sa_configured,
        calendar_libs,
    )
    if sa_configured and not calendar_libs:
        logger.error(
            "GOOGLE_SERVICE_ACCOUNT_JSON is set but google-api-python-client is missing. "
            "Demo bookings will not appear on Google Calendar until you run: pip install -r requirements.txt"
        )

    logger.info("AI Chatbot startup complete")
    yield
    close_pool()
    logger.info("AI Chatbot shutdown complete")


# ── app ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Nexintel AI Support Chatbot",
    description=(
        "Text and audio support agent powered by Gemini. "
        "Answers are grounded in admin-uploaded documents via vector search."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

settings = get_settings()

# ── rate limiting ──────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(
    RateLimitExceeded,
    lambda request, exc: JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please slow down."},
    ),
)
app.add_middleware(SlowAPIMiddleware)

# ── CORS ───────────────────────────────────────────────────────────────────────
# Parse comma-separated origins from CORS_ORIGINS env var.
# Default "*" keeps behaviour identical to before for local dev.
# In production set: CORS_ORIGINS=https://your-frontend.com,https://other.com
_raw_origins = settings.cors_origins.strip()
_cors_origins: list[str] = (
    ["*"]
    if _raw_origins == "*"
    else [o.strip() for o in _raw_origins.split(",") if o.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── HTTP request logger ────────────────────────────────────────────────────────
@app.middleware("http")
async def _log_http_requests(request: Request, call_next):
    started = time.perf_counter()
    logger.debug("HTTP START method=%s path=%s client=%s", request.method, request.url.path, request.client)
    try:
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "HTTP END method=%s path=%s status=%s elapsed_ms=%.0f",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response
    except Exception:
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.exception(
            "HTTP ERROR method=%s path=%s elapsed_ms=%.0f",
            request.method,
            request.url.path,
            elapsed_ms,
        )
        raise


# ── global error handler ───────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def _global_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ── Central error capture (docs/error-logging.md). Vendored copy: ./errorlog ──
import os as _os  # noqa: E402
from errorlog import install as _install_errorlog  # noqa: E402

_install_errorlog(app, service_name="ai-chatbot", own_code_root=_os.path.dirname(_os.path.abspath(__file__)))


# ── routes ─────────────────────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(chat.router)
app.include_router(audio.router)
app.include_router(admin.router)
app.include_router(demo.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=(settings.environment == "development"),
        log_level=settings.log_level.lower(),
    )
