"""Case-chat conversation history: the latest turns, shortened, plus a rolling summary.

Each question used to carry the last N question/answer pairs of the chat in full, and
nothing older. Answers average about 9,500 characters and the longest reach 40,000, so
a few full answers crowded the prompt while anything before them was forgotten.

The history block now carries, in this order:

* a summary of the turns before the recent ones, at most CHAT_SUMMARY_MAX_TOKENS, kept
  per chat in chat_session_summaries and updated in the background after each answer;
* any older turn the summary has not caught up with yet, shortened, so nothing is lost
  while an update is still running or after one failed;
* the latest CHAT_HISTORY_RECENT_TURNS turns (never more than the plan's
  max_conversation_history): questions in full, the newest answer up to
  CHAT_HISTORY_LATEST_ANSWER_TOKENS, older answers up to CHAT_HISTORY_OLDER_ANSWER_TOKENS.

The summary is written only from the saved turns and the previous summary. It records
what the advocate asked and decided, attributes JuriNex's answers as answers rather than
established facts, and skips rules already saved as instructions. The chat prompt marks
it as context that the documents override. Nothing here raises into a chat.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Sequence

from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available
from app.services.token_budget import chars_for_tokens

logger = logging.getLogger("agentic_document_service.chat_summary")

HISTORY_INTRO = (
    "Use the prior conversation only as supporting context. If the latest question narrows or changes "
    "the issue, prioritize the latest question."
)
SUMMARY_HEADER = (
    "Summary of earlier turns in this conversation (written by JuriNex from the saved turns; context "
    "only: the case documents and the latest question override it, and it is never a source to cite):"
)
GAP_HEADER = "Earlier turns not yet in the summary (answers shortened):"
HISTORY_HEADER = "Conversation history:"
CURRENT_HEADER = "Current question:"
SHORTENED_MARK = "[... answer shortened]"

MAX_GAP_TURNS = 6
MAX_QUESTION_CHARS = 4_000
MAX_TURNS_PER_UPDATE = 12
MAX_UPDATE_ROUNDS = 3
SUMMARY_INPUT_ANSWER_TOKENS = 2_500
SUMMARY_OUTPUT_TOKENS = 8_192
SESSION_SCAN_LIMIT = 500
LOCK_TIMEOUT_S = 90.0
THINKING_LEVELS = ("minimal", "low", "medium", "high")

_ENSURE_SQL = """
CREATE TABLE IF NOT EXISTS chat_session_summaries (
    folder_name   TEXT        NOT NULL,
    user_id       TEXT        NOT NULL,
    session_id    TEXT        NOT NULL,
    summary       TEXT        NOT NULL DEFAULT '',
    covered_turns INTEGER     NOT NULL DEFAULT 0,
    covered_until TIMESTAMPTZ,
    last_chat_id  TEXT,
    model         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (folder_name, user_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_session_summaries_folder
    ON chat_session_summaries (folder_name);
"""

_RECENT_TURNS_SQL = """
    SELECT id::text AS chat_id, question, answer, created_at
    FROM folder_chats
    WHERE folder_name = %s AND user_id::text = %s AND session_id::text = %s
    ORDER BY created_at DESC
    LIMIT %s
"""

_OLDER_TURNS_SQL = """
    SELECT chat_id, question, answer, created_at FROM (
        SELECT id::text AS chat_id, question, answer, created_at
        FROM folder_chats
        WHERE folder_name = %s AND user_id::text = %s AND session_id::text = %s
        ORDER BY created_at DESC
        OFFSET %s LIMIT %s
    ) older
    ORDER BY created_at ASC
"""

_SUMMARY_SQL = """
    SELECT summary, covered_turns, covered_until
    FROM chat_session_summaries
    WHERE folder_name = %s AND user_id = %s AND session_id = %s
"""

# The WHERE on the update is an optimistic lock: a summary is replaced only if nobody
# folded other turns into it since it was read.
_UPSERT_SQL = """
    INSERT INTO chat_session_summaries
        (folder_name, user_id, session_id, summary, covered_turns, covered_until, last_chat_id, model)
    VALUES (%s, %s, %s, %s, %s, %s::timestamptz, %s, %s)
    ON CONFLICT (folder_name, user_id, session_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        covered_turns = EXCLUDED.covered_turns,
        covered_until = EXCLUDED.covered_until,
        last_chat_id = EXCLUDED.last_chat_id,
        model = EXCLUDED.model,
        updated_at = NOW()
    WHERE chat_session_summaries.covered_until IS NOT DISTINCT FROM %s::timestamptz
"""

SUMMARY_PROMPT = """\
You keep a running summary of one conversation between an advocate and JuriNex, a legal
research and drafting assistant, inside a single case. The summary replaces the old turns
in later prompts, so write it for someone continuing this same conversation.

You get the SUMMARY SO FAR (it may be empty), the NEW TURNS to fold in, and the STANDING
RULES already saved for this advocate and case.

Cover, most important first:
- what the advocate asked for, and anything they asked to change, keep or avoid in this
  conversation;
- decisions and conclusions the advocate stated or accepted;
- what JuriNex answered, attributed as JuriNex's answer ("JuriNex found ..."), with the
  document and page it relied on when the turn gives them;
- open questions and pending tasks.

Rules:
- Use only the summary so far and the new turns. Add nothing: no new facts, dates, names,
  citations, reasons or conclusions.
- Copy names, dates, amounts, section numbers and case numbers exactly as written.
- JuriNex's analysis is an answer, not an established fact. Never state it as a fact.
- When a new turn corrects or replaces something earlier, keep only the current version.
- Do not repeat the standing rules, and never restate an item already in the summary.
- Drop greetings, thanks, and chatter about formatting that is not a request.
- Plain text, one short "- " bullet per item, at most {max_tokens} tokens (about
  {max_chars} characters). If space runs out, drop the least important items.

Return JSON only: {{"summary": "<the updated summary>"}}
"""

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
_HEX32_RE = re.compile(r"^[0-9a-f]{32}$")

_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="chat-summary")
_ensured = False
_ensure_lock = threading.Lock()
_session_locks: dict[tuple[str, str, str], threading.Lock] = {}
_session_locks_guard = threading.Lock()


@dataclass(frozen=True)
class Turn:
    chat_id: str
    question: str
    answer: str
    created_at: datetime | None = None


@dataclass(frozen=True)
class SummaryRow:
    summary: str
    covered_turns: int = 0
    covered_until: datetime | None = None


# ── Settings ─────────────────────────────────────────────────────────────────

def summary_enabled() -> bool:
    return bool(getattr(get_settings(), "chat_summary_enabled", True))


def recent_turn_count(max_history: int | None) -> int:
    """Turns sent verbatim: the configured number, never more than the plan allows."""
    try:
        plan = int(max_history or 0)
    except (TypeError, ValueError):
        plan = 0
    if plan <= 0:
        return 0
    configured = int(getattr(get_settings(), "chat_history_recent_turns", 3) or 3)
    return max(1, min(plan, configured))


def answer_chars(*, latest: bool) -> int:
    settings = get_settings()
    if latest:
        tokens = getattr(settings, "chat_history_latest_answer_tokens", 3000)
    else:
        tokens = getattr(settings, "chat_history_older_answer_tokens", 700)
    return max(400, chars_for_tokens(int(tokens or 0)))


def summary_max_tokens() -> int:
    return max(200, int(getattr(get_settings(), "chat_summary_max_tokens", 1000) or 1000))


def summary_max_chars() -> int:
    return chars_for_tokens(summary_max_tokens())


# ── Text helpers ─────────────────────────────────────────────────────────────

def normalize_session_id(session_id: Any) -> str:
    raw = str(session_id or "").strip().lower()
    if _HEX32_RE.match(raw):
        return f"{raw[0:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"
    return raw


def shorten(text: str | None, max_chars: int) -> str:
    """At most `max_chars`, cut at a paragraph, line, sentence or word, and marked as shortened."""
    body = str(text or "").strip()
    if max_chars <= 0 or len(body) <= max_chars:
        return body
    room = max(1, max_chars - len(SHORTENED_MARK) - 1)
    cut = body[:room]
    floor = int(room * 0.6)
    for separator in ("\n\n", "\n", ". ", " "):
        at = cut.rfind(separator)
        if at >= floor:
            cut = cut[: at + 1] if separator == ". " else cut[:at]
            break
    return cut.rstrip() + "\n" + SHORTENED_MARK


def fit_summary(text: str | None, max_chars: int) -> str:
    """Tidy the summary and keep it within `max_chars`, dropping whole items from the end."""
    lines = [line.rstrip() for line in str(text or "").strip().splitlines()]
    lines = [line for line in lines if line.strip()]
    if not lines:
        return ""
    kept: list[str] = []
    used = 0
    for line in lines:
        cost = len(line) + (1 if kept else 0)
        if used + cost > max_chars:
            break
        kept.append(line)
        used += cost
    if not kept:
        return shorten(lines[0], max_chars).replace("\n" + SHORTENED_MARK, " …")
    return "\n".join(kept)


def _naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _turn(row: Any) -> Turn:
    data = dict(row) if hasattr(row, "keys") else {
        "chat_id": row[0], "question": row[1], "answer": row[2], "created_at": row[3]
    }
    return Turn(
        chat_id=str(data.get("chat_id") or ""),
        question=str(data.get("question") or ""),
        answer=str(data.get("answer") or ""),
        created_at=data.get("created_at"),
    )


def _summary_row(row: Any) -> SummaryRow | None:
    if not row:
        return None
    data = dict(row) if hasattr(row, "keys") else {
        "summary": row[0], "covered_turns": row[1], "covered_until": row[2]
    }
    return SummaryRow(
        summary=str(data.get("summary") or ""),
        covered_turns=int(data.get("covered_turns") or 0),
        covered_until=data.get("covered_until"),
    )


def _render_turns(turns: Sequence[Turn], *, latest_whole: bool) -> str:
    lines: list[str] = []
    last = len(turns) - 1
    for position, turn in enumerate(turns):
        question = shorten(turn.question, MAX_QUESTION_CHARS)
        answer = shorten(turn.answer, answer_chars(latest=latest_whole and position == last))
        if question:
            lines.append(f"User: {question}")
        if answer:
            lines.append(f"Assistant: {answer}")
    return "\n".join(lines)


# ── History block for the chat prompt ────────────────────────────────────────

def render_history(
    query_text: str,
    *,
    turns_newest_first: Sequence[Turn],
    summary: SummaryRow | None,
    recent_count: int,
    use_summary: bool = True,
) -> str:
    """The question with its history block, or the question alone when there is none."""
    turns = list(turns_newest_first)
    recent = list(reversed(turns[:recent_count]))
    older_oldest_first = list(reversed(turns[recent_count:]))

    summary_text = summary.summary.strip() if (use_summary and summary is not None) else ""
    gap: list[Turn] = []
    if use_summary:
        covered = _naive_utc(summary.covered_until) if summary is not None else None
        gap = [
            turn
            for turn in older_oldest_first
            if covered is None or turn.created_at is None or _naive_utc(turn.created_at) > covered
        ][-MAX_GAP_TURNS:]

    parts: list[str] = []
    if summary_text:
        parts.append(f"{SUMMARY_HEADER}\n{summary_text}")
    if gap:
        parts.append(f"{GAP_HEADER}\n{_render_turns(gap, latest_whole=False)}")
    if recent:
        parts.append(f"{HISTORY_HEADER}\n{_render_turns(recent, latest_whole=True)}")
    if not parts:
        return query_text
    return "\n\n".join([HISTORY_INTRO, *parts, f"{CURRENT_HEADER}\n{query_text}"])


def read_history_state(
    folder_name: str,
    user_id: str,
    session_id: str,
    limit: int,
) -> tuple[list[Turn], SummaryRow | None]:
    """Newest-first turns of one chat and its summary. Raises on database errors."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(_RECENT_TURNS_SQL, (folder_name, user_id, session_id, limit))
            turns = [_turn(row) for row in cur.fetchall()]
        summary: SummaryRow | None = None
        if turns and summary_enabled():
            try:
                with conn.cursor() as cur:
                    cur.execute(_SUMMARY_SQL, (folder_name, user_id, session_id))
                    summary = _summary_row(cur.fetchone())
            except Exception as exc:  # noqa: BLE001 — the table may not exist until the first update
                logger.debug("[ChatSummary] summary not read for session=%s: %s", session_id, exc)
                try:
                    conn.rollback()
                except Exception:  # noqa: BLE001
                    pass
    return turns, summary


def build_history_block(
    *,
    user_id: str,
    folder_name: str,
    session_id: str | None,
    query_text: str,
    max_history: int,
    fallback_turns: Callable[[int], Sequence[dict[str, Any]]] | None = None,
) -> str:
    """The question with this chat's history block. Never raises.

    `fallback_turns(limit)` returns oldest-first {question, answer} pairs from wherever
    the caller keeps them when the database has none (for example an unsaved session).
    """
    recent_count = recent_turn_count(max_history)
    session = normalize_session_id(session_id)
    if recent_count <= 0 or not session:
        return query_text
    use_summary = summary_enabled()

    turns: list[Turn] = []
    summary: SummaryRow | None = None
    if is_db_available():
        try:
            turns, summary = read_history_state(
                folder_name,
                str(user_id),
                session,
                recent_count + (MAX_GAP_TURNS if use_summary else 0),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[ChatSummary] history not read for session=%s: %s", session, exc)
            turns, summary = [], None
    if not turns and fallback_turns is not None:
        try:
            pairs = list(fallback_turns(recent_count) or [])
        except Exception:  # noqa: BLE001
            pairs = []
        turns = [
            Turn(chat_id="", question=str(pair.get("question") or ""), answer=str(pair.get("answer") or ""))
            for pair in reversed(pairs)
        ]

    block = render_history(
        query_text,
        turns_newest_first=turns,
        summary=summary,
        recent_count=recent_count,
        use_summary=use_summary,
    )
    if block is not query_text:
        logger.info(
            "[ChatSummary] history session=%s recent=%s summary_chars=%s older_turns=%s prompt_chars=%s",
            session,
            min(recent_count, len(turns)),
            len(summary.summary) if summary is not None else 0,
            max(0, len(turns) - recent_count),
            len(block),
        )
    return block


# ── Rolling summary update (background, after each answer) ───────────────────

def ensure_table(conn: Any) -> None:
    global _ensured
    if _ensured:
        return
    with _ensure_lock:
        if _ensured:
            return
        with conn.cursor() as cur:
            cur.execute(_ENSURE_SQL)
        conn.commit()
        _ensured = True


def read_summary_text(folder_name: str, user_id: Any, session_id: Any) -> str:
    """The stored summary of one chat, or "" when there is none.

    For readers outside this module (the memory writer). Never raises and never creates
    the table.
    """
    folder = str(folder_name or "").strip()
    user = str(user_id or "").strip()
    session = normalize_session_id(session_id)
    if not (folder and user and session) or not is_db_available():
        return ""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.chat_session_summaries') IS NOT NULL AS present")
            row = cur.fetchone()
            present = (row.get("present") if hasattr(row, "get") else row[0]) if row else False
            if not present:
                return ""
            cur.execute(_SUMMARY_SQL, (folder, user, session))
            found = _summary_row(cur.fetchone())
        return found.summary if found is not None else ""
    except Exception as exc:  # noqa: BLE001
        logger.debug("[ChatSummary] summary text unavailable session=%s: %s", session, exc)
        return ""


def _read_summary(folder_name: str, user_id: str, session_id: str) -> SummaryRow | None:
    with get_db_connection() as conn:
        ensure_table(conn)
        with conn.cursor() as cur:
            cur.execute(_SUMMARY_SQL, (folder_name, user_id, session_id))
            return _summary_row(cur.fetchone())


def _pending_turns(
    folder_name: str,
    user_id: str,
    session_id: str,
    *,
    offset: int,
    covered_until: datetime | None,
) -> list[Turn]:
    """Oldest-first turns that left the recent window and are not in the summary yet."""
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(_OLDER_TURNS_SQL, (folder_name, user_id, session_id, offset, SESSION_SCAN_LIMIT))
        turns = [_turn(row) for row in cur.fetchall()]
    cutoff = _naive_utc(covered_until)
    return [
        turn
        for turn in turns
        if cutoff is None or (turn.created_at is not None and _naive_utc(turn.created_at) > cutoff)
    ]


def _store_summary(
    folder_name: str,
    user_id: str,
    session_id: str,
    *,
    summary: str,
    covered_turns: int,
    covered_until: datetime | None,
    last_chat_id: str,
    model: str,
    expected_covered_until: datetime | None,
) -> bool:
    with get_db_connection() as conn:
        ensure_table(conn)
        with conn.cursor() as cur:
            cur.execute(
                _UPSERT_SQL,
                (
                    folder_name,
                    user_id,
                    session_id,
                    summary,
                    covered_turns,
                    _naive_utc(covered_until),
                    last_chat_id,
                    model,
                    _naive_utc(expected_covered_until),
                ),
            )
            stored = (cur.rowcount or 0) > 0
        conn.commit()
    return stored


def _saved_rules(user_id: str, case_key: str | None) -> list[str]:
    """Instruction texts already saved, so the summary does not repeat them. Never raises."""
    try:
        from app.services.memory import repository

        scopes: list[tuple[str, str]] = [("user", user_id)]
        if case_key:
            scopes.append(("case", case_key))
        texts: list[str] = []
        for scope_type, scope_id in scopes:
            data = repository.get_instruction_set(scope_type, scope_id) or {}
            for item in data.get("items") or []:
                text = str(item.get("text") or "").strip()
                if text and item.get("enabled", True):
                    texts.append(text)
        return texts[:40]
    except Exception as exc:  # noqa: BLE001
        logger.debug("[ChatSummary] saved rules unavailable: %s", exc)
        return []


def build_summary_request(previous: str, turns: Sequence[Turn], rules: Sequence[str]) -> str:
    input_answer_chars = chars_for_tokens(SUMMARY_INPUT_ANSWER_TOKENS)
    parts = ["SUMMARY SO FAR:", "<<<", previous.strip() or "(empty)", ">>>", ""]
    parts.append("STANDING RULES ALREADY SAVED (applied separately; do not repeat them):")
    parts.extend([f"- {rule}" for rule in rules] or ["(none)"])
    parts.extend(["", "NEW TURNS TO FOLD IN (oldest first):"])
    for number, turn in enumerate(turns, 1):
        parts.append(f"[Turn {number}]")
        parts.append(f"ADVOCATE: {shorten(turn.question, MAX_QUESTION_CHARS)}")
        parts.append(f"JURINEX: {shorten(turn.answer, input_answer_chars)}")
        parts.append("")
    return "\n".join(parts).rstrip()


def parse_summary(payload: Any) -> str:
    """The summary from the model's output. Raises ValueError when there is none."""
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
    if isinstance(data, dict):
        summary = str(data.get("summary") or "").strip()
        if summary:
            return summary
    raise ValueError("The model returned no summary.")


def _model_config(model: str) -> Any:
    from google.genai import types

    settings = get_settings()
    kwargs: dict[str, Any] = {
        "system_instruction": SUMMARY_PROMPT.format(
            max_tokens=summary_max_tokens(), max_chars=summary_max_chars()
        ),
        "temperature": 0.2,
        "max_output_tokens": SUMMARY_OUTPUT_TOKENS,
        "response_mime_type": "application/json",
    }
    name = model.strip().lower().rsplit("/", 1)[-1]
    level = str(getattr(settings, "chat_summary_thinking_level", "low") or "").strip().lower()
    if "gemini-3" in name and level in THINKING_LEVELS:
        if "gemini-3.7" in name and level == "minimal":
            level = "low"
        try:
            kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=level)
        except Exception:  # noqa: BLE001 — older SDKs
            pass
    timeout_ms = int(max(5.0, float(getattr(settings, "chat_summary_timeout_s", 60.0) or 60.0)) * 1000)
    try:
        return types.GenerateContentConfig(**kwargs, http_options=types.HttpOptions(timeout=timeout_ms))
    except Exception:  # noqa: BLE001 — older SDKs have no per-request http_options
        return types.GenerateContentConfig(**kwargs)


def _ask_model(previous: str, turns: Sequence[Turn], rules: Sequence[str]) -> tuple[str, str]:
    """(summary, model). Raises when the model is unavailable or returns nothing usable."""
    from app.services.adapters.document_ai import _gemini_client

    model = str(getattr(get_settings(), "chat_summary_model", "") or "gemini-3.8-flash").strip()
    client = _gemini_client(model)
    if client is None:
        raise RuntimeError("No Gemini client is configured for chat summaries.")
    response = client.models.generate_content(
        model=model,
        contents=build_summary_request(previous, turns, rules),
        config=_model_config(model),
    )
    return parse_summary(getattr(response, "text", "") or ""), model


def _session_lock(key: tuple[str, str, str]) -> threading.Lock:
    with _session_locks_guard:
        lock = _session_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _session_locks[key] = lock
        return lock


def update_session_summary(
    *,
    user_id: Any,
    folder_name: str,
    session_id: Any,
    max_history: int,
    case_key: str | None = None,
) -> str:
    """Fold the turns that left the recent window into the chat's summary.

    Returns what happened ("updated", "up_to_date", "disabled", ...). Never raises.
    """
    user = str(user_id or "").strip()
    folder = str(folder_name or "").strip()
    session = normalize_session_id(session_id)
    recent_count = recent_turn_count(max_history)
    if not summary_enabled():
        return "disabled"
    if recent_count <= 0 or not session or not folder or not user or user == "anonymous":
        return "not_applicable"
    if not is_db_available():
        return "db_unavailable"

    lock = _session_lock((folder, user, session))
    if not lock.acquire(timeout=LOCK_TIMEOUT_S):
        return "busy"
    try:
        outcome = "up_to_date"
        for _round in range(MAX_UPDATE_ROUNDS):
            previous = _read_summary(folder, user, session)
            covered = previous.covered_until if previous is not None else None
            pending = _pending_turns(folder, user, session, offset=recent_count, covered_until=covered)
            if not pending:
                break
            batch = pending[:MAX_TURNS_PER_UPDATE]
            try:
                text, model = _ask_model(
                    previous.summary if previous is not None else "",
                    batch,
                    _saved_rules(user, case_key),
                )
            except Exception as exc:  # noqa: BLE001 — the unsummarised turns are still sent shortened
                logger.warning("[ChatSummary] summary model failed session=%s: %s", session, exc)
                return "model_error"
            text = fit_summary(text, summary_max_chars())
            if not text:
                return "empty"
            stored = _store_summary(
                folder,
                user,
                session,
                summary=text,
                covered_turns=(previous.covered_turns if previous is not None else 0) + len(batch),
                covered_until=batch[-1].created_at,
                last_chat_id=batch[-1].chat_id,
                model=model,
                expected_covered_until=covered,
            )
            if not stored:
                return "conflict"
            outcome = "updated"
            logger.info(
                "[ChatSummary] updated session=%s folded_turns=%s summary_chars=%s model=%s",
                session,
                len(batch),
                len(text),
                model,
            )
            if len(pending) <= len(batch):
                break
        return outcome
    except Exception as exc:  # noqa: BLE001
        logger.warning("[ChatSummary] update failed session=%s: %s", session, exc)
        return "error"
    finally:
        lock.release()


def submit_summary_update(**kwargs: Any) -> Future | None:
    """Run `update_session_summary` on the summary thread. Never raises."""
    if not summary_enabled():
        return None
    if recent_turn_count(kwargs.get("max_history")) <= 0 or not normalize_session_id(kwargs.get("session_id")):
        return None
    try:
        return _EXECUTOR.submit(update_session_summary, **kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[ChatSummary] update not started: %s", exc)
        return None


# ── Deletion ─────────────────────────────────────────────────────────────────

def delete_summaries(cur: Any, *, folder_name: str, session_or_chat_id: str | None = None) -> int:
    """Delete a folder's chat summaries, or one chat's, on an open cursor.

    Checks that the table exists first, so it can run inside a larger transaction
    without aborting it. `session_or_chat_id` may be a session id or a folder_chats row
    id, like delete_session accepts; call it before the chat rows are deleted.
    """
    cur.execute("SELECT to_regclass('public.chat_session_summaries') IS NOT NULL AS present")
    row = cur.fetchone()
    present = (row.get("present") if hasattr(row, "get") else row[0]) if row else False
    if not present:
        return 0
    # A savepoint keeps a failure here from aborting the caller's delete of the chats.
    cur.execute("SAVEPOINT chat_session_summaries_delete")
    try:
        if session_or_chat_id:
            ident = normalize_session_id(session_or_chat_id)
            cur.execute(
                """
                DELETE FROM chat_session_summaries
                 WHERE folder_name = %s
                   AND (
                        session_id = %s
                        OR session_id IN (
                            SELECT session_id::text FROM folder_chats
                             WHERE folder_name = %s AND id::text = %s
                        )
                   )
                """,
                (folder_name, ident, folder_name, ident),
            )
        else:
            cur.execute("DELETE FROM chat_session_summaries WHERE folder_name = %s", (folder_name,))
        deleted = int(cur.rowcount or 0)
        cur.execute("RELEASE SAVEPOINT chat_session_summaries_delete")
        return deleted
    except Exception as exc:  # noqa: BLE001
        logger.warning("[ChatSummary] summaries not deleted folder=%s: %s", folder_name, exc)
        cur.execute("ROLLBACK TO SAVEPOINT chat_session_summaries_delete")
        return 0
