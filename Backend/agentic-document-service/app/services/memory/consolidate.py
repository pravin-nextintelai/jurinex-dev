"""Consolidation: fold what JuriNex remembers about the advocate into fewer, sharper lines.

Memory that only grows eventually hits its ceiling, and the usual answer — "full,
go and edit it" — interrupts the advocate to do clerical work. Five facts learned
over five chats usually say three things:

    Mostly appears before the Aurangabad Bench
    Files land acquisition matters at Aurangabad          ->  Appears before the
    Practises mainly in land acquisition                      Aurangabad Bench, mainly
                                                              in land acquisition

So near the ceiling the set is rewritten once, tighter, and there is room again.

Three rules make this safe to do automatically:

* **Nothing new may appear.** Every merged line has to be traceable to the words
  already stored (the same grounding check the chat writer uses), so the model can
  shorten and join but cannot introduce a fact the advocate never stated.
* **Every merged line faces the same rules as a typed one** — no case details, no
  party names, no identifiers, no inference language.
* **It is reversible.** The set before the merge is kept, so one press puts it back.

If any rule fails, or the model is unavailable, nothing changes and the advocate is
told the set is full instead. This never raises into a chat.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

from app.core.config import get_settings
from app.services.memory.schemas import (
    ADVOCATE_CATEGORIES,
    MAX_ADVOCATE_CHARS,
    MAX_ADVOCATE_LINES,
    MAX_LINE_CHARS,
)
from app.services.memory.validator import validate_advocate_line

logger = logging.getLogger("agentic_document_service.memory.consolidate")

CONSOLIDATE_TIMEOUT_MS = 20_000
CONSOLIDATE_MAX_OUTPUT_TOKENS = 2_048
# Below this the merge is not worth its call: two facts cannot usefully become one
# and a half.
MIN_LINES_TO_CONSOLIDATE = 4

CONSOLIDATE_PROMPT = """\
You keep the notes a legal assistant holds about one advocate — their practice, the
clients they act for, how they like to work, and their background. The notes were
written one at a time across many chats, so they overlap and repeat. Rewrite them as
a shorter set that says the same things.

Rules:
- Say nothing the notes do not already say. No new facts, courts, subjects, numbers,
  names, reasons or qualifiers. If two notes disagree, keep the later one (they are
  given oldest first).
- Join notes that are about the same thing into one line. Leave a note that stands
  alone exactly as it is.
- Keep every specific: courts, subject areas, languages, the kinds of client, the way
  they want work done.
- Each line: one fact, plain text, third person about the advocate, at most 300
  characters, no leading dash.
- Keep each line in one of these categories: practice, clients, work_style,
  background. Do not invent a category.
- Never include anything about a single case: no case numbers, dates, hearings, FIRs
  or the names of parties.
- Return fewer lines than you were given. If they genuinely cannot be shortened,
  return them unchanged.

Return JSON only:
{"lines": [{"category": "<one of the four>", "text": "<the fact>"}]}
"""

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


@dataclass
class ConsolidationResult:
    """What a merge would do, or did. `applied` is set by the caller that writes it."""

    before: list[dict[str, Any]] = field(default_factory=list)
    after: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    model: str | None = None
    applied: bool = False

    @property
    def chars_before(self) -> int:
        return sum(len(str(line.get("text") or "")) for line in self.before)

    @property
    def chars_after(self) -> int:
        return sum(len(str(line.get("text") or "")) for line in self.after)

    @property
    def changed(self) -> bool:
        return bool(self.after) and not self.error and len(self.after) < len(self.before)

    def as_dict(self) -> dict[str, Any]:
        return {
            "lines_before": len(self.before),
            "lines_after": len(self.after),
            "chars_before": self.chars_before,
            "chars_after": self.chars_after,
            "changed": self.changed,
            "applied": self.applied,
            "error": self.error,
            "model": self.model,
        }


# ── Settings ─────────────────────────────────────────────────────────────────

def enabled() -> bool:
    return bool(getattr(get_settings(), "advocate_consolidate_enabled", True))


def trigger_fraction() -> float:
    """How full the set has to be before a merge is worth a model call."""
    try:
        value = float(getattr(get_settings(), "advocate_consolidate_at", 0.8) or 0.8)
    except (TypeError, ValueError):
        value = 0.8
    return min(1.0, max(0.5, value))


def fullness(lines: Sequence[dict[str, Any]]) -> float:
    """How full the set is, 0.0 to 1.0, by whichever of the two caps bites first."""
    used_chars = sum(len(str(line.get("text") or "")) for line in lines)
    by_chars = used_chars / MAX_ADVOCATE_CHARS if MAX_ADVOCATE_CHARS else 0.0
    by_lines = len(lines) / MAX_ADVOCATE_LINES if MAX_ADVOCATE_LINES else 0.0
    return max(by_chars, by_lines)


def should_consolidate(lines: Sequence[dict[str, Any]]) -> bool:
    """Whether this set is close enough to its ceiling to be worth merging."""
    if not enabled() or len(lines) < MIN_LINES_TO_CONSOLIDATE:
        return False
    return fullness(lines) >= trigger_fraction()


# ── The model call ───────────────────────────────────────────────────────────

def parse_lines(payload: Any) -> list[dict[str, str]]:
    """The merged lines from the model's output. Raises ValueError when there are none."""
    text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload or "")
    text = _FENCE_RE.sub("", text).strip()
    if not text:
        raise ValueError("The model returned nothing.")
    data: Any = None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
            except json.JSONDecodeError:
                data = None
    rows = data.get("lines") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError("The model returned no lines.")
    out: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        body = " ".join(str(row.get("text") or "").split()).lstrip("-• ").strip()
        category = str(row.get("category") or "").strip().lower()
        if body and category in ADVOCATE_CATEGORIES:
            out.append({"category": category, "text": body[:MAX_LINE_CHARS]})
    if not out:
        raise ValueError("The model returned nothing usable.")
    return out


def _config() -> Any:
    from google.genai import types

    kwargs: dict[str, Any] = {
        "system_instruction": CONSOLIDATE_PROMPT,
        "temperature": 0.1,
        "max_output_tokens": CONSOLIDATE_MAX_OUTPUT_TOKENS,
        "response_mime_type": "application/json",
    }
    try:
        return types.GenerateContentConfig(**kwargs, http_options=types.HttpOptions(timeout=CONSOLIDATE_TIMEOUT_MS))
    except Exception:  # noqa: BLE001 — older SDKs have no per-request http_options
        return types.GenerateContentConfig(**kwargs)


def build_request(lines: Sequence[dict[str, Any]]) -> str:
    parts = ["NOTES (oldest first):"]
    for line in lines:
        parts.append(f"- [{line.get('category')}] {str(line.get('text') or '').strip()}")
    return "\n".join(parts)


def _ask_model(lines: Sequence[dict[str, Any]]) -> tuple[list[dict[str, str]], str]:
    """(merged lines, model). Raises when the model is unavailable or unusable."""
    from app.services.adapters.document_ai import _gemini_client

    model = str(getattr(get_settings(), "advocate_consolidate_model", "") or "gemini-3.8-flash").strip()
    client = _gemini_client(model)
    if client is None:
        raise RuntimeError("No Gemini client is configured for consolidation.")
    response = client.models.generate_content(
        model=model, contents=build_request(lines), config=_config()
    )
    return parse_lines(getattr(response, "text", "") or ""), model


# ── Checking the result ──────────────────────────────────────────────────────

def _grounded(text: str, source: str) -> bool:
    from app.services.memory.writer import is_grounded

    return is_grounded(text, source)


def check_merged(
    merged: Sequence[dict[str, str]],
    original: Sequence[dict[str, Any]],
    *,
    party_names: Iterable[str] = (),
) -> str | None:
    """Why this merge cannot be trusted, or None when it can.

    The whole original set is the source text: a merged line may draw on several
    notes at once, which is the point of merging.
    """
    if not merged:
        return "empty"
    if len(merged) >= len(original):
        return "not_shorter"
    if len(merged) > MAX_ADVOCATE_LINES:
        return "too_many_lines"
    if sum(len(row["text"]) for row in merged) > MAX_ADVOCATE_CHARS:
        return "too_long"
    source = " ".join(str(line.get("text") or "") for line in original)
    names = tuple(party_names)
    for row in merged:
        problem = validate_advocate_line(row["text"], category=row["category"], party_names=names)
        if problem is not None:
            return f"line_{problem.code}"
        if not _grounded(row["text"], source):
            return "line_not_in_the_notes"
    return None


def plan(
    lines: Sequence[dict[str, Any]],
    *,
    party_names: Iterable[str] = (),
) -> ConsolidationResult:
    """What a merge would produce. Never raises; an unusable result comes back as an error."""
    original = [
        dict(line)
        for line in lines
        if str(line.get("text") or "").strip() and str(line.get("category") or "") in ADVOCATE_CATEGORIES
    ]
    if len(original) < MIN_LINES_TO_CONSOLIDATE:
        return ConsolidationResult(before=original, after=[], error="too_few")

    try:
        merged, model = _ask_model(original)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] consolidation unavailable: %s", exc)
        return ConsolidationResult(before=original, after=[], error="unavailable")

    problem = check_merged(merged, original, party_names=party_names)
    if problem is not None:
        logger.info("[Memory] consolidation set aside: %s", problem)
        return ConsolidationResult(before=original, after=[], error=problem, model=model)

    logger.info(
        "[Memory] consolidation ready: %s facts (%s chars) -> %s facts (%s chars) via %s",
        len(original),
        sum(len(str(line.get("text") or "")) for line in original),
        len(merged),
        sum(len(row["text"]) for row in merged),
        model,
    )
    return ConsolidationResult(before=original, after=[dict(row) for row in merged], model=model)
