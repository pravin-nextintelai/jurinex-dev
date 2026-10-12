"""Category / severity classification and the fingerprint."""
from __future__ import annotations

import hashlib
import re
from typing import Iterable, Optional, Tuple

from .config import AI_PROVIDERS
from .model import (
    CAT_AI_PROVIDER,
    CAT_CITATION,
    CAT_DATABASE,
    CAT_EXTERNAL,
    CAT_INTERNAL,
    CAT_TIMEOUT,
    SEV_CRITICAL,
    SEV_ERROR,
    SEV_WARNING,
)

_DB_MODULES = ("psycopg", "psycopg2", "asyncpg", "sqlalchemy", "pg8000", "redis", "neo4j", "elasticsearch", "qdrant")
_DB_CONNECTION_NAMES = {
    "OperationalError", "InterfaceError", "ConnectionDoesNotExistError", "CannotConnectNowError",
    "TooManyConnectionsError", "PoolTimeout", "PoolClosed", "ConnectionError", "DisconnectionError",
    "ConnectionFailure", "InvalidCatalogNameError", "InvalidPasswordError",
}
_DB_CONN_MSG_RE = re.compile(
    r"(connection refused|could not connect|server closed the connection|connection reset|"
    r"too many connections|the database system is (starting|shutting)|timeout expired|"
    r"password authentication failed|no route to host|name or service not known|"
    r"connection timed out|pool exhausted|couldn't get a connection|SSL SYSCALL error)",
    re.IGNORECASE,
)
_TIMEOUT_NAMES = {
    "TimeoutError", "TimeoutException", "ConnectTimeout", "ReadTimeout", "WriteTimeout", "PoolTimeout",
    "DeadlineExceeded", "ServerTimeoutError", "CancelledError", "FuturesTimeoutError",
}
_AI_QUOTA_CODES = {"RESOURCE_EXHAUSTED", "PERMISSION_DENIED", "UNAUTHENTICATED", "QUOTA_EXCEEDED", "429", "401", "403"}
_TIMEOUT_CODES = {"DEADLINE_EXCEEDED", "TIMEOUT", "504", "408", "ETIMEDOUT", "ECONNABORTED"}


def _mro_names(exc: BaseException) -> Iterable[str]:
    for cls in type(exc).__mro__:
        yield cls.__name__


def _modules(exc: BaseException) -> Iterable[str]:
    for cls in type(exc).__mro__:
        yield (cls.__module__ or "").split(".")[0]


def is_timeout(exc: BaseException) -> bool:
    names = set(_mro_names(exc))
    if names & _TIMEOUT_NAMES:
        return True
    if isinstance(exc, TimeoutError):
        return True
    msg = str(exc).lower()
    return "timed out" in msg or "timeout" in msg and "deadline" in msg


def is_database_error(exc: BaseException) -> bool:
    mods = set(_modules(exc))
    if mods & set(_DB_MODULES):
        return True
    names = set(_mro_names(exc))
    return bool(names & {"DatabaseError", "DBAPIError", "PostgresError", "PoolError"})


def is_database_connection_error(exc: BaseException) -> bool:
    if not is_database_error(exc):
        return False
    names = set(_mro_names(exc))
    if names & _DB_CONNECTION_NAMES:
        return True
    return bool(_DB_CONN_MSG_RE.search(str(exc) or ""))


def classify_exception(exc: BaseException) -> Tuple[str, str]:
    """Return (category, severity) for an exception raised inside our own process."""
    if isinstance(exc, MemoryError) or "OutOfMemory" in set(_mro_names(exc)):
        return CAT_INTERNAL, SEV_CRITICAL
    if is_database_connection_error(exc):
        return CAT_DATABASE, SEV_CRITICAL
    if is_database_error(exc):
        return CAT_DATABASE, SEV_ERROR
    if is_timeout(exc):
        return CAT_TIMEOUT, SEV_ERROR
    return CAT_INTERNAL, SEV_ERROR


def category_for_provider(provider: Optional[str], *, timeout: bool = False) -> str:
    if timeout:
        return CAT_TIMEOUT
    if provider in AI_PROVIDERS:
        return CAT_AI_PROVIDER
    if provider == "CITATION":
        return CAT_CITATION
    return CAT_EXTERNAL


def severity_for_external(
    provider: Optional[str],
    status: Optional[int],
    error_code: Optional[str],
    *,
    default: str = SEV_ERROR,
) -> str:
    code = (error_code or "").upper()
    if provider in AI_PROVIDERS:
        if status in (401, 403, 429) or code in _AI_QUOTA_CODES:
            return SEV_CRITICAL
    return default


def is_timeout_code(status: Optional[int], error_code: Optional[str]) -> bool:
    code = (error_code or "").upper()
    return status in (408, 504) or code in _TIMEOUT_CODES


def fingerprint(
    service_name: str,
    error_type: Optional[str],
    method: Optional[str],
    frame: Optional[str],
    external_provider: Optional[str],
    external_error_code: Optional[str],
) -> str:
    raw = "|".join(
        [
            service_name or "",
            error_type or "",
            method or "",
            frame or "",
            external_provider or "",
            external_error_code or "",
        ]
    )
    return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()


__all__ = [
    "classify_exception", "category_for_provider", "severity_for_external", "fingerprint",
    "is_timeout", "is_timeout_code", "is_database_error", "is_database_connection_error",
    "SEV_WARNING", "SEV_ERROR", "SEV_CRITICAL",
]


# ── plain-language reason ────────────────────────────────────────────────────

_PROVIDER_NAMES = {
    "GEMINI": "the AI model (Gemini)",
    "ANTHROPIC": "the AI model (Claude)",
    "OPENAI": "the AI model (OpenAI)",
    "DEEPSEEK": "the AI model (DeepSeek)",
    "CITATION": "the citation provider (Indian Kanoon)",
    "RAZORPAY": "the payment gateway (Razorpay)",
    "GCS": "cloud file storage",
    "DOCUMENT_AI": "the document reading service (Google Document AI)",
    "SPEECH": "the speech service",
    "BREVO": "the email service (Brevo)",
    "ZOHO": "the Zoho editor",
    "MICROSOFT": "Microsoft 365",
    "PAYMENT_SERVICE": "the payment service",
    "AUTH_SERVICE": "the login service",
    "FILE_SERVICE": "the document service",
    "CHAT_SERVICE": "the chat service",
}
_STATUS_REASONS = {
    400: "the request sent was invalid",
    401: "the user was not logged in or the session had expired",
    402: "payment or quota is required to continue",
    403: "the user is not allowed to do this",
    404: "the requested item does not exist",
    405: "this action is not supported on that address",
    409: "it conflicts with something that already exists",
    413: "the file or request was too large",
    415: "the file type is not supported",
    422: "some of the data entered was not valid",
    429: "too many requests were made in a short time",
    500: "the server hit an internal problem",
    502: "a service behind the server did not answer correctly",
    503: "the service was temporarily unavailable",
    504: "a service behind the server took too long to answer",
}
_CLIENT_SUMMARIES = {
    "PaymentCancelled": "The user closed the payment window before paying.",
    "PaymentFailed": "The payment was declined or failed at the payment gateway.",
    "PaymentVerifyFailed": "The payment went through but the server could not confirm it.",
    "ClientNetworkError": "The browser could not reach the server or the file storage.",
    "ClientRenderError": "The page crashed while drawing on screen.",
    "ClientUnhandledError": "A programming error happened inside the browser page.",
    "ClientError": "An error happened in the browser.",
}
_BUG_TYPES = {
    "KeyError", "AttributeError", "TypeError", "ValueError", "IndexError", "AssertionError",
    "NameError", "ZeroDivisionError", "ReferenceError", "RangeError", "SyntaxError",
}


def _plain(text, limit):
    t = (text or "").strip().replace("\n", " ")
    return t if len(t) <= limit else t[: limit - 1] + "…"


def _cap(text):
    return text[:1].upper() + text[1:]


def _provider_name(provider):
    if not provider:
        return "an outside service"
    return _PROVIDER_NAMES.get(provider, provider.replace("_", " ").lower() + " service")


def summarize(
    *,
    source,
    category,
    severity,
    error_type,
    error_message,
    status_code,
    external_provider=None,
    external_status_code=None,
    external_error_code=None,
):
    """One sentence a non-technical person can read: why did this happen."""
    et = error_type or ""
    if et in _CLIENT_SUMMARIES:
        return _CLIENT_SUMMARIES[et]
    if external_provider or source == "EXTERNAL_API":
        name = _provider_name(external_provider)
        code = (external_error_code or "").upper()
        if category == "TIMEOUT" or code in ("DEADLINE_EXCEEDED", "ETIMEDOUT"):
            return _cap(f"{name} took too long to answer, so the request timed out.")
        if category == "AI_SAFETY_BLOCK":
            return "The AI model refused to answer because the content tripped its safety rules."
        if category == "AI_EMPTY_RESPONSE":
            if code == "MAX_TOKENS":
                return "The AI answer was cut off because it reached the maximum length."
            return "The AI model returned an empty answer."
        if category == "AI_INVALID_OUTPUT":
            return "The AI model answered in a format the system could not read."
        st = external_status_code
        if st in (401, 403) or code in ("UNAUTHENTICATED", "PERMISSION_DENIED", "API_KEY_INVALID"):
            return _cap(f"{name} rejected our credentials (API key or token), so the call was refused.")
        if st == 429 or code == "RESOURCE_EXHAUSTED":
            return _cap(f"the quota or rate limit for {name} was used up.")
        if st is not None and st >= 500:
            return _cap(f"{name} failed on its own side (HTTP {st}).")
        if st is not None and st >= 400:
            return _cap(f"{name} rejected the request (HTTP {st}).")
        if et in ("ConnectError", "ConnectionError", "ConnectTimeout", "ECONNREFUSED", "ENOTFOUND") or "connect" in (error_message or "").lower():
            return _cap(f"{name} could not be reached (it may be down or the address is wrong).")
        return _cap(f"the call to {name} failed.")
    if category == "DATABASE":
        return "The database could not be reached." if severity == "CRITICAL" else "A database operation failed."
    if category == "TIMEOUT":
        return "The operation took too long and was stopped."
    if et.startswith("HttpErrorResponse") or et.startswith("HTTPException") or et.startswith("HttpStatus"):
        digits = "".join(ch for ch in et if ch.isdigit())
        st = int(digits) if digits else status_code
        reason = _STATUS_REASONS.get(st or 0)
        if reason:
            return f"The request failed because {reason} (HTTP {st})."
        return f"The request failed with HTTP {st}."
    if source == "PROCESS":
        return "The service itself crashed and had to restart."
    if source == "JOB":
        return "A background task (not started by a user action) failed."
    if et == "MemoryError":
        return "The service ran out of memory while handling this."
    if et in _BUG_TYPES:
        return f"A programming error in the code caused this ({et}): {_plain(error_message, 120)}"
    if status_code is not None and status_code in _STATUS_REASONS:
        return f"The request failed because {_STATUS_REASONS[status_code]} (HTTP {status_code})."
    return f"An unexpected error occurred ({et or 'Error'}): {_plain(error_message, 120)}"


# ── error code, what happened, suggested fix (for the admin detail view) ─────

_RESOURCE_WORDS = {
    "STORAGE FOLDER": "a storage folder", "CASE": "a case", "FILE": "a file", "USER": "the user profile",
    "CHAT": "a chat", "PROMPT": "a prompt", "PLAN": "a plan", "PAYMENT": "a payment",
    "SUPPORT TICKET": "a support ticket", "TEMPLATE": "a template", "DRAFT": "a draft",
}
_ACTION_VERBS = {"VIEW": "open", "CREATE": "create", "UPDATE": "save changes to", "DELETE": "delete"}


def _object_words(resource_type, endpoint):
    if resource_type and resource_type in _RESOURCE_WORDS:
        return _RESOURCE_WORDS[resource_type]
    ep = (endpoint or "").split("?")[0].strip("/")
    if ep.startswith("client:"):
        return "the " + ep[7:].replace("-", " ") + " screen"
    segs = [s for s in ep.split("/") if s and s not in ("api", "v1", "files", "internal") and not s[:1].isdigit() and "{" not in s and ":" not in s]
    if not segs:
        return "the page"
    return "the " + segs[-1].replace("-", " ").replace("_", " ")


def error_code_for(*, source, category, severity, error_type, error_message, status_code, external_provider=None, external_status_code=None, external_error_code=None):
    et = error_type or ""
    msg = (error_message or "").lower()
    client = {
        "PaymentCancelled": "PAYMENT_CANCELLED", "PaymentFailed": "PAYMENT_FAILED", "PaymentVerifyFailed": "PAYMENT_VERIFY_FAILED",
        "ClientNetworkError": "BROWSER_NETWORK_ERROR", "ClientRenderError": "BROWSER_RENDER_ERROR",
        "ClientUnhandledError": "BROWSER_ERROR", "ClientError": "BROWSER_ERROR",
    }
    if et in client:
        return client[et]
    if external_provider or source == "EXTERNAL_API":
        code = (external_error_code or "").upper()
        st = external_status_code
        if category == "AI_SAFETY_BLOCK":
            return "AI_SAFETY_BLOCK"
        if category == "AI_EMPTY_RESPONSE":
            return "AI_EMPTY_RESPONSE"
        if category == "AI_INVALID_OUTPUT":
            return "AI_INVALID_OUTPUT"
        if st == 429 or code == "RESOURCE_EXHAUSTED":
            return "AI_QUOTA_EXCEEDED" if category == "AI_PROVIDER" else "UPSTREAM_RATE_LIMITED"
        if category == "TIMEOUT" or code in ("DEADLINE_EXCEEDED", "ETIMEDOUT"):
            return "UPSTREAM_TIMEOUT"
        if st in (401, 403) or code in ("UNAUTHENTICATED", "PERMISSION_DENIED", "API_KEY_INVALID"):
            return "UPSTREAM_AUTH_FAILED"
        if st is not None and st >= 500:
            return "UPSTREAM_ERROR"
        if st is not None and st >= 400:
            return "UPSTREAM_REJECTED"
        return "UPSTREAM_UNREACHABLE"
    if category == "DATABASE":
        return "DATABASE_UNAVAILABLE" if severity == "CRITICAL" else "DATABASE_ERROR"
    if category == "TIMEOUT":
        return "TIMEOUT"
    if et == "MemoryError":
        return "OUT_OF_MEMORY"
    if source == "PROCESS":
        return "PROCESS_CRASH"
    if source == "JOB":
        return "JOB_FAILED"
    st = status_code
    digits = "".join(ch for ch in et if ch.isdigit()) if et.startswith(("HttpErrorResponse", "HTTPException", "HttpStatus")) else ""
    if digits:
        st = int(digits)
    if st in (401, 403):
        if "expire" in msg:
            return "AUTH_EXPIRED"
        return "AUTH_REQUIRED" if st == 401 else "PERMISSION_DENIED"
    by_status = {400: "BAD_REQUEST", 402: "PAYMENT_REQUIRED", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 409: "CONFLICT",
                 413: "PAYLOAD_TOO_LARGE", 415: "UNSUPPORTED_FILE_TYPE", 422: "VALIDATION_ERROR", 429: "RATE_LIMITED",
                 502: "UPSTREAM_ERROR", 503: "SERVICE_UNAVAILABLE", 504: "UPSTREAM_TIMEOUT"}
    if st in by_status:
        return by_status[st]
    return "INTERNAL_ERROR"


def what_happened_for(*, action, resource_type, endpoint, http_method, status_code, error_type, user_id=None, source="HTTP"):
    et = error_type or ""
    client = {
        "PaymentCancelled": "The user was on the payment screen and closed the payment window before paying.",
        "PaymentFailed": "The user tried to pay, but the payment did not go through.",
        "PaymentVerifyFailed": "The user paid, but the server could not confirm the payment.",
        "ClientNetworkError": "The user was using the app, and a request from the browser could not reach the server.",
        "ClientRenderError": "The user opened a page, and it crashed while being displayed.",
        "ClientUnhandledError": "The user was using the app when a programming error happened in the browser.",
    }
    if et in client:
        return client[et]
    if source == "JOB" or (endpoint or "").startswith(("job:", "thread:", "task:", "cron:")):
        return "A background task ran on its own (not started by a user action) and failed."
    if source == "PROCESS":
        return "The service itself crashed while running."
    who = "The user" if user_id else "Someone (not logged in) or another service"
    verb = _ACTION_VERBS.get((action or "").upper())
    if not verb:
        verb = {"GET": "open", "POST": "create", "PUT": "save changes to", "PATCH": "save changes to", "DELETE": "delete"}.get((http_method or "").upper(), "use")
    ep = (endpoint or "").lower()
    if "upload" in ep:
        verb = "upload"
    elif "download" in ep or "export" in ep:
        verb = "download"
    elif "chat" in ep and (http_method or "").upper() == "POST":
        verb = "send a message in"
    elif "login" in ep or "signin" in ep:
        verb = "log in to"
    obj = _object_words(resource_type, endpoint)
    st = status_code
    if st is None:
        outcome = "but it failed."
    elif st in (401, 403):
        outcome = f"but the request was refused (HTTP {st})."
    elif st == 404:
        outcome = "but it could not be found (HTTP 404)."
    elif st is not None and st >= 500:
        outcome = f"but the server failed (HTTP {st})."
    else:
        outcome = f"but the request failed (HTTP {st})."
    return f"{who} tried to {verb} {obj}, {outcome}"


def suggested_fix_for(code, *, external_provider=None, frame=None, error_type=None, error_message=None):
    prov = _provider_name(external_provider) if external_provider else "the outside service"
    where = f" at {frame}" if frame else ""
    fixes = {
        "AUTH_EXPIRED": "User: log in again. Developers: renew the token before it expires or send the user to the login page automatically.",
        "AUTH_REQUIRED": "User: log in and retry. Developers: make sure the frontend sends the login token with this request.",
        "PERMISSION_DENIED": "Check the user's role and plan; if they should have access, correct the permission rule.",
        "NOT_FOUND": "Check that the item still exists and that the link or id the frontend uses is correct.",
        "METHOD_NOT_ALLOWED": "Developers: the frontend is calling this address with the wrong HTTP method.",
        "BAD_REQUEST": "Developers: compare the data the frontend sends with what the API expects (field names, required fields).",
        "VALIDATION_ERROR": "Developers: compare the data the frontend sends with what the API expects; show the user which field is wrong.",
        "CONFLICT": "The item already exists or was changed by someone else; reload and retry.",
        "PAYLOAD_TOO_LARGE": "Ask the user to upload a smaller file, or raise the size limit in the service settings.",
        "UNSUPPORTED_FILE_TYPE": "Ask the user to use a supported file type.",
        "PAYMENT_REQUIRED": "The user's quota or plan is used up; they need to upgrade or top up.",
        "RATE_LIMITED": "Ask the user to wait a minute and retry; developers can raise the limit if it is too low.",
        "AI_QUOTA_EXCEEDED": f"The quota for {prov} is used up. Raise the quota, add a retry with waiting, or fall back to another model.",
        "AI_SAFETY_BLOCK": "The content was blocked by the AI safety rules. Rephrase the request or adjust the safety settings if the block is wrong.",
        "AI_EMPTY_RESPONSE": "Retry the request; developers should raise the answer length limit or handle empty answers gracefully.",
        "AI_INVALID_OUTPUT": "Developers: make the parser tolerant of the model's output format or tighten the output instructions.",
        "UPSTREAM_AUTH_FAILED": f"Developers: the API key or token used for {prov} is wrong, missing or expired; fix it in the service's environment settings.",
        "UPSTREAM_RATE_LIMITED": f"Too many calls to {prov}; add a retry with waiting or reduce the call rate.",
        "UPSTREAM_TIMEOUT": f"{_cap(prov)} is slow or down; retry later and raise the timeout if it keeps happening.",
        "UPSTREAM_ERROR": f"{_cap(prov)} failed on its side; retry later and check its status page.",
        "UPSTREAM_REJECTED": f"Developers: {prov} refused the request; check the data sent to it.",
        "UPSTREAM_UNREACHABLE": f"Check that {prov} is running and the address configured for it is correct (network, DNS, firewall).",
        "DATABASE_UNAVAILABLE": "Check that the database is running and the connection settings and pool size are correct.",
        "DATABASE_ERROR": "Developers: check the failing query and the database logs.",
        "TIMEOUT": "The operation is too slow; retry, and developers should speed it up or raise the timeout.",
        "OUT_OF_MEMORY": "Restart the service and give it more memory; developers should look for large data held in memory.",
        "PROCESS_CRASH": "Restart the service and fix the code in the stack trace.",
        "JOB_FAILED": "Check the job's logs and fix the code in the stack trace; rerun the job.",
        "SERVICE_UNAVAILABLE": "The service was down or restarting; retry in a moment.",
        "PAYMENT_CANCELLED": "No action needed. Follow up with the user if it keeps happening.",
        "PAYMENT_FAILED": "Ask the user to retry with another card or payment method; check the Razorpay dashboard for the decline reason.",
        "PAYMENT_VERIFY_FAILED": "Developers: check the payment verification (signature, order id); confirm the payment manually in Razorpay.",
        "BROWSER_NETWORK_ERROR": "Check the user's internet connection and that the service address is reachable (CORS, firewall).",
        "BROWSER_RENDER_ERROR": "Developers: fix the frontend component in the stack trace.",
        "BROWSER_ERROR": "Developers: fix the frontend code in the stack trace.",
    }
    if code in fixes:
        return fixes[code]
    detail = f" ({error_type}: {_plain(error_message, 100)})" if error_type else ""
    return f"Developers: fix the code{where}{detail}; add a check for the missing or invalid value."


def explain(ev, *, frame=None, user_id=None):
    """(error_code, what_happened, suggested_fix) for an ErrorEvent-like or AuditEvent-like object."""
    g = lambda k, d=None: getattr(ev, k, d)  # noqa: E731
    source = g("source", "HTTP")
    category = g("category", "INTERNAL")
    severity = g("severity", "ERROR")
    code = error_code_for(
        source=source, category=category, severity=severity, error_type=g("error_type"), error_message=g("error_message"),
        status_code=g("status_code"), external_provider=g("external_provider"), external_status_code=g("external_status_code"),
        external_error_code=g("external_error_code"),
    )
    what = what_happened_for(
        action=g("action"), resource_type=g("resource_type"), endpoint=g("endpoint"), http_method=g("http_method"),
        status_code=g("status_code"), error_type=g("error_type"), user_id=user_id or g("user_id"), source=source,
    )
    fix = suggested_fix_for(code, external_provider=g("external_provider"), frame=frame or g("frame"), error_type=g("error_type"), error_message=g("error_message"))
    return code, what[:500], fix[:1000]
