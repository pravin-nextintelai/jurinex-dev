"""Personalization: prompt log -> batched profile builder -> instruction generator.

Flow
----
1. Every document-chat prompt is appended to `personalization_prompts` with a
   per-user running `prompt_no` and `batch_no = (prompt_no - 1) // BATCH + 1`.
   Recording is fire-and-forget from the chat route (thread pool), so the user
   never waits on it.
2. When a batch completes (`prompt_no % BATCH == 0`) a background job runs the
   Profile Builder: previous profile JSON + that batch's prompts -> a new profile
   version in `personalization_profiles`. The profile is cumulative. A catch-up
   loop processes every still-uncovered batch, so a missed run self-heals on the
   next trigger.
3. "Generate instruction" (button) -> latest profile (or DEFAULT_LEGAL_PROFILE
   for a new user) + the current session's prompts -> Instruction Generator ->
   structured plain text shown to the user.
4. "Add to system" -> `personalization_instructions` row with is_active=true
   (previous active rows deactivated; `mode="append"` merges with the current
   one). `build_active_instruction_block(user_id)` is appended to the
   document-chat system prompt on every message.

Tables are created lazily (CREATE TABLE IF NOT EXISTS) on first use; canonical
DDL lives in db/migrations/170_create_personalization_tables.sql.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from pydantic import BaseModel

from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available
from app.services.personalization_prompts import (
    DEFAULT_LEGAL_PROFILE,
    INSTRUCTION_GENERATOR_SYSTEM_PROMPT,
    INSTRUCTION_POLISH_SYSTEM_PROMPT,
    PROFILE_BUILDER_SYSTEM_PROMPT,
    PROFILE_PATTERN_KEYS,
    PROFILE_SCHEMA_VERSION,
)

logger = logging.getLogger("agentic_document_service.personalization")

_ENSURE_SQL = """
CREATE TABLE IF NOT EXISTS personalization_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    session_id TEXT,
    folder_name TEXT,
    prompt_text TEXT NOT NULL,
    prompt_no INTEGER NOT NULL,
    batch_no INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_personalization_prompts_user_no
    ON personalization_prompts (user_id, prompt_no);
CREATE INDEX IF NOT EXISTS idx_personalization_prompts_user_batch
    ON personalization_prompts (user_id, batch_no);
CREATE INDEX IF NOT EXISTS idx_personalization_prompts_session
    ON personalization_prompts (session_id);
ALTER TABLE personalization_prompts ADD COLUMN IF NOT EXISTS source_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_personalization_prompts_source_ref
    ON personalization_prompts (user_id, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS personalization_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    batch_no INTEGER NOT NULL DEFAULT 0,
    prompts_covered INTEGER NOT NULL DEFAULT 0,
    profile_json JSONB NOT NULL,
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_personalization_profiles_user_version
    ON personalization_profiles (user_id, version);

CREATE TABLE IF NOT EXISTS personalization_instructions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    instruction_text TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    source_profile_version INTEGER,
    source_session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_personalization_instructions_user_active
    ON personalization_instructions (user_id, is_active);
ALTER TABLE personalization_instructions ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE personalization_instructions ADD COLUMN IF NOT EXISTS behaviour_json JSONB;
ALTER TABLE personalization_instructions ADD COLUMN IF NOT EXISTS folder_name TEXT;
CREATE INDEX IF NOT EXISTS idx_personalization_instructions_user_folder_active
    ON personalization_instructions (user_id, folder_name, is_active);
"""

# How an instruction came to be: written by hand, generated from the profile +
# session, or hand-written then rewritten by the polisher.
_VALID_ORIGINS = ("manual", "generated", "polished")

_tables_ready = False
_tables_lock = threading.Lock()

# Small dedicated pool: prompt logging + profile rebuilds. Never the request thread.
_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="personalization")
_inflight_lock = threading.Lock()
_inflight_rebuilds: set[str] = set()

# Per-user cache of the rendered active-instruction block (TTL seconds). One
# indexed query per chat message is cheap, but this also shields the chat route
# from a slow DB and is invalidated on every activate/deactivate/delete.
_ACTIVE_CACHE_TTL_S = 30.0
_active_cache: dict[str, tuple[float, str]] = {}

_MAX_ACTIVE_INSTRUCTION_CHARS = 12_000
_MAX_EXAMPLES_PER_PATTERN = 3
_MAX_EXAMPLE_CHARS = 160
_MAX_PATTERNS_PER_CATEGORY = 12
_MAX_CATCHUP_BATCHES = 50

_FALLBACK_MODELS = ("gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash")


# ── Settings ──────────────────────────────────────────────────────────────────

def _settings() -> Any:
    return get_settings()


def _enabled() -> bool:
    return bool(getattr(_settings(), "personalization_enabled", True))


def _batch_size() -> int:
    try:
        return max(2, int(getattr(_settings(), "personalization_batch_size", 10) or 10))
    except (TypeError, ValueError):
        return 10


def _max_prompt_chars() -> int:
    try:
        return max(200, int(getattr(_settings(), "personalization_max_prompt_chars", 4000) or 4000))
    except (TypeError, ValueError):
        return 4000


def _model_chain(override: str | None = None) -> list[str]:
    preferred = str(getattr(_settings(), "personalization_model", "") or "").strip()
    chain: list[str] = []
    for name in (str(override or "").strip(), preferred, *_FALLBACK_MODELS):
        if name and name not in chain:
            chain.append(name)
    return chain


# ── DB helpers ────────────────────────────────────────────────────────────────

def _ensure_tables(conn: Any) -> None:
    global _tables_ready
    if _tables_ready:
        return
    with _tables_lock:
        if _tables_ready:
            return
        try:
            with conn.cursor() as cur:
                cur.execute(_ENSURE_SQL)
            conn.commit()
        except Exception as exc:  # noqa: BLE001 — concurrent CREATE from another worker
            conn.rollback()
            logger.debug("[Personalization] DDL skipped: %s", exc)
        _tables_ready = True


def _require_db() -> None:
    if not is_db_available():
        raise RuntimeError("Database access is not configured for the agentic document service.")


def _row_out(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    out = dict(row)
    for key in ("id",):
        if out.get(key) is not None:
            out[key] = str(out[key])
    for key in ("created_at", "updated_at"):
        if out.get(key) is not None and hasattr(out[key], "isoformat"):
            out[key] = out[key].isoformat()
    if out.get("instruction_text"):
        out["instruction_text"] = _to_plain_instruction(str(out["instruction_text"]))
    return out


def _clean_uid(user_id: Any) -> str:
    uid = str(user_id or "").strip()
    if not uid or uid.lower() == "anonymous":
        return ""
    return uid


def _cache_key(uid: str, folder_name: str | None) -> str:
    return f"{uid}|{(folder_name or '').strip()}"


def _invalidate_cache(uid: str) -> None:
    prefix = f"{uid}|"
    for key in [k for k in _active_cache if k.startswith(prefix)]:
        _active_cache.pop(key, None)


def _clean_folder(folder_name: Any) -> str | None:
    text = str(folder_name or "").strip()
    return text or None


# ── Structured-output schema for the profile ─────────────────────────────────

class PatternEntry(BaseModel):
    pattern: str
    confidence: float
    evidence_count: int
    examples: list[str]


class UserExpectationProfile(BaseModel):
    schema_version: int
    summary: str
    language_mix: str
    practice_areas: list[PatternEntry]
    typical_tasks: list[PatternEntry]
    response_expectations: list[PatternEntry]
    output_format_preferences: list[PatternEntry]
    tone_and_language: list[PatternEntry]
    depth_and_length: list[PatternEntry]
    communication_style: list[PatternEntry]
    expertise_signals: list[PatternEntry]
    citation_preferences: list[PatternEntry]
    jurisdiction_focus: list[PatternEntry]
    recurring_topics: list[PatternEntry]
    dislikes_and_corrections: list[PatternEntry]


# ── Structured-output schema for instruction generation ─────────────────────
# Step 1 (behaviour analysis) precedes step 2 (instruction) in the schema so the
# model must reason about the user's behaviour BEFORE writing the rules.

class BehaviourInsight(BaseModel):
    finding: str
    confidence: float
    evidence: list[str]


class BehaviourAnalysis(BaseModel):
    summary: str
    tone: BehaviourInsight
    response_shape: BehaviourInsight
    depth_and_length: BehaviourInsight
    language: BehaviourInsight
    expertise_level: BehaviourInsight
    communication_style: BehaviourInsight
    priorities: list[BehaviourInsight]
    dislikes: list[BehaviourInsight]


class InstructionGeneration(BaseModel):
    behaviour_analysis: BehaviourAnalysis
    instruction_markdown: str


_BEHAVIOUR_CORE_KEYS = (
    "tone", "response_shape", "depth_and_length", "language", "expertise_level", "communication_style",
)
_MAX_BEHAVIOUR_EVIDENCE = 2
_MAX_BEHAVIOUR_LIST = 8


def _normalize_insight(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    finding = str(raw.get("finding") or "").strip()
    if not finding:
        return None
    try:
        confidence = float(raw.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    evidence = [
        str(e).strip()[:_MAX_EXAMPLE_CHARS]
        for e in list(raw.get("evidence") or [])[:_MAX_BEHAVIOUR_EVIDENCE]
        if str(e).strip()
    ]
    return {
        "finding": finding[:400],
        "confidence": round(min(1.0, max(0.0, confidence)), 2),
        "evidence": evidence,
    }


def _normalize_behaviour(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"summary": str(raw.get("summary") or "").strip()[:1200]}
    for key in _BEHAVIOUR_CORE_KEYS:
        out[key] = _normalize_insight(raw.get(key))
    for key in ("priorities", "dislikes"):
        items = [_normalize_insight(x) for x in list(raw.get(key) or [])[:_MAX_BEHAVIOUR_LIST]]
        out[key] = [x for x in items if x]
    return out


def _normalize_profile(raw: dict[str, Any]) -> dict[str, Any]:
    """Clamp/limit a model-produced profile so a bad generation can't bloat the DB."""
    out: dict[str, Any] = {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "summary": str(raw.get("summary") or "").strip()[:2000],
        "language_mix": str(raw.get("language_mix") or "English").strip()[:200],
    }
    for key in PROFILE_PATTERN_KEYS:
        cleaned: list[dict[str, Any]] = []
        for item in list(raw.get(key) or [])[: _MAX_PATTERNS_PER_CATEGORY]:
            if not isinstance(item, dict):
                continue
            pattern = str(item.get("pattern") or "").strip()
            if not pattern:
                continue
            try:
                confidence = float(item.get("confidence") or 0.0)
            except (TypeError, ValueError):
                confidence = 0.0
            try:
                evidence = int(item.get("evidence_count") or 0)
            except (TypeError, ValueError):
                evidence = 0
            examples = [
                str(e).strip()[:_MAX_EXAMPLE_CHARS]
                for e in list(item.get("examples") or [])[:_MAX_EXAMPLES_PER_PATTERN]
                if str(e).strip()
            ]
            cleaned.append(
                {
                    "pattern": pattern[:400],
                    "confidence": round(min(1.0, max(0.0, confidence)), 2),
                    "evidence_count": max(0, evidence),
                    "examples": examples,
                }
            )
        out[key] = cleaned
    return out


# ── Gemini call ───────────────────────────────────────────────────────────────

_FENCE_RE = re.compile(r"^```(?:\w+)?\s*\n([\s\S]*?)\n```\s*$")
_INLINE_FENCE_RE = re.compile(r"```(?:\w+)?\s*\n?|```")
_HEADING_MARK_RE = re.compile(r"^\s{0,3}#{1,6}\s+")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*|__(.+?)__")
_ITALIC_RE = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")
_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_HR_LINE_RE = re.compile(r"^\s*[-*_]{3,}\s*$")
_AMP_SECTION = {
    "depth & detail": "Depth and detail",
    "citations & jurisdiction": "Citations and jurisdiction",
}


def _strip_fences(text: str) -> str:
    stripped = (text or "").strip()
    match = _FENCE_RE.match(stripped)
    return match.group(1).strip() if match else stripped


def _to_plain_instruction(text: str) -> str:
    """Structured plain text: section titles and hyphen bullets, no markdown."""
    s = _INLINE_FENCE_RE.sub("", _strip_fences(text or "")).strip()
    if not s:
        return ""
    lines: list[str] = []
    for raw in s.splitlines():
        line = raw.rstrip()
        if _HR_LINE_RE.match(line):
            lines.append("")
            continue
        line = _HEADING_MARK_RE.sub("", line)
        line = _BOLD_RE.sub(lambda m: m.group(1) or m.group(2) or "", line)
        line = _INLINE_CODE_RE.sub(r"\1", line)
        line = _ITALIC_RE.sub(r"\1", line)
        key = line.strip().lower()
        if key in _AMP_SECTION:
            line = _AMP_SECTION[key]
        lines.append(line)
    out = "\n".join(lines).strip()
    return re.sub(r"\n{3,}", "\n\n", out)


def _gemini_call(
    *,
    system: str,
    user: str,
    schema: type[BaseModel] | None = None,
    temperature: float,
    max_output_tokens: int,
    model_override: str | None = None,
) -> tuple[Any, str]:
    """One Gemini call with model fallback. Returns (parsed-or-text, model_used).

    `model_override` puts one model at the head of the chain (the memory router asks for
    the cheap flash model); the usual fallbacks still follow it.
    """
    from google.genai import types as gt

    from app.services.adapters.document_ai import _gemini_client

    client = _gemini_client()
    if client is None:
        raise RuntimeError("Gemini client unavailable — GEMINI_API_KEY not configured")

    last_err: Exception | None = None
    for model in _model_chain(model_override):
        kwargs: dict[str, Any] = {
            "system_instruction": system,
            "temperature": temperature,
            "max_output_tokens": max_output_tokens,
        }
        if schema is not None:
            kwargs["response_mime_type"] = "application/json"
            kwargs["response_schema"] = schema
        try:
            started = time.perf_counter()
            resp = client.models.generate_content(
                model=model,
                contents=user,
                config=gt.GenerateContentConfig(**kwargs),
            )
            text = (getattr(resp, "text", None) or "").strip()
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            if schema is not None:
                parsed = getattr(resp, "parsed", None)
                if not isinstance(parsed, schema):
                    parsed = schema.model_validate_json(_strip_fences(text))
                logger.info("[Personalization] %s structured call ok model=%s ms=%s", schema.__name__, model, elapsed_ms)
                return parsed, model
            if not text:
                raise ValueError("model returned an empty response")
            logger.info("[Personalization] text call ok model=%s ms=%s chars=%s", model, elapsed_ms, len(text))
            return _strip_fences(text), model
        except Exception as exc:  # noqa: BLE001 — try the next model
            last_err = exc
            logger.warning("[Personalization] model %s failed: %s", model, exc)
    raise RuntimeError(f"Personalization LLM call failed on all models: {last_err}")


# ── 1. Prompt log ─────────────────────────────────────────────────────────────

def record_prompt(
    user_id: Any,
    session_id: str | None,
    prompt_text: str,
    folder_name: str | None = None,
) -> dict[str, Any] | None:
    """Append one prompt. Returns the row (with prompt_no/batch_no) or None when skipped.

    When the prompt completes a batch, schedules the background profile rebuild.
    """
    if not _enabled() or not is_db_available():
        return None
    uid = _clean_uid(user_id)
    text = (prompt_text or "").strip()
    if not uid or not text:
        return None
    text = text[: _max_prompt_chars()]
    bs = _batch_size()

    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            # Serialise per-user numbering so two concurrent prompts can't share a prompt_no.
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"personalization:{uid}",))
            cur.execute(
                "SELECT COALESCE(MAX(prompt_no), 0) + 1 AS n FROM personalization_prompts WHERE user_id = %s",
                (uid,),
            )
            prompt_no = int(cur.fetchone()["n"])
            batch_no = (prompt_no - 1) // bs + 1
            cur.execute(
                """
                INSERT INTO personalization_prompts
                    (user_id, session_id, folder_name, prompt_text, prompt_no, batch_no)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, created_at
                """,
                (uid, (session_id or None), (folder_name or None), text, prompt_no, batch_no),
            )
            row = cur.fetchone()
        conn.commit()

    batch_complete = prompt_no % bs == 0
    logger.info(
        "[Personalization] prompt logged user_id=%s prompt_no=%s batch_no=%s batch_complete=%s",
        uid, prompt_no, batch_no, batch_complete,
    )
    if batch_complete:
        schedule_profile_rebuild(uid)
    return {
        "id": str(row["id"]),
        "prompt_no": prompt_no,
        "batch_no": batch_no,
        "batch_complete": batch_complete,
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


def record_prompt_in_background(
    *,
    user_id: Any,
    session_id: str | None,
    prompt_text: str,
    folder_name: str | None = None,
    incognito: bool = False,
) -> None:
    """Fire-and-forget `record_prompt` on the personalization thread pool."""
    if not _enabled():
        return
    if not _clean_uid(user_id) or not (prompt_text or "").strip():
        return

    def _job() -> None:
        try:
            record_prompt(user_id, session_id, prompt_text, folder_name)
        except Exception as exc:  # noqa: BLE001 — logging must never surface to the chat
            logger.warning("[Personalization] prompt log failed user_id=%s: %s", user_id, exc)
            return
        if incognito:
            return
        try:
            from app.services.memory_service import schedule_memory_extract

            # Prompt time handles only explicit "remember this" / "forget that", so the
            # user sees those land immediately. The LLM extraction moved to
            # memory_service.schedule_turn_extract, which the chat route fires once the
            # answer is out and can therefore weigh the reply as well as the question.
            schedule_memory_extract(
                user_id,
                prompt_text,
                folder_name=folder_name,
                session_id=session_id,
                explicit_only=True,
            )
        except Exception as mem_exc:  # noqa: BLE001
            logger.debug("[Personalization] memory extract skipped: %s", mem_exc)

    _EXECUTOR.submit(_job)


def _session_key(session_id: str) -> str:
    """Case/dash-insensitive session id (the UI may mint dashed or 32-hex ids)."""
    return str(session_id or "").strip().lower().replace("-", "")


def get_session_prompts(user_id: Any, session_id: str | None, limit: int = 40) -> list[dict[str, Any]]:
    uid = _clean_uid(user_id)
    sid = str(session_id or "").strip()
    if not uid or not sid or not is_db_available():
        return []
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, prompt_no, batch_no, prompt_text, session_id, folder_name, source_ref, created_at
                FROM personalization_prompts
                WHERE user_id = %s AND REPLACE(LOWER(session_id), '-', '') = %s
                ORDER BY prompt_no ASC
                LIMIT %s
                """,
                (uid, _session_key(sid), int(limit)),
            )
            return [_row_out(r) for r in cur.fetchall()]


def get_recent_prompts(user_id: Any, limit: int = 10, folder_name: str | None = None) -> list[dict[str, Any]]:
    """Most recent prompts, oldest first. With `folder_name`, only that case's prompts —
    every case keeps its own prompts, nothing from other cases leaks in."""
    uid = _clean_uid(user_id)
    if not uid or not is_db_available():
        return []
    folder = _clean_folder(folder_name)
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, prompt_no, batch_no, prompt_text, session_id, folder_name, created_at
                FROM personalization_prompts
                WHERE user_id = %s{" AND folder_name = %s" if folder else ""}
                ORDER BY prompt_no DESC
                LIMIT %s
                """,
                (uid, folder, int(limit)) if folder else (uid, int(limit)),
            )
            rows = [_row_out(r) for r in cur.fetchall()]
    rows.reverse()  # oldest first
    return rows


_UUID_HEX32_RE = re.compile(r"^[0-9a-fA-F]{32}$")


def _session_uuid_text(session_id: str) -> str:
    """folder_chats.session_id is a UUID; match the dashed lowercase text form."""
    s = session_id.strip().lower()
    if _UUID_HEX32_RE.match(s):
        return f"{s[0:8]}-{s[8:12]}-{s[12:16]}-{s[16:20]}-{s[20:32]}"
    return s


def get_chat_history_prompts(user_id: Any, session_id: str | None, limit: int = 40) -> list[dict[str, Any]]:
    """User questions of an OLDER chat read from folder_chats — for sessions that
    pre-date the prompt log (or that it missed). Same row shape as
    get_session_prompts so callers can treat both alike."""
    uid = _clean_uid(user_id)
    sid = str(session_id or "").strip()
    if not uid or not sid or not is_db_available():
        return []
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, question, session_id, folder_name, created_at
                    FROM folder_chats
                    WHERE user_id::text = %s AND session_id::text = %s
                    ORDER BY created_at ASC
                    LIMIT %s
                    """,
                    (uid, _session_uuid_text(sid), int(limit)),
                )
                rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001 — fallback only; never break generation
        logger.warning("[Personalization] chat-history fallback failed session=%s: %s", sid, exc)
        return []
    out: list[dict[str, Any]] = []
    cap = _max_prompt_chars()
    for i, r in enumerate(rows, start=1):
        question = str(r.get("question") or "").strip()
        if not question:
            continue
        created = r.get("created_at")
        out.append(
            {
                "id": str(r.get("id")),
                "prompt_no": i,
                "batch_no": 0,
                "prompt_text": question[:cap],
                "session_id": str(r.get("session_id") or sid),
                "folder_name": r.get("folder_name"),
                "created_at": created.isoformat() if created is not None and hasattr(created, "isoformat") else None,
                "source": "chat_history",
            }
        )
    return out


def get_session_history(user_id: Any, session_id: str | None, limit: int = 40) -> tuple[list[dict[str, Any]], str]:
    """Prompts of a session: the prompt log first, then folder_chats for old chats.
    Returns (rows, source) with source in {"session", "chat_history", "none"}."""
    if not session_id:
        return [], "none"
    rows = get_session_prompts(user_id, session_id, limit=limit)
    if rows:
        return rows, "session"
    rows = get_chat_history_prompts(user_id, session_id, limit=limit)
    return (rows, "chat_history") if rows else ([], "none")


def import_chat_history(
    user_id: Any,
    *,
    session_id: str | None = None,
    folder_name: str | None = None,
    limit: int = 2000,
) -> dict[str, Any]:
    """Run OLD chats through the same flow as live prompts.

    Every not-yet-imported question in folder_chats (one session, one case
    folder, or the user's whole history) is appended to the prompt log in
    chronological order — counter +1 each, batch_no assigned, original
    timestamp kept — and, if that completes one or more batches, the Profile
    Builder is scheduled in the background (its catch-up loop handles several
    batches at once). Idempotent: `source_ref = 'folder_chats:<id>'` is unique
    per user, and sessions that were already logged live are skipped.
    """
    _require_db()
    uid = _clean_uid(user_id)
    if not uid:
        raise ValueError("A signed-in user is required")
    bs = _batch_size()
    cap = _max_prompt_chars()

    sql = """
        SELECT fc.id, fc.question, fc.session_id::text AS session_id, fc.folder_name, fc.created_at
        FROM folder_chats fc
        WHERE fc.user_id::text = %s
          AND COALESCE(fc.question, '') <> ''
          AND NOT EXISTS (
                SELECT 1 FROM personalization_prompts pp
                WHERE pp.user_id = %s AND pp.source_ref = 'folder_chats:' || fc.id::text
          )
          AND NOT EXISTS (
                SELECT 1 FROM personalization_prompts pl
                WHERE pl.user_id = %s AND pl.source_ref IS NULL
                  AND REPLACE(LOWER(pl.session_id), '-', '') = REPLACE(fc.session_id::text, '-', '')
          )
    """
    params: list[Any] = [uid, uid, uid]
    if session_id:
        sql += " AND fc.session_id::text = %s"
        params.append(_session_uuid_text(str(session_id)))
    if folder_name:
        sql += " AND fc.folder_name = %s"
        params.append(str(folder_name))
    sql += " ORDER BY fc.created_at ASC, fc.id ASC LIMIT %s"
    params.append(int(limit))

    imported = 0
    batches_completed = 0
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"personalization:{uid}",))
            cur.execute(sql, params)
            rows = cur.fetchall()
            cur.execute(
                "SELECT COALESCE(MAX(prompt_no), 0) AS n FROM personalization_prompts WHERE user_id = %s",
                (uid,),
            )
            prompt_no = int(cur.fetchone()["n"])
            for r in rows:
                text = str(r.get("question") or "").strip()[:cap]
                if not text:
                    continue
                prompt_no += 1
                batch_no = (prompt_no - 1) // bs + 1
                cur.execute(
                    """
                    INSERT INTO personalization_prompts
                        (user_id, session_id, folder_name, prompt_text, prompt_no, batch_no, source_ref, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()))
                    """,
                    (
                        uid,
                        r.get("session_id"),
                        r.get("folder_name"),
                        text,
                        prompt_no,
                        batch_no,
                        f"folder_chats:{r.get('id')}",
                        r.get("created_at"),
                    ),
                )
                imported += 1
                if prompt_no % bs == 0:
                    batches_completed += 1
        conn.commit()

    rebuild_scheduled = False
    if batches_completed:
        rebuild_scheduled = schedule_profile_rebuild(uid)
    logger.info(
        "[Personalization] chat history imported user_id=%s session=%s folder=%s imported=%s prompt_count=%s batches_completed=%s rebuild=%s",
        uid, session_id or "*", folder_name or "*", imported, prompt_no, batches_completed, rebuild_scheduled,
    )
    return {
        "imported": imported,
        "prompt_count": prompt_no,
        "batches_completed": batches_completed,
        "rebuild_scheduled": rebuild_scheduled,
        "session_id": session_id,
        "folder_name": folder_name,
    }


# ── 2. Profile builder (background) ──────────────────────────────────────────

def _latest_profile_row(conn: Any, uid: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, user_id, version, batch_no, prompts_covered, profile_json, model, created_at, updated_at
            FROM personalization_profiles
            WHERE user_id = %s
            ORDER BY version DESC
            LIMIT 1
            """,
            (uid,),
        )
        return cur.fetchone()


def get_latest_profile(user_id: Any) -> dict[str, Any] | None:
    uid = _clean_uid(user_id)
    if not uid or not is_db_available():
        return None
    with get_db_connection() as conn:
        _ensure_tables(conn)
        return _row_out(_latest_profile_row(conn, uid))


def _format_prompt_lines(rows: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for i, r in enumerate(rows, start=1):
        created = r.get("created_at")
        stamp = ""
        if created is not None:
            stamp = created[:10] if isinstance(created, str) else created.strftime("%Y-%m-%d")
        prefix = f"{i}. [{stamp}] " if stamp else f"{i}. "
        lines.append(prefix + str(r.get("prompt_text") or "").strip())
    return "\n".join(lines)


def _run_profile_builder(
    previous_profile: dict[str, Any] | None,
    rows: list[dict[str, Any]],
) -> tuple[dict[str, Any], str]:
    prev_json = (
        json.dumps(previous_profile, ensure_ascii=False, indent=2) if previous_profile else "null"
    )
    user_msg = (
        f"<previous_profile>\n{prev_json}\n</previous_profile>\n\n"
        f"<new_prompts>\n{_format_prompt_lines(rows)}\n</new_prompts>\n\n"
        "Update the previous profile with patterns from the new prompts. Keep old patterns "
        "unless the new prompts clearly contradict them. Increase confidence if a pattern "
        "repeats. Output the full updated JSON only."
    )
    parsed, model = _gemini_call(
        system=PROFILE_BUILDER_SYSTEM_PROMPT,
        user=user_msg,
        schema=UserExpectationProfile,
        temperature=0.2,
        max_output_tokens=16_384,
    )
    return _normalize_profile(parsed.model_dump()), model


def rebuild_profile(user_id: Any, *, allow_partial: bool = False) -> dict[str, Any] | None:
    """Process every uncovered batch for the user (catch-up loop).

    `allow_partial=True` (manual "rebuild now") also folds in a trailing partial
    batch. Normal background runs only consume complete batches. Returns the
    latest profile row afterwards (may be unchanged when nothing was due).
    """
    _require_db()
    uid = _clean_uid(user_id)
    if not uid:
        return None
    bs = _batch_size()
    built: dict[str, Any] | None = None

    for _ in range(_MAX_CATCHUP_BATCHES):
        with get_db_connection() as conn:
            _ensure_tables(conn)
            latest = _latest_profile_row(conn, uid)
            covered = int(latest["prompts_covered"]) if latest else 0
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT prompt_no, batch_no, prompt_text, session_id, created_at
                    FROM personalization_prompts
                    WHERE user_id = %s AND prompt_no > %s
                    ORDER BY prompt_no ASC
                    LIMIT %s
                    """,
                    (uid, covered, bs),
                )
                rows = cur.fetchall()
        if not rows:
            break
        if len(rows) < bs and not allow_partial:
            break

        previous = dict(latest["profile_json"]) if latest and latest.get("profile_json") else None
        new_profile, model = _run_profile_builder(previous, rows)
        version = (int(latest["version"]) + 1) if latest else 1

        with get_db_connection() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO personalization_profiles
                            (user_id, version, batch_no, prompts_covered, profile_json, model)
                        VALUES (%s, %s, %s, %s, %s::jsonb, %s)
                        RETURNING id, user_id, version, batch_no, prompts_covered, profile_json, model,
                                  created_at, updated_at
                        """,
                        (
                            uid,
                            version,
                            int(rows[-1]["batch_no"]),
                            int(rows[-1]["prompt_no"]),
                            json.dumps(new_profile, ensure_ascii=False),
                            model,
                        ),
                    )
                    built = _row_out(cur.fetchone())
                conn.commit()
            except Exception as exc:  # noqa: BLE001 — another worker won the version race
                conn.rollback()
                logger.warning("[Personalization] profile v%s insert skipped user_id=%s: %s", version, uid, exc)
                break
        logger.info(
            "[Personalization] profile rebuilt user_id=%s version=%s prompts_covered=%s model=%s",
            uid, version, rows[-1]["prompt_no"], model,
        )
        if len(rows) < bs:
            break

    return built or get_latest_profile(uid)


def schedule_profile_rebuild(user_id: Any, *, allow_partial: bool = False) -> bool:
    """Queue a background rebuild; returns False when one is already in flight."""
    uid = _clean_uid(user_id)
    if not uid or not _enabled():
        return False
    with _inflight_lock:
        if uid in _inflight_rebuilds:
            return False
        _inflight_rebuilds.add(uid)

    def _job() -> None:
        try:
            rebuild_profile(uid, allow_partial=allow_partial)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Personalization] background rebuild failed user_id=%s: %s", uid, exc)
        finally:
            with _inflight_lock:
                _inflight_rebuilds.discard(uid)

    _EXECUTOR.submit(_job)
    return True


def is_rebuild_in_progress(user_id: Any) -> bool:
    with _inflight_lock:
        return _clean_uid(user_id) in _inflight_rebuilds


# ── 3. Instruction generator (button) ────────────────────────────────────────

_HISTORY_PROMPT_LIMIT = 60


def generate_instruction(
    user_id: Any,
    session_id: str | None = None,
    *,
    scope: str = "auto",
    import_history: bool = False,
    folder_name: str | None = None,
) -> dict[str, Any]:
    """Latest profile (or the default one) + prompts -> instruction markdown.

    scope="session" / "auto" with a session_id: that chat's prompts (an OLD chat is
    first run through the normal flow — logged, counter +1, builder scheduled).
    scope="history" (the direct "Generate from my past prompts" button): the
    user's past prompts. With `folder_name` ONLY that case's prompts are used
    (each case stays separate); without it, prompts across all cases. With
    import_history=True the matching old chats are first imported into the
    prompt log so the memory flow covers them too.
    """
    _require_db()
    uid = _clean_uid(user_id)
    if not uid:
        raise ValueError("A signed-in user is required")
    scope = str(scope or "auto").lower()
    folder = _clean_folder(folder_name)
    imported_prompts = 0

    if scope == "history" or (scope == "auto" and not session_id and import_history):
        if import_history:
            try:
                imported_prompts = int(import_chat_history(uid, folder_name=folder).get("imported") or 0)
            except Exception as exc:  # noqa: BLE001 — importing is best-effort; still generate
                logger.warning("[Personalization] history import skipped user_id=%s: %s", uid, exc)
        history_rows = get_recent_prompts(uid, limit=_HISTORY_PROMPT_LIMIT, folder_name=folder)
        history_source = ("case" if folder else "history") if history_rows else "none"
    else:
        # Current session's prompt log → an older chat's questions (folder_chats) →
        # the user's most recent prompts → nothing (default profile only).
        history_rows, history_source = get_session_history(uid, session_id)
        if history_source == "chat_history":
            # An OLD chat was picked: run its prompts through the normal flow first
            # (prompt log, counter +1 each, Profile Builder in the background when a
            # batch completes), then generate from them. Generation itself never waits
            # on the rebuild, so the profile used here is the latest saved version.
            try:
                imported_prompts = int(import_chat_history(uid, session_id=session_id).get("imported") or 0)
                logged = get_session_prompts(uid, session_id)
                if logged:
                    history_rows, history_source = logged, "session"
            except Exception as exc:  # noqa: BLE001 — importing is best-effort; still generate
                logger.warning("[Personalization] past-chat import skipped session=%s: %s", session_id, exc)
        if not history_rows:
            history_rows = get_recent_prompts(uid, limit=_batch_size(), folder_name=folder)
            history_source = ("case" if folder else "recent") if history_rows else "none"

    # Read the profile AFTER any import so a rebuild that already finished counts.
    latest = get_latest_profile(uid)
    profile_json = latest["profile_json"] if latest else DEFAULT_LEGAL_PROFILE

    history_block = (
        "\n".join(f"{i}. {str(r.get('prompt_text') or '').strip()}" for i, r in enumerate(history_rows, start=1))
        or "(no prompts in this session yet)"
    )
    user_msg = (
        "<user_expectation_profile>\n"
        f"{json.dumps(profile_json, ensure_ascii=False, indent=2)}\n"
        "</user_expectation_profile>\n\n"
        f'<chat_history source="{history_source}">\n{history_block}\n</chat_history>'
    )
    # One structured call: behaviour analysis (step 1) then the instruction (step 2).
    parsed, model = _gemini_call(
        system=INSTRUCTION_GENERATOR_SYSTEM_PROMPT,
        user=user_msg,
        schema=InstructionGeneration,
        temperature=0.4,
        max_output_tokens=8192,
    )
    text = _to_plain_instruction(parsed.instruction_markdown)
    if not text:
        raise RuntimeError("Instruction generator returned an empty instruction")
    behaviour = _normalize_behaviour(parsed.behaviour_analysis.model_dump())
    return {
        "instruction_text": text,
        "behaviour_analysis": behaviour,
        "profile_version": int(latest["version"]) if latest else 0,
        "profile_is_default": latest is None,
        "history_source": history_source,
        "history_prompt_count": len(history_rows),
        "imported_prompts": imported_prompts,
        "folder_name": folder,
        "model": model,
    }


def polish_instruction(user_id: Any, instruction_text: str) -> dict[str, Any]:
    """Rewrite a hand-written draft into the standard instruction format.

    Preserves every preference the user wrote (the prompt forbids adding new
    ones); the learned profile is passed only as wording context.
    """
    uid = _clean_uid(user_id)
    if not uid:
        raise ValueError("A signed-in user is required")
    draft = _to_plain_instruction(instruction_text or "")
    if not draft:
        raise ValueError("Instruction text cannot be empty")
    draft = draft[:_MAX_ACTIVE_INSTRUCTION_CHARS]

    latest = get_latest_profile(uid) if is_db_available() else None
    profile_block = (
        json.dumps(latest["profile_json"], ensure_ascii=False, indent=2) if latest else "null"
    )
    user_msg = (
        f"<draft_instruction>\n{draft}\n</draft_instruction>\n\n"
        f"<user_expectation_profile>\n{profile_block}\n</user_expectation_profile>"
    )
    text, model = _gemini_call(
        system=INSTRUCTION_POLISH_SYSTEM_PROMPT,
        user=user_msg,
        temperature=0.3,
        max_output_tokens=4096,
    )
    text = _to_plain_instruction(text)
    return {
        "instruction_text": text,
        "profile_version": int(latest["version"]) if latest else 0,
        "profile_is_default": latest is None,
        "model": model,
    }


# ── 4. Active instruction ────────────────────────────────────────────────────

_INSTRUCTION_COLUMNS = (
    "id, user_id, instruction_text, is_active, origin, behaviour_json, folder_name, "
    "source_profile_version, source_session_id, created_at, updated_at"
)


def _active_row(cur: Any, uid: str, folder_name: str | None = None) -> dict[str, Any] | None:
    """The instruction that applies: the case's own active one first (each case is
    separate), else the user's global one (folder_name IS NULL). Adds `scope`."""
    folder = _clean_folder(folder_name)
    if folder:
        cur.execute(
            f"""
            SELECT {_INSTRUCTION_COLUMNS}
            FROM personalization_instructions
            WHERE user_id = %s AND is_active = TRUE AND folder_name = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (uid, folder),
        )
        row = cur.fetchone()
        if row:
            return {**row, "scope": "case"}
    cur.execute(
        f"""
        SELECT {_INSTRUCTION_COLUMNS}
        FROM personalization_instructions
        WHERE user_id = %s AND is_active = TRUE AND folder_name IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (uid,),
    )
    row = cur.fetchone()
    return {**row, "scope": "global"} if row else None


def get_active_instruction(user_id: Any, folder_name: str | None = None) -> dict[str, Any] | None:
    uid = _clean_uid(user_id)
    if not uid or not is_db_available():
        return None
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            return _row_out(_active_row(cur, uid, folder_name))


def activate_instruction(
    user_id: Any,
    instruction_text: str,
    *,
    mode: str = "replace",
    origin: str | None = None,
    source_profile_version: int | None = None,
    source_session_id: str | None = None,
    behaviour: dict[str, Any] | None = None,
    folder_name: str | None = None,
) -> dict[str, Any]:
    """Make `instruction_text` the user's active instruction.

    folder_name: scope. Given → applies only to that case (each case keeps its
    own instruction); None → the user's global instruction, used by cases that
    have none of their own.
    mode="replace": deactivate the current one IN THAT SCOPE and store the new text.
    mode="append":  new active = currently applied text + blank line + new text.
    origin: "manual" | "generated" | "polished" (UI badge; defaults to manual).
    behaviour: the generator's behaviour analysis, kept with the row so the UI
    can show "what we noticed about you" next to the active instruction.
    """
    behaviour_json = json.dumps(_normalize_behaviour(behaviour), ensure_ascii=False) if isinstance(behaviour, dict) else None
    folder = _clean_folder(folder_name)
    _require_db()
    uid = _clean_uid(user_id)
    if not uid:
        raise ValueError("A signed-in user is required")
    text = _to_plain_instruction(instruction_text or "")
    if not text:
        raise ValueError("Instruction text cannot be empty")
    mode = "append" if str(mode or "").lower() == "append" else "replace"
    origin = str(origin or "").lower()
    if origin not in _VALID_ORIGINS:
        origin = "manual"

    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            if mode == "append":
                current = _active_row(cur, uid, folder)
                if current and str(current.get("instruction_text") or "").strip():
                    text = f"{str(current['instruction_text']).rstrip()}\n\n{text}"
            text = text[:_MAX_ACTIVE_INSTRUCTION_CHARS]
            if folder:
                cur.execute(
                    "UPDATE personalization_instructions SET is_active = FALSE, updated_at = NOW() "
                    "WHERE user_id = %s AND is_active = TRUE AND folder_name = %s",
                    (uid, folder),
                )
            else:
                cur.execute(
                    "UPDATE personalization_instructions SET is_active = FALSE, updated_at = NOW() "
                    "WHERE user_id = %s AND is_active = TRUE AND folder_name IS NULL",
                    (uid,),
                )
            cur.execute(
                f"""
                INSERT INTO personalization_instructions
                    (user_id, instruction_text, is_active, origin, behaviour_json, folder_name,
                     source_profile_version, source_session_id)
                VALUES (%s, %s, TRUE, %s, %s::jsonb, %s, %s, %s)
                RETURNING {_INSTRUCTION_COLUMNS}
                """,
                (uid, text, origin, behaviour_json, folder, source_profile_version, (source_session_id or None)),
            )
            row = cur.fetchone()
        conn.commit()
    _invalidate_cache(uid)
    logger.info(
        "[Personalization] instruction activated user_id=%s scope=%s mode=%s origin=%s chars=%s",
        uid, folder or "global", mode, origin, len(text),
    )
    return {**_row_out(row), "mode": mode, "scope": "case" if folder else "global"}


def deactivate_instructions(user_id: Any, folder_name: str | None = None) -> dict[str, Any]:
    """Turn off the instruction that currently APPLIES (keeps history rows, just
    clears is_active). With a folder: that case's own instruction if it has one,
    else the global one. Without: the global one."""
    _require_db()
    uid = _clean_uid(user_id)
    if not uid:
        return {"deactivated": 0, "scope": None}
    folder = _clean_folder(folder_name)
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            current = _active_row(cur, uid, folder)
            scope = current.get("scope") if current else None
            if scope == "case":
                cur.execute(
                    "UPDATE personalization_instructions SET is_active = FALSE, updated_at = NOW() "
                    "WHERE user_id = %s AND is_active = TRUE AND folder_name = %s",
                    (uid, folder),
                )
            else:
                cur.execute(
                    "UPDATE personalization_instructions SET is_active = FALSE, updated_at = NOW() "
                    "WHERE user_id = %s AND is_active = TRUE AND folder_name IS NULL",
                    (uid,),
                )
            count = cur.rowcount
        conn.commit()
    _invalidate_cache(uid)
    return {"deactivated": int(count or 0), "scope": scope}


def list_instructions(user_id: Any, limit: int = 20) -> list[dict[str, Any]]:
    uid = _clean_uid(user_id)
    if not uid or not is_db_available():
        return []
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {_INSTRUCTION_COLUMNS}
                FROM personalization_instructions
                WHERE user_id = %s
                ORDER BY is_active DESC, created_at DESC
                LIMIT %s
                """,
                (uid, int(limit)),
            )
            return [
                {**_row_out(r), "scope": "case" if r.get("folder_name") else "global"}
                for r in cur.fetchall()
            ]


def delete_instruction(user_id: Any, instruction_id: str) -> bool:
    _require_db()
    uid = _clean_uid(user_id)
    if not uid:
        return False
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM personalization_instructions WHERE id = %s::uuid AND user_id = %s",
                (str(instruction_id), uid),
            )
            deleted = cur.rowcount > 0
        conn.commit()
    _invalidate_cache(uid)
    return deleted


def build_active_instruction_block(user_id: Any, folder_name: str | None = None) -> str:
    """Block appended to the chat system prompt: '' when nothing applies.
    The case's own instruction wins; otherwise the user's global one."""
    uid = _clean_uid(user_id)
    if not uid or not _enabled() or not is_db_available():
        return ""
    key = _cache_key(uid, folder_name)
    now = time.time()
    hit = _active_cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    row = get_active_instruction(uid, folder_name)
    text = _to_plain_instruction(str((row or {}).get("instruction_text") or ""))
    block = ""
    if text:
        scope_note = (
            f"set by the user for this case ({_clean_folder(folder_name)})"
            if row and row.get("scope") == "case"
            else "set by the user for all their cases"
        )
        block = (
            f"\n\n=== USER PERSONALIZATION ({scope_note}; generated from this user's own working style — "
            "apply it to every answer; it never overrides document-grounding, accuracy or safety rules) ===\n"
            f"{text}\n"
            "=== END USER PERSONALIZATION ==="
        )
    _active_cache[key] = (now + _ACTIVE_CACHE_TTL_S, block)
    return block


# ── Status (UI strip) ────────────────────────────────────────────────────────

def get_status(user_id: Any, folder_name: str | None = None) -> dict[str, Any]:
    uid = _clean_uid(user_id)
    folder = _clean_folder(folder_name)
    bs = _batch_size()
    base = {
        "enabled": _enabled(),
        "batch_size": bs,
        "prompt_count": 0,
        "case_prompt_count": 0,
        "folder_name": folder,
        "prompts_until_next_profile_update": bs,
        "uncovered_prompts": 0,
        "profile": None,
        "profile_is_default": True,
        "active_instruction": None,
        "rebuild_in_progress": False,
        "memory": {
            "enabled": False,
            "generate_from_chats": False,
            "sensitive_data": False,
            "topic_count": 0,
            "case_topic_count": 0,
            "extracting": False,
        },
    }
    if not uid or not is_db_available():
        return base
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM personalization_prompts WHERE user_id = %s", (uid,))
            count = int(cur.fetchone()["n"])
            case_count = 0
            if folder:
                cur.execute(
                    "SELECT COUNT(*) AS n FROM personalization_prompts WHERE user_id = %s AND folder_name = %s",
                    (uid, folder),
                )
                case_count = int(cur.fetchone()["n"])
            latest = _latest_profile_row(conn, uid)
            active = _active_row(cur, uid, folder)

    covered = int(latest["prompts_covered"]) if latest else 0
    remainder = count % bs
    profile_out = None
    if latest:
        pj = latest.get("profile_json") or {}
        profile_out = {
            "id": str(latest["id"]),
            "version": int(latest["version"]),
            "batch_no": int(latest.get("batch_no") or 0),
            "prompts_covered": covered,
            "summary": str(pj.get("summary") or ""),
            "language_mix": str(pj.get("language_mix") or ""),
            "model": latest.get("model"),
            "updated_at": latest["updated_at"].isoformat() if latest.get("updated_at") else None,
        }
    base.update(
        {
            "prompt_count": count,
            "case_prompt_count": case_count,
            "prompts_until_next_profile_update": (bs - remainder) if remainder else bs,
            "uncovered_prompts": max(0, count - covered),
            "profile": profile_out,
            "profile_is_default": latest is None,
            "active_instruction": _row_out(active),
            "rebuild_in_progress": is_rebuild_in_progress(uid),
        }
    )
    try:
        from app.services.memory_service import memory_status_for_user

        base["memory"] = memory_status_for_user(uid, folder)
    except Exception as mem_exc:  # noqa: BLE001
        logger.debug("[Personalization] memory status skipped: %s", mem_exc)
    return base
