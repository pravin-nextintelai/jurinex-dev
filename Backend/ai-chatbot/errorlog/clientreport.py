"""Browser-reported errors: failures the frontend sees that no backend ever does
(a Razorpay window closed, a React render crash, an unhandled promise rejection,
a network failure). Mounted by ``install(app, client_report_path=...)`` behind
the service's own verified-JWT dependency so rows carry the user's id.

Body (JSON):
  kind      cancelled | failed | verify-failed | unhandled | render | network | error
  flow      short name of the feature ("token-topup", "chat", "app")
  message   what the user saw
  error     { name, message, stack }
  url       the request that failed (network kind), query string is stripped
  status    HTTP status the browser saw, if any
  page      page path
  razorpay  the Razorpay ``payment.failed`` payload for payment kinds
  order_id, payment_id, plan_id, plan_name, amount, currency, details

No ``from __future__ import annotations`` here: FastAPI needs real types.
"""
import threading
import time
from typing import Any, Dict, Optional

from .config import Config
from .context import client_ip, get_context, peek_jwt_claims
from .model import (
    CAT_EXTERNAL,
    CAT_INTERNAL,
    CAT_TIMEOUT,
    SEV_ERROR,
    SEV_WARNING,
    SOURCE_EXTERNAL,
    SOURCE_HTTP,
    ErrorEvent,
)
from .recorder import Recorder
from .sanitize import (
    MAX_ERROR_MESSAGE,
    MAX_EXTERNAL_RESPONSE,
    MAX_STACK,
    MAX_USER_MESSAGE,
    host_of,
    mask_text,
    strip_query,
    tail,
    truncate,
)

KINDS = {
    "cancelled": ("PaymentCancelled", SEV_WARNING),
    "failed": ("PaymentFailed", SEV_ERROR),
    "verify-failed": ("PaymentVerifyFailed", SEV_ERROR),
    "unhandled": ("ClientUnhandledError", SEV_ERROR),
    "render": ("ClientRenderError", SEV_ERROR),
    "network": ("ClientNetworkError", SEV_ERROR),
    "error": ("ClientError", SEV_ERROR),
}
PAYMENT_KINDS = {"cancelled", "failed", "verify-failed"}
RATE_LIMIT_PER_MINUTE = 60


class _RateLimiter:
    def __init__(self, limit: int = RATE_LIMIT_PER_MINUTE, window_s: float = 60.0) -> None:
        self.limit = limit
        self.window = window_s
        self._hits: Dict[str, list] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < self.window]
            if len(hits) >= self.limit:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            if len(self._hits) > 5000:  # keep the table bounded
                self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] < self.window}
            return True


def _s(value: Any, limit: int) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        import json

        try:
            value = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:  # noqa: BLE001
            value = str(value)
    text = str(value).strip()
    return truncate(mask_text(text), limit) or None


def _user_fields(user: Any) -> tuple:
    if isinstance(user, dict):
        uid = user.get("id") or user.get("user_id") or user.get("userId") or user.get("sub")
        email = user.get("email")
    else:
        uid = getattr(user, "id", None) or getattr(user, "user_id", None)
        email = getattr(user, "email", None)
    uid = str(uid)[:64] if uid not in (None, "") else None
    email = email[:255] if isinstance(email, str) and email else None
    return uid, email


def build_event(recorder: Recorder, cfg: Config, body: Dict[str, Any], user: Any, headers: Dict[str, str], peer: Optional[str]) -> ErrorEvent:
    kind = body.get("kind") if body.get("kind") in KINDS else "error"
    default_type, severity = KINDS[kind]
    flow = (_s(body.get("flow"), 50) or "app").lower()
    flow = "".join(ch if ch.isalnum() or ch in "-_.:" else "-" for ch in flow)
    err = body.get("error") if isinstance(body.get("error"), dict) else {}
    err_name = _s(err.get("name"), 100)
    err_msg = _s(err.get("message"), 2000)
    stack = tail(mask_text(str(err.get("stack"))), MAX_STACK) if isinstance(err.get("stack"), str) and err.get("stack") else None
    message = _s(body.get("message"), MAX_USER_MESSAGE) or err_msg or ("Payment cancelled" if kind == "cancelled" else "Error")
    page = _s(body.get("page") or headers.get("referer"), 500)
    url = strip_query(_s(body.get("url"), 500)) if body.get("url") else None
    status = body.get("status") if isinstance(body.get("status"), int) and not isinstance(body.get("status"), bool) else None
    payload: Dict[str, Any] = {"client_report": True, "kind": kind, "flow": flow}
    if page:
        payload["page"] = page
    display = body.get("display")
    if isinstance(display, str) and display:
        payload["display"] = display[:30]
    ua = headers.get("user-agent")
    if ua:
        payload["user_agent"] = truncate(ua, 300)
    details = body.get("details")
    if isinstance(details, dict) and details:
        payload["details"] = details
    for key in ("plan_id", "plan_name", "order_id", "payment_id", "currency"):
        if body.get(key) not in (None, ""):
            payload[key] = _s(body.get(key), 200)
    if isinstance(body.get("amount"), (int, float)) and not isinstance(body.get("amount"), bool):
        payload["amount"] = body["amount"]

    ev = recorder._base(  # noqa: SLF001
        source=SOURCE_HTTP,
        category=CAT_INTERNAL,
        severity=severity,
        error_type=(err_name or default_type)[:255],
        error_message=truncate(mask_text(f"{flow}: {err_msg or message}"), MAX_ERROR_MESSAGE) or "",
        stack_trace=stack,
        user_message=message,
        endpoint=f"client:{flow}"[:500],
        method=f"client.{flow}.{kind}"[:255],
        payload=payload,
    )
    if kind in PAYMENT_KINDS:
        provider = (_s(body.get("provider"), 50) or "RAZORPAY").upper()
        rz = body.get("razorpay") if isinstance(body.get("razorpay"), dict) else {}
        rz_err = rz.get("error") if isinstance(rz.get("error"), dict) else {}
        meta = rz_err.get("metadata") if isinstance(rz_err.get("metadata"), dict) else {}
        description = _s(rz_err.get("description") or body.get("description"), MAX_EXTERNAL_RESPONSE)
        ev.source = SOURCE_EXTERNAL
        ev.category = CAT_EXTERNAL
        ev.error_type = default_type
        ev.external_provider = provider
        ev.external_endpoint = f"{provider.lower()}.checkout"
        ev.external_error_code = _s(rz_err.get("code") or body.get("code") or ("USER_CANCELLED" if kind == "cancelled" else None), 100)
        ev.external_response = description
        if description:
            ev.error_message = truncate(mask_text(f"{flow}: {description}"), MAX_ERROR_MESSAGE) or ""
        for key in ("reason", "step", "source"):
            if rz_err.get(key):
                payload[key] = _s(rz_err.get(key), 100)
        for key in ("order_id", "payment_id"):
            if meta.get(key):
                payload[key] = _s(meta.get(key), 100)
    elif kind == "network":
        host = host_of(url)
        ev.source = SOURCE_EXTERNAL
        ev.category = CAT_TIMEOUT if (err_msg and "timeout" in err_msg.lower()) else CAT_EXTERNAL
        ev.external_provider = cfg.provider_for_host(host) or (host.split(":")[0][:50].upper() if host else None)
        ev.external_endpoint = url
        ev.external_status_code = status
        if not err_name:
            ev.error_type = default_type
    else:
        ev.status_code = status
    ev.user_id, ev.user_email = _user_fields(user)
    ev.ip_address = client_ip(headers, peer)
    return ev


def build_client_report_router(recorder: Recorder, cfg: Config, path: str, dependency=None):
    from fastapi import APIRouter, Depends, Header, HTTPException, Request

    router = APIRouter(include_in_schema=False)
    limiter = _RateLimiter()

    def _suppress() -> None:
        ctx = get_context()
        if ctx is not None:
            ctx.suppress = True

    if dependency is not None:
        async def current_user(request: Request, user: Any = Depends(dependency)) -> Any:  # noqa: B008
            return user
    else:
        async def current_user(request: Request, authorization: Optional[str] = Header(default=None)) -> Any:
            claims = peek_jwt_claims(authorization)
            uid, _ = _user_fields(claims)
            if not uid:
                _suppress()
                raise HTTPException(status_code=401, detail="Authentication token required")
            return claims

    @router.post(path, status_code=202)
    async def report_client_error(request: Request, user: Any = Depends(current_user)):  # noqa: B008
        headers = {k.lower(): v for k, v in request.headers.items()}
        uid, _ = _user_fields(user)
        key = uid or client_ip(headers, request.client.host if request.client else None) or "anonymous"
        if not limiter.allow(key):
            _suppress()
            raise HTTPException(status_code=429, detail="Too many error reports")
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            _suppress()
            raise HTTPException(status_code=400, detail="Body must be JSON")
        if not isinstance(body, dict):
            _suppress()
            raise HTTPException(status_code=400, detail="Body must be an object")
        ev = build_event(recorder, cfg, body, user, headers, request.client.host if request.client else None)
        rid = recorder.record_now(ev)
        return {"success": True, "request_id": rid}

    return router
