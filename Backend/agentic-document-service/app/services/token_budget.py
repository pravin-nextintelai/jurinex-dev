"""Estimated tokens for prompt budgets.

Budgets are set in tokens because models bill and cap input in tokens, but counting
exactly would need a network call to the provider before every answer. Instead the
length in characters is converted with a measured ratio: 24,000 characters of English
case OCR came to 8,081 Gemini tokens (about 3 characters per token). Numbers, citations
and OCR noise make legal text denser than plain prose, so the estimate errs on the side
of fewer characters per token. Override with CHARS_PER_TOKEN_ESTIMATE.
"""
from __future__ import annotations

import math

DEFAULT_CHARS_PER_TOKEN = 3.0
_MIN_RATIO = 1.5
_MAX_RATIO = 6.0


def chars_per_token() -> float:
    try:
        from app.core.config import get_settings

        ratio = float(getattr(get_settings(), "chars_per_token_estimate", DEFAULT_CHARS_PER_TOKEN) or 0)
    except Exception:  # noqa: BLE001 — a budget estimate must never break a request
        ratio = DEFAULT_CHARS_PER_TOKEN
    if not math.isfinite(ratio) or ratio <= 0:
        return DEFAULT_CHARS_PER_TOKEN
    return min(_MAX_RATIO, max(_MIN_RATIO, ratio))


def chars_for_tokens(tokens: int | float) -> int:
    """How many characters fit in `tokens` estimated tokens."""
    try:
        value = float(tokens)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(value) or value <= 0:
        return 0
    return int(value * chars_per_token())


def estimate_tokens(text: str | None) -> int:
    """Estimated token count of `text`."""
    length = len(text or "")
    if length <= 0:
        return 0
    return int(math.ceil(length / chars_per_token()))
