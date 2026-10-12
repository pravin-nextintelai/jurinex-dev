"""Flask integration (Visual-Service): request context, response hook, handler."""
from __future__ import annotations

import logging
from typing import Any, List

from .config import Config
from .context import (
    RequestContext,
    client_ip,
    new_request_id,
    reset_context,
    set_context,
    user_from_headers,
)
from .frames import endpoint_method_name
from .model import SOURCE_HTTP
from .recorder import Recorder
from .sanitize import extract_user_message

log = logging.getLogger("errorlog")

SAFE_MESSAGE = "Internal server error"


def install_flask(app: Any, recorder: Recorder, cfg: Config) -> List[str]:
    from flask import g, jsonify, request

    try:
        from werkzeug.exceptions import HTTPException as WerkzeugHTTPException
    except Exception:  # noqa: BLE001
        WerkzeugHTTPException = ()  # type: ignore[assignment]

    @app.before_request
    def _errorlog_begin():  # type: ignore[no-untyped-def]
        try:
            headers = {k.lower(): v for k, v in request.headers.items()}
            rid = (headers.get("x-request-id") or "").strip()[:64] or new_request_id()
            ctx = RequestContext(
                request_id=rid,
                ip_address=client_ip(headers, request.remote_addr),
                endpoint=(request.path or "")[:500],
                http_method=(request.method or "")[:10] or None,
                user_agent=headers.get("user-agent"),
            )
            ctx.user_id, ctx.user_email = user_from_headers(headers)
            g._errorlog_ctx = ctx
            g._errorlog_token = set_context(ctx)
        except Exception as exc:  # noqa: BLE001
            log.debug("errorlog: flask begin failed: %s", exc)

    @app.after_request
    def _errorlog_after(response):  # type: ignore[no-untyped-def]
        ctx = getattr(g, "_errorlog_ctx", None)
        if ctx is None:
            return response
        try:
            ctx.status_code = int(response.status_code)
            ctx.response_started = True
            ctx.content_type = response.content_type
            ct = (ctx.content_type or "").lower()
            ctx.streaming = bool(getattr(response, "is_streamed", False)) or "event-stream" in ct
            if ctx.status_code >= 400 and not ctx.streaming and not getattr(response, "direct_passthrough", False):
                data = response.get_data()[: cfg.body_peek_bytes]
                ctx.user_message = extract_user_message(data, ctx.content_type)
            if "X-Request-Id" not in response.headers:
                response.headers["X-Request-Id"] = ctx.request_id
        except Exception as exc:  # noqa: BLE001
            log.debug("errorlog: flask after failed: %s", exc)
        return response

    @app.teardown_request
    def _errorlog_teardown(exc):  # type: ignore[no-untyped-def]
        ctx = getattr(g, "_errorlog_ctx", None)
        token = getattr(g, "_errorlog_token", None)
        if ctx is None:
            return
        try:
            if exc is not None and isinstance(exc, Exception):
                recorder.record_exception(exc, source=SOURCE_HTTP)
            rule = getattr(request, "url_rule", None)
            if rule is not None:
                ctx.route_template = getattr(rule, "rule", None)
            view = app.view_functions.get(request.endpoint) if request.endpoint else None
            if view is not None:
                ctx.extra["route_method"] = endpoint_method_name(view, cfg.own_code_root)
            elif request.endpoint:
                ctx.extra["route_method"] = str(request.endpoint).split(".")[-1]
            args = request.view_args or {}
            ids = [(k, v) for k, v in args.items() if k.endswith("_id") or k.endswith("Id") or k.endswith("_name")]
            if ids and ctx.resource_type is None:
                preferred = ("folder", "case", "file", "document", "user", "ticket", "session", "chat")

                def _score(key: str) -> int:
                    base = key.rsplit("_", 1)[0].lower() if "_" in key else key.lower()
                    for i, token in enumerate(preferred):
                        if token in base:
                            return i
                    return 99

                ids.sort(key=lambda kv: _score(kv[0]))
                ctx.resource_type = ids[0][0].rsplit("_", 1)[0].upper()[:50]
                ctx.resource_id = str(ids[0][1])[:100]
            recorder.flush_context(ctx)
            recorder.audit_request(ctx)
        except Exception as inner:  # noqa: BLE001
            log.debug("errorlog: flask teardown failed: %s", inner)
        finally:
            if token is not None:
                reset_context(token)

    @app.errorhandler(Exception)
    def _errorlog_handle(exc):  # type: ignore[no-untyped-def]
        ctx = getattr(g, "_errorlog_ctx", None)
        if WerkzeugHTTPException and isinstance(exc, WerkzeugHTTPException):
            if (exc.code or 500) >= 500:
                recorder.record_exception(exc, source=SOURCE_HTTP)
            return exc
        recorder.record_exception(exc, source=SOURCE_HTTP)
        rid = ctx.request_id if ctx is not None else new_request_id()
        body = jsonify({"error": SAFE_MESSAGE, "request_id": rid})
        body.status_code = 500
        body.headers["X-Request-Id"] = rid
        return body

    return ["flask.before_request", "flask.after_request", "flask.teardown_request", "flask.errorhandler(Exception)"]
