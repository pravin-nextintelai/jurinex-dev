"""Central error capture for JuriNex Python services.

One call wires everything, without touching routes or services::

    from errorlog import install as install_errorlog
    install_errorlog(app, service_name="agentic-document-service", own_code_root=Path(__file__).parent)

Flask::

    install_errorlog(flask_app=app, service_name="visual-service", own_code_root=...)

What it installs
----------------
* a pure ASGI middleware outside Starlette's error middleware: request id,
  request context (ip, endpoint, user from the JWT / x-user-id), response hook
  (status + up to 4 KB of 5xx bodies for the exact user message), flush
* exception handlers that record and keep the existing error format
* google-genai / google-generativeai method patches (Gemini + ADK)
* httpx / requests / aiohttp / urllib patches (external APIs, request-id forwarding)
* a logging.Handler for ERROR+ records carrying exc_info
* sys.excepthook, threading.excepthook, asyncio loop exception handler
* a background writer thread with its own DB connection (or HTTP ingest)
* on the owner service: POST /internal/error-logs and daily retention
* outside production: GET /internal/error-logs/_debug/* verification routes

Environment: SERVICE_NAME, ENVIRONMENT, ERROR_LOG_ENABLED, ERROR_LOG_DATABASE_URL,
ERROR_LOG_INGEST_URL, ERROR_LOG_INGEST_KEY, ERROR_LOG_RETENTION_DAYS,
ERROR_LOG_STORE_AI_CONTENT, ERROR_LOG_SKIP_STATUS, ERROR_LOG_STORE_RECOVERED_EXTERNAL,
EXTERNAL_PROVIDERS. See docs/error-logging.md.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from . import config as _config
from .context import attach, get_context, set_user
from .model import ErrorEvent
from .recorder import Recorder
from .writer import Writer

__all__ = ["install", "ErrorLog", "record", "record_exception", "set_user", "attach", "get_request_id", "get"]
__version__ = "1.0.0"

log = logging.getLogger("errorlog")

_lock = threading.Lock()
_handle: Optional["ErrorLog"] = None


class ErrorLog:
    """Handle returned by ``install``; also reachable through ``errorlog.get()``."""

    def __init__(self, cfg: _config.Config, writer: Writer, recorder: Recorder) -> None:
        self.cfg = cfg
        self.writer = writer
        self.recorder = recorder
        self.hooks: Dict[str, List[str]] = {}
        self.apps: List[int] = []
        self._loop_hook = None

    @property
    def enabled(self) -> bool:
        return self.cfg.enabled

    # manual API ----------------------------------------------------------
    def record_exception(self, exc: BaseException, **kw: Any) -> Optional[ErrorEvent]:
        return self.recorder.record_exception(exc, **kw)

    def record(self, **fields: Any) -> Optional[ErrorEvent]:
        """Record a hand-made error (no exception object)."""
        ev = self.recorder._base(**fields)  # noqa: SLF001
        return self.recorder.record(ev)

    def flush(self, timeout: float = 5.0) -> bool:
        return self.writer.flush(timeout)

    def stats(self) -> Dict[str, Any]:
        out = self.writer.stats()
        out.update(
            {
                "service_name": self.cfg.service_name,
                "environment": self.cfg.environment,
                "enabled": self.cfg.enabled,
                "recorded_total": self.recorder.recorded_total,
                "hooks": self.hooks,
                "skip_status": sorted(self.cfg.skip_status),
                "store_recovered_external": self.cfg.store_recovered_external,
            }
        )
        return out

    def shutdown(self) -> None:
        self.writer.shutdown()


def _wrap_asgi_app(app: Any, handle: ErrorLog) -> None:
    from .asgi import ErrorLogASGIMiddleware

    if id(app) in handle.apps:
        return
    handle.apps.append(id(app))
    recorder, cfg, loop_hook = handle.recorder, handle.cfg, handle._loop_hook  # noqa: SLF001

    # Starlette builds its middleware stack lazily on the first request; we wrap
    # the result so our middleware sits OUTSIDE ServerErrorMiddleware.
    orig_build = app.build_middleware_stack

    def build_middleware_stack():
        return ErrorLogASGIMiddleware(orig_build(), recorder, cfg, loop_hook)

    app.build_middleware_stack = build_middleware_stack
    if getattr(app, "middleware_stack", None) is not None:
        app.middleware_stack = ErrorLogASGIMiddleware(app.middleware_stack, recorder, cfg, loop_hook)


def install(
    app: Any = None,
    *,
    service_name: Optional[str] = None,
    owner: bool = False,
    own_code_root: Optional[os.PathLike] = None,
    flask_app: Any = None,
    ingest: Optional[bool] = None,
    debug_routes: Optional[bool] = None,
    parse_helpers: Iterable[str] = (),
    extra_loggers: Iterable[str] = (),
    sink: Any = None,
    client_report_path: Optional[str] = None,
    client_report_dependency: Any = None,
) -> ErrorLog:
    """Install the error logger. Idempotent; later calls can add more apps.

    ``client_report_path`` mounts ``POST <path>`` for browser-reported errors,
    protected by ``client_report_dependency`` (the service's verified-JWT
    dependency; without one the JWT payload is only peeked for attribution).
    """
    global _handle
    with _lock:
        if _handle is None:
            cfg = _config.load(service_name, Path(own_code_root) if own_code_root else None, owner=owner)
            if not owner and "ERROR_LOG_RETENTION_ENABLED" not in os.environ:
                cfg.retention_enabled = False
            writer = Writer(cfg, sink=sink)
            recorder = Recorder(cfg, writer)
            handle = ErrorLog(cfg, writer, recorder)
            _handle = handle
            if not cfg.enabled:
                log.info("errorlog: disabled by ERROR_LOG_ENABLED")
            else:
                _install_global_hooks(handle, parse_helpers, extra_loggers)
                writer.start()
        handle = _handle

    if not handle.cfg.enabled:
        return handle

    if app is not None:
        try:
            from .handlers import install_exception_handlers

            _wrap_asgi_app(app, handle)
            install_exception_handlers(app, handle.recorder, handle.cfg)
            handle.hooks.setdefault("asgi", []).append(type(app).__name__)
            if owner or ingest:
                from .ingest import build_ingest_router

                app.include_router(build_ingest_router(handle.writer, handle.cfg))
                handle.hooks.setdefault("routes", []).append("POST /internal/error-logs")
                handle.hooks.setdefault("routes", []).append("POST /internal/audit-logs")
            if debug_routes is True or (debug_routes is None and handle.cfg.debug_routes):
                from .debug_routes import build_debug_router

                app.include_router(build_debug_router(handle, handle.cfg))
                handle.hooks.setdefault("routes", []).append("GET /internal/error-logs/_debug/*")
            if client_report_path:
                from .clientreport import build_client_report_router

                handle.cfg.client_report_path = client_report_path
                before = len(app.router.routes)
                app.include_router(build_client_report_router(handle.recorder, handle.cfg, client_report_path, client_report_dependency))
                # Routers with wildcard paths (e.g. /api/files/{name}) may already be
                # registered: put ours first so it is never shadowed.
                added = app.router.routes[before:]
                del app.router.routes[before:]
                app.router.routes[0:0] = added
                handle.hooks.setdefault("routes", []).append(f"POST {client_report_path}")
        except Exception as exc:  # noqa: BLE001
            log.warning("errorlog: app wiring failed: %s", exc)

    if flask_app is not None:
        try:
            from .flask_ext import install_flask

            handle.hooks["flask"] = install_flask(flask_app, handle.recorder, handle.cfg)
        except Exception as exc:  # noqa: BLE001
            log.warning("errorlog: flask wiring failed: %s", exc)

    sink_name = handle.writer.sink.name if handle.writer.sink else "none"
    log.info(
        "errorlog: installed for %s (%s) sink=%s hooks=%s",
        handle.cfg.service_name,
        handle.cfg.environment,
        sink_name,
        {k: len(v) for k, v in handle.hooks.items()},
    )
    return handle


def _install_global_hooks(handle: ErrorLog, parse_helpers: Iterable[str], extra_loggers: Iterable[str]) -> None:
    from .gemini import install_gemini_hooks
    from .httpclients import install_http_hooks
    from .jobs import install_executor_context_propagation, install_process_hooks, make_loop_hook
    from .loghook import install_logging_hook
    from .parsehook import install_parse_hooks

    steps = (
        ("gemini", lambda: install_gemini_hooks(handle.recorder, handle.cfg)),
        ("http", lambda: install_http_hooks(handle.recorder, handle.cfg)),
        ("logging", lambda: install_logging_hook(handle.recorder, handle.cfg, extra_loggers)),
        ("process", lambda: install_process_hooks(handle.recorder, handle.cfg, handle.writer)),
        ("parsers", lambda: install_parse_hooks(handle.recorder, handle.cfg, parse_helpers)),
    )
    for name, fn in steps:
        try:
            handle.hooks[name] = list(fn())
        except Exception as exc:  # noqa: BLE001
            log.debug("errorlog: %s hooks failed: %s", name, exc)
            handle.hooks[name] = []
    try:
        if install_executor_context_propagation():
            handle.hooks["executor_context"] = ["concurrent.futures.ThreadPoolExecutor.submit"]
    except Exception as exc:  # noqa: BLE001
        log.debug("errorlog: executor propagation failed: %s", exc)
    handle._loop_hook = make_loop_hook(handle.recorder)  # noqa: SLF001


# ── module-level conveniences ────────────────────────────────────────────────

def get() -> Optional[ErrorLog]:
    return _handle


def record_exception(exc: BaseException, **kw: Any) -> Optional[ErrorEvent]:
    return _handle.record_exception(exc, **kw) if _handle else None


def record(**fields: Any) -> Optional[ErrorEvent]:
    return _handle.record(**fields) if _handle else None


def get_request_id() -> Optional[str]:
    ctx = get_context()
    return ctx.request_id if ctx else None
