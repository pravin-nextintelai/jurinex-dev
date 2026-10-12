"""Pure ASGI middleware: request context, request id, response hook, flush.

It is installed *outside* Starlette's ServerErrorMiddleware (see ``install``),
so it sees the final status and body of every response, including the 500 an
exception handler produced, and it sees exceptions re-raised after that.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Callable, Dict, Optional

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

_RID_RE = re.compile(r"^[A-Za-z0-9._:\-]{1,64}$")
_STREAMING_TYPES = ("text/event-stream", "application/x-ndjson", "application/stream+json")


def _headers(scope: Dict[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k, v in scope.get("headers") or []:
        try:
            key = k.decode("latin-1").lower()
            if key not in out:
                out[key] = v.decode("latin-1")
        except Exception:  # noqa: BLE001
            continue
    return out


def _resource_from_path_params(params: Optional[Dict[str, Any]]) -> tuple:
    """(resource_type, resource_id) from ``*_id`` / ``*_name`` path params."""
    if not params or not isinstance(params, dict):
        return None, None
    ids = [(k, v) for k, v in params.items() if isinstance(k, str) and (k.endswith("_id") or k.endswith("Id") or k.endswith("_name"))]
    if not ids:
        return None, None
    preferred = ("folder", "case", "file", "document", "user", "ticket", "session", "chat")

    def _score(key: str) -> int:
        base = re.sub(r"(_id|Id|_name)$", "", key).lower()
        for i, token in enumerate(preferred):
            if token in base:
                return i
        return 99

    ids.sort(key=lambda kv: _score(kv[0]))
    k, v = ids[0]
    base = re.sub(r"(_id|Id|_name)$", "", k)
    rtype = re.sub(r"(?<!^)(?=[A-Z])", "_", base).upper()[:50] or None
    return rtype, (str(v)[:100] if v is not None else None)


class ErrorLogASGIMiddleware:
    def __init__(self, app: Callable, recorder: Recorder, cfg: Config, loop_hook: Optional[Callable[[], None]] = None) -> None:
        self.app = app
        self.recorder = recorder
        self.cfg = cfg
        self._loop_hook = loop_hook

    def _ensure_loop_hook(self) -> None:
        if self._loop_hook is None:
            return
        try:
            self._loop_hook()
        except Exception:  # noqa: BLE001
            pass

    async def __call__(self, scope: Dict[str, Any], receive: Callable, send: Callable) -> None:
        if scope.get("type") != "http":
            self._ensure_loop_hook()
            await self.app(scope, receive, send)
            return
        self._ensure_loop_hook()

        headers = _headers(scope)
        incoming = (headers.get("x-request-id") or "").strip()
        rid = incoming if incoming and _RID_RE.match(incoming) else new_request_id()
        client = scope.get("client") or (None, None)
        ctx = RequestContext(
            request_id=rid,
            ip_address=client_ip(headers, client[0] if client else None),
            endpoint=((scope.get("root_path") or "") + (scope.get("path") or ""))[:500],
            http_method=(scope.get("method") or "")[:10] or None,
            user_agent=headers.get("user-agent"),
        )
        ctx.user_id, ctx.user_email = user_from_headers(headers)
        token = set_context(ctx)
        rid_bytes = rid.encode("latin-1")
        peek_limit = self.cfg.body_peek_bytes

        async def send_wrapper(message: Dict[str, Any]) -> None:
            mtype = message.get("type")
            if mtype == "http.response.start":
                ctx.status_code = int(message.get("status") or 0) or None
                raw = list(message.get("headers") or [])
                has_rid = False
                for k, v in raw:
                    kl = k.lower()
                    if kl == b"x-request-id":
                        has_rid = True
                        # A service that already issues request ids (citation-service)
                        # wins, so the stored row matches what the client saw.
                        if not incoming:
                            try:
                                theirs = v.decode("latin-1").strip()
                                if theirs and _RID_RE.match(theirs):
                                    ctx.request_id = theirs
                            except Exception:  # noqa: BLE001
                                pass
                    elif kl == b"content-type":
                        try:
                            ctx.content_type = v.decode("latin-1")
                        except Exception:  # noqa: BLE001
                            ctx.content_type = None
                if not has_rid:
                    raw.append((b"x-request-id", rid_bytes))
                # Let browser code read x-request-id on cross-origin responses, so the
                # frontend reporter can tell which failures this backend already stored.
                expose_idx = next((i for i, (k, _) in enumerate(raw) if k.lower() == b"access-control-expose-headers"), None)
                if expose_idx is None:
                    raw.append((b"access-control-expose-headers", b"x-request-id"))
                elif b"x-request-id" not in raw[expose_idx][1].lower() and b"*" not in raw[expose_idx][1]:
                    raw[expose_idx] = (raw[expose_idx][0], raw[expose_idx][1] + b", x-request-id")
                message = dict(message)
                message["headers"] = raw
                ct = (ctx.content_type or "").lower()
                ctx.streaming = any(t in ct for t in _STREAMING_TYPES)
                ctx.response_started = True
            elif mtype == "http.response.body":
                body = message.get("body") or b""
                if (
                    body
                    and ctx.status_code is not None
                    and ctx.status_code >= 400
                    and not ctx.streaming
                    and len(ctx.body_peek) < peek_limit
                ):
                    ctx.body_peek.extend(body[: peek_limit - len(ctx.body_peek)])
                if not message.get("more_body", False):
                    ctx.response_complete = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except BaseException as exc:
            if isinstance(exc, Exception) and not isinstance(exc, asyncio.CancelledError):
                after = ctx.response_started and (ctx.status_code or 500) < 500
                ctx.escaped_exception = True
                self.recorder.record_exception(exc, source=SOURCE_HTTP, after_response_start=after)
            raise
        finally:
            try:
                self._finish(ctx, scope)
            except Exception as exc:  # noqa: BLE001
                log.debug("errorlog: finish failed: %s", exc)
            if not ctx.escaped_exception:
                reset_context(token)
            # On the exception path the context stays set: the server logs the
            # exception afterwards in this same task and the logging hook must
            # still see the request to de-duplicate it.

    def _finish(self, ctx: RequestContext, scope: Dict[str, Any]) -> None:
        if ctx.status_code is not None and ctx.status_code >= 400 and ctx.body_peek:
            ctx.user_message = extract_user_message(bytes(ctx.body_peek), ctx.content_type)
        route = scope.get("route")
        if route is not None:
            ctx.route_template = getattr(route, "path_format", None) or getattr(route, "path", None)
        endpoint = scope.get("endpoint") or getattr(route, "endpoint", None)
        if endpoint is not None:
            try:
                ctx.extra["route_method"] = endpoint_method_name(endpoint, self.cfg.own_code_root)
            except Exception:  # noqa: BLE001
                pass
        if not ctx.extra.get("route_method") and route is not None:
            name = getattr(route, "name", None)
            if isinstance(name, str) and name and name not in ("http", "websocket"):
                ctx.extra["route_method"] = name
        if not ctx.user_email or not ctx.user_id:
            uid, email = user_from_headers(_headers(scope))
            ctx.user_id = ctx.user_id or uid
            ctx.user_email = ctx.user_email or email
        if ctx.resource_type is None:
            rtype, rid = _resource_from_path_params(scope.get("path_params"))
            if rtype:
                ctx.resource_type, ctx.resource_id = rtype, rid
        if ctx.response_started or ctx.pending:
            self.recorder.flush_context(ctx)
        # One audit row per request: who used which API, with the error row linked.
        self.recorder.audit_request(ctx)
