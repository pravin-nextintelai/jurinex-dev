"""POST /internal/error-logs — ingest rows from services that cannot write to
the database (Node services, or anything configured with ERROR_LOG_INGEST_URL).

Protected by the ``X-Internal-Key`` header (env ERROR_LOG_INGEST_KEY). Hidden
from the OpenAPI schema. Accepts one object or a list of up to 100.

No ``from __future__ import annotations`` here: FastAPI must see real types on
the route signature, and the FastAPI imports are local to keep the package
importable without FastAPI.
"""
import datetime as _dt
import hmac
import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

from . import classify
from .config import Config
from .model import (
    AUDIT_FAILED,
    AUDIT_SUCCESS,
    CAT_INTERNAL,
    CATEGORIES,
    SEV_ERROR,
    SEVERITIES,
    SOURCE_HTTP,
    SOURCES,
    AuditEvent,
    ErrorEvent,
)
from .sanitize import (
    MAX_ERROR_MESSAGE,
    MAX_EXTERNAL_RESPONSE,
    MAX_STACK,
    MAX_USER_MESSAGE,
    mask_text,
    sanitize_payload,
    strip_query,
    tail,
    truncate,
)

log = logging.getLogger("errorlog")

MAX_BATCH = 100

_STR_LIMITS = {
    "service_name": 100, "environment": 20, "request_id": 64, "user_id": 64, "user_email": 255,
    "ip_address": 45, "endpoint": 500, "http_method": 10, "method": 255, "action": 30,
    "resource_type": 50, "resource_id": 100, "error_type": 255, "external_provider": 50,
    "external_endpoint": 500, "external_model": 100, "external_error_code": 100, "resolved_by": 255,
}
_INT_FIELDS = ("status_code", "external_status_code", "latency_ms")


def _str(value: Any, limit: int) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    return truncate(mask_text(value), limit) if value else None


def _int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _dt_parse(value: Any) -> Optional[_dt.datetime]:
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=_dt.timezone.utc)
    if isinstance(value, (int, float)):
        try:
            return _dt.datetime.fromtimestamp(value / (1000 if value > 1e11 else 1), tz=_dt.timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip().replace("Z", "+00:00")
        try:
            parsed = _dt.datetime.fromisoformat(text)
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=_dt.timezone.utc)
    return None


def coerce_row(raw: Dict[str, Any], default_service: str, default_env: str) -> Tuple[Optional[ErrorEvent], Optional[str]]:
    """Validate and sanitise one ingest row. Returns (event, error)."""
    if not isinstance(raw, dict):
        return None, "row must be an object"
    service = _str(raw.get("service_name"), 100) or default_service
    if not service:
        return None, "service_name is required"
    error_message = _str(raw.get("error_message"), MAX_ERROR_MESSAGE)
    error_type = _str(raw.get("error_type"), 255) or "Error"
    if not error_message and not raw.get("user_message"):
        return None, "error_message is required"
    source = (_str(raw.get("source"), 20) or SOURCE_HTTP).upper()
    if source not in SOURCES:
        source = SOURCE_HTTP
    category = (_str(raw.get("category"), 30) or CAT_INTERNAL).upper()
    if category not in CATEGORIES:
        category = CAT_INTERNAL
    severity = (_str(raw.get("severity"), 20) or SEV_ERROR).upper()
    if severity not in SEVERITIES:
        severity = SEV_ERROR

    ev = ErrorEvent(
        service_name=service,
        environment=_str(raw.get("environment"), 20) or default_env,
        source=source,
        category=category,
        severity=severity,
        error_type=error_type,
        error_message=error_message or "",
        stack_trace=tail(mask_text(raw.get("stack_trace")), MAX_STACK) if isinstance(raw.get("stack_trace"), str) else None,
        user_message=_str(raw.get("user_message"), MAX_USER_MESSAGE),
        external_response=_str(raw.get("external_response"), MAX_EXTERNAL_RESPONSE),
    )
    for key, limit in _STR_LIMITS.items():
        if key in ("service_name", "environment", "error_type"):
            continue
        setattr(ev, key, _str(raw.get(key), limit))
    if ev.external_endpoint:
        ev.external_endpoint = truncate(strip_query(ev.external_endpoint), 500)
    for key in _INT_FIELDS:
        setattr(ev, key, _int(raw.get(key)))
    payload = raw.get("payload")
    if isinstance(payload, dict):
        ev.payload = sanitize_payload(payload)
    elif payload is not None:
        ev.payload = {"value": sanitize_payload(payload)}
    rid = raw.get("id")
    if isinstance(rid, str):
        try:
            ev.id = str(uuid.UUID(rid))
        except ValueError:
            pass
    created = _dt_parse(raw.get("created_at"))
    if created is not None:
        ev.created_at = created
    ev.is_resolved = bool(raw.get("is_resolved", False))
    ev.resolved_at = _dt_parse(raw.get("resolved_at"))
    ev.resolution_note = _str(raw.get("resolution_note"), 4000)
    ev.error_summary = _str(raw.get("error_summary"), 500)
    ev.error_code = _str(raw.get("error_code"), 50)
    ev.what_happened = _str(raw.get("what_happened"), 500)
    ev.suggested_fix = _str(raw.get("suggested_fix"), 1000)
    fp = raw.get("fingerprint")
    if isinstance(fp, str) and 16 <= len(fp.strip()) <= 64:
        ev.fingerprint = fp.strip()
    else:
        ev.fingerprint = classify.fingerprint(
            ev.service_name, ev.error_type, ev.method, None, ev.external_provider, ev.external_error_code
        )
    return ev, None


def build_ingest_router(writer, cfg: Config):
    from fastapi import APIRouter, Header, HTTPException, Request

    router = APIRouter(include_in_schema=False)

    @router.post("/internal/error-logs")
    async def ingest_error_logs(request: Request, x_internal_key: Optional[str] = Header(default=None)):
        if not cfg.ingest_key:
            raise HTTPException(status_code=503, detail="error log ingest is not configured")
        if not x_internal_key or not hmac.compare_digest(x_internal_key.strip(), cfg.ingest_key):
            raise HTTPException(status_code=401, detail="invalid internal key")
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="body must be JSON")
        rows: List[Any] = body if isinstance(body, list) else [body]
        if len(rows) > MAX_BATCH:
            raise HTTPException(status_code=413, detail=f"at most {MAX_BATCH} rows per request")
        accepted = 0
        dropped = 0
        rejected: List[Dict[str, Any]] = []
        for index, raw in enumerate(rows):
            ev, err = coerce_row(raw, default_service="unknown-service", default_env=cfg.environment)
            if ev is None:
                rejected.append({"index": index, "error": err})
                continue
            if writer.enqueue(ev):
                accepted += 1
            else:
                dropped += 1
        return {"accepted": accepted, "dropped": dropped, "rejected": rejected[:20], "rejected_count": len(rejected)}

    @router.post("/internal/audit-logs")
    async def ingest_audit_logs(request: Request, x_internal_key: Optional[str] = Header(default=None)):
        if not cfg.ingest_key:
            raise HTTPException(status_code=503, detail="error log ingest is not configured")
        if not x_internal_key or not hmac.compare_digest(x_internal_key.strip(), cfg.ingest_key):
            raise HTTPException(status_code=401, detail="invalid internal key")
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="body must be JSON")
        rows: List[Any] = body if isinstance(body, list) else [body]
        if len(rows) > MAX_BATCH:
            raise HTTPException(status_code=413, detail=f"at most {MAX_BATCH} rows per request")
        accepted = 0
        dropped = 0
        rejected: List[Dict[str, Any]] = []
        for index, raw in enumerate(rows):
            ev, err = coerce_audit_row(raw, default_env=cfg.environment)
            if ev is None:
                rejected.append({"index": index, "error": err})
                continue
            if writer.enqueue(ev):
                accepted += 1
            else:
                dropped += 1
        return {"accepted": accepted, "dropped": dropped, "rejected": rejected[:20], "rejected_count": len(rejected)}

    return router


def coerce_audit_row(raw: Dict[str, Any], default_env: str) -> Tuple[Optional[AuditEvent], Optional[str]]:
    if not isinstance(raw, dict):
        return None, "row must be an object"
    service = _str(raw.get("service_name"), 100)
    if not service:
        return None, "service_name is required"
    status = (_str(raw.get("status"), 10) or AUDIT_SUCCESS).upper()
    ev = AuditEvent(
        service_name=service,
        environment=_str(raw.get("environment"), 20) or default_env,
        request_id=_str(raw.get("request_id"), 64),
        user_id=_str(raw.get("user_id"), 64),
        user_email=_str(raw.get("user_email"), 255),
        ip_address=_str(raw.get("ip_address"), 45),
        http_method=_str(raw.get("http_method"), 10),
        endpoint=_str(raw.get("endpoint"), 500),
        route=_str(raw.get("route"), 500),
        status_code=_int(raw.get("status_code")),
        status=AUDIT_FAILED if status == AUDIT_FAILED else AUDIT_SUCCESS,
        duration_ms=_int(raw.get("duration_ms")),
        user_agent=_str(raw.get("user_agent"), 300),
        resource_type=_str(raw.get("resource_type"), 50),
        resource_id=_str(raw.get("resource_id"), 100),
        action=_str(raw.get("action"), 30),
        method=_str(raw.get("method"), 255),
        error_type=_str(raw.get("error_type"), 255),
        error_message=_str(raw.get("error_message"), 4000),
        user_message=_str(raw.get("user_message"), 1000),
        stack_trace=tail(mask_text(raw.get("stack_trace")), MAX_STACK) if isinstance(raw.get("stack_trace"), str) else None,
        error_summary=_str(raw.get("error_summary"), 500),
        error_code=_str(raw.get("error_code"), 50),
        what_happened=_str(raw.get("what_happened"), 500),
        suggested_fix=_str(raw.get("suggested_fix"), 1000),
    )
    if not ev.action or not ev.resource_type or not ev.method:
        from . import auditmeta
        payload_method = None
        if isinstance(raw.get("payload"), dict):
            payload_method = raw["payload"].get("method")
        meta = auditmeta.enrich(
            http_method=ev.http_method,
            endpoint=ev.endpoint,
            route=ev.route,
            resource_type=ev.resource_type,
            resource_id=ev.resource_id,
            action=ev.action,
            route_method=ev.method or payload_method,
            service_name=ev.service_name,
        )
        ev.action = ev.action or meta["action"]
        ev.resource_type = ev.resource_type or meta["resource_type"]
        ev.resource_id = ev.resource_id or meta["resource_id"]
        ev.method = ev.method or meta["method"]
    for key in ("id", "error_log_id"):
        val = raw.get(key)
        if isinstance(val, str):
            try:
                setattr(ev, key, str(uuid.UUID(val)))
            except ValueError:
                if key == "error_log_id":
                    ev.error_log_id = None
    created = _dt_parse(raw.get("created_at"))
    if created is not None:
        ev.created_at = created
    payload = raw.get("payload")
    if isinstance(payload, dict):
        ev.payload = sanitize_payload(payload)
    return ev, None
