"""Request context (contextvars) and the per-request list of pending errors."""
from __future__ import annotations

import base64
import contextvars
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from .model import ErrorEvent


@dataclass
class RequestContext:
    request_id: str
    ip_address: Optional[str] = None
    endpoint: Optional[str] = None
    http_method: Optional[str] = None
    user_agent: Optional[str] = None
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    route_template: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    action: Optional[str] = None
    method_override: Optional[str] = None
    started_at: float = field(default_factory=time.perf_counter)
    pending: List[ErrorEvent] = field(default_factory=list)
    seen_exc_ids: Set[int] = field(default_factory=set)
    response_started: bool = False
    response_complete: bool = False
    streaming: bool = False
    status_code: Optional[int] = None
    content_type: Optional[str] = None
    body_peek: bytearray = field(default_factory=bytearray)
    user_message: Optional[str] = None
    flushed: bool = False
    escaped_exception: bool = False
    # Set by the error logger's own routes (client reports) when they answer 4xx:
    # their refusals are not application errors.
    suppress: bool = False
    # ids of the error_logs rows written for this request (the audit row links to them)
    written_ids: List[str] = field(default_factory=list)
    # the error events themselves, so the audit row can carry the error text
    written_events: List[Any] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)


_ctx: contextvars.ContextVar[Optional[RequestContext]] = contextvars.ContextVar("errorlog_ctx", default=None)
# True while a Gemini SDK call is in progress: the HTTP hook then leaves Gemini
# hosts to the SDK wrapper so one failure is not recorded twice.
_in_sdk: contextvars.ContextVar[bool] = contextvars.ContextVar("errorlog_in_sdk", default=False)
# True on the writer thread and inside the logger itself (recursion guard).
_internal: contextvars.ContextVar[bool] = contextvars.ContextVar("errorlog_internal", default=False)


def get_context() -> Optional[RequestContext]:
    return _ctx.get()


def set_context(ctx: Optional[RequestContext]) -> contextvars.Token:
    return _ctx.set(ctx)


def reset_context(token: contextvars.Token) -> None:
    try:
        _ctx.reset(token)
    except (ValueError, LookupError):
        pass


def in_sdk_call() -> bool:
    return _in_sdk.get()


def is_internal() -> bool:
    return _internal.get()


def mark_internal(value: bool = True) -> contextvars.Token:
    return _internal.set(value)


def new_request_id() -> str:
    return uuid.uuid4().hex


def set_user(user_id: Optional[Any] = None, user_email: Optional[str] = None) -> None:
    """Attach the resolved user to the current request (safe to call anywhere)."""
    ctx = _ctx.get()
    if ctx is None:
        return
    if user_id is not None and str(user_id).strip():
        ctx.user_id = str(user_id)[:64]
    if user_email and isinstance(user_email, str):
        ctx.user_email = user_email[:255]


def attach(
    *,
    method: Optional[str] = None,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[Any] = None,
    **extra: Any,
) -> None:
    """Attach audit-style fields to whatever error this request ends up recording."""
    ctx = _ctx.get()
    if ctx is None:
        return
    if method:
        ctx.method_override = method[:255]
    if action:
        ctx.action = action[:30]
    if resource_type:
        ctx.resource_type = resource_type[:50]
    if resource_id is not None:
        ctx.resource_id = str(resource_id)[:100]
    if extra:
        ctx.extra.update(extra)


# ── user identity from headers (no verification; attribution only) ────────────

_ID_KEYS = ("id", "user_id", "userId", "uid", "sub")
_EMAIL_KEYS = ("email", "user_email", "preferred_username", "userEmail", "mail")


def peek_jwt_claims(authorization: Optional[str]) -> Dict[str, Any]:
    """Decode a JWT payload WITHOUT verifying it. Used only to attribute errors.

    A forged token fails the service's own auth and the request ends as 401,
    which is never stored, so an attacker cannot plant attribution this way.
    """
    if not authorization or not isinstance(authorization, str):
        return {}
    token = authorization.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")).decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _email_from_obj(obj: Any) -> Optional[str]:
    if not isinstance(obj, dict):
        return None
    for key in _EMAIL_KEYS:
        val = obj.get(key)
        if isinstance(val, str) and "@" in val:
            return val[:255]
    nested = obj.get("user")
    if isinstance(nested, dict):
        for key in _EMAIL_KEYS:
            val = nested.get(key)
            if isinstance(val, str) and "@" in val:
                return val[:255]
    return None


def user_from_headers(headers: Dict[str, str]) -> tuple:
    """(user_id, user_email) from x-user-id / x-user-email / Authorization, or (None, None)."""
    user_id: Optional[str] = None
    email: Optional[str] = None
    xuid = headers.get("x-user-id")
    if xuid and xuid.strip():
        user_id = xuid.strip()[:64]
    xemail = headers.get("x-user-email")
    if xemail and "@" in xemail:
        email = xemail.strip()[:255]
    claims = peek_jwt_claims(headers.get("authorization"))
    if claims:
        if user_id is None:
            for key in _ID_KEYS:
                val = claims.get(key)
                if val not in (None, ""):
                    user_id = str(val)[:64]
                    break
        if email is None:
            email = _email_from_obj(claims)
    return user_id, email


def client_ip(headers: Dict[str, str], peer: Optional[str]) -> Optional[str]:
    xff = headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first[:45]
    real = headers.get("x-real-ip")
    if real and real.strip():
        return real.strip()[:45]
    return (peer or None) and str(peer)[:45]
