"""FastAPI / Starlette exception handlers that record and keep the existing
response format, adding a safe message and the request id."""
from __future__ import annotations

import inspect
import logging
import re
from typing import Any, Callable, Dict, Optional

from .config import Config
from .context import get_context, new_request_id
from .model import CAT_INTERNAL, SOURCE_HTTP
from .recorder import Recorder
from .sanitize import mask_text, truncate

log = logging.getLogger("errorlog")

SAFE_MESSAGE = "Internal server error"


def _cors_headers(app: Any, request: Any) -> Dict[str, str]:
    """Replicate the app's CORSMiddleware decision for an error response.

    Starlette's ServerErrorMiddleware answers from outside CORSMiddleware, so a
    500 would otherwise reach the browser without CORS headers and be hidden
    behind a CORS error. We mirror what the configured middleware would do.
    """
    try:
        origin = request.headers.get("origin")
        if not origin:
            return {}
        for mw in getattr(app, "user_middleware", []) or []:
            cls = getattr(mw, "cls", None)
            if cls is None or cls.__name__ != "CORSMiddleware":
                continue
            opts = getattr(mw, "kwargs", None)
            if opts is None:
                opts = getattr(mw, "options", {}) or {}
            allow_origins = list(opts.get("allow_origins") or [])
            regex = opts.get("allow_origin_regex")
            creds = bool(opts.get("allow_credentials"))
            allowed = "*" in allow_origins or origin in allow_origins
            if not allowed and regex:
                try:
                    allowed = re.fullmatch(regex, origin) is not None
                except re.error:
                    allowed = False
            if not allowed:
                return {}
            value = origin if (creds or "*" not in allow_origins) else "*"
            out = {"access-control-allow-origin": value, "vary": "Origin"}
            if creds:
                out["access-control-allow-credentials"] = "true"
            return out
    except Exception:  # noqa: BLE001
        return {}
    return {}


def _request_id(request: Any) -> str:
    ctx = get_context()
    if ctx is not None:
        return ctx.request_id
    try:
        rid = request.headers.get("x-request-id")
        if rid:
            return rid[:64]
    except Exception:  # noqa: BLE001
        pass
    return new_request_id()


async def _call(handler: Callable, request: Any, exc: BaseException) -> Any:
    result = handler(request, exc)
    if inspect.isawaitable(result):
        result = await result
    return result


def _set_header(response: Any, key: str, value: str) -> None:
    try:
        if key not in response.headers:
            response.headers[key] = value
    except Exception:  # noqa: BLE001
        pass


def install_exception_handlers(app: Any, recorder: Recorder, cfg: Config) -> None:
    from starlette.exceptions import HTTPException as StarletteHTTPException
    from starlette.responses import JSONResponse

    try:
        from fastapi.exception_handlers import http_exception_handler as default_http_handler
    except Exception:  # noqa: BLE001 - plain Starlette
        default_http_handler = None

    handlers: Dict[Any, Callable] = getattr(app, "exception_handlers", {}) or {}
    existing_exc = handlers.get(Exception) or handlers.get(500)
    existing_http = handlers.get(StarletteHTTPException)
    try:
        from fastapi import HTTPException as FastAPIHTTPException

        existing_fastapi_http = handlers.get(FastAPIHTTPException)
    except Exception:  # noqa: BLE001
        FastAPIHTTPException = None  # type: ignore[assignment]
        existing_fastapi_http = None

    async def handle_exception(request: Any, exc: Exception) -> Any:
        # Starlette calls this even when the response already started (a stream
        # or a BackgroundTask failed); the response built here is then discarded.
        ctx = get_context()
        after = bool(ctx and ctx.response_started and (ctx.status_code or 500) < 500)
        recorder.record_exception(exc, source=SOURCE_HTTP, after_response_start=after)
        rid = _request_id(request)
        if existing_exc is not None:
            try:
                response = await _call(existing_exc, request, exc)
                _set_header(response, "x-request-id", rid)
                return response
            except Exception as inner:  # noqa: BLE001 - never let the handler itself 500 twice
                log.debug("errorlog: existing Exception handler failed: %s", inner)
        headers = {"x-request-id": rid}
        headers.update(_cors_headers(app, request))
        return JSONResponse({"detail": SAFE_MESSAGE, "request_id": rid}, status_code=500, headers=headers)

    def _record_http(exc: Any) -> None:
        status = int(getattr(exc, "status_code", 500) or 500)
        if status < 500:
            return
        detail = getattr(exc, "detail", None)
        detail_text = detail if isinstance(detail, str) else (repr(detail) if detail is not None else "")
        cause = exc.__cause__ or exc.__context__
        if cause is not None and isinstance(cause, Exception):
            if recorder.seen(cause):
                # Already recorded by a hook (e.g. the Gemini or HTTP hook):
                # just remember what the route told the user.
                ctx = get_context()
                if ctx is not None:
                    ctx.extra.setdefault("http_detail", truncate(mask_text(detail_text), 500))
                    ctx.extra.setdefault("http_status", status)
                return
            # ``raise HTTPException(500, detail=f"... {e}")`` inside an except
            # block: the real error is the cause, record that with its stack.
            ev = recorder.event_from_exception(cause, source=SOURCE_HTTP, category=None)
            ev.payload["http_detail"] = truncate(mask_text(detail_text), 500)
            ev.payload["http_status"] = status
            recorder.record(ev)
            return
        ev = recorder.event_from_exception(exc, source=SOURCE_HTTP, category=CAT_INTERNAL, message=detail_text or None)
        ev.error_type = f"HTTPException{status}"
        recorder.record(ev)

    async def handle_http_exception(request: Any, exc: Any) -> Any:
        try:
            _record_http(exc)
        except Exception as inner:  # noqa: BLE001
            log.debug("errorlog: http exception record failed: %s", inner)
        rid = _request_id(request)
        handler = existing_http or default_http_handler
        if handler is None:
            from starlette.responses import PlainTextResponse

            return PlainTextResponse(str(getattr(exc, "detail", "")), status_code=exc.status_code, headers={"x-request-id": rid})
        response = await _call(handler, request, exc)
        _set_header(response, "x-request-id", rid)
        return response

    app.add_exception_handler(Exception, handle_exception)
    app.add_exception_handler(StarletteHTTPException, handle_http_exception)
    if FastAPIHTTPException is not None and existing_fastapi_http is not None and existing_fastapi_http is not existing_http:
        # The service registered a handler on fastapi.HTTPException specifically.
        async def handle_fastapi_http(request: Any, exc: Any) -> Any:
            try:
                _record_http(exc)
            except Exception as inner:  # noqa: BLE001
                log.debug("errorlog: http exception record failed: %s", inner)
            response = await _call(existing_fastapi_http, request, exc)
            _set_header(response, "x-request-id", _request_id(request))
            return response

        app.add_exception_handler(FastAPIHTTPException, handle_fastapi_http)
