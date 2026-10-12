"""File-style memory: subject-scoped notes with listing-first retrieval.

Memory is FILES, never chat history — the same shape as a Claude project memory.
Each row is one memory file (/profile.md, /preferences.md, /topics/x.md,
/areas/x.md, /people/x.md) with tagged [stated]/[inferred] lines. Chat turns
inject a lightweight listing, then only the files whose descriptions match the
query (plus profile/preferences). Background extraction runs AFTER the turn and
writes what is durable into a file; explicit remember/forget writes in that turn.

Raw conversations are NOT part of Memory: they are not listed, not searched and
not injected. `folder_chats` stays the chat-history store for the chat UI and for
the instruction generator, which are separate features.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import Any

from pydantic import BaseModel

from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available
from app.services.personalization_prompts import MEMORY_EXTRACTOR_SYSTEM_PROMPT

logger = logging.getLogger("agentic_document_service.memory")

_ENSURE_SQL = """
    CREATE TABLE IF NOT EXISTS personalization_memory_settings (
        user_id TEXT PRIMARY KEY,
        generate_from_chats BOOLEAN NOT NULL DEFAULT FALSE,
        search_past_chats BOOLEAN NOT NULL DEFAULT FALSE,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        sensitive_data BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE personalization_memory_settings
        ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE personalization_memory_settings
        ADD COLUMN IF NOT EXISTS sensitive_data BOOLEAN NOT NULL DEFAULT FALSE;
    -- search_past_chats is RETIRED: Memory is files only, so raw conversations are
    -- never listed, searched or injected. The column stays (default FALSE) so an
    -- older deployment's NOT NULL constraint keeps being satisfied; nothing reads it.
    -- search_past_chats is RETIRED: Memory is files only, so raw conversations are
    -- never listed, searched or injected. The column stays (default FALSE) so an
    -- older deployment's NOT NULL constraint keeps being satisfied; nothing reads it.
    UPDATE personalization_memory_settings
       SET enabled = TRUE
     WHERE generate_from_chats = TRUE AND enabled = FALSE;
CREATE TABLE IF NOT EXISTS personalization_memory_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    folder_name TEXT,
    topic_key TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'auto',
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    kind TEXT NOT NULL DEFAULT 'topics',
    description TEXT NOT NULL DEFAULT '',
    aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
    sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    sources JSONB NOT NULL DEFAULT '["chat"]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'topics';
ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS sensitive BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '["chat"]'::jsonb;
ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_memory_topics_project
    ON personalization_memory_topics (user_id, folder_name, updated_at DESC)
    WHERE folder_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_topics_user
    ON personalization_memory_topics (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_topics_user_folder
    ON personalization_memory_topics (user_id, folder_name);
DROP INDEX IF EXISTS uq_memory_topics_user_scope_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_topics_user_scope_kind_key
    ON personalization_memory_topics (user_id, COALESCE(folder_name, ''), kind, topic_key);
ALTER TABLE personalization_memory_settings
    ALTER COLUMN generate_from_chats SET DEFAULT FALSE;
ALTER TABLE personalization_memory_settings
    ALTER COLUMN search_past_chats SET DEFAULT FALSE;
"""

_VALID_ORIGINS = ("auto", "explicit", "edited")
_VALID_KINDS = ("profile", "preferences", "topics", "areas", "people")
_ALWAYS_READ_KINDS = frozenset({"profile", "preferences"})
_TOPIC_COLUMNS = (
    "id, user_id, folder_name, topic_key, title, content, origin, pinned, "
    "kind, description, aliases, sensitive, sources, version, created_at, updated_at"
)
_MAX_TOPIC_CONTENT = 2500
_MAX_TITLE = 120
_MAX_DESCRIPTION = 180
_MAX_TOPICS_PER_USER = 60
_MAX_CHANGES_PER_EXTRACT = 6
_EXTRACT_COOLDOWN_S = 6.0
_PINNED_KEYS = frozenset({"working_style", "output_format", "language", "profile", "preferences"})

_REMEMBER_RE = re.compile(
    r"(?:please\s+)?(?:remember(?:\s+(?:this|that|it))?|yaad\s+rakh(?:o|na|na\s+ki)?|"
    r"note\s+this|save\s+this(?:\s+to\s+memory)?)\s*[:\-–,]?\s*(.+)$",
    re.IGNORECASE | re.DOTALL,
)
_FORGET_RE = re.compile(
    r"(?:please\s+)?(?:forget(?:\s+(?:this|that|it|about))?|bhool\s+jao|"
    r"delete\s+(?:this\s+)?memory|don't\s+remember)\s*[:\-–,]?\s*(.+)$",
    re.IGNORECASE | re.DOTALL,
)
_TOKEN_RE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9'\-]{2,}")
_SLUG_RE = re.compile(r"[^a-z0-9]+")
_STOPWORDS = frozenset(
    """
    the and for that this with from have been your about please give list
    what when where which while would could should into them they their
    than then also just like want need make take also very more most some
    any all not but are was were been being will shall can may might must
    document documents case cases file files chat please kindly
    """.split()
)

_tables_ready = False
_tables_lock = threading.Lock()
_inflight_lock = threading.Lock()
_inflight_extracts: set[str] = set()
_last_extract_at: dict[str, float] = {}

_DEFAULT_SETTINGS = {
    "enabled": False,
    "generate_from_chats": False,
    "sensitive_data": False,
}


class MemoryTopicChange(BaseModel):
    action: str = "upsert"  # upsert | delete
    kind: str = "topics"  # profile | preferences | topics | areas | people
    topic_key: str = ""
    title: str = ""
    description: str = ""
    aliases: list[str] = []
    content: str = ""
    lines: list[str] = []
    delete_line_substrings: list[str] = []
    scope: str = "global"  # global | case
    pinned: bool = False
    sensitive: bool = False
    provenance: str = "stated"  # stated | inferred


class MemoryExtraction(BaseModel):
    changes: list[MemoryTopicChange]
    noop_reason: str = ""


def _pz():
    from app.services import personalization_service as pz

    return pz


def _clean_uid(user_id: Any) -> str:
    return _pz()._clean_uid(user_id)


def _clean_folder(folder_name: Any) -> str | None:
    return _pz()._clean_folder(folder_name)


def _row_out(row: dict[str, Any] | None) -> dict[str, Any] | None:
    return _pz()._row_out(row)


def _enabled() -> bool:
    return _pz()._enabled()


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
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            logger.debug("[Memory] DDL skipped: %s", exc)
        _tables_ready = True


def _max_inject_chars() -> int:
    try:
        return max(400, int(getattr(get_settings(), "personalization_memory_max_inject_chars", 2800) or 2800))
    except (TypeError, ValueError):
        return 2800


def _max_retrieve() -> int:
    try:
        return max(1, min(8, int(getattr(get_settings(), "personalization_memory_max_retrieve", 4) or 4)))
    except (TypeError, ValueError):
        return 4


def _slug(text: str) -> str:
    s = _SLUG_RE.sub("_", (text or "").lower()).strip("_")[:60]
    return s or "note"


def _tokens(text: str) -> set[str]:
    return {
        t.lower()
        for t in _TOKEN_RE.findall(text or "")
        if t.lower() not in _STOPWORDS and len(t) >= 3
    }


def _distinctive_tokens(text: str, limit: int = 6) -> list[str]:
    seen: set[str] = set()
    ranked = sorted(_tokens(text), key=len, reverse=True)
    out: list[str] = []
    for tok in ranked:
        if tok in seen:
            continue
        seen.add(tok)
        out.append(tok)
        if len(out) >= limit:
            break
    return out


def _norm_kind(kind: Any, topic_key: str = "") -> str:
    k = str(kind or "").strip().lower()
    if k in _VALID_KINDS:
        return k
    key = str(topic_key or "").strip().lower()
    if key in ("profile",):
        return "profile"
    if key in ("preferences", "working_style", "output_format", "language"):
        return "preferences" if key == "preferences" else "topics"
    return "topics"


def memory_path(kind: str, topic_key: str, folder_name: str | None = None) -> str:
    kind = _norm_kind(kind, topic_key)
    key = _slug(topic_key or kind)
    if kind == "profile":
        return "/profile.md"
    if kind == "preferences" and key in ("preferences", "preference"):
        return "/preferences.md"
    prefix = f"/cases/{folder_name}" if folder_name else ""
    return f"{prefix}/{kind}/{key}.md"


def parse_memory_path(path: str) -> tuple[str, str, str | None]:
    """Return (kind, topic_key, folder_name) from a /profile.md-style path."""
    raw = str(path or "").strip().replace("\\", "/")
    if not raw.startswith("/"):
        raw = "/" + raw
    if raw.endswith(".md"):
        raw = raw[:-3]
    parts = [p for p in raw.split("/") if p]
    folder: str | None = None
    if parts[:1] == ["cases"] and len(parts) >= 2:
        folder = parts[1]
        parts = parts[2:]
    if not parts:
        return "topics", "note", folder
    head = parts[0].lower()
    if head == "profile":
        return "profile", "profile", None
    if head == "preferences":
        return "preferences", "preferences", None
    if head in _VALID_KINDS:
        key = _slug(parts[1] if len(parts) > 1 else head)
        return head, key, folder
    return "topics", _slug(parts[-1]), folder


def _as_str_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _ensure_tagged_lines(text: str, provenance: str = "stated") -> str:
    tag = "inferred" if str(provenance).lower() == "inferred" else "stated"
    lines: list[str] = []
    for raw in (text or "").splitlines():
        t = raw.strip()
        if not t:
            continue
        t = re.sub(r"^[-*•]\s+", "", t).strip()
        if re.match(r"^\[(stated|inferred)\]\s+", t, re.I):
            lines.append(f"- {t}")
        else:
            lines.append(f"- [{tag}] {t}")
    return "\n".join(lines)


def _line_core(line: str) -> str:
    t = re.sub(r"^[-*•]\s+", "", (line or "").strip())
    t = re.sub(r"^\[(stated|inferred)\]\s+", "", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip().lower()


def _merge_tagged_content(existing: str, incoming: str, delete_substrings: list[str] | None = None) -> str:
    """Append unique tagged lines; drop lines matching delete substrings. Never wipe the file."""
    keep: list[str] = []
    seen: set[str] = set()
    needles = [s.strip().lower() for s in (delete_substrings or []) if s and s.strip()]
    for raw in (existing or "").splitlines():
        t = raw.strip()
        if not t:
            continue
        hay = t.lower()
        if needles and any(n in hay for n in needles):
            continue
        core = _line_core(t)
        if core in seen:
            continue
        seen.add(core)
        keep.append(t if t.startswith("- ") else f"- {t}")
    for raw in (incoming or "").splitlines():
        t = raw.strip()
        if not t:
            continue
        if not t.startswith("- "):
            t = f"- {t}"
        core = _line_core(t)
        if not core or core in seen:
            continue
        seen.add(core)
        keep.append(t)
    return "\n".join(keep)[:_MAX_TOPIC_CONTENT]


_NEVER_STORE_RE = re.compile(
    r"\b("
    r"aadhaar|aadhar|passport\s*(?:no\.?|number)|"
    r"pan\s*(?:card|number)|gstin|"
    r"credit\s*card|debit\s*card|\bcvv\b|bank\s*account|"
    r"routing\s*number|\bifsc\b|swift\s*code|"
    r"social\s*security|\bssn\b|"
    r"sexual\s+history|criminal\s+history|"
    r"suicid(?:e|al)|self[-\s]harm|"
    r"immigration\s+status"
    r")\b",
    re.IGNORECASE,
)
_CONSENT_RE = re.compile(
    r"\b("
    r"diagnos(?:is|ed)|health\s+condition|medical\s+condition|"
    r"hiv|cancer|depression|anxiety\s+disorder|"
    r"political\s+(?:party|views?)|\bvot(?:e|ed|ing)\b|"
    r"sexual\s+orientation|\bgay\b|\blesbian\b|\bbisexual\b|"
    r"religion|hindu|muslim|christian|sikh|caste|"
    r"net\s+worth|salary|union\s+member"
    r")\b",
    re.IGNORECASE,
)


def _sensitivity_tier(text: str) -> str:
    """never | consent | ok"""
    blob = text or ""
    if _NEVER_STORE_RE.search(blob):
        return "never"
    if _CONSENT_RE.search(blob):
        return "consent"
    return "ok"


def _guard_write(uid: str, text: str) -> str | None:
    """Error message if this text must not be stored; None if the write may proceed."""
    tier = _sensitivity_tier(text)
    if tier == "never":
        return "That kind of information is never stored in memory."
    if tier == "consent" and not bool(get_settings_for_user(uid).get("sensitive_data")):
        return "Memory does not store health, political, religious or financial details."
    return None


def _render_file_text(row: dict[str, Any]) -> str:
    kind = _norm_kind(row.get("kind"), str(row.get("topic_key") or ""))
    key = str(row.get("topic_key") or kind)
    desc = str(row.get("description") or row.get("title") or "").strip()
    aliases = _as_str_list(row.get("aliases"))
    sources = _as_str_list(row.get("sources")) or ["chat"]
    body = str(row.get("content") or "").strip()
    alias_bit = ", ".join(aliases) if aliases else ""
    head = [
        "---",
        f"name: {key}",
        f"description: {desc}",
        f"sources: [{', '.join(sources)}]",
    ]
    if alias_bit:
        head.append(f"aliases: [{alias_bit}]")
    head.append("---")
    return "\n".join(head) + ("\n\n" + body if body else "")


def _topic_out(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    out = _row_out(row) or {}
    out["scope"] = "case" if row.get("folder_name") else "global"
    kind = _norm_kind(out.get("kind"), str(out.get("topic_key") or ""))
    out["kind"] = kind
    out["aliases"] = _as_str_list(out.get("aliases"))
    out["sources"] = _as_str_list(out.get("sources")) or ["chat"]
    out["path"] = memory_path(kind, str(out.get("topic_key") or ""), out.get("folder_name"))
    if not str(out.get("description") or "").strip():
        out["description"] = str(out.get("title") or out.get("path") or "").strip()
    out["file_text"] = _render_file_text(out)
    return out


# ── Settings ──────────────────────────────────────────────────────────────────

def _pack_settings(
    enabled: bool,
    generate: bool,
    sensitive: bool = False,
    updated_at: Any = None,
) -> dict[str, Any]:
    on = bool(enabled)
    out = {
        "enabled": on,
        "generate_from_chats": bool(generate),
        "sensitive_data": bool(sensitive),
    }
    if updated_at is not None and hasattr(updated_at, "isoformat"):
        out["updated_at"] = updated_at.isoformat()
    return out


def _memory_on(settings: dict[str, Any] | None) -> bool:
    if not settings:
        return False
    if "enabled" in settings:
        return bool(settings["enabled"])
    return bool(settings.get("generate_from_chats"))


def get_settings_for_user(user_id: Any) -> dict[str, Any]:
    uid = _clean_uid(user_id)
    if not uid or not is_db_available():
        return dict(_DEFAULT_SETTINGS)
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT enabled, generate_from_chats, sensitive_data, updated_at "
                "FROM personalization_memory_settings WHERE user_id = %s",
                (uid,),
            )
            row = cur.fetchone()
    if not row:
        return dict(_DEFAULT_SETTINGS)
    enabled = bool(row["enabled"]) if row.get("enabled") is not None else bool(row.get("generate_from_chats"))
    return _pack_settings(
        enabled,
        bool(row["generate_from_chats"]),
        bool(row.get("sensitive_data")),
        row.get("updated_at"),
    )


def update_settings(
    user_id: Any,
    *,
    enabled: bool | None = None,
    generate_from_chats: bool | None = None,
    sensitive_data: bool | None = None,
) -> dict[str, Any]:
    uid = _clean_uid(user_id)
    if not uid:
        raise ValueError("A signed-in user is required")
    if not is_db_available():
        raise RuntimeError("Database access is not configured for the agentic document service.")
    current = get_settings_for_user(uid)
    if enabled is not None:
        on = bool(enabled)
        # ONE switch. Memory is a single setting in the profile Settings page, so
        # turning it on turns on the behaviour that makes it useful — filing durable
        # facts after a turn — and turning it off stops all of it. `generate_from_chats`
        # stays in the API for callers that set it explicitly; nothing in the UI does.
        gen = on if generate_from_chats is None else bool(generate_from_chats)
        # Sensitive data is a separate consent, NOT part of the single switch: health,
        # politics, religion, orientation, caste and financial facts stay unstored
        # unless a caller opts in on purpose.
        sensitive = bool(current.get("sensitive_data")) if sensitive_data is None else bool(sensitive_data)
    else:
        on = bool(current.get("enabled"))
        gen = bool(current.get("generate_from_chats")) if generate_from_chats is None else bool(generate_from_chats)
        sensitive = bool(current.get("sensitive_data")) if sensitive_data is None else bool(sensitive_data)
        if generate_from_chats is None and sensitive_data is None:
            return current
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO personalization_memory_settings
                    (user_id, enabled, generate_from_chats, sensitive_data, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (user_id) DO UPDATE SET
                    enabled = EXCLUDED.enabled,
                    generate_from_chats = EXCLUDED.generate_from_chats,
                    sensitive_data = EXCLUDED.sensitive_data,
                    updated_at = NOW()
                """,
                (uid, on, gen, sensitive),
            )
        conn.commit()
    logger.info(
        "[Memory] settings user_id=%s enabled=%s generate=%s sensitive=%s",
        uid, on, gen, sensitive,
    )
    return get_settings_for_user(uid)


# ── Topics CRUD ───────────────────────────────────────────────────────────────

def list_topics(user_id: Any, folder_name: str | None = None) -> list[dict[str, Any]]:
    """Global files always; when folder_name is set, that case's files too."""
    uid = _clean_uid(user_id)
    if not uid or not is_db_available():
        return []
    folder = _clean_folder(folder_name)
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            if folder:
                cur.execute(
                    f"""
                    SELECT {_TOPIC_COLUMNS}
                    FROM personalization_memory_topics
                    WHERE user_id = %s AND (folder_name IS NULL OR folder_name = %s)
                    ORDER BY pinned DESC, (folder_name IS NULL), updated_at DESC
                    """,
                    (uid, folder),
                )
            else:
                cur.execute(
                    f"""
                    SELECT {_TOPIC_COLUMNS}
                    FROM personalization_memory_topics
                    WHERE user_id = %s AND folder_name IS NULL
                    ORDER BY pinned DESC, updated_at DESC
                    """,
                    (uid,),
                )
            rows = [_topic_out(r) for r in cur.fetchall()]
    return rows


def list_memory(user_id: Any, folder_name: str | None = None) -> list[dict[str, Any]]:
    """Listing primitive: path + one-line description for every file."""
    out = []
    for t in list_topics(user_id, folder_name):
        out.append(
            {
                "id": t.get("id"),
                "path": t.get("path"),
                "kind": t.get("kind"),
                "name": t.get("topic_key"),
                "description": t.get("description") or t.get("title"),
                "scope": t.get("scope"),
                "sensitive": bool(t.get("sensitive")),
            }
        )
    return out


def read_memory(user_id: Any, path: str, folder_name: str | None = None) -> dict[str, Any] | None:
    """Read primitive: one file by path. Returns None if missing."""
    kind, key, path_folder = parse_memory_path(path)
    folder = _resolve_path_scope(path_folder, folder_name)
    uid = _clean_uid(user_id)
    if not uid or not is_db_available():
        return None
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            row = _find_topic(cur, uid, key, folder, kind)
    return _topic_out(row)


def write_memory(
    user_id: Any,
    path: str,
    content: str,
    *,
    title: str | None = None,
    description: str | None = None,
    folder_name: str | None = None,
    replace_content: bool = True,
) -> dict[str, Any] | None:
    """Write primitive: create or replace a file at path (reads-then-merges unless replace)."""
    kind, key, path_folder = parse_memory_path(path)
    folder = _resolve_path_scope(path_folder, folder_name)
    heading = (title or "").strip() or key.replace("_", " ")
    return upsert_topic(
        user_id,
        title=heading,
        content=content,
        topic_key=key,
        folder_name=folder,
        origin="edited",
        kind=kind,
        description=description or heading,
        replace_content=replace_content,
    )


def _count_topics(cur: Any, uid: str) -> int:
    cur.execute("SELECT COUNT(*) AS n FROM personalization_memory_topics WHERE user_id = %s", (uid,))
    return int(cur.fetchone()["n"])


def _find_topic(
    cur: Any, uid: str, topic_key: str, folder: str | None, kind: str | None = None
) -> dict[str, Any] | None:
    kind = _norm_kind(kind, topic_key) if kind else None
    if folder:
        if kind:
            cur.execute(
                f"""
                SELECT {_TOPIC_COLUMNS}
                FROM personalization_memory_topics
                WHERE user_id = %s AND topic_key = %s AND folder_name = %s AND kind = %s
                LIMIT 1
                """,
                (uid, topic_key, folder, kind),
            )
        else:
            cur.execute(
                f"""
                SELECT {_TOPIC_COLUMNS}
                FROM personalization_memory_topics
                WHERE user_id = %s AND topic_key = %s AND folder_name = %s
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (uid, topic_key, folder),
            )
    else:
        if kind:
            cur.execute(
                f"""
                SELECT {_TOPIC_COLUMNS}
                FROM personalization_memory_topics
                WHERE user_id = %s AND topic_key = %s AND folder_name IS NULL AND kind = %s
                LIMIT 1
                """,
                (uid, topic_key, kind),
            )
        else:
            cur.execute(
                f"""
                SELECT {_TOPIC_COLUMNS}
                FROM personalization_memory_topics
                WHERE user_id = %s AND topic_key = %s AND folder_name IS NULL
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (uid, topic_key),
            )
    return cur.fetchone()


def upsert_topic(
    user_id: Any,
    *,
    title: str,
    content: str,
    topic_key: str | None = None,
    folder_name: str | None = None,
    origin: str = "explicit",
    pinned: bool = False,
    protect_edited: bool = False,
    kind: str | None = None,
    description: str | None = None,
    aliases: list[str] | None = None,
    sensitive: bool = False,
    sources: list[str] | None = None,
    replace_content: bool = False,
    delete_line_substrings: list[str] | None = None,
) -> dict[str, Any] | None:
    uid = _clean_uid(user_id)
    title = (title or "").strip()[:_MAX_TITLE]
    incoming = _ensure_tagged_lines(content or "")
    if not uid or not title or not incoming:
        return None
    blocked = _guard_write(uid, f"{title}\n{incoming}")
    if blocked:
        if origin in ("explicit", "edited"):
            raise ValueError(blocked)
        logger.info("[Memory] skip %s write user_id=%s: %s", origin, uid, blocked)
        return None
    kind = _norm_kind(kind, topic_key or title)
    if kind in ("profile", "preferences"):
        folder_name = None
        key = kind
        pinned = True
    else:
        key = _slug(topic_key or title)
    folder = _clean_folder(folder_name)
    origin = origin if origin in _VALID_ORIGINS else "explicit"
    pinned = bool(pinned) or key in _PINNED_KEYS or kind in _ALWAYS_READ_KINDS
    desc = (description or "").strip()[:_MAX_DESCRIPTION] or title
    alias_list = _as_str_list(aliases)
    source_list = _as_str_list(sources) or ["chat"]
    if _sensitivity_tier(f"{title}\n{incoming}") == "consent":
        sensitive = True
    if not is_db_available():
        return None
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            existing = _find_topic(cur, uid, key, folder, kind)
            merged = incoming
            if existing:
                if replace_content:
                    merged = incoming
                else:
                    merged = _merge_tagged_content(
                        str(existing.get("content") or ""),
                        incoming,
                        delete_line_substrings,
                    )
                if not merged:
                    return _topic_out(existing)
                if protect_edited and str(existing.get("origin") or "") == "edited" and origin == "auto":
                    origin = "edited"
                if not desc or desc == title:
                    desc = str(existing.get("description") or desc)
                if not alias_list:
                    alias_list = _as_str_list(existing.get("aliases"))
                cur.execute(
                    f"""
                    UPDATE personalization_memory_topics
                       SET title = %s, content = %s, origin = %s, pinned = %s,
                           kind = %s, description = %s, aliases = %s::jsonb,
                           sensitive = %s, sources = %s::jsonb, updated_at = NOW()
                     WHERE id = %s::uuid
                    RETURNING {_TOPIC_COLUMNS}
                    """,
                    (
                        title, merged, origin, pinned, kind, desc,
                        json.dumps(alias_list), bool(sensitive) or bool(existing.get("sensitive")),
                        json.dumps(source_list), str(existing["id"]),
                    ),
                )
            else:
                if _count_topics(cur, uid) >= _MAX_TOPICS_PER_USER and origin == "auto":
                    logger.info("[Memory] skip new auto topic user_id=%s at cap", uid)
                    return None
                cur.execute(
                    f"""
                    INSERT INTO personalization_memory_topics
                        (user_id, folder_name, topic_key, title, content, origin, pinned,
                         kind, description, aliases, sensitive, sources)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb)
                    RETURNING {_TOPIC_COLUMNS}
                    """,
                    (
                        uid, folder, key, title, merged, origin, pinned,
                        kind, desc, json.dumps(alias_list), bool(sensitive), json.dumps(source_list),
                    ),
                )
            row = cur.fetchone()
        conn.commit()
    return _topic_out(row)


# ── Project-scoped memory (hard isolation) ────────────────────────────────────
#
# A "project" is a case: the UI calls it a Project, `cases` is its table, and inside
# this service it is addressed by `folder_name` — the same key every chat route already
# carries. A project memory file is a personalization_memory_topics row with
# folder_name set; rows with folder_name IS NULL are the user cross-case memory and are
# never project rows.
#
# THE BOUNDARY: every statement below filters `user_id = %s AND folder_name = %s`, and
# `_require_project` refuses a blank project so a missing id can never widen into
# "folder_name IS NULL" (which would read the global store) or into no filter at all.
# This is enforced here in SQL, not in the prompt layer.
# tests/test_project_memory_isolation.py asserts both.

_PROJECT_SCOPE = "user_id = %s AND folder_name = %s"
_PROJECT_LISTING_COLUMNS = (
    "id, folder_name, topic_key, title, kind, description, aliases, sensitive, version, updated_at"
)


def _require_project(project_id: Any) -> str:
    """The project key, or ValueError. Never returns None — a NULL scope is the global store."""
    folder = _clean_folder(project_id)
    if not folder:
        raise ValueError("A project (case) is required for project-scoped memory.")
    return folder


def _require_user(user_id: Any) -> str:
    uid = _clean_uid(user_id)
    if not uid:
        raise ValueError("A signed-in user is required")
    return uid


def _resolve_path_scope(path_folder: str | None, folder_name: Any) -> str | None:
    """Scope for a /cases/<project>/... path, refusing a path that names another project."""
    ctx = _clean_folder(folder_name)
    spelled = _clean_folder(path_folder)
    if spelled and ctx and spelled != ctx:
        raise ValueError("That memory file belongs to a different project.")
    if ctx:
        return ctx
    return spelled


def _project_row_out(row: dict[str, Any] | None) -> dict[str, Any] | None:
    """Full project row, shaped like every other memory file."""
    out = _topic_out(row)
    if not out:
        return None
    out["project_id"] = out.get("folder_name")
    out["slug"] = out.get("topic_key")
    out["version"] = int(out.get("version") or 1)
    return out


def list_project_memory(user_id: Any, project_id: Any) -> list[dict[str, Any]]:
    """Listing for ONE project: slug + description, never content."""
    uid = _require_user(user_id)
    folder = _require_project(project_id)
    if not is_db_available():
        return []
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {_PROJECT_LISTING_COLUMNS}
                FROM personalization_memory_topics
                WHERE {_PROJECT_SCOPE}
                ORDER BY pinned DESC, updated_at DESC
                """,
                (uid, folder),
            )
            rows = cur.fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        slug = str(row.get("topic_key") or "")
        out.append(
            {
                "id": str(row.get("id")),
                "project_id": folder,
                "slug": slug,
                "path": memory_path(_norm_kind(row.get("kind"), slug), slug, folder),
                "kind": _norm_kind(row.get("kind"), slug),
                "description": str(row.get("description") or row.get("title") or "").strip(),
                "aliases": _as_str_list(row.get("aliases")),
                "sensitive": bool(row.get("sensitive")),
                "version": int(row.get("version") or 1),
                "updated_at": _iso(row.get("updated_at")),
            }
        )
    return out


def read_project_memory(user_id: Any, project_id: Any, slug: str) -> dict[str, Any] | None:
    """One project file by slug, or None. Never falls back to the global store."""
    uid = _require_user(user_id)
    folder = _require_project(project_id)
    key = _slug(slug)
    if not key or not is_db_available():
        return None
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {_TOPIC_COLUMNS}
                FROM personalization_memory_topics
                WHERE {_PROJECT_SCOPE} AND topic_key = %s
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (uid, folder, key),
            )
            row = cur.fetchone()
    return _project_row_out(row)


def write_project_memory(
    user_id: Any,
    project_id: Any,
    slug: str,
    description: str,
    content: str,
    *,
    title: str | None = None,
    kind: str = "areas",
    expected_version: int | None = None,
) -> dict[str, Any] | None:
    """Create or overwrite one project file, bumping `version`.

    `expected_version` (the version last read) makes the write conditional: a
    concurrent edit in between raises instead of silently clobbering.
    """
    uid = _require_user(user_id)
    folder = _require_project(project_id)
    key = _slug(slug)
    body = _ensure_tagged_lines(content or "")
    heading = (title or "").strip()[:_MAX_TITLE] or key.replace("_", " ")
    desc = (description or "").strip()[:_MAX_DESCRIPTION] or heading
    if not key or not body:
        raise ValueError("A slug and content are required")
    # profile/preferences are user-level by definition; they have no project form.
    file_kind = _norm_kind(kind, key)
    if file_kind in _ALWAYS_READ_KINDS:
        file_kind = "areas"
    blocked = _guard_write(uid, f"{heading}\n{body}")
    if blocked:
        raise ValueError(blocked)
    sensitive = _sensitivity_tier(f"{heading}\n{body}") == "consent"
    if not is_db_available():
        raise RuntimeError("Database access is not configured for the agentic document service.")
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, version
                FROM personalization_memory_topics
                WHERE {_PROJECT_SCOPE} AND topic_key = %s
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (uid, folder, key),
            )
            existing = cur.fetchone()
            if existing:
                current_version = int(existing.get("version") or 1)
                if expected_version is not None and int(expected_version) != current_version:
                    raise ValueError(
                        f"That memory file changed since you read it (version {current_version}). Re-read and retry."
                    )
                cur.execute(
                    f"""
                    UPDATE personalization_memory_topics
                       SET title = %s, content = %s, description = %s, kind = %s,
                           origin = 'edited', sensitive = sensitive OR %s,
                           version = version + 1, updated_at = NOW()
                     WHERE {_PROJECT_SCOPE} AND id = %s::uuid
                    RETURNING {_TOPIC_COLUMNS}
                    """,
                    (heading, body, desc, file_kind, sensitive, uid, folder, str(existing["id"])),
                )
            else:
                if expected_version is not None:
                    raise ValueError("That memory file no longer exists.")
                cur.execute(
                    f"""
                    INSERT INTO personalization_memory_topics
                        (user_id, folder_name, topic_key, title, content, origin, pinned,
                         kind, description, aliases, sensitive, sources, version)
                    VALUES (%s, %s, %s, %s, %s, 'edited', FALSE, %s, %s, '[]'::jsonb, %s, '["chat"]'::jsonb, 1)
                    RETURNING {_TOPIC_COLUMNS}
                    """,
                    (uid, folder, key, heading, body, file_kind, desc, sensitive),
                )
            row = cur.fetchone()
        conn.commit()
    logger.info(
        "[Memory] project write user_id=%s project=%s slug=%s version=%s",
        uid, folder, key, (row or {}).get("version"),
    )
    return _project_row_out(row)


def delete_project_memory(user_id: Any, project_id: Any, slug: str) -> bool:
    """Hard-delete one project file. Returns False when the project has no such slug."""
    uid = _require_user(user_id)
    folder = _require_project(project_id)
    key = _slug(slug)
    if not key or not is_db_available():
        return False
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                f"DELETE FROM personalization_memory_topics WHERE {_PROJECT_SCOPE} AND topic_key = %s",
                (uid, folder, key),
            )
            deleted = cur.rowcount > 0
        conn.commit()
    if deleted:
        logger.info("[Memory] project delete user_id=%s project=%s slug=%s", uid, folder, key)
    return deleted


def update_topic(
    user_id: Any,
    topic_id: str,
    *,
    title: str | None = None,
    content: str | None = None,
    pinned: bool | None = None,
) -> dict[str, Any] | None:
    uid = _clean_uid(user_id)
    if not uid or not topic_id:
        return None
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {_TOPIC_COLUMNS}
                FROM personalization_memory_topics
                WHERE id = %s::uuid AND user_id = %s
                """,
                (str(topic_id), uid),
            )
            row = cur.fetchone()
            if not row:
                return None
            new_title = (title if title is not None else row["title"] or "").strip()[:_MAX_TITLE]
            new_content = (content if content is not None else row["content"] or "").strip()[:_MAX_TOPIC_CONTENT]
            if content is not None:
                new_content = _ensure_tagged_lines(new_content, "stated") or new_content
            blocked = _guard_write(uid, f"{new_title}\n{new_content}")
            if blocked:
                raise ValueError(blocked)
            new_pinned = row["pinned"] if pinned is None else bool(pinned)
            if not new_title or not new_content:
                raise ValueError("Title and content cannot be empty")
            cur.execute(
                f"""
                UPDATE personalization_memory_topics
                   SET title = %s, content = %s, pinned = %s, origin = 'edited',
                       description = CASE WHEN description = '' OR description IS NULL THEN %s ELSE description END,
                       updated_at = NOW()
                 WHERE id = %s::uuid AND user_id = %s
                RETURNING {_TOPIC_COLUMNS}
                """,
                (new_title, new_content, new_pinned, new_title, str(topic_id), uid),
            )
            updated = cur.fetchone()
        conn.commit()
    return _topic_out(updated)


def delete_topic(user_id: Any, topic_id: str) -> bool:
    uid = _clean_uid(user_id)
    if not uid or not topic_id:
        return False
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM personalization_memory_topics WHERE id = %s::uuid AND user_id = %s",
                (str(topic_id), uid),
            )
            deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def search_topics(
    user_id: Any, query: str, folder_name: str | None = None, limit: int = 20
) -> list[dict[str, Any]]:
    """Find memory FILES whose path, description, aliases or body match the query.

    Memory holds no conversations, so there is nothing else to search. Matching is done
    in Python over the rows the caller may already see, which keeps the same scope rules
    as `list_topics` (global files, plus this case's when a case is given).
    """
    uid = _clean_uid(user_id)
    q = (query or "").strip()
    if not uid or not q:
        return []
    rows = list_topics(uid, folder_name)
    tokens = _tokens(q)
    needle = q.lower()
    scored: list[tuple[int, dict[str, Any]]] = []
    for t in rows:
        hay = (
            f"{t.get('path') or ''} {t.get('topic_key') or ''} {t.get('title') or ''} "
            f"{t.get('description') or ''} {' '.join(_as_str_list(t.get('aliases')))} "
            f"{t.get('content') or ''}"
        ).lower()
        score = 0
        if needle in hay:
            score += 50
        score += len(tokens & _tokens(hay))
        if score > 0:
            scored.append((score, t))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [t for _score, t in scored[: max(1, int(limit))]]


def forget_matching(user_id: Any, query: str, folder_name: str | None = None) -> list[dict[str, Any]]:
    """Delete topics whose title/key/content match the forget query."""
    uid = _clean_uid(user_id)
    q = (query or "").strip()
    if not uid or not q or not is_db_available():
        return []
    tokens = _distinctive_tokens(q, limit=5)
    if not tokens:
        tokens = [q[:80]]
    topics = list_topics(uid, folder_name)
    removed: list[dict[str, Any]] = []
    hay_q = q.lower()
    for t in topics:
        hay = (
            f"{t.get('topic_key') or ''} {t.get('title') or ''} {t.get('path') or ''} "
            f"{t.get('description') or ''} {t.get('content') or ''}"
        ).lower()
        hit = hay_q in hay or any(tok in hay for tok in tokens)
        if hit and t.get("id"):
            if delete_topic(uid, str(t["id"])):
                removed.append(t)
    return removed


def remember_explicit(
    user_id: Any,
    text: str,
    *,
    folder_name: str | None = None,
    title: str | None = None,
) -> dict[str, Any] | None:
    body = (text or "").strip()
    if not body:
        return None
    heading = (title or "").strip() or (body.split("\n", 1)[0][:80] or "Remembered note")
    blocked = _guard_write(_clean_uid(user_id), f"{heading}\n{body}")
    if blocked:
        raise ValueError(blocked)
    folder = folder_name
    kind = "areas" if folder else "topics"
    return upsert_topic(
        user_id,
        title=heading,
        content=_ensure_tagged_lines(body, "stated"),
        topic_key=_slug(heading),
        folder_name=folder,
        origin="explicit",
        pinned=False,
        kind=kind,
        description=heading,
        replace_content=False,
    )


def sync_working_style_from_profile(user_id: Any, profile_json: dict[str, Any] | None) -> None:
    """Keep a pinned global `working_style` note in sync with the learned profile.

    Does not overwrite a note the user edited by hand.
    """
    summary = str((profile_json or {}).get("summary") or "").strip()
    if not summary:
        return
    uid = _clean_uid(user_id)
    if not uid or not is_db_available():
        return
    with get_db_connection() as conn:
        _ensure_tables(conn)
        with conn.cursor() as cur:
            existing = _find_topic(cur, uid, "preferences", None, "preferences")
    if existing and str(existing.get("content") or "").strip() == summary:
        return
    upsert_topic(
        user_id,
        title="How you like to work",
        content=_ensure_tagged_lines(summary, "inferred"),
        topic_key="preferences",
        folder_name=None,
        origin="auto",
        pinned=True,
        protect_edited=True,
        kind="preferences",
        description="How this user wants the assistant to behave",
    )


def memory_status_for_user(user_id: Any, folder_name: str | None = None) -> dict[str, Any]:
    uid = _clean_uid(user_id)
    settings = get_settings_for_user(uid)
    folder = _clean_folder(folder_name)
    topic_count = 0
    case_topic_count = 0
    extracting = False
    if uid and is_db_available():
        with get_db_connection() as conn:
            _ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) AS n FROM personalization_memory_topics WHERE user_id = %s",
                    (uid,),
                )
                topic_count = int(cur.fetchone()["n"])
                if folder:
                    cur.execute(
                        "SELECT COUNT(*) AS n FROM personalization_memory_topics "
                        "WHERE user_id = %s AND folder_name = %s",
                        (uid, folder),
                    )
                    case_topic_count = int(cur.fetchone()["n"])
        with _inflight_lock:
            # Prompt-time jobs are keyed by uid, post-turn jobs by "turn:<uid>".
            extracting = uid in _inflight_extracts or f"turn:{uid}" in _inflight_extracts
    packed = {**settings, "topic_count": topic_count, "case_topic_count": case_topic_count, "extracting": extracting}
    packed["enabled"] = _memory_on(settings)
    return packed


# ── Small helpers ─────────────────────────────────────────────────────────────

def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


# ── Listing-first retrieval (chat injection) ──────────────────────────────────

def _score_topic(topic: dict[str, Any], query_tokens: set[str], query: str = "") -> int:
    """Score from the listing only (path, description, aliases, title) — not file body."""
    kind = _norm_kind(topic.get("kind"), str(topic.get("topic_key") or ""))
    if kind in _ALWAYS_READ_KINDS:
        return 1000
    q = (query or "").lower()
    title = str(topic.get("title") or "")
    desc = str(topic.get("description") or "")
    aliases = " ".join(_as_str_list(topic.get("aliases")))
    path = str(topic.get("path") or "")
    key = str(topic.get("topic_key") or "")
    listing = f"{path} {title} {desc} {aliases} {key}".lower()
    if q and (key.lower() in q or title.lower() in q or any(a.lower() in q for a in _as_str_list(topic.get("aliases")))):
        return 80
    listing_tokens = _tokens(listing)
    return (
        5 * len(_tokens(desc) & query_tokens)
        + 3 * len(_tokens(title) & query_tokens)
        + 3 * len(_tokens(aliases) & query_tokens)
        + len(listing_tokens & query_tokens)
    )


def build_memory_block(
    user_id: Any,
    folder_name: str | None = None,
    query: str = "",
    *,
    incognito: bool = False,
) -> str:
    """Listing-first injection. Empty when Memory is off or this chat is incognito."""
    uid = _clean_uid(user_id)
    if incognito or not uid or not _enabled() or not is_db_available():
        return ""
    settings = get_settings_for_user(uid)
    if not _memory_on(settings):
        return ""
    topics = list_topics(uid, folder_name)
    listing_lines = [f"{t.get('path')} — {str(t.get('description') or t.get('title') or '').strip()}" for t in topics]
    listing = "\n".join(listing_lines) if listing_lines else "(none yet)"

    q = (query or "").strip()
    q_tokens = _tokens(q)
    ranked = sorted(topics, key=lambda t: _score_topic(t, q_tokens, q), reverse=True)
    selected: list[dict[str, Any]] = []
    budget = _max_inject_chars()
    used = 0
    max_n = _max_retrieve()
    for t in ranked:
        score = _score_topic(t, q_tokens, q)
        always = _norm_kind(t.get("kind"), str(t.get("topic_key") or "")) in _ALWAYS_READ_KINDS
        if not always and score <= 0:
            continue
        if bool(t.get("sensitive")):
            if not settings.get("sensitive_data") or score < 80:
                continue
        if not str(t.get("content") or "").strip():
            continue
        body = _render_file_text(t)
        chunk = len(body) + 40
        if selected and used + chunk > budget:
            break
        selected.append(t)
        used += chunk
        if len(selected) >= max_n + 2:
            break

    # Memory is FILES, never transcripts. Raw past conversations are not searched and
    # not injected — what survives a chat is whatever the extractor wrote into a file.
    note_parts = [_render_file_text(t) for t in selected]
    if not topics:
        return ""

    chunks = [
        "\n\n=== USER MEMORY ===",
        "Private files about this user. Apply a file only when it changes the substance "
        "of the answer. If the response would be the same without it, leave it out. "
        "Never say 'based on your memory/data'. Never mention that you stored something "
        "unless they explicitly asked you to remember it. Never surface sensitive stored "
        "facts unless the user brought that topic up in this message. "
        "If they ask what you know about them, answer plainly from the files below. "
        "Never override document-grounding, accuracy or safety.",
        "<memory_listing>",
        listing,
        "</memory_listing>",
    ]
    if note_parts:
        chunks.append("<memory_files>\n" + "\n\n".join(note_parts) + "\n</memory_files>")
    elif topics:
        chunks.append(
            "No matching file was read for this turn. Use the listing; do not invent file contents."
        )
    chunks.append("=== END USER MEMORY ===")
    return "\n".join(chunks)


# ── Project memory: listing injection + READ_MEMORY round-trip ────────────────
#
# Two Gemini calls, and ONLY for a chat that has a project (folder_name):
#   1. The router gets the project listing ("- slug: description" per line) plus the
#      question and answers either "READ_MEMORY: <slug>" or "NONE". It is a cheap call
#      on PERSONALIZATION_MEMORY_DIRECTIVE_MODEL (gemini-2.5-flash).
#   2. On a directive we read that slug — through the project store, so the hard
#      folder_name filter applies to whatever the model asked for — and the file goes
#      into the system prompt of the ANSWER call the chat route already makes.
#
# A chat with no project never reaches this code, so general chats call Gemini exactly
# as before. Any failure (no key, timeout, unknown slug) falls back to the
# deterministic listing-only block.

MEMORY_DIRECTIVE_PREFIX = "READ_MEMORY:"

_DIRECTIVE_RE = re.compile(r"^\s*READ_MEMORY\s*:\s*([^\n]+)", re.IGNORECASE)

MEMORY_ROUTER_SYSTEM_PROMPT = """You are the Memory Router for a legal assistant.

You see a LISTING of memory files saved for the current project (case) and the user's
next message. You do not see the file contents.

Reply with EXACTLY ONE line and nothing else:
  READ_MEMORY: <slug>   - if one listed file would change the substance of the answer
  NONE                  - otherwise

Rules:
- <slug> must be copied verbatim from the listing. Never invent one.
- Choose NONE when the listing is empty, when nothing matches, or when the answer would
  be the same either way. NONE is the common case.
- Pick the single most relevant file. Never name more than one.
- Never answer the user's question. Never explain your choice."""


def parse_memory_directive(text: str) -> str | None:
    """The slug from a leading `READ_MEMORY: <slug>`, else None."""
    match = _DIRECTIVE_RE.match(str(text or ""))
    if not match:
        return None
    raw = match.group(1).strip().strip("`\"'<>").strip()
    if not raw or raw.upper() == "NONE":
        return None
    # The model may answer with a path (/cases/x/areas/slug.md) or the bare slug.
    if "/" in raw:
        _kind, key, _folder = parse_memory_path(raw)
        return key or None
    return _slug(raw) or None


def build_project_listing(user_id: Any, project_id: Any) -> str:
    """One "- slug: description" line per project file, for the prompt and the router."""
    try:
        files = list_project_memory(user_id, project_id)
    except ValueError:
        return ""
    lines = []
    for f in files:
        desc = str(f.get("description") or "").strip() or "(no description)"
        lines.append(f"- {f.get('slug')}: {desc}")
    return "\n".join(lines)


def _directive_enabled() -> bool:
    return bool(getattr(get_settings(), "personalization_memory_directive_enabled", True))


def _directive_model() -> str:
    return (
        str(getattr(get_settings(), "personalization_memory_directive_model", "") or "").strip()
        or "gemini-2.5-flash"
    )


def resolve_memory_directive(
    user_id: Any,
    project_id: Any,
    question: str,
    *,
    listing: str | None = None,
    skip_slugs: frozenset[str] | set[str] = frozenset(),
) -> dict[str, Any] | None:
    """Gemini call 1 of 2: ask which project file to read, then read it.

    Returns the project row to inject, or None when the router said NONE, named a slug
    that does not exist in THIS project, or failed.
    """
    uid = _clean_uid(user_id)
    folder = _clean_folder(project_id)
    q = (question or "").strip()
    if not uid or not folder or not q or not _directive_enabled():
        return None
    index = listing if listing is not None else build_project_listing(uid, folder)
    if not index.strip():
        return None
    user_msg = (
        f"<project_memory_listing>\n{index}\n</project_memory_listing>\n\n"
        f"<user_message>\n{q[:2000]}\n</user_message>"
    )
    try:
        text, model = _pz()._gemini_call(
            system=MEMORY_ROUTER_SYSTEM_PROMPT,
            user=user_msg,
            schema=None,
            temperature=0.0,
            max_output_tokens=64,
            model_override=_directive_model(),
        )
    except Exception as exc:  # noqa: BLE001 — the answer call must not depend on this
        logger.warning("[Memory] directive router failed user_id=%s project=%s: %s", uid, folder, exc)
        return None
    slug = parse_memory_directive(text)
    if not slug or slug in skip_slugs:
        return None
    row = read_project_memory(uid, folder, slug)
    if not row:
        logger.info(
            "[Memory] router named an unknown slug user_id=%s project=%s slug=%s model=%s",
            uid, folder, slug, model,
        )
        return None
    logger.info(
        "[Memory] READ_MEMORY user_id=%s project=%s slug=%s model=%s", uid, folder, slug, model
    )
    return row


def build_memory_block_with_directive(
    user_id: Any,
    folder_name: str | None = None,
    query: str = "",
    *,
    incognito: bool = False,
) -> str:
    """The chat-turn memory block: deterministic retrieval, then the project round-trip.

    With no folder_name this returns exactly what `build_memory_block` returns and makes
    no extra Gemini call, so general chats are untouched.
    """
    block = build_memory_block(user_id, folder_name, query, incognito=incognito)
    uid = _clean_uid(user_id)
    folder = _clean_folder(folder_name)
    if incognito or not uid or not folder or not _enabled():
        return block
    if not _memory_on(get_settings_for_user(uid)):
        return block
    project_files = list_project_memory(uid, folder)
    if not project_files:
        return block
    listing = "\n".join(
        f"- {f.get('slug')}: {str(f.get('description') or '').strip() or '(no description)'}"
        for f in project_files
    )
    # Files the deterministic pass already injected — never pay to read them twice.
    already = {
        str(f.get("slug"))
        for f in project_files
        if f.get("slug") and f"name: {f.get('slug')}" in block
    }
    row = resolve_memory_directive(uid, folder, query, listing=listing, skip_slugs=already)
    parts = [
        "",
        "",
        "=== PROJECT MEMORY ===",
        "Memory files saved for this case only. Never mention the listing and never emit "
        f"{MEMORY_DIRECTIVE_PREFIX} in your answer — the file you need is already below.",
        "<project_memory_listing>",
        listing,
        "</project_memory_listing>",
    ]
    if row:
        parts.append("<project_memory_file>")
        parts.append(str(row.get("file_text") or ""))
        parts.append("</project_memory_file>")
    parts.append("=== END PROJECT MEMORY ===")
    return block + "\n".join(parts)


# ── Extract after each prompt ─────────────────────────────────────────────────

def _index_for_extractor(topics: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for t in topics[:40]:
        scope = "case" if t.get("folder_name") else "global"
        preview = str(t.get("content") or "").replace("\n", " ").strip()[:220]
        lines.append(
            f"- path={t.get('path')} kind={t.get('kind')} key={t.get('topic_key')} "
            f"scope={scope} desc={t.get('description') or t.get('title')}\n  {preview}"
        )
    return "\n".join(lines) if lines else "(none)"


def _change_blob(change: MemoryTopicChange) -> str:
    parts = [change.title or "", change.content or "", " ".join(change.lines or [])]
    return "\n".join(p for p in parts if p)


def _apply_change(uid: str, change: MemoryTopicChange, folder: str | None) -> None:
    action = str(change.action or "").strip().lower()
    scope = str(change.scope or "global").strip().lower()
    if scope not in ("global", "case"):
        scope = "global"
    kind = _norm_kind(change.kind, change.topic_key or change.title)
    key = _slug(change.topic_key or change.title or kind)
    if not key:
        return
    if action not in ("upsert", "delete"):
        return
    target_folder = None if kind in _ALWAYS_READ_KINDS else (folder if scope == "case" else None)
    if action == "delete":
        with get_db_connection() as conn:
            _ensure_tables(conn)
            with conn.cursor() as cur:
                existing = _find_topic(cur, uid, key, target_folder, kind)
            conn.commit()
        if existing:
            delete_topic(uid, str(existing["id"]))
        return
    title = (change.title or key.replace("_", " ")).strip()
    raw = (change.content or "").strip()
    if change.lines:
        raw = "\n".join(str(x).strip() for x in change.lines if str(x).strip()) or raw
    if not title or not raw:
        return
    blob = f"{title}\n{raw}"
    if _sensitivity_tier(blob) == "never":
        return
    if (_sensitivity_tier(blob) == "consent" or change.sensitive) and not get_settings_for_user(uid).get("sensitive_data"):
        return
    upsert_topic(
        uid,
        title=title,
        content=_ensure_tagged_lines(raw, change.provenance or "stated"),
        topic_key=key,
        folder_name=target_folder,
        origin="auto",
        pinned=bool(change.pinned) or kind in _ALWAYS_READ_KINDS,
        protect_edited=True,
        kind=kind,
        description=(change.description or "").strip() or title,
        aliases=list(change.aliases or []),
        sensitive=bool(change.sensitive) or _sensitivity_tier(blob) == "consent",
        delete_line_substrings=list(change.delete_line_substrings or []),
        replace_content=False,
    )


def _apply_explicit_commands(uid: str, prompt: str, folder: str | None) -> bool:
    """Handle 'remember this' / 'forget this' without waiting on the LLM."""
    handled = False
    forget = _FORGET_RE.search(prompt.strip())
    if forget:
        query = (forget.group(1) or "").strip()
        if query:
            removed = forget_matching(uid, query, folder_name=folder)
            logger.info("[Memory] explicit forget user_id=%s removed=%s", uid, len(removed))
            handled = True
    remember = _REMEMBER_RE.search(prompt.strip())
    if remember:
        body = (remember.group(1) or "").strip()
        if body:
            remember_explicit(uid, body, folder_name=folder)
            logger.info("[Memory] explicit remember user_id=%s chars=%s", uid, len(body))
            handled = True
    return handled


def extract_from_prompt(
    user_id: Any,
    prompt_text: str,
    *,
    folder_name: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    uid = _clean_uid(user_id)
    text = (prompt_text or "").strip()
    if not uid or not text or not _enabled() or not is_db_available():
        return {"changes": 0, "skipped": True}
    folder = _clean_folder(folder_name)
    settings = get_settings_for_user(uid)
    if not _memory_on(settings):
        return {"changes": 0, "skipped": True, "reason": "memory_off"}
    explicit = _apply_explicit_commands(uid, text, folder)
    if explicit:
        return {"changes": 1, "skipped": False, "reason": "explicit"}
    if not settings.get("generate_from_chats"):
        return {"changes": 0, "skipped": True, "reason": "generate_off"}
    if len(text) < 12:
        return {"changes": 0, "skipped": True, "reason": "too_short"}

    topics = list_topics(uid, folder)
    recent: list[dict[str, Any]] = []
    try:
        recent = _pz().get_recent_prompts(uid, limit=8, folder_name=folder)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] recent prompts skipped: %s", exc)
    recent_lines = []
    for i, r in enumerate(recent[-8:], start=1):
        recent_lines.append(f"{i}. {str(r.get('prompt_text') or '').strip()[:400]}")
    user_msg = (
        f"<existing_files>\n{_index_for_extractor(topics)}\n</existing_files>\n\n"
        f"<latest_prompt>\n{text[:2000]}\n</latest_prompt>\n\n"
        f"<recent_prompts>\n{chr(10).join(recent_lines) or '(none)'}\n</recent_prompts>\n"
        f"<current_case>{folder or 'none (global chat)'}</current_case>\n"
        "Return only durable topic changes."
    )
    try:
        parsed, model = _pz()._gemini_call(
            system=MEMORY_EXTRACTOR_SYSTEM_PROMPT,
            user=user_msg,
            schema=MemoryExtraction,
            temperature=0.1,
            max_output_tokens=2048,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] extract LLM failed user_id=%s: %s", uid, exc)
        return {"changes": int(explicit), "error": str(exc)}

    applied = 0
    routine: list[MemoryTopicChange] = []
    sensitive_changes: list[MemoryTopicChange] = []
    allow_sensitive = bool(settings.get("sensitive_data"))
    for change in list(getattr(parsed, "changes", None) or [])[:_MAX_CHANGES_PER_EXTRACT]:
        blob = _change_blob(change)
        tier = _sensitivity_tier(blob)
        if tier == "never":
            continue
        if tier == "consent" or change.sensitive:
            if allow_sensitive:
                sensitive_changes.append(change)
            continue
        routine.append(change)
    for change in routine + sensitive_changes:
        try:
            _apply_change(uid, change, folder)
            applied += 1
        except Exception as exc:  # noqa: BLE001
            logger.debug("[Memory] change skipped: %s", exc)
    logger.info(
        "[Memory] extract user_id=%s model=%s applied=%s session=%s folder=%s",
        uid, model, applied, session_id, folder,
    )
    return {"changes": applied + int(explicit), "model": model, "noop_reason": getattr(parsed, "noop_reason", "")}


def schedule_memory_extract(
    user_id: Any,
    prompt_text: str,
    *,
    folder_name: str | None = None,
    session_id: str | None = None,
    explicit_only: bool = False,
) -> bool:
    """Prompt-time pass.

    `explicit_only=True` (what the chat route uses) applies "remember this" /
    "forget that" immediately and leaves the LLM extraction to `schedule_turn_extract`,
    which runs after the answer and sees both sides of the exchange.
    """
    uid = _clean_uid(user_id)
    if not uid or not _enabled() or not (prompt_text or "").strip():
        return False
    if not _memory_on(get_settings_for_user(uid)):
        return False
    settings = get_settings_for_user(uid)
    is_explicit = bool(_REMEMBER_RE.search(prompt_text) or _FORGET_RE.search(prompt_text))
    if explicit_only and not is_explicit:
        return False
    if not is_explicit and not settings.get("generate_from_chats"):
        return False
    now = time.time()
    with _inflight_lock:
        last = _last_extract_at.get(uid, 0.0)
        if uid in _inflight_extracts:
            return False
        if not is_explicit and (now - last) < _EXTRACT_COOLDOWN_S:
            return False
        _inflight_extracts.add(uid)
        _last_extract_at[uid] = now

    def _job() -> None:
        try:
            if explicit_only:
                _apply_explicit_commands(uid, prompt_text.strip(), _clean_folder(folder_name))
            else:
                extract_from_prompt(
                    uid, prompt_text, folder_name=folder_name, session_id=session_id
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Memory] background extract failed user_id=%s: %s", uid, exc)
        finally:
            with _inflight_lock:
                _inflight_extracts.discard(uid)

    _pz()._EXECUTOR.submit(_job)
    return True


# ── Extract after a completed turn (reply already sent) ───────────────────────
#
# This is the write half of project memory. It runs on the personalization thread pool
# AFTER the answer has streamed, so the user never waits on it, and unlike the
# prompt-time pass it sees the assistant reply — which is what lets it tell a decision
# the user confirmed from a suggestion the assistant merely floated.
#
# It deliberately saves nothing for small talk, search results, or unconfirmed
# suggestions; that is spelled out in MEMORY_EXTRACTOR_SYSTEM_PROMPT and reinforced
# per-turn below. Writes go through _apply_change, so the project rows it touches are
# scoped to this turn's folder and every sensitivity guard still applies.

_MAX_REPLY_FOR_EXTRACT = 4000
_MAX_PROMPT_FOR_EXTRACT = 2000

_TURN_EXTRACT_RULES = (
    "This is a COMPLETED turn: you see what the user asked and what the assistant "
    "replied. Save only what the USER stated or explicitly confirmed. An assistant "
    "suggestion the user did not accept is not a fact. Small talk, greetings, "
    "acknowledgements, and anything the assistant looked up or generated are never "
    "saved. If nothing durable changed, return an empty changes list."
)


def _turn_extract_enabled() -> bool:
    return bool(getattr(get_settings(), "personalization_memory_turn_extract_enabled", True))


def extract_after_turn(
    user_id: Any,
    user_message: str,
    assistant_reply: str,
    *,
    folder_name: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    """Fold durable facts from one finished exchange into memory. Runs in the background."""
    uid = _clean_uid(user_id)
    prompt = (user_message or "").strip()
    reply = (assistant_reply or "").strip()
    if not uid or not prompt or not _enabled() or not is_db_available():
        return {"changes": 0, "skipped": True}
    if not _turn_extract_enabled():
        return {"changes": 0, "skipped": True, "reason": "turn_extract_off"}
    settings = get_settings_for_user(uid)
    if not _memory_on(settings) or not settings.get("generate_from_chats"):
        return {"changes": 0, "skipped": True, "reason": "generate_off"}
    if len(prompt) < 12:
        return {"changes": 0, "skipped": True, "reason": "too_short"}
    folder = _clean_folder(folder_name)

    topics = list_topics(uid, folder)
    listing = _index_for_extractor(topics)
    user_msg = (
        f"<existing_files>\n{listing}\n</existing_files>\n\n"
        f"<latest_prompt>\n{prompt[:_MAX_PROMPT_FOR_EXTRACT]}\n</latest_prompt>\n\n"
        f"<assistant_reply>\n{reply[:_MAX_REPLY_FOR_EXTRACT]}\n</assistant_reply>\n\n"
        f"<current_case>{folder or 'none (global chat)'}</current_case>\n"
        f"{_TURN_EXTRACT_RULES}"
    )
    try:
        parsed, model = _pz()._gemini_call(
            system=MEMORY_EXTRACTOR_SYSTEM_PROMPT,
            user=user_msg,
            schema=MemoryExtraction,
            temperature=0.1,
            max_output_tokens=2048,
            model_override=_directive_model(),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] turn extract LLM failed user_id=%s: %s", uid, exc)
        return {"changes": 0, "error": str(exc)}

    applied = 0
    allow_sensitive = bool(settings.get("sensitive_data"))
    for change in list(getattr(parsed, "changes", None) or [])[:_MAX_CHANGES_PER_EXTRACT]:
        tier = _sensitivity_tier(_change_blob(change))
        if tier == "never":
            continue
        if (tier == "consent" or change.sensitive) and not allow_sensitive:
            continue
        try:
            _apply_change(uid, change, folder)
            applied += 1
        except Exception as exc:  # noqa: BLE001
            logger.debug("[Memory] turn change skipped: %s", exc)
    logger.info(
        "[Memory] turn extract user_id=%s model=%s applied=%s session=%s project=%s",
        uid, model, applied, session_id, folder,
    )
    return {"changes": applied, "model": model, "noop_reason": getattr(parsed, "noop_reason", "")}


def schedule_turn_extract(
    user_id: Any,
    user_message: str,
    assistant_reply: str,
    *,
    folder_name: str | None = None,
    session_id: str | None = None,
    incognito: bool = False,
) -> bool:
    """Queue `extract_after_turn` on the personalization pool. Never blocks the reply."""
    uid = _clean_uid(user_id)
    if incognito or not uid or not _enabled() or not _turn_extract_enabled():
        return False
    if not (user_message or "").strip() or not (assistant_reply or "").strip():
        return False
    settings = get_settings_for_user(uid)
    if not _memory_on(settings) or not settings.get("generate_from_chats"):
        return False
    key = f"turn:{uid}"
    with _inflight_lock:
        if key in _inflight_extracts:
            return False
        _inflight_extracts.add(key)

    def _job() -> None:
        try:
            extract_after_turn(
                uid,
                user_message,
                assistant_reply,
                folder_name=folder_name,
                session_id=session_id,
            )
        except Exception as exc:  # noqa: BLE001 — a background write never reaches the user
            logger.warning("[Memory] background turn extract failed user_id=%s: %s", uid, exc)
        finally:
            with _inflight_lock:
                _inflight_extracts.discard(key)

    _pz()._EXECUTOR.submit(_job)
    return True
