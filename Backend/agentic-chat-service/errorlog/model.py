"""The ErrorEvent record: one row of ``error_logs``."""
from __future__ import annotations

import datetime as _dt
import uuid
from dataclasses import dataclass, field, fields
from typing import Any, Dict, Optional

SOURCE_HTTP = "HTTP"
SOURCE_EXTERNAL = "EXTERNAL_API"
SOURCE_JOB = "JOB"
SOURCE_LOGGER = "LOGGER"
SOURCE_PROCESS = "PROCESS"
SOURCES = {SOURCE_HTTP, SOURCE_EXTERNAL, SOURCE_JOB, SOURCE_LOGGER, SOURCE_PROCESS}

CAT_INTERNAL = "INTERNAL"
CAT_DATABASE = "DATABASE"
CAT_TIMEOUT = "TIMEOUT"
CAT_AI_PROVIDER = "AI_PROVIDER"
CAT_AI_SAFETY = "AI_SAFETY_BLOCK"
CAT_AI_EMPTY = "AI_EMPTY_RESPONSE"
CAT_AI_INVALID = "AI_INVALID_OUTPUT"
CAT_CITATION = "CITATION_PROVIDER"
CAT_EXTERNAL = "EXTERNAL_API"
CATEGORIES = {
    CAT_INTERNAL, CAT_DATABASE, CAT_TIMEOUT, CAT_AI_PROVIDER, CAT_AI_SAFETY,
    CAT_AI_EMPTY, CAT_AI_INVALID, CAT_CITATION, CAT_EXTERNAL,
}

SEV_WARNING = "WARNING"
SEV_ERROR = "ERROR"
SEV_CRITICAL = "CRITICAL"
SEVERITIES = {SEV_WARNING, SEV_ERROR, SEV_CRITICAL}
SEVERITY_RANK = {SEV_WARNING: 0, SEV_ERROR: 1, SEV_CRITICAL: 2}

# Column order used for INSERTs; keep in sync with ddl.py and the migration.
COLUMNS = (
    "id", "created_at", "service_name", "environment", "source", "category", "severity",
    "request_id", "user_id", "user_email", "ip_address", "endpoint", "http_method",
    "method", "action", "resource_type", "resource_id", "status_code", "user_message",
    "error_type", "error_message", "stack_trace", "external_provider", "external_endpoint",
    "external_model", "external_status_code", "external_error_code", "external_response",
    "latency_ms", "payload", "fingerprint", "is_resolved", "resolved_by", "resolved_at",
    "resolution_note", "error_summary", "error_code", "what_happened", "suggested_fix",
)


def _now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


@dataclass
class ErrorEvent:
    service_name: str
    environment: str
    source: str = SOURCE_HTTP
    category: str = CAT_INTERNAL
    severity: str = SEV_ERROR
    error_type: str = "Error"
    error_message: str = ""
    stack_trace: Optional[str] = None
    method: Optional[str] = None
    frame: Optional[str] = None  # "file:line" of the first own-code frame (fingerprint input)
    request_id: Optional[str] = None
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    ip_address: Optional[str] = None
    endpoint: Optional[str] = None
    http_method: Optional[str] = None
    action: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    status_code: Optional[int] = None
    user_message: Optional[str] = None
    external_provider: Optional[str] = None
    external_endpoint: Optional[str] = None
    external_model: Optional[str] = None
    external_status_code: Optional[int] = None
    external_error_code: Optional[str] = None
    external_response: Optional[str] = None
    latency_ms: Optional[int] = None
    payload: Dict[str, Any] = field(default_factory=dict)
    fingerprint: Optional[str] = None
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: _dt.datetime = field(default_factory=_now)
    is_resolved: bool = False
    resolved_by: Optional[str] = None
    resolved_at: Optional[_dt.datetime] = None
    resolution_note: Optional[str] = None
    # plain-language reason a non-technical person can read
    error_summary: Optional[str] = None
    error_code: Optional[str] = None       # stable code: AUTH_EXPIRED, INTERNAL_ERROR, AI_QUOTA_EXCEEDED …
    what_happened: Optional[str] = None    # "The user tried to open the plan details, but the request was refused (HTTP 403)."
    suggested_fix: Optional[str] = None    # what to do about it
    # Internal only (not stored): the exception object, for de-duplication.
    exc_obj: Optional[BaseException] = field(default=None, repr=False, compare=False)
    exc_id: Optional[int] = None
    # Internal only: the error happened after the response had started (stream/background).
    after_response_start: bool = False

    def to_row(self, payload_json: Optional[str]) -> tuple:
        return (
            self.id, self.created_at, self.service_name, self.environment, self.source,
            self.category, self.severity, self.request_id, self.user_id, self.user_email,
            self.ip_address, self.endpoint, self.http_method, self.method, self.action,
            self.resource_type, self.resource_id, self.status_code, self.user_message,
            self.error_type, self.error_message, self.stack_trace, self.external_provider,
            self.external_endpoint, self.external_model, self.external_status_code,
            self.external_error_code, self.external_response, self.latency_ms, payload_json,
            self.fingerprint, self.is_resolved, self.resolved_by, self.resolved_at,
            self.resolution_note, self.error_summary, self.error_code, self.what_happened, self.suggested_fix,
        )

    def to_dict(self) -> Dict[str, Any]:
        """JSON-friendly dict for the HTTP ingest sink (same column names)."""
        out: Dict[str, Any] = {}
        for f in fields(self):
            if f.name in ("exc_obj", "exc_id", "after_response_start", "frame"):
                continue
            v = getattr(self, f.name)
            if isinstance(v, _dt.datetime):
                v = v.isoformat()
            out[f.name] = v
        return out

    def is_external(self) -> bool:
        return self.source == SOURCE_EXTERNAL


# ── API audit log: one row per request (who used which service and API) ─────

AUDIT_COLUMNS = (
    "id", "created_at", "service_name", "environment", "request_id", "user_id", "user_email",
    "ip_address", "http_method", "endpoint", "route", "status_code", "status", "duration_ms",
    "error_log_id", "user_agent", "resource_type", "resource_id", "action", "method",
    "error_type", "error_message", "user_message", "stack_trace", "error_summary", "error_code", "what_happened", "suggested_fix", "payload",
)
AUDIT_SUCCESS = "SUCCESS"
AUDIT_FAILED = "FAILED"


@dataclass
class AuditEvent:
    service_name: str
    environment: str
    request_id: Optional[str] = None
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    ip_address: Optional[str] = None
    http_method: Optional[str] = None
    endpoint: Optional[str] = None
    route: Optional[str] = None
    status_code: Optional[int] = None
    status: str = AUDIT_SUCCESS
    duration_ms: Optional[int] = None
    error_log_id: Optional[str] = None
    user_agent: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    action: Optional[str] = None
    method: Optional[str] = None
    # Filled only when the request failed: the exact internal error and what the user saw.
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    user_message: Optional[str] = None
    stack_trace: Optional[str] = None
    error_summary: Optional[str] = None
    error_code: Optional[str] = None
    what_happened: Optional[str] = None
    suggested_fix: Optional[str] = None
    payload: Dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: _dt.datetime = field(default_factory=_now)

    def to_row(self, payload_json: Optional[str]) -> tuple:
        return (
            self.id, self.created_at, self.service_name, self.environment, self.request_id,
            self.user_id, self.user_email, self.ip_address, self.http_method, self.endpoint,
            self.route, self.status_code, self.status, self.duration_ms, self.error_log_id,
            self.user_agent, self.resource_type, self.resource_id, self.action, self.method,
            self.error_type, self.error_message, self.user_message, self.stack_trace, self.error_summary, self.error_code, self.what_happened, self.suggested_fix, payload_json,
        )

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for f in fields(self):
            v = getattr(self, f.name)
            if isinstance(v, _dt.datetime):
                v = v.isoformat()
            out[f.name] = v
        return out
