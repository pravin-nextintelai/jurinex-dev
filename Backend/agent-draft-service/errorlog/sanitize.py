"""Masking and size limits for everything that is written to error_logs."""
from __future__ import annotations

import json
import re
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit

MAX_USER_MESSAGE = 1000
MAX_ERROR_MESSAGE = 4000
MAX_STACK = 10000
MAX_EXTERNAL_RESPONSE = 2000
PAYLOAD_MAX_STR = 500
PAYLOAD_MAX_DEPTH = 3
PAYLOAD_MAX_ITEMS = 20

# A key is a secret when one of its words is one of these...
_SENSITIVE_WORDS = {
    "password", "passwd", "pwd", "token", "secret", "otp", "authorization", "cookie", "cookies",
    "apikey", "credential", "credentials", "jwt", "auth", "sid", "pin", "signature", "key",
    "privatekey", "clientsecret", "bearer", "passcode",
}
# ...unless another word says it is a count or a size, not a value
# (prompt_token_count, total_tokens, max_tokens, key_count).
_NOT_SECRET_WORDS = {
    "count", "counts", "usage", "total", "used", "limit", "limits", "remaining", "max", "min",
    "per", "chars", "len", "length", "size", "prompt", "candidates", "cached", "thoughts", "tokens",
    "input", "output", "budget", "window", "ms", "id", "ids", "name", "type", "kind", "hash", "ok",
}
_WORD_SPLIT_RE = re.compile(r"[^a-z0-9]+")

# Secrets that travel inside strings. (regex, keep_prefix): when keep_prefix is
# true, group 1 is kept and the rest of the match is masked; otherwise the whole
# match is the secret.
_INLINE_SECRET_RES = (
    (re.compile(r"([?&](?:key|api_key|apikey|token|access_token|refresh_token|secret|password|otp|sig|signature)=)[^&\s'\"]+", re.I), True),
    (re.compile(r"\b((?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|otp|client[_-]?secret)\s*[=:]\s*)[^\s,;'\"&]+", re.I), True),
    (re.compile(r"(Bearer\s+)[A-Za-z0-9\-_\.=]+", re.I), True),
    (re.compile(r"(postgres(?:ql)?://[^:/\s]+:)[^@\s]+@", re.I), True),  # DSN passwords
    (re.compile(r"\bAIza[0-9A-Za-z\-_]{20,}\b"), False),  # Google API keys
    (re.compile(r"\bsk-[A-Za-z0-9\-_]{10,}\b"), False),  # OpenAI / Anthropic style keys
    (re.compile(r"\bxkeysib-[A-Za-z0-9\-_]{10,}\b"), False),  # Brevo
    (re.compile(r"\bxsmtpsib-[A-Za-z0-9\-_]{10,}\b"), False),  # Brevo SMTP
    (re.compile(r"\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{5,}\b"), False),  # JWTs
)

MASK = "***"


def is_sensitive_key(key: Any) -> bool:
    if not isinstance(key, str):
        return False
    words = {w for w in _WORD_SPLIT_RE.split(key.strip().lower()) if w}
    if not words or not (words & _SENSITIVE_WORDS):
        return False
    return not (words & _NOT_SECRET_WORDS)


def mask_text(text: Optional[str]) -> Optional[str]:
    """Replace secrets embedded in a free-text string."""
    if not text or not isinstance(text, str):
        return text
    out = text
    for rx, keep_prefix in _INLINE_SECRET_RES:
        if keep_prefix:
            out = rx.sub(lambda m: m.group(1) + MASK, out)
        else:
            out = rx.sub(MASK, out)
    return out


def truncate(text: Optional[str], limit: int) -> Optional[str]:
    if text is None:
        return None
    if not isinstance(text, str):
        text = str(text)
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)] + "…"


def tail(text: Optional[str], limit: int) -> Optional[str]:
    """Keep the LAST ``limit`` characters (used for stack traces)."""
    if text is None:
        return None
    if not isinstance(text, str):
        text = str(text)
    if len(text) <= limit:
        return text
    return "…" + text[-(limit - 1):]


def strip_query(url: Optional[str]) -> Optional[str]:
    """Drop the query string and fragment, which is where API keys travel."""
    if not url or not isinstance(url, str):
        return url
    try:
        parts = urlsplit(url)
    except ValueError:
        return url.split("?", 1)[0]
    netloc = parts.netloc.rsplit("@", 1)[-1]  # drop userinfo
    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def host_of(url: Optional[str]) -> Optional[str]:
    if not url or not isinstance(url, str):
        return None
    try:
        return (urlsplit(url).netloc or "").rsplit("@", 1)[-1].lower() or None
    except ValueError:
        return None


def sanitize_payload(value: Any, *, depth: int = 0) -> Any:
    """Mask secret keys, cap string sizes, depth and list lengths.

    The result is always JSON-serialisable.
    """
    if depth > PAYLOAD_MAX_DEPTH:
        return "…"
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return str(value)
        return value
    if isinstance(value, str):
        return truncate(mask_text(value), PAYLOAD_MAX_STR)
    if isinstance(value, bytes):
        return f"<{len(value)} bytes>"
    if isinstance(value, dict):
        out = {}
        for i, (k, v) in enumerate(value.items()):
            if i >= PAYLOAD_MAX_ITEMS:
                out["…"] = f"+{len(value) - PAYLOAD_MAX_ITEMS} more"
                break
            ks = truncate(str(k), 100)
            out[ks] = MASK if is_sensitive_key(ks) else sanitize_payload(v, depth=depth + 1)
        return out
    if isinstance(value, (list, tuple, set, frozenset)):
        items = list(value)
        out_list = [sanitize_payload(v, depth=depth + 1) for v in items[:PAYLOAD_MAX_ITEMS]]
        if len(items) > PAYLOAD_MAX_ITEMS:
            out_list.append(f"+{len(items) - PAYLOAD_MAX_ITEMS} more")
        return out_list
    # Pydantic models, dataclasses, enums, anything else
    for attr in ("model_dump", "dict", "to_dict", "_asdict"):
        fn = getattr(value, attr, None)
        if callable(fn):
            try:
                return sanitize_payload(fn(), depth=depth + 1)
            except Exception:  # noqa: BLE001 - never let sanitising raise
                break
    name = getattr(value, "name", None)
    if name is not None and hasattr(type(value), "__members__"):
        return str(name)
    return truncate(mask_text(repr(value)), PAYLOAD_MAX_STR)


def payload_json(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        return json.dumps(sanitize_payload(value), ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        return None


def extract_user_message(body: Optional[bytes], content_type: Optional[str]) -> Optional[str]:
    """The exact message the client saw: detail/message/error from JSON, else text."""
    if not body:
        return None
    try:
        text = body.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        return None
    text = text.strip()
    if not text:
        return None
    ct = (content_type or "").lower()
    if ct.startswith("application/json") or text[:1] in "{[":
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        if isinstance(data, dict):
            for key in ("detail", "message", "error", "msg", "description"):
                if key in data and data[key] not in (None, ""):
                    val = data[key]
                    if isinstance(val, dict):
                        for inner in ("message", "detail", "error", "msg"):
                            if inner in val and val[inner] not in (None, ""):
                                val = val[inner]
                                break
                    if not isinstance(val, str):
                        val = json.dumps(val, ensure_ascii=False, default=str)
                    return truncate(mask_text(val), MAX_USER_MESSAGE)
            return truncate(mask_text(text), MAX_USER_MESSAGE)
    if ct.startswith("text/html"):
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
    return truncate(mask_text(text), MAX_USER_MESSAGE)
