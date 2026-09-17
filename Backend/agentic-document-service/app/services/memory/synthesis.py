"""Reviewing a stretch of conversation, the way a person would after a meeting.

The per-turn writer judges one message at a time. That misses what only a run of
messages shows: a decision reached over three exchanges ("the extension ground is
stronger" … "yes, go with that" … "draft it"), where the matter now stands, what is
still open, and a way of working the advocate keeps asking for without ever stating it
as a rule ("in detail" in five different questions).

Every few turns, and when the advocate comes back to a case after a break, the turns
since the last review are read together and the case memory is brought up to date:

* **Summary** — `Stage:`, `Last action:` and `Open items:` lines, kept current in place;
* **Decisions** — ones the advocate reached across several of their own messages;
* **Suggestions** — working preferences shown by a pattern of requests. Inferred, so
  they are only ever suggested, never saved.

What keeps it from inventing: a summary line may name only numbers and names that the
advocate wrote or that memory already holds (memory's facts were verified against the
documents), a decision must be traceable to the advocate's own words in the turns it
cites, and a preference must be a way of working that at least two of the advocate's
messages ask for. Answers are context, never evidence.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

from app.core.config import get_settings

logger = logging.getLogger("agentic_document_service.memory.synthesis")

SUMMARY_KEYS: tuple[tuple[str, str], ...] = (
    ("stage", "Stage"),
    ("last_action", "Last action"),
    ("open_items", "Open items"),
)
MAX_TURNS_PER_REVIEW = 12
MAX_DECISIONS = 3
MAX_PREFERENCES = 2
MAX_LINE = 280
QUESTION_CHARS = 1_200
ANSWER_CHARS = 1_500
TIMEOUT_MS = 45_000
MAX_OUTPUT_TOKENS = 4_096

PROMPT = """\
You review a stretch of conversation between an advocate and JuriNex, a legal research
assistant, about ONE case, and bring that case's memory file up to date. You return
JSON only.

EVIDENCE
The advocate's messages are evidence of what they decided and how they want to work.
JuriNex's answers are context only: they show what the advocate was replying to, but
nothing in an answer is ever recorded as a decision or a preference. CURRENT MEMORY holds
facts already verified; you may refer to them.

1. SUMMARY: where the work on the case stands after these turns.
   - stage: the stage of the matter or of the work, in a few words, only if these turns
     show it ("Preparing the rejoinder", "Reviewing the petition's grounds").
   - last_action: the most recent thing the advocate did or asked for that moves the
     work forward ("Asked for an analysis of why the petition is weak").
   - open_items: things still to be done that the advocate raised and did not close.
   Use null (or [] for open_items) for anything these turns do not show. Name a date,
   number or person only if the advocate wrote it or CURRENT MEMORY holds it.

2. DECISIONS the advocate reached, especially across several messages ("go with the
   extension ground", "we will not press the Nazrana ground"). Only what THEY decided,
   in their words, citing the turn numbers that show it. Not questions, not requests for
   an answer, not JuriNex's recommendations, not anything in DECISIONS ALREADY RECORDED.

3. PREFERENCES: a way the advocate wants answers written that at least two of their
   messages ask for, even if they never said "always" ("in detail", "in a table", "in
   simple language"). Write it as a short instruction ("Give detailed answers"), cite
   every turn that shows it, and skip anything in SAVED INSTRUCTIONS or RULES ALREADY
   NOTICED. What an answer should be about ("tell me about the petitioner") is not a
   preference.

Limits: at most 3 decisions and 2 preferences. Each line at most 250 characters, plain
text. If nothing qualifies, return nulls and empty lists.

Return JSON only:
{"stage": null, "last_action": null, "open_items": [],
 "decisions": [{"text": "...", "turns": [2, 3]}],
 "preferences": [{"text": "...", "turns": [1, 4]}]}
"""

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
_DIGITS_RE = re.compile(r"\d+")
_CAPITAL_RE = re.compile(r"\b[A-Z][A-Za-z]{2,}\b")
# How an answer should be written, beyond the writer's MANNER_RE: depth and plainness,
# which is what advocates most often ask for without stating a rule.
_DEPTH_RE = re.compile(
    r"\b(?:detail\w*|in[\s-]depth|elaborat\w*|thorough\w*|simple|simply|plain|easy\s+to\s+understand|"
    r"step[\s-]by[\s-]step|layman|summar(?:y|ise|ize)\s+first|short\s+and|point\s+by\s+point)\b",
    re.IGNORECASE,
)
_session_locks: dict[tuple[str, str, str], threading.Lock] = {}
_session_locks_guard = threading.Lock()


@dataclass(frozen=True)
class Turn:
    number: int
    chat_id: str
    question: str
    answer: str
    preset: bool
    created_at: datetime | None


@dataclass
class Review:
    """What a review proposes, before any of it is checked or written."""

    stage: str | None = None
    last_action: str | None = None
    open_items: list[str] = field(default_factory=list)
    decisions: list[dict[str, Any]] = field(default_factory=list)
    preferences: list[dict[str, Any]] = field(default_factory=list)


# ── Settings ─────────────────────────────────────────────────────────────────

def _setting(name: str, default: Any) -> Any:
    try:
        return getattr(get_settings(), name, default)
    except Exception:  # noqa: BLE001
        return default


def enabled() -> bool:
    return bool(_setting("memory_synthesis_enabled", True))


def every_turns() -> int:
    try:
        return max(2, int(_setting("memory_synthesis_every_turns", 5) or 5))
    except (TypeError, ValueError):
        return 5


def idle_minutes() -> int:
    try:
        return max(5, int(_setting("memory_synthesis_idle_minutes", 30) or 30))
    except (TypeError, ValueError):
        return 30


def model_settings() -> tuple[str, str]:
    model = str(_setting("memory_synthesis_model", "") or "").strip() or "gemini-3.7-flash"
    level = str(_setting("memory_synthesis_thinking_level", "") or "").strip().lower() or "medium"
    if "gemini-3.7" in model and level == "minimal":
        level = "low"
    return model, level


def session_lock(case_key: str, user_id: str, session_id: str) -> threading.Lock:
    key = (case_key, user_id, session_id)
    with _session_locks_guard:
        lock = _session_locks.get(key)
        if lock is None:
            lock = _session_locks[key] = threading.Lock()
        return lock


# ── When to review ───────────────────────────────────────────────────────────

def due_by_count(unreviewed: int) -> bool:
    """Enough new turns in this chat to be worth a review."""
    return enabled() and unreviewed >= every_turns()


def due_after_break(unreviewed: int, last_turn_at: datetime | None, *, now: datetime | None = None) -> bool:
    """An earlier chat the advocate left with something unreviewed, long enough ago to be over."""
    if not enabled() or unreviewed < 2 or last_turn_at is None:
        return False
    moment = now or datetime.now(timezone.utc)
    when = last_turn_at if last_turn_at.tzinfo else last_turn_at.replace(tzinfo=timezone.utc)
    return moment - when >= timedelta(minutes=idle_minutes())


# ── Reading ──────────────────────────────────────────────────────────────────

def _short(text: str, limit: int) -> str:
    body = " ".join(str(text or "").split())
    return body if len(body) <= limit else body[: limit - 1].rstrip() + "…"


def build_request(
    turns: Sequence[Turn],
    *,
    summary_lines: Sequence[dict[str, Any]],
    decision_lines: Sequence[dict[str, Any]],
    saved_rules: Sequence[str],
    noticed_rules: Sequence[str],
    chat_summary: str = "",
) -> str:
    parts = ["CURRENT MEMORY — SUMMARY:"]
    parts.extend([f"- {line.get('text')}" for line in summary_lines if line.get("text")] or ["(empty)"])
    parts += ["", "DECISIONS ALREADY RECORDED:"]
    parts.extend([f"- {line.get('text')}" for line in decision_lines if line.get("text")] or ["(none)"])
    parts += ["", "SAVED INSTRUCTIONS:"]
    parts.extend([f"- {rule}" for rule in saved_rules] or ["(none)"])
    parts += ["", "RULES ALREADY NOTICED:"]
    parts.extend([f"- {rule}" for rule in noticed_rules] or ["(none)"])
    if chat_summary.strip():
        parts += ["", "EARLIER IN THIS CHAT (context only):", _short(chat_summary, 2_000)]
    parts += ["", "TURNS (oldest first):"]
    for turn in turns:
        asked = "(a saved prompt)" if turn.preset else _short(turn.question, QUESTION_CHARS)
        parts += [f"[Turn {turn.number}]", f"ADVOCATE: {asked}", f"JURINEX: {_short(turn.answer, ANSWER_CHARS)}", ""]
    return "\n".join(parts).rstrip()


def _clean(value: Any) -> str:
    text = " ".join(str(value or "").split()).strip().strip('"').lstrip("-• ").strip()
    return text[:MAX_LINE] if text and text.lower() not in {"null", "none", "n/a"} else ""


def parse_review(payload: Any, turn_numbers: Iterable[int]) -> Review:
    """The review in the model's output, keeping only items that cite real turns."""
    text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload or "")
    text = _FENCE_RE.sub("", text).strip()
    if not text:
        raise ValueError("The model returned nothing.")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError("The model did not return JSON.") from None
        data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError("The model did not return an object.")

    valid = set(turn_numbers)

    def cited(item: Any) -> list[int]:
        numbers = item.get("turns") if isinstance(item, dict) else None
        found: list[int] = []
        for value in numbers or []:
            try:
                number = int(value)
            except (TypeError, ValueError):
                continue
            if number in valid and number not in found:
                found.append(number)
        return found

    def items(key: str, limit: int) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for item in data.get(key) or []:
            body = _clean(item.get("text") if isinstance(item, dict) else item)
            turns = cited(item)
            if body and turns:
                out.append({"text": body, "turns": turns})
            if len(out) >= limit:
                break
        return out

    open_items = data.get("open_items")
    if isinstance(open_items, str):
        open_items = [open_items]
    return Review(
        stage=_clean(data.get("stage")) or None,
        last_action=_clean(data.get("last_action")) or None,
        open_items=[item for item in (_clean(value) for value in open_items or []) if item][:4],
        decisions=items("decisions", MAX_DECISIONS),
        preferences=items("preferences", MAX_PREFERENCES),
    )


def ask_model(request: str, turn_numbers: Iterable[int]) -> tuple[Review, str]:
    """(review, model). Raises when the model is unavailable or returns nothing usable."""
    from google.genai import types

    from app.services.adapters.document_ai import _build_gemini_config, _gemini_client

    model, level = model_settings()
    client = _gemini_client(model)
    if client is None:
        raise RuntimeError("No Gemini client is configured for memory review.")
    config = _build_gemini_config(
        {"temperature": 0.1, "max_output_tokens": MAX_OUTPUT_TOKENS}, {"thinking_level": level}, model_name=model
    )
    try:
        config.system_instruction = PROMPT
        config.response_mime_type = "application/json"
        config.http_options = types.HttpOptions(timeout=TIMEOUT_MS)
    except Exception:  # noqa: BLE001 — a plain-dict config from an older SDK
        pass
    response = client.models.generate_content(model=model, contents=request, config=config)
    return parse_review(getattr(response, "text", "") or "", turn_numbers), model


# ── Checking what it proposes ────────────────────────────────────────────────

_NOT_NAMES = frozenset(
    """
    stage last action open items asked reviewing preparing drafting awaiting the this that
    jurinex advocate petitioner respondent respondents petition case matter court high
    bench order hearing reply rejoinder draft analysis summary grounds ground writ suit
    """.split()
)


def _numbers(text: str) -> set[str]:
    return {run.lstrip("0") or "0" for run in _DIGITS_RE.findall(re.sub(r"(?<=\d),(?=\d)", "", text))}


def _proper_names(text: str) -> set[str]:
    words = _CAPITAL_RE.findall(text)
    # The first word of a line or clause is capitalised for grammar, not because it is a name.
    starts = {match.group(1) for match in re.finditer(r"(?:^|[.:;]\s+)([A-Z][A-Za-z]+)", text)}
    return {word.lower() for word in words if word not in starts and word.lower() not in _NOT_NAMES}


def grounded_status(line: str, evidence: str) -> bool:
    """A summary line may name only numbers and names the evidence contains."""
    if not _numbers(line) <= _numbers(evidence):
        return False
    names = _proper_names(line)
    if not names:
        return True
    lowered = evidence.lower()
    present = {name for name in names if re.search(rf"\b{re.escape(name)}\b", lowered)}
    return len(present) / len(names) >= 0.75


def is_manner(text: str) -> bool:
    from app.services.memory.writer import describes_manner

    return describes_manner(text) or bool(_DEPTH_RE.search(text))


def _manner_terms(text: str) -> set[str]:
    """The words in a text that say how to write ("detailed", "table"), lightly stemmed."""
    from app.services.memory.writer import MANNER_RE, content_words

    found: set[str] = set()
    for pattern in (MANNER_RE, _DEPTH_RE):
        for match in pattern.finditer(text):
            found |= content_words(match.group(0)) or {match.group(0).lower()}
    return found


def shows_pattern(preference: str, messages: Sequence[str]) -> bool:
    """At least two of the advocate's messages ask for this way of working.

    What must recur is the *manner* ("detailed", "table", "simple"), not any shared word:
    "Give detailed answers" is not backed by "give me a simple answer" merely because
    both say "answer".
    """
    from app.services.memory.validator import same_polarity

    wanted = _manner_terms(preference)
    if not wanted:
        return False
    # "give it in a table" and "no tables please" share a word, not a preference.
    backing = [
        message for message in messages if wanted & _manner_terms(message) and same_polarity(preference, message)
    ]
    return len(backing) >= 2
