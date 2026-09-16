"""The only place that reads or writes memory tables.

Two invariants this module exists to hold:

1. **Isolation is structural.** Every case-scoped statement carries
   `case_key = %s`. There is no function that reads across cases, and
   `_require_case_key` refuses an empty key rather than falling back to
   "everything".

2. **Writes are version-locked.** The section row holds the version token; a
   write with a stale token is rejected with `VersionConflict` carrying the
   current content, so the caller (a UI editor, or the post-turn writer) can
   merge and retry instead of silently clobbering someone else's edit. The chat
   surface, the drafting pipeline and the document processor all write to the
   same case.
"""
from __future__ import annotations

import json
import logging
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator, Sequence

from app.services.db import get_db_connection, is_db_available
from app.services.memory.schemas import (
    ADVOCATE_CATEGORIES,
    INSTRUCTION_ORIGINS,
    INSTRUCTION_SCOPES,
    MAX_INSTRUCTION_ITEM_CHARS,
    MAX_ADVOCATE_FORGOTTEN,
    MAX_ADVOCATE_LINES,
    MAX_INSTRUCTION_ITEMS,
    MAX_LINE_CHARS,
    MAX_SECTION_LINES,
    MAX_SUMMARY_LINES,
    OVERRIDE_TYPES,
    SECTIONS,
    SETTINGS_FLAGS,
    MemorySettings,
)
from app.services.memory.validator import ResolvedOp, split_instruction_text

logger = logging.getLogger("agentic_document_service.memory.repository")


class VersionConflict(Exception):
    """A write carried a stale version token. Carries the current content."""

    def __init__(
        self,
        section: str,
        expected: int | None,
        current_version: int | None,
        current_lines: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(
            f"Stale version for section '{section}': expected {expected}, current {current_version}."
        )
        self.section = section
        self.expected = expected
        self.current_version = current_version
        self.current_lines = current_lines or []


# ── Lazy DDL (mirrors db/migrations/170_create_memory_tables.sql) ─────────────
# The migration is authoritative; this keeps a fresh deployment working before
# `npm run migrate` has been run, exactly like custom_prompt_service does.
_ENSURE_SQL = """
CREATE TABLE IF NOT EXISTS user_standing_preferences (
    user_id     TEXT PRIMARY KEY,
    content     TEXT        NOT NULL DEFAULT '',
    version     INTEGER     NOT NULL DEFAULT 1,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_standing_preferences_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT        NOT NULL,
    version    INTEGER     NOT NULL,
    content    TEXT        NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_standing_preferences_history_user
    ON user_standing_preferences_history (user_id, version DESC);
CREATE TABLE IF NOT EXISTS case_instructions (
    case_key    TEXT PRIMARY KEY,
    folder_name TEXT,
    content     TEXT        NOT NULL DEFAULT '',
    version     INTEGER     NOT NULL DEFAULT 1,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS case_instructions_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key   TEXT        NOT NULL,
    version    INTEGER     NOT NULL,
    content    TEXT        NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_case_instructions_history_case
    ON case_instructions_history (case_key, version DESC);
CREATE TABLE IF NOT EXISTS case_memory_sections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key    TEXT        NOT NULL,
    folder_name TEXT,
    section     TEXT        NOT NULL,
    version     INTEGER     NOT NULL DEFAULT 1,
    seed_meta   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT case_memory_sections_section_check
        CHECK (section IN ('summary','facts','parties','documents','drafting_log','decisions','dates')),
    CONSTRAINT case_memory_sections_case_section_key UNIQUE (case_key, section)
);
CREATE INDEX IF NOT EXISTS idx_case_memory_sections_case
    ON case_memory_sections (case_key);
CREATE TABLE IF NOT EXISTS case_memory_lines (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key   TEXT        NOT NULL,
    section    TEXT        NOT NULL,
    ord        INTEGER     NOT NULL DEFAULT 1,
    tag        TEXT        NOT NULL,
    text       TEXT        NOT NULL,
    source_ref JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT case_memory_lines_tag_check CHECK (tag IN ('stated','extracted','status')),
    CONSTRAINT case_memory_lines_text_len_check CHECK (char_length(text) <= 300),
    CONSTRAINT case_memory_lines_section_fk
        FOREIGN KEY (case_key, section)
        REFERENCES case_memory_sections (case_key, section)
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_case_memory_lines_case_section_ord
    ON case_memory_lines (case_key, section, ord);
CREATE TABLE IF NOT EXISTS memory_settings (
    scope_type           TEXT        NOT NULL,
    scope_id             TEXT        NOT NULL,
    enabled              BOOLEAN     NOT NULL DEFAULT TRUE,
    write_enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    recall_enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
    instructions_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
    sensitive_enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
    updated_by           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_settings_scope_type_check CHECK (scope_type IN ('user','case','firm')),
    CONSTRAINT memory_settings_pkey PRIMARY KEY (scope_type, scope_id)
);
CREATE TABLE IF NOT EXISTS memory_assembly_log (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key             TEXT        NOT NULL,
    user_id              TEXT,
    session_id           UUID,
    chat_id              UUID,
    mode                 TEXT,
    prefs_version        INTEGER,
    instructions_version INTEGER,
    sections_loaded      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    preset_ref           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    past_chat_ids        UUID[]      NOT NULL DEFAULT ARRAY[]::UUID[],
    model                TEXT,
    budget               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    writes               INTEGER     NOT NULL DEFAULT 0,
    rejected             INTEGER     NOT NULL DEFAULT 0,
    proposals            INTEGER     NOT NULL DEFAULT 0,
    skipped_reason       TEXT,
    details              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_assembly_log_case_created
    ON memory_assembly_log (case_key, created_at DESC);
CREATE TABLE IF NOT EXISTS memory_proposals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key    TEXT        NOT NULL,
    user_id     TEXT,
    kind        TEXT        NOT NULL,
    text        TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'pending',
    source_ref  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT memory_proposals_kind_check CHECK (kind IN ('instruction','preference')),
    CONSTRAINT memory_proposals_status_check CHECK (status IN ('pending','accepted','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_memory_proposals_case_status
    ON memory_proposals (case_key, status, created_at DESC);
CREATE TABLE IF NOT EXISTS memory_instruction_sets (
    scope_type  TEXT        NOT NULL,
    scope_id    TEXT        NOT NULL,
    version     INTEGER     NOT NULL DEFAULT 1,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_instruction_sets_scope_check CHECK (scope_type IN ('user','case')),
    CONSTRAINT memory_instruction_sets_pkey PRIMARY KEY (scope_type, scope_id)
);
CREATE TABLE IF NOT EXISTS memory_instructions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type  TEXT        NOT NULL,
    scope_id    TEXT        NOT NULL,
    ord         INTEGER     NOT NULL DEFAULT 1,
    text        TEXT        NOT NULL,
    enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    origin      TEXT        NOT NULL DEFAULT 'user',
    source_ref  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_instructions_text_len_check CHECK (char_length(text) <= 400),
    CONSTRAINT memory_instructions_origin_check
        CHECK (origin IN ('user','chat','learned','import','migrated')),
    CONSTRAINT memory_instructions_set_fk
        FOREIGN KEY (scope_type, scope_id)
        REFERENCES memory_instruction_sets (scope_type, scope_id)
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_instructions_scope
    ON memory_instructions (scope_type, scope_id, ord);
CREATE TABLE IF NOT EXISTS memory_instruction_overrides (
    instruction_id UUID        NOT NULL REFERENCES memory_instructions (id) ON DELETE CASCADE,
    override_type  TEXT        NOT NULL,
    override_id    TEXT        NOT NULL,
    enabled        BOOLEAN     NOT NULL,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_instruction_overrides_type_check CHECK (override_type IN ('case','session')),
    CONSTRAINT memory_instruction_overrides_pkey PRIMARY KEY (instruction_id, override_type, override_id)
);
CREATE INDEX IF NOT EXISTS idx_memory_instruction_overrides_target
    ON memory_instruction_overrides (override_type, override_id);
CREATE TABLE IF NOT EXISTS advocate_memory_sets (
    user_id     TEXT PRIMARY KEY,
    version     INTEGER     NOT NULL DEFAULT 1,
    forgotten   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    last_consolidation JSONB,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS advocate_memory_lines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT        NOT NULL,
    category    TEXT        NOT NULL,
    ord         INTEGER     NOT NULL DEFAULT 1,
    text        TEXT        NOT NULL,
    source_ref  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT advocate_memory_lines_category_check
        CHECK (category IN ('practice','clients','work_style','background')),
    CONSTRAINT advocate_memory_lines_text_len_check CHECK (char_length(text) <= 300),
    used_count   INTEGER     NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    CONSTRAINT advocate_memory_lines_set_fk
        FOREIGN KEY (user_id) REFERENCES advocate_memory_sets (user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_advocate_memory_lines_user
    ON advocate_memory_lines (user_id, ord);
CREATE INDEX IF NOT EXISTS idx_advocate_memory_lines_use
    ON advocate_memory_lines (user_id, used_count, last_used_at NULLS FIRST);
"""

# Tables purged when a case is deleted, in FK-safe order.
_CASE_TABLES: tuple[tuple[str, str], ...] = (
    ("case_memory_lines", "case_key"),
    ("case_memory_sections", "case_key"),
    ("case_instructions_history", "case_key"),
    ("case_instructions", "case_key"),
    ("memory_assembly_log", "case_key"),
    ("memory_proposals", "case_key"),
)
# Instruction rows a case owns, or that were switched off for it. Items follow
# their set through the FK; a universal instruction's per-case override is the
# case's row, not the instruction's.
_CASE_INSTRUCTION_PURGES: tuple[tuple[str, str], ...] = (
    ("memory_instructions", "scope_type = 'case' AND scope_id = ANY(%s::text[])"),
    ("memory_instruction_sets", "scope_type = 'case' AND scope_id = ANY(%s::text[])"),
    ("memory_instruction_overrides", "override_type = 'case' AND override_id = ANY(%s::text[])"),
)

# Tables whose case_key moves when an intake folder becomes a real case.
# case_memory_lines follows its section via ON UPDATE CASCADE.
_REBIND_TABLES: tuple[str, ...] = (
    "case_memory_sections",
    "case_instructions",
    "case_instructions_history",
    "memory_assembly_log",
    "memory_proposals",
)

_tables_ready = False
# Whether memory_assembly_log has the `details` column (migration 172). Settled
# the first time the tables are ensured; assumed present for a caller's own
# connection.
_details_column = True
# Whether memory_settings has `advocate_enabled` (migration 175). Settled like `_details_column`.
_advocate_column = True
# Whether advocate_memory_lines has `used_count`/`last_used_at` (migration 176). Until
# it does, facts are read without their use and nothing is counted; the panel then
# shows no use and eviction falls back to the oldest auto-learned fact.
_advocate_use_columns = True
# Whether advocate_memory_sets has `last_consolidation` (migration 177). Without it a
# merge cannot be undone, so consolidation stays switched off rather than run blind.
_advocate_consolidation_column = True

_PROPOSAL_STATUSES = frozenset({"pending", "accepted", "rejected"})


# ── Plumbing ─────────────────────────────────────────────────────────────────

def _require_case_key(case_key: str | None) -> str:
    """Refuse an empty key: a query without a case_key is a leak, not a wildcard."""
    key = str(case_key or "").strip()
    if not key:
        raise ValueError("case_key is required for every memory operation.")
    return key


def ensure_tables(conn: Any) -> None:
    global _tables_ready
    if _tables_ready:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(_ENSURE_SQL)
        conn.commit()
    except Exception as exc:  # noqa: BLE001 — a sibling process may be creating them
        conn.rollback()
        logger.debug("[Memory] DDL skipped: %s", exc)
    _ensure_details_column(conn)
    _ensure_advocate_column(conn)
    _ensure_advocate_use_columns(conn)
    _tables_ready = True


def _add_column(conn: Any, table: str, column: str, ddl: str) -> bool:
    """Add one column if this database has not had its migration yet. True when present."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = %s AND column_name = %s LIMIT 1",
                (table, column),
            )
            if cur.fetchone() is None:
                cur.execute("SET LOCAL lock_timeout = '2s'")
                cur.execute(ddl)
        conn.commit()
        return True
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        logger.warning("[Memory] %s.%s is unavailable until its migration is applied: %s", table, column, exc)
        return False


def _ensure_advocate_use_columns(conn: Any) -> None:
    """Give an advocate table created before migrations 176 and 177 its newer columns.

    Each is settled on its own, so a database that has one and not the other keeps the
    half it has.
    """
    global _advocate_use_columns, _advocate_consolidation_column
    _advocate_use_columns = _add_column(
        conn,
        "advocate_memory_lines",
        "used_count",
        "ALTER TABLE advocate_memory_lines "
        "ADD COLUMN IF NOT EXISTS used_count INTEGER NOT NULL DEFAULT 0, "
        "ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ",
    )
    _advocate_consolidation_column = _add_column(
        conn,
        "advocate_memory_sets",
        "last_consolidation",
        "ALTER TABLE advocate_memory_sets ADD COLUMN IF NOT EXISTS last_consolidation JSONB",
    )


def _ensure_advocate_column(conn: Any) -> None:
    """Give a settings table created before migration 175 its `advocate_enabled` switch.

    Same approach as `_ensure_details_column`: looked up first, and the ALTER waits
    at most two seconds for its lock. Until it can run, settings are read and written
    without the switch, which then counts as on.
    """
    global _advocate_column
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'memory_settings' AND column_name = 'advocate_enabled' LIMIT 1"
            )
            if cur.fetchone() is None:
                cur.execute("SET LOCAL lock_timeout = '2s'")
                cur.execute(
                    "ALTER TABLE memory_settings "
                    "ADD COLUMN IF NOT EXISTS advocate_enabled BOOLEAN NOT NULL DEFAULT TRUE"
                )
        conn.commit()
        _advocate_column = True
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        _advocate_column = False
        logger.warning("[Memory] the 'remember me across cases' switch is unsaved until migration 175 is applied: %s", exc)


def _settings_flags() -> tuple[str, ...]:
    """The settings columns this database has."""
    if _advocate_column:
        return SETTINGS_FLAGS
    return tuple(flag for flag in SETTINGS_FLAGS if flag != "advocate_enabled")


def _ensure_details_column(conn: Any) -> None:
    """Give a log table created before migration 172 its `details` column.

    Looked up first, so the usual case takes no lock at all. When the column is
    missing, the ALTER waits at most two seconds for its lock rather than
    queueing chat traffic behind it; if it cannot run, turn logs are written
    without details until the migration is applied.
    """
    global _details_column
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'memory_assembly_log' AND column_name = 'details' LIMIT 1"
            )
            if cur.fetchone() is None:
                cur.execute("SET LOCAL lock_timeout = '2s'")
                cur.execute(
                    "ALTER TABLE memory_assembly_log "
                    "ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb"
                )
        conn.commit()
        _details_column = True
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        _details_column = False
        logger.warning("[Memory] turn details are not logged until migration 172 is applied: %s", exc)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def _conn(existing: Any = None) -> Iterator[Any]:
    """Use the caller's connection when given one, else open (and close) our own."""
    if existing is not None:
        yield existing
        return
    with get_db_connection() as conn:
        ensure_tables(conn)
        yield conn


def available() -> bool:
    return is_db_available()


def _out(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    out = dict(row)
    for key, value in list(out.items()):
        if isinstance(value, uuid.UUID):
            out[key] = str(value)
        elif hasattr(value, "isoformat"):
            out[key] = value.isoformat()
        elif isinstance(value, list):
            out[key] = [str(v) if isinstance(v, uuid.UUID) else v for v in value]
    return out


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {})


# ── Layer 1: standing preferences ────────────────────────────────────────────

def get_preferences(user_id: str, *, conn: Any = None) -> dict[str, Any] | None:
    uid = str(user_id or "").strip()
    if not uid:
        return None
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT user_id, content, version, updated_by, updated_at "
            "FROM user_standing_preferences WHERE user_id = %s",
            (uid,),
        )
        return _out(cur.fetchone())


def put_preferences(
    user_id: str,
    content: str,
    expected_version: int | None,
    updated_by: str | None = None,
    *,
    conn: Any = None,
) -> dict[str, Any]:
    """Write preferences, keeping the previous text in the history table."""
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("user_id is required.")
    text = str(content or "")

    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT content, version FROM user_standing_preferences WHERE user_id = %s FOR UPDATE",
            (uid,),
        )
        current = cur.fetchone()

        if current is None:
            if expected_version not in (None, 0):
                raise VersionConflict("preferences", expected_version, None, [])
            cur.execute(
                "INSERT INTO user_standing_preferences (user_id, content, version, updated_by) "
                "VALUES (%s, %s, 1, %s) RETURNING user_id, content, version, updated_at",
                (uid, text, updated_by),
            )
            row = cur.fetchone()
            connection.commit()
            return _out(row) or {}

        current_version = int(current.get("version") or 1)
        if expected_version is not None and int(expected_version) != current_version:
            connection.rollback()
            raise VersionConflict("preferences", expected_version, current_version, [])

        cur.execute(
            "INSERT INTO user_standing_preferences_history (user_id, version, content, created_by) "
            "VALUES (%s, %s, %s, %s)",
            (uid, current_version, current.get("content") or "", updated_by),
        )
        cur.execute(
            "UPDATE user_standing_preferences SET content = %s, version = version + 1, "
            "updated_by = %s, updated_at = NOW() WHERE user_id = %s "
            "RETURNING user_id, content, version, updated_at",
            (text, updated_by, uid),
        )
        row = cur.fetchone()
        connection.commit()
        return _out(row) or {}


# ── Layer 2: case instructions ───────────────────────────────────────────────

def get_instructions(case_key: str, *, conn: Any = None) -> dict[str, Any] | None:
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT case_key, folder_name, content, version, updated_by, updated_at "
            "FROM case_instructions WHERE case_key = %s",
            (key,),
        )
        return _out(cur.fetchone())


def put_instructions(
    case_key: str,
    content: str,
    expected_version: int | None,
    updated_by: str | None = None,
    folder_name: str | None = None,
    *,
    conn: Any = None,
) -> dict[str, Any]:
    key = _require_case_key(case_key)
    text = str(content or "")

    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT content, version FROM case_instructions WHERE case_key = %s FOR UPDATE",
            (key,),
        )
        current = cur.fetchone()

        if current is None:
            if expected_version not in (None, 0):
                raise VersionConflict("instructions", expected_version, None, [])
            cur.execute(
                "INSERT INTO case_instructions (case_key, folder_name, content, version, updated_by) "
                "VALUES (%s, %s, %s, 1, %s) "
                "RETURNING case_key, folder_name, content, version, updated_at",
                (key, folder_name, text, updated_by),
            )
            row = cur.fetchone()
            connection.commit()
            return _out(row) or {}

        current_version = int(current.get("version") or 1)
        if expected_version is not None and int(expected_version) != current_version:
            connection.rollback()
            raise VersionConflict("instructions", expected_version, current_version, [])

        cur.execute(
            "INSERT INTO case_instructions_history (case_key, version, content, created_by) "
            "VALUES (%s, %s, %s, %s)",
            (key, current_version, current.get("content") or "", updated_by),
        )
        cur.execute(
            "UPDATE case_instructions SET content = %s, folder_name = COALESCE(%s, folder_name), "
            "version = version + 1, updated_by = %s, updated_at = NOW() WHERE case_key = %s "
            "RETURNING case_key, folder_name, content, version, updated_at",
            (text, folder_name, updated_by, key),
        )
        row = cur.fetchone()
        connection.commit()
        return _out(row) or {}


# ── Layer 3: case memory ─────────────────────────────────────────────────────

def get_section_index(case_key: str, *, conn: Any = None) -> list[dict[str, Any]]:
    """Section names, versions and line counts — what the model sees as an index."""
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            """
            SELECT s.section, s.version, s.updated_at,
                   COUNT(l.id)                        AS line_count,
                   COALESCE(SUM(char_length(l.text)), 0) AS char_count
            FROM case_memory_sections s
            LEFT JOIN case_memory_lines l
              ON l.case_key = s.case_key AND l.section = s.section
            WHERE s.case_key = %s
            GROUP BY s.section, s.version, s.updated_at
            """,
            (key,),
        )
        rows = [_out(row) or {} for row in cur.fetchall()]
    order = {name: i for i, name in enumerate(SECTIONS)}
    rows.sort(key=lambda r: order.get(str(r.get("section")), 99))
    for row in rows:
        row["line_count"] = int(row.get("line_count") or 0)
        row["char_count"] = int(row.get("char_count") or 0)
    return rows


def get_section(case_key: str, section: str, *, conn: Any = None) -> dict[str, Any] | None:
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT section, version, updated_at FROM case_memory_sections "
            "WHERE case_key = %s AND section = %s",
            (key, str(section)),
        )
        head = cur.fetchone()
        if head is None:
            return None
        cur.execute(
            "SELECT id, ord, tag, text, source_ref, created_by, created_at, updated_at "
            "FROM case_memory_lines WHERE case_key = %s AND section = %s ORDER BY ord ASC, created_at ASC",
            (key, str(section)),
        )
        lines = [_out(row) or {} for row in cur.fetchall()]
    out = _out(head) or {}
    out["lines"] = lines
    return out


def get_sections(
    case_key: str,
    sections: Iterable[str] | None = None,
    *,
    conn: Any = None,
) -> dict[str, dict[str, Any]]:
    """Several sections in one round trip. `sections=None` loads all of them."""
    key = _require_case_key(case_key)
    wanted = [str(s) for s in sections] if sections is not None else list(SECTIONS)
    if not wanted:
        return {}
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT section, version, updated_at FROM case_memory_sections "
            "WHERE case_key = %s AND section = ANY(%s::text[])",
            (key, wanted),
        )
        heads = {str(row.get("section")): _out(row) or {} for row in cur.fetchall()}
        if not heads:
            return {}
        cur.execute(
            "SELECT id, section, ord, tag, text, source_ref, created_at, updated_at "
            "FROM case_memory_lines WHERE case_key = %s AND section = ANY(%s::text[]) "
            "ORDER BY section ASC, ord ASC, created_at ASC",
            (key, list(heads.keys())),
        )
        for row in cur.fetchall():
            item = _out(row) or {}
            heads.setdefault(str(item.get("section")), {}).setdefault("lines", []).append(item)
    for head in heads.values():
        head.setdefault("lines", [])
    return heads


def _fetch_lines(cur: Any, case_key: str, section: str) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT id, ord, tag, text, source_ref FROM case_memory_lines "
        "WHERE case_key = %s AND section = %s ORDER BY ord ASC, created_at ASC",
        (case_key, section),
    )
    return [_out(row) or {} for row in cur.fetchall()]


def _current_version(cur: Any, case_key: str, section: str) -> int | None:
    cur.execute(
        "SELECT version FROM case_memory_sections WHERE case_key = %s AND section = %s",
        (case_key, section),
    )
    row = cur.fetchone()
    return int(row["version"]) if row else None


def _ensure_section(
    cur: Any,
    case_key: str,
    section: str,
    folder_name: str | None,
) -> int:
    """Create the section if absent; return its current version."""
    cur.execute(
        "INSERT INTO case_memory_sections (case_key, folder_name, section) VALUES (%s, %s, %s) "
        "ON CONFLICT (case_key, section) DO NOTHING RETURNING version",
        (case_key, folder_name, section),
    )
    row = cur.fetchone()
    if row is not None:
        return int(row["version"])
    version = _current_version(cur, case_key, section)
    return int(version or 1)


def _bump_version(cur: Any, case_key: str, section: str, expected_version: int | None) -> int:
    """Optimistic lock. Raises VersionConflict with the live content on a stale token."""
    if expected_version is None:
        cur.execute(
            "UPDATE case_memory_sections SET version = version + 1, updated_at = NOW() "
            "WHERE case_key = %s AND section = %s RETURNING version",
            (case_key, section),
        )
    else:
        cur.execute(
            "UPDATE case_memory_sections SET version = version + 1, updated_at = NOW() "
            "WHERE case_key = %s AND section = %s AND version = %s RETURNING version",
            (case_key, section, int(expected_version)),
        )
    row = cur.fetchone()
    if row is None:
        raise VersionConflict(
            section,
            expected_version,
            _current_version(cur, case_key, section),
            _fetch_lines(cur, case_key, section),
        )
    return int(row["version"])


def apply_op(
    case_key: str,
    op: ResolvedOp,
    expected_version: int | None = None,
    actor: str | None = None,
    folder_name: str | None = None,
    source_ref_extra: dict[str, Any] | None = None,
    *,
    conn: Any = None,
) -> dict[str, Any]:
    """Apply one validated memory operation under its version token.

    Returns `{section, version, line_id}`. Raises `VersionConflict` when the
    token is stale, `ValueError` for an unusable op.
    """
    key = _require_case_key(case_key)
    section = str(op.section)
    if section not in SECTIONS:
        raise ValueError(f"Unknown memory section '{section}'.")

    source_ref = dict(op.source_ref or {})
    if source_ref_extra:
        source_ref.update(source_ref_extra)

    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            if op.op == "create_section":
                cur.execute(
                    "INSERT INTO case_memory_sections (case_key, folder_name, section) "
                    "VALUES (%s, %s, %s) ON CONFLICT (case_key, section) DO NOTHING RETURNING version",
                    (key, folder_name, section),
                )
                created = cur.fetchone()
                if created is None:
                    raise VersionConflict(
                        section,
                        expected_version,
                        _current_version(cur, key, section),
                        _fetch_lines(cur, key, section),
                    )
                version = int(created["version"])
                _insert_lines(cur, key, section, op.lines, actor, source_ref)
                connection.commit()
                return {"section": section, "version": version, "line_id": None}

            if op.op == "delete_section":
                version = _current_version(cur, key, section)
                if version is None:
                    connection.rollback()
                    return {"section": section, "version": None, "line_id": None, "deleted": False}
                if expected_version is not None and int(expected_version) != version:
                    raise VersionConflict(section, expected_version, version, _fetch_lines(cur, key, section))
                cur.execute(
                    "DELETE FROM case_memory_lines WHERE case_key = %s AND section = %s",
                    (key, section),
                )
                cur.execute(
                    "DELETE FROM case_memory_sections WHERE case_key = %s AND section = %s",
                    (key, section),
                )
                connection.commit()
                return {"section": section, "version": None, "line_id": None, "deleted": True}

            # Every remaining op mutates lines inside an existing section.
            existing_version = _ensure_section(cur, key, section, folder_name)
            effective_expected = expected_version
            if effective_expected is not None and existing_version == 1 and expected_version == 0:
                # A caller that saw "no section" may send version 0; treat the
                # freshly created section as a match rather than a conflict.
                effective_expected = 1
            version = _bump_version(cur, key, section, effective_expected)

            line_id: str | None = None
            if op.op == "rewrite_section":
                cur.execute(
                    "DELETE FROM case_memory_lines WHERE case_key = %s AND section = %s",
                    (key, section),
                )
                _insert_lines(cur, key, section, op.lines, actor, source_ref)
            elif op.op == "append_line":
                line_id = _append_line(cur, key, section, op, actor, source_ref)
            elif op.op == "replace_line":
                line_id = _replace_line(cur, key, section, op, actor, source_ref)
            else:
                raise ValueError(f"Unknown memory operation '{op.op}'.")

            connection.commit()
            return {"section": section, "version": version, "line_id": line_id}
        except VersionConflict:
            connection.rollback()
            raise
        except Exception:
            connection.rollback()
            raise


def _next_ord(cur: Any, case_key: str, section: str) -> int:
    cur.execute(
        "SELECT COALESCE(MAX(ord), 0) + 1 AS next_ord FROM case_memory_lines "
        "WHERE case_key = %s AND section = %s",
        (case_key, section),
    )
    row = cur.fetchone()
    return int((row or {}).get("next_ord") or 1)


def _insert_lines(
    cur: Any,
    case_key: str,
    section: str,
    lines: Sequence[dict[str, Any]],
    actor: str | None,
    source_ref_extra: dict[str, Any],
) -> None:
    limit = MAX_SUMMARY_LINES if section == "summary" else MAX_SECTION_LINES
    for index, line in enumerate(list(lines)[:limit], start=1):
        ref = dict(line.get("source_ref") or {})
        ref.update(source_ref_extra)
        cur.execute(
            "INSERT INTO case_memory_lines (case_key, section, ord, tag, text, source_ref, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)",
            (case_key, section, index, str(line.get("tag") or "stated"), str(line.get("text") or ""), _json(ref), actor),
        )


def _append_line(
    cur: Any,
    case_key: str,
    section: str,
    op: ResolvedOp,
    actor: str | None,
    source_ref: dict[str, Any],
) -> str:
    cur.execute(
        "INSERT INTO case_memory_lines (case_key, section, ord, tag, text, source_ref, created_by) "
        "VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s) RETURNING id",
        (
            case_key,
            section,
            _next_ord(cur, case_key, section),
            op.tag,
            op.text,
            _json(source_ref),
            actor,
        ),
    )
    row = cur.fetchone()
    return str(row["id"])


def _replace_line(
    cur: Any,
    case_key: str,
    section: str,
    op: ResolvedOp,
    actor: str | None,
    source_ref: dict[str, Any],
) -> str | None:
    """Update one line; an empty replacement deletes it (guide 5.5)."""
    if not op.line_id:
        # Nothing to replace — fall back to an append so the fact is not lost.
        return _append_line(cur, case_key, section, op, actor, source_ref)

    if not str(op.text or "").strip():
        cur.execute(
            "DELETE FROM case_memory_lines WHERE id = %s::uuid AND case_key = %s AND section = %s",
            (str(op.line_id), case_key, section),
        )
        return None

    cur.execute(
        "UPDATE case_memory_lines SET tag = %s, text = %s, source_ref = %s::jsonb, "
        "created_by = COALESCE(%s, created_by), updated_at = NOW() "
        "WHERE id = %s::uuid AND case_key = %s AND section = %s RETURNING id",
        (op.tag, op.text, _json(source_ref), actor, str(op.line_id), case_key, section),
    )
    row = cur.fetchone()
    if row is None:
        # The line vanished under us (a concurrent delete); append instead.
        return _append_line(cur, case_key, section, op, actor, source_ref)
    return str(row["id"])


def delete_line(case_key: str, line_id: str, actor: str | None = None, *, conn: Any = None) -> bool:
    """Hard delete. 'Forget' means delete, never a softened 'previously believed'."""
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT section FROM case_memory_lines WHERE id = %s::uuid AND case_key = %s",
            (str(line_id), key),
        )
        row = cur.fetchone()
        if row is None:
            return False
        section = str(row["section"])
        cur.execute(
            "DELETE FROM case_memory_lines WHERE id = %s::uuid AND case_key = %s",
            (str(line_id), key),
        )
        cur.execute(
            "UPDATE case_memory_sections SET version = version + 1, updated_at = NOW() "
            "WHERE case_key = %s AND section = %s",
            (key, section),
        )
        connection.commit()
        return True


def delete_all(case_key: str, *, conn: Any = None) -> dict[str, int]:
    """Forget everything about one case (memory + instructions + proposals).

    Automatic seeding is switched off for the case in the same transaction, or
    the next chat would quietly refill what the advocate just asked JuriNex to
    forget. Filling it from the case details again is the advocate's call.
    """
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        counts = purge_case_keys(cur, [key])
        try:
            cur.execute("SAVEPOINT sp_memory_forget_mark")
            cur.execute(
                _SEED_META_UPSERT,
                (key, None, SEED_META_SECTION, _json({"auto_seed": False, "forgotten_at": _now_iso()})),
            )
            cur.execute("RELEASE SAVEPOINT sp_memory_forget_mark")
        except Exception as exc:  # noqa: BLE001 — the forget itself must still happen
            cur.execute("ROLLBACK TO SAVEPOINT sp_memory_forget_mark")
            logger.warning("[Memory] automatic seeding not paused after forget case_key=%s: %s", key, exc)
        connection.commit()
    return counts


def append_lines(
    case_key: str,
    section: str,
    lines: Sequence[dict[str, Any]],
    actor: str | None = None,
    folder_name: str | None = None,
    *,
    conn: Any = None,
) -> dict[str, Any]:
    """Append several already-validated lines to one section, in one transaction.

    Seeding and import write many lines at once; this costs one version bump
    instead of one per line. Lines beyond the section's cap are not written, and
    a full section is left untouched rather than having its version bumped for
    nothing. Returns `{section, version, added}`.
    """
    key = _require_case_key(case_key)
    name = str(section)
    if name not in SECTIONS:
        raise ValueError(f"Unknown memory section '{name}'.")
    items = [line for line in lines if str(line.get("text") or "").strip()]
    if not items:
        return {"section": name, "version": None, "added": 0}

    limit = MAX_SUMMARY_LINES if name == "summary" else MAX_SECTION_LINES
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            version = _ensure_section(cur, key, name, folder_name)
            room = max(0, limit - len(_fetch_lines(cur, key, name)))
            if room == 0:
                connection.rollback()
                logger.info("[Memory] append skipped: case_key=%s section=%s is full", key, name)
                return {"section": name, "version": version, "added": 0}

            version = _bump_version(cur, key, name, None)
            next_ord = _next_ord(cur, key, name)
            added = 0
            for line in items[:room]:
                cur.execute(
                    "INSERT INTO case_memory_lines (case_key, section, ord, tag, text, source_ref, created_by) "
                    "VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)",
                    (
                        key,
                        name,
                        next_ord + added,
                        str(line.get("tag") or "stated"),
                        str(line.get("text") or ""),
                        _json(dict(line.get("source_ref") or {})),
                        actor,
                    ),
                )
                added += 1
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"section": name, "version": version, "added": added}


def replace_case_memory(
    case_key: str,
    sections: dict[str, Sequence[dict[str, Any]]],
    actor: str | None = None,
    folder_name: str | None = None,
    *,
    conn: Any = None,
) -> dict[str, int]:
    """Replace every memory section of one case in a single transaction.

    Used by a replacing import. Instructions, settings, the assembly log and
    proposals are left alone: an import restores what JuriNex knows about the
    case, it does not rewrite the audit trail. Sections not named in `sections`
    end up empty. Returns `{section: lines written}`.
    """
    key = _require_case_key(case_key)
    written: dict[str, int] = {}
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute("DELETE FROM case_memory_lines WHERE case_key = %s", (key,))
            cur.execute("DELETE FROM case_memory_sections WHERE case_key = %s", (key,))
            for name in SECTIONS:
                lines = [line for line in (sections.get(name) or []) if str(line.get("text") or "").strip()]
                if not lines:
                    continue
                cur.execute(
                    "INSERT INTO case_memory_sections (case_key, folder_name, section) VALUES (%s, %s, %s) "
                    "ON CONFLICT (case_key, section) DO NOTHING RETURNING version",
                    (key, folder_name, name),
                )
                cur.fetchone()
                _insert_lines(cur, key, name, lines, actor, {})
                limit = MAX_SUMMARY_LINES if name == "summary" else MAX_SECTION_LINES
                written[name] = min(len(lines), limit)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return written


# ── Seeding bookkeeping ──────────────────────────────────────────────────────
# Kept in the summary section's `seed_meta`: when the case was last seeded and
# checked, a fingerprint of what seeding read, which seeded sources it wrote, and
# whether automatic seeding is allowed. Writing it never bumps a version.

SEED_META_SECTION = "summary"
_SEED_META_UPSERT = (
    "INSERT INTO case_memory_sections (case_key, folder_name, section, seed_meta) "
    "VALUES (%s, %s, %s, %s::jsonb) "
    "ON CONFLICT (case_key, section) DO UPDATE SET seed_meta = EXCLUDED.seed_meta"
)


def get_seed_meta(case_key: str, *, conn: Any = None) -> dict[str, Any]:
    """Seeding bookkeeping for one case; {} when it has never been seeded."""
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT seed_meta FROM case_memory_sections WHERE case_key = %s AND section = %s",
            (key, SEED_META_SECTION),
        )
        row = cur.fetchone()
    meta = row.get("seed_meta") if isinstance(row, dict) else None
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except ValueError:
            meta = None
    return dict(meta) if isinstance(meta, dict) else {}


def set_seed_meta(
    case_key: str,
    meta: dict[str, Any],
    folder_name: str | None = None,
    *,
    conn: Any = None,
) -> None:
    """Store seeding bookkeeping without touching the section's lines or version."""
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(_SEED_META_UPSERT, (key, folder_name, SEED_META_SECTION, _json(meta or {})))
        connection.commit()


# ── Purge / rebind (case lifecycle) ──────────────────────────────────────────

def purge_case_keys(cur: Any, keys: Sequence[str]) -> dict[str, int]:
    """Delete every memory row for these keys using the caller's cursor.

    Runs inside `folder_service.delete_case`'s transaction. Each statement is
    wrapped in a savepoint so a table that predates migration 170 cannot abort
    the case deletion itself.
    """
    clean = [str(k).strip() for k in keys if str(k or "").strip()]
    counts: dict[str, int] = {}
    if not clean:
        return counts
    statements = [(table, f"{column} = ANY(%s::text[])") for table, column in _CASE_TABLES]
    statements += list(_CASE_INSTRUCTION_PURGES)
    for table, where in statements:
        savepoint = f"sp_memory_{table}"
        try:
            cur.execute(f"SAVEPOINT {savepoint}")
            cur.execute(f"DELETE FROM {table} WHERE {where}", (clean,))
            counts[table] = counts.get(table, 0) + int(cur.rowcount or 0)
            cur.execute(f"RELEASE SAVEPOINT {savepoint}")
        except Exception as exc:  # noqa: BLE001
            cur.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
            logger.warning("[Memory] purge skipped table=%s error=%s", table, exc)
    try:
        cur.execute("SAVEPOINT sp_memory_settings")
        cur.execute(
            "DELETE FROM memory_settings WHERE scope_type = 'case' AND scope_id = ANY(%s::text[])",
            (clean,),
        )
        counts["memory_settings"] = int(cur.rowcount or 0)
        cur.execute("RELEASE SAVEPOINT sp_memory_settings")
    except Exception as exc:  # noqa: BLE001
        cur.execute("ROLLBACK TO SAVEPOINT sp_memory_settings")
        logger.warning("[Memory] purge skipped table=memory_settings error=%s", exc)
    return counts


def rebind_case_key(
    old_key: str,
    new_key: str,
    folder_name: str | None = None,
    *,
    conn: Any = None,
) -> dict[str, int]:
    """Move memory from an intake key (temp-*) to the real cases.id key.

    Refuses to merge: if the destination already has sections, the move is
    skipped and logged rather than silently mixing two cases' facts.
    """
    old = str(old_key or "").strip()
    new = str(new_key or "").strip()
    counts: dict[str, int] = {}
    if not old or not new or old == new:
        return counts

    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM case_memory_sections WHERE case_key = %s LIMIT 1",
            (new,),
        )
        if cur.fetchone() is not None:
            logger.warning(
                "[Memory] rebind skipped: destination case_key=%s already has memory (source=%s)",
                new,
                old,
            )
            connection.rollback()
            return counts

        for table in _REBIND_TABLES:
            try:
                if table in {"case_memory_sections", "case_instructions"}:
                    cur.execute(
                        f"UPDATE {table} SET case_key = %s, folder_name = COALESCE(%s, folder_name) "
                        f"WHERE case_key = %s",
                        (new, folder_name, old),
                    )
                else:
                    cur.execute(f"UPDATE {table} SET case_key = %s WHERE case_key = %s", (new, old))
                counts[table] = int(cur.rowcount or 0)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[Memory] rebind skipped table=%s error=%s", table, exc)

        # Lines follow their section via ON UPDATE CASCADE, but a deployment
        # without the FK (lazy DDL raced) needs the explicit move.
        try:
            cur.execute(
                "UPDATE case_memory_lines SET case_key = %s WHERE case_key = %s",
                (new, old),
            )
            moved = int(cur.rowcount or 0)
            if moved:
                counts["case_memory_lines"] = moved
        except Exception as exc:  # noqa: BLE001
            logger.debug("[Memory] line rebind not needed: %s", exc)

        try:
            cur.execute(
                "UPDATE memory_settings SET scope_id = %s "
                "WHERE scope_type = 'case' AND scope_id = %s",
                (new, old),
            )
            counts["memory_settings"] = int(cur.rowcount or 0)
        except Exception as exc:  # noqa: BLE001
            logger.debug("[Memory] settings rebind skipped: %s", exc)

        # Case instructions and the per-case overrides of universal ones. The
        # set moves only when the destination has none, like memory sections.
        try:
            cur.execute(
                "SELECT 1 FROM memory_instruction_sets WHERE scope_type = 'case' AND scope_id = %s LIMIT 1",
                (new,),
            )
            if cur.fetchone() is None:
                cur.execute(
                    "UPDATE memory_instruction_sets SET scope_id = %s "
                    "WHERE scope_type = 'case' AND scope_id = %s",
                    (new, old),
                )
                counts["memory_instruction_sets"] = int(cur.rowcount or 0)
                cur.execute(
                    "UPDATE memory_instructions SET scope_id = %s WHERE scope_type = 'case' AND scope_id = %s",
                    (new, old),
                )
                moved = int(cur.rowcount or 0)
                if moved:
                    counts["memory_instructions"] = moved
            cur.execute(
                "UPDATE memory_instruction_overrides SET override_id = %s "
                "WHERE override_type = 'case' AND override_id = %s",
                (new, old),
            )
            counts["memory_instruction_overrides"] = int(cur.rowcount or 0)
        except Exception as exc:  # noqa: BLE001
            logger.debug("[Memory] instruction rebind skipped: %s", exc)

        connection.commit()
    logger.info("[Memory] rebind %s -> %s moved=%s", old, new, counts)
    return counts


# ── Instructions: one item per row, at universal ("user") or case scope ──────
# The set row holds the version token, exactly like a memory section; every
# item write goes through it. Reading a scope for the first time moves any text
# saved in the old one-box tables across as items, so nothing the advocate wrote
# is lost when this replaces the text boxes.

_INSTRUCTION_COLUMNS = "id, ord, text, enabled, origin, source_ref, created_by, created_at, updated_at"
_LEGACY_INSTRUCTION_SOURCES: dict[str, tuple[str, str]] = {
    "case": ("case_instructions", "case_key"),
    "user": ("user_standing_preferences", "user_id"),
}


def _require_scope(scope_type: str, scope_id: str | None) -> tuple[str, str]:
    kind = str(scope_type or "").strip()
    if kind not in INSTRUCTION_SCOPES:
        raise ValueError(f"Unknown instruction scope '{scope_type}'.")
    sid = str(scope_id or "").strip()
    if not sid:
        raise ValueError("scope_id is required for every instruction operation.")
    return kind, sid


def _fetch_instructions(cur: Any, kind: str, sid: str) -> list[dict[str, Any]]:
    cur.execute(
        f"SELECT {_INSTRUCTION_COLUMNS} FROM memory_instructions "
        "WHERE scope_type = %s AND scope_id = %s ORDER BY ord ASC, created_at ASC",
        (kind, sid),
    )
    return [_out(row) or {} for row in cur.fetchall()]


def _instruction_set_version(cur: Any, kind: str, sid: str) -> int | None:
    cur.execute(
        "SELECT version FROM memory_instruction_sets WHERE scope_type = %s AND scope_id = %s",
        (kind, sid),
    )
    row = cur.fetchone()
    return int(row["version"]) if row else None


def _legacy_instruction_text(cur: Any, kind: str, sid: str) -> str:
    """Text from the one-box table this scope used before items existed."""
    table, column = _LEGACY_INSTRUCTION_SOURCES[kind]
    try:
        cur.execute("SAVEPOINT sp_memory_legacy_read")
        cur.execute(f"SELECT content FROM {table} WHERE {column} = %s", (sid,))
        row = cur.fetchone()
        cur.execute("RELEASE SAVEPOINT sp_memory_legacy_read")
    except Exception as exc:  # noqa: BLE001 — the old table may be absent on a fresh deployment
        cur.execute("ROLLBACK TO SAVEPOINT sp_memory_legacy_read")
        logger.debug("[Memory] no legacy instructions for %s/%s: %s", kind, sid, exc)
        return ""
    return str((row or {}).get("content") or "")


def _ensure_instruction_set(cur: Any, kind: str, sid: str, actor: str | None) -> int:
    """Create the set if absent, moving legacy text into it; return the version."""
    version = _instruction_set_version(cur, kind, sid)
    if version is not None:
        return version
    cur.execute(
        "INSERT INTO memory_instruction_sets (scope_type, scope_id, updated_by) VALUES (%s, %s, %s) "
        "ON CONFLICT (scope_type, scope_id) DO NOTHING RETURNING version",
        (kind, sid, actor),
    )
    row = cur.fetchone()
    if row is None:
        return int(_instruction_set_version(cur, kind, sid) or 1)
    for index, text in enumerate(split_instruction_text(_legacy_instruction_text(cur, kind, sid)), start=1):
        cur.execute(
            "INSERT INTO memory_instructions (scope_type, scope_id, ord, text, enabled, origin, source_ref, created_by) "
            "VALUES (%s, %s, %s, %s, TRUE, 'migrated', '{}'::jsonb, %s)",
            (kind, sid, index, text[:MAX_INSTRUCTION_ITEM_CHARS], "migration"),
        )
    return int(row["version"])


def _bump_instruction_set(cur: Any, kind: str, sid: str, expected_version: int | None) -> int:
    """Optimistic lock on the set. Raises VersionConflict carrying the live items."""
    if expected_version is None:
        cur.execute(
            "UPDATE memory_instruction_sets SET version = version + 1, updated_at = NOW() "
            "WHERE scope_type = %s AND scope_id = %s RETURNING version",
            (kind, sid),
        )
    else:
        cur.execute(
            "UPDATE memory_instruction_sets SET version = version + 1, updated_at = NOW() "
            "WHERE scope_type = %s AND scope_id = %s AND version = %s RETURNING version",
            (kind, sid, int(expected_version)),
        )
    row = cur.fetchone()
    if row is None:
        raise VersionConflict(
            f"instructions:{kind}",
            expected_version,
            _instruction_set_version(cur, kind, sid),
            _fetch_instructions(cur, kind, sid),
        )
    return int(row["version"])


def get_instruction_set(scope_type: str, scope_id: str, *, conn: Any = None) -> dict[str, Any]:
    """The items of one scope with the set's version; `version` is None when nothing is stored."""
    kind, sid = _require_scope(scope_type, scope_id)
    with _conn(conn) as connection, connection.cursor() as cur:
        version = _instruction_set_version(cur, kind, sid)
        if version is None:
            if not split_instruction_text(_legacy_instruction_text(cur, kind, sid)):
                return {"scope_type": kind, "scope_id": sid, "version": None, "items": []}
            try:
                version = _ensure_instruction_set(cur, kind, sid, "migration")
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        items = _fetch_instructions(cur, kind, sid)
    return {"scope_type": kind, "scope_id": sid, "version": version, "items": items}


def _next_instruction_ord(cur: Any, kind: str, sid: str) -> int:
    cur.execute(
        "SELECT COALESCE(MAX(ord), 0) + 1 AS next_ord FROM memory_instructions "
        "WHERE scope_type = %s AND scope_id = %s",
        (kind, sid),
    )
    row = cur.fetchone()
    return int((row or {}).get("next_ord") or 1)


def _insert_instruction(
    cur: Any,
    kind: str,
    sid: str,
    ord_: int,
    text: str,
    *,
    enabled: bool,
    origin: str,
    source_ref: dict[str, Any] | None,
    actor: str | None,
) -> dict[str, Any]:
    if origin not in INSTRUCTION_ORIGINS:
        raise ValueError(f"Unknown instruction origin '{origin}'.")
    cur.execute(
        "INSERT INTO memory_instructions (scope_type, scope_id, ord, text, enabled, origin, source_ref, created_by) "
        f"VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s) RETURNING {_INSTRUCTION_COLUMNS}",
        (kind, sid, ord_, text, bool(enabled), origin, _json(source_ref or {}), actor),
    )
    return _out(cur.fetchone()) or {}


def _clean_instruction_text(text: str) -> str:
    body = " ".join(str(text or "").split())
    if not body:
        raise ValueError("An instruction needs some text.")
    return body[:MAX_INSTRUCTION_ITEM_CHARS]


def add_instruction(
    scope_type: str,
    scope_id: str,
    text: str,
    expected_version: int | None = None,
    *,
    enabled: bool = True,
    origin: str = "user",
    source_ref: dict[str, Any] | None = None,
    actor: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """Append one instruction under the set's version token. Returns {version, item}."""
    kind, sid = _require_scope(scope_type, scope_id)
    body = _clean_instruction_text(text)
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            existing = _ensure_instruction_set(cur, kind, sid, actor)
            effective = expected_version
            if effective is not None and existing == 1 and expected_version == 0:
                # A caller that saw "nothing stored" may send 0 for a set created just now.
                effective = 1
            version = _bump_instruction_set(cur, kind, sid, effective)
            item = _insert_instruction(
                cur, kind, sid, _next_instruction_ord(cur, kind, sid), body,
                enabled=enabled, origin=origin, source_ref=source_ref, actor=actor,
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"version": version, "item": item}


def append_instructions(
    scope_type: str,
    scope_id: str,
    items: Sequence[dict[str, Any]],
    *,
    actor: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """Append several instructions with one version bump (import, migration)."""
    kind, sid = _require_scope(scope_type, scope_id)
    rows = [item for item in items if str(item.get("text") or "").strip()]
    if not rows:
        return {"version": None, "added": 0}
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            _ensure_instruction_set(cur, kind, sid, actor)
            room = max(0, MAX_INSTRUCTION_ITEMS - len(_fetch_instructions(cur, kind, sid)))
            if room == 0:
                connection.rollback()
                return {"version": _instruction_set_version(cur, kind, sid), "added": 0}
            version = _bump_instruction_set(cur, kind, sid, None)
            next_ord = _next_instruction_ord(cur, kind, sid)
            added = 0
            for item in rows[:room]:
                _insert_instruction(
                    cur, kind, sid, next_ord + added, _clean_instruction_text(item.get("text")),
                    enabled=bool(item.get("enabled", True)),
                    origin=str(item.get("origin") or "import"),
                    source_ref=dict(item.get("source_ref") or {}),
                    actor=actor,
                )
                added += 1
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"version": version, "added": added}


def update_instruction(
    scope_type: str,
    scope_id: str,
    instruction_id: str,
    expected_version: int | None = None,
    *,
    text: str | None = None,
    enabled: bool | None = None,
    source_ref_extra: dict[str, Any] | None = None,
    actor: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """Change an item's text or switch. Raises LookupError when the item is not in this scope."""
    kind, sid = _require_scope(scope_type, scope_id)
    body = _clean_instruction_text(text) if text is not None else None
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute(
                "SELECT 1 FROM memory_instructions WHERE id = %s::uuid AND scope_type = %s AND scope_id = %s",
                (str(instruction_id), kind, sid),
            )
            if cur.fetchone() is None:
                connection.rollback()
                raise LookupError("That instruction no longer exists.")
            version = _bump_instruction_set(cur, kind, sid, expected_version)
            cur.execute(
                "UPDATE memory_instructions SET text = COALESCE(%s, text), enabled = COALESCE(%s, enabled), "
                "source_ref = source_ref || %s::jsonb, updated_at = NOW() "
                f"WHERE id = %s::uuid AND scope_type = %s AND scope_id = %s RETURNING {_INSTRUCTION_COLUMNS}",
                (body, enabled, _json(source_ref_extra or {}), str(instruction_id), kind, sid),
            )
            item = _out(cur.fetchone()) or {}
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"version": version, "item": item}


def delete_instruction(
    scope_type: str,
    scope_id: str,
    instruction_id: str,
    expected_version: int | None = None,
    *,
    actor: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """Remove one item (its overrides go with it). Returns {version, deleted, item}."""
    kind, sid = _require_scope(scope_type, scope_id)
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute(
                f"SELECT {_INSTRUCTION_COLUMNS} FROM memory_instructions "
                "WHERE id = %s::uuid AND scope_type = %s AND scope_id = %s",
                (str(instruction_id), kind, sid),
            )
            row = cur.fetchone()
            if row is None:
                version = _instruction_set_version(cur, kind, sid)
                connection.rollback()
                return {"version": version, "deleted": False, "item": None}
            version = _bump_instruction_set(cur, kind, sid, expected_version)
            cur.execute(
                "DELETE FROM memory_instructions WHERE id = %s::uuid AND scope_type = %s AND scope_id = %s",
                (str(instruction_id), kind, sid),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"version": version, "deleted": True, "item": _out(row)}


def replace_instruction_set(
    scope_type: str,
    scope_id: str,
    items: Sequence[dict[str, Any]],
    expected_version: int | None = None,
    *,
    actor: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """Swap every item of one scope for `items`, in one transaction."""
    kind, sid = _require_scope(scope_type, scope_id)
    rows = [item for item in items if str(item.get("text") or "").strip()][:MAX_INSTRUCTION_ITEMS]
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            _ensure_instruction_set(cur, kind, sid, actor)
            version = _bump_instruction_set(cur, kind, sid, expected_version)
            cur.execute(
                "DELETE FROM memory_instructions WHERE scope_type = %s AND scope_id = %s",
                (kind, sid),
            )
            written: list[dict[str, Any]] = []
            for index, item in enumerate(rows, start=1):
                written.append(
                    _insert_instruction(
                        cur, kind, sid, index, _clean_instruction_text(item.get("text")),
                        enabled=bool(item.get("enabled", True)),
                        origin=str(item.get("origin") or "user"),
                        source_ref=dict(item.get("source_ref") or {}),
                        actor=actor,
                    )
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"version": version, "items": written}


def get_instruction_overrides(
    instruction_ids: Sequence[str],
    *,
    case_key: str | None = None,
    session_id: str | None = None,
    conn: Any = None,
) -> dict[str, dict[str, bool | None]]:
    """Per-case and per-session switches for these items: {id: {"case": bool|None, "session": bool|None}}."""
    ids = [str(i) for i in instruction_ids if str(i or "").strip()]
    case = str(case_key or "").strip()
    session = str(session_id or "").strip()
    out: dict[str, dict[str, bool | None]] = {i: {"case": None, "session": None} for i in ids}
    if not ids or not (case or session):
        return out
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT instruction_id::text AS instruction_id, override_type, enabled "
            "FROM memory_instruction_overrides WHERE instruction_id = ANY(%s::uuid[]) "
            "AND ((override_type = 'case' AND override_id = %s) OR (override_type = 'session' AND override_id = %s))",
            (ids, case or "", session or ""),
        )
        for row in cur.fetchall():
            slot = out.setdefault(str(row.get("instruction_id")), {"case": None, "session": None})
            slot[str(row.get("override_type"))] = bool(row.get("enabled"))
    return out


def set_instruction_override(
    instruction_id: str,
    override_type: str,
    override_id: str,
    enabled: bool | None,
    *,
    actor: str | None = None,
    conn: Any = None,
) -> None:
    """Switch one item off (or on) for one case or session; `enabled=None` clears the override."""
    kind = str(override_type or "").strip()
    if kind not in OVERRIDE_TYPES:
        raise ValueError(f"Unknown override type '{override_type}'.")
    target = str(override_id or "").strip()
    if not target:
        raise ValueError("override_id is required.")
    with _conn(conn) as connection, connection.cursor() as cur:
        if enabled is None:
            cur.execute(
                "DELETE FROM memory_instruction_overrides "
                "WHERE instruction_id = %s::uuid AND override_type = %s AND override_id = %s",
                (str(instruction_id), kind, target),
            )
        else:
            cur.execute(
                "INSERT INTO memory_instruction_overrides (instruction_id, override_type, override_id, enabled, created_by) "
                "VALUES (%s::uuid, %s, %s, %s, %s) "
                "ON CONFLICT (instruction_id, override_type, override_id) "
                "DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()",
                (str(instruction_id), kind, target, bool(enabled), actor),
            )
        connection.commit()


# ── About the advocate: facts remembered across all of their cases ───────────
# One set per advocate. The set row holds the version token (like an instruction
# set) and the facts the advocate deleted after JuriNex learned them from chat, so
# the writer does not learn them again. Keyed by user id only: nothing here
# belongs to a case, and deleting a case leaves it alone.

_ADVOCATE_BASE_COLUMNS = "id, category, ord, text, source_ref, created_by, created_at, updated_at"


def _advocate_columns() -> str:
    """The fact columns this database has: with use counters once migration 176 is in."""
    if _advocate_use_columns:
        return f"{_ADVOCATE_BASE_COLUMNS}, used_count, last_used_at"
    return _ADVOCATE_BASE_COLUMNS


def _require_user(user_id: str | None) -> str:
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("user_id is required for every advocate memory operation.")
    return uid


def _clean_advocate_text(text: str) -> str:
    body = " ".join(str(text or "").split())
    if not body:
        raise ValueError("A remembered fact needs some text.")
    return body[:MAX_LINE_CHARS]


def _require_category(category: str | None) -> str:
    value = str(category or "").strip()
    if value not in ADVOCATE_CATEGORIES:
        raise ValueError(f"Unknown category '{category}'.")
    return value


def _fetch_advocate_lines(cur: Any, uid: str) -> list[dict[str, Any]]:
    cur.execute(
        f"SELECT {_advocate_columns()} FROM advocate_memory_lines WHERE user_id = %s ORDER BY ord ASC, created_at ASC",
        (uid,),
    )
    return [_out(row) or {} for row in cur.fetchall()]


def _advocate_set(cur: Any, uid: str) -> dict[str, Any] | None:
    cur.execute("SELECT version, forgotten FROM advocate_memory_sets WHERE user_id = %s", (uid,))
    return cur.fetchone()


def _forgotten_list(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return [str(item) for item in value if str(item or "").strip()] if isinstance(value, list) else []


def _ensure_advocate_set(cur: Any, uid: str, actor: str | None) -> int:
    cur.execute(
        "INSERT INTO advocate_memory_sets (user_id, updated_by) VALUES (%s, %s) "
        "ON CONFLICT (user_id) DO NOTHING RETURNING version",
        (uid, actor),
    )
    row = cur.fetchone()
    if row is not None:
        return int(row["version"])
    existing = _advocate_set(cur, uid)
    return int((existing or {}).get("version") or 1)


def _bump_advocate_set(cur: Any, uid: str, expected_version: int | None) -> int:
    """Optimistic lock on the advocate's set. Raises VersionConflict carrying the live lines."""
    if expected_version is None:
        cur.execute(
            "UPDATE advocate_memory_sets SET version = version + 1, updated_at = NOW() "
            "WHERE user_id = %s RETURNING version",
            (uid,),
        )
    else:
        cur.execute(
            "UPDATE advocate_memory_sets SET version = version + 1, updated_at = NOW() "
            "WHERE user_id = %s AND version = %s RETURNING version",
            (uid, int(expected_version)),
        )
    row = cur.fetchone()
    if row is None:
        current = _advocate_set(cur, uid)
        raise VersionConflict(
            "advocate",
            expected_version,
            int(current["version"]) if current else None,
            _fetch_advocate_lines(cur, uid),
        )
    return int(row["version"])


def get_advocate_memory(user_id: str, *, conn: Any = None) -> dict[str, Any]:
    """Everything remembered about one advocate; `version` is None when nothing is stored."""
    uid = _require_user(user_id)
    with _conn(conn) as connection, connection.cursor() as cur:
        head = _advocate_set(cur, uid)
        if head is None:
            return {"user_id": uid, "version": None, "lines": [], "forgotten": []}
        lines = _fetch_advocate_lines(cur, uid)
    return {
        "user_id": uid,
        "version": int(head.get("version") or 1),
        "lines": lines,
        "forgotten": _forgotten_list(head.get("forgotten")),
    }


def add_advocate_line(
    user_id: str,
    category: str,
    text: str,
    expected_version: int | None = None,
    *,
    source_ref: dict[str, Any] | None = None,
    actor: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """Remember one fact about the advocate under the set's version token. Returns {version, line}."""
    uid = _require_user(user_id)
    kind = _require_category(category)
    body = _clean_advocate_text(text)
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            existing = _ensure_advocate_set(cur, uid, actor)
            effective = expected_version
            if effective is not None and existing == 1 and expected_version == 0:
                effective = 1
            version = _bump_advocate_set(cur, uid, effective)
            cur.execute("SELECT COUNT(*) AS n, COALESCE(MAX(ord), 0) + 1 AS next_ord FROM advocate_memory_lines WHERE user_id = %s", (uid,))
            counts = cur.fetchone() or {}
            if int(counts.get("n") or 0) >= MAX_ADVOCATE_LINES:
                raise ValueError(f"At most {MAX_ADVOCATE_LINES} facts about the advocate are kept.")
            cur.execute(
                "INSERT INTO advocate_memory_lines (user_id, category, ord, text, source_ref, created_by) "
                f"VALUES (%s, %s, %s, %s, %s::jsonb, %s) RETURNING {_advocate_columns()}",
                (uid, kind, int(counts.get("next_ord") or 1), body, _json(source_ref or {}), actor),
            )
            line = _out(cur.fetchone()) or {}
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"version": version, "line": line}


def update_advocate_line(
    user_id: str,
    line_id: str,
    expected_version: int | None = None,
    *,
    text: str | None = None,
    category: str | None = None,
    source_ref_extra: dict[str, Any] | None = None,
    actor: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """Change one fact's text or category. Raises LookupError when it is not this advocate's."""
    uid = _require_user(user_id)
    body = _clean_advocate_text(text) if text is not None else None
    kind = _require_category(category) if category is not None else None
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute(
                "SELECT 1 FROM advocate_memory_lines WHERE id = %s::uuid AND user_id = %s",
                (str(line_id), uid),
            )
            if cur.fetchone() is None:
                connection.rollback()
                raise LookupError("That fact is no longer remembered.")
            version = _bump_advocate_set(cur, uid, expected_version)
            cur.execute(
                "UPDATE advocate_memory_lines SET text = COALESCE(%s, text), category = COALESCE(%s, category), "
                "source_ref = source_ref || %s::jsonb, updated_at = NOW() "
                f"WHERE id = %s::uuid AND user_id = %s RETURNING {_advocate_columns()}",
                (body, kind, _json(source_ref_extra or {}), str(line_id), uid),
            )
            line = _out(cur.fetchone()) or {}
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"version": version, "line": line}


def delete_advocate_line(
    user_id: str,
    line_id: str,
    expected_version: int | None = None,
    *,
    actor: str | None = None,
    remember_as_forgotten: bool = True,
    conn: Any = None,
) -> dict[str, Any]:
    """Forget one fact. One JuriNex learned from chat is kept on the forgotten list so it is not learned again.

    `remember_as_forgotten=False` skips that list. Eviction uses it: a fact dropped to
    make room was not rejected by the advocate, so JuriNex may learn it again once
    there is space.

    Returns {version, deleted, line}.
    """
    uid = _require_user(user_id)
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute(
                f"SELECT {_advocate_columns()} FROM advocate_memory_lines WHERE id = %s::uuid AND user_id = %s",
                (str(line_id), uid),
            )
            row = cur.fetchone()
            if row is None:
                head = _advocate_set(cur, uid)
                connection.rollback()
                return {"version": int(head["version"]) if head else None, "deleted": False, "line": None}
            version = _bump_advocate_set(cur, uid, expected_version)
            cur.execute("DELETE FROM advocate_memory_lines WHERE id = %s::uuid AND user_id = %s", (str(line_id), uid))
            ref = row.get("source_ref") if isinstance(row.get("source_ref"), dict) else {}
            if remember_as_forgotten and str((ref or {}).get("kind") or "") == "chat":
                head = _advocate_set(cur, uid) or {}
                forgotten = [*_forgotten_list(head.get("forgotten")), str(row.get("text") or "")]
                cur.execute(
                    "UPDATE advocate_memory_sets SET forgotten = %s::jsonb WHERE user_id = %s",
                    (json.dumps(forgotten[-MAX_ADVOCATE_FORGOTTEN:]), uid),
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"version": version, "deleted": True, "line": _out(row)}


def delete_advocate_memory(user_id: str, *, conn: Any = None) -> int:
    """Forget everything remembered about the advocate, the forgotten list included. Returns lines deleted."""
    uid = _require_user(user_id)
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute("DELETE FROM advocate_memory_lines WHERE user_id = %s", (uid,))
            count = int(cur.rowcount or 0)
            cur.execute("DELETE FROM advocate_memory_sets WHERE user_id = %s", (uid,))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return count


def consolidation_supported() -> bool:
    """Whether this database can keep the set before a merge, so a merge can be undone."""
    return _advocate_consolidation_column


def _snapshot_rows(lines: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """The parts of a fact worth putting back: what it says, and where it came from."""
    return [
        {
            "category": str(line.get("category") or ""),
            "text": str(line.get("text") or ""),
            "source_ref": line.get("source_ref") if isinstance(line.get("source_ref"), dict) else {},
            "created_by": line.get("created_by"),
            "used_count": int(line.get("used_count") or 0),
        }
        for line in lines
        if str(line.get("text") or "").strip()
    ]


def replace_advocate_lines(
    user_id: str,
    lines: Sequence[dict[str, Any]],
    expected_version: int | None = None,
    *,
    snapshot: Sequence[dict[str, Any]] | None = None,
    snapshot_meta: dict[str, Any] | None = None,
    actor: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """Swap the whole set for a new one in a single transaction.

    Consolidation uses this. `snapshot` is the set as it stood beforehand, kept on the
    set row so one press puts it back; passing None clears any snapshot, which is what
    undo itself does. Returns {version, lines}.
    """
    uid = _require_user(user_id)
    rows = [
        (str(line.get("category") or ""), " ".join(str(line.get("text") or "").split()))
        for line in lines
    ]
    rows = [(category, text) for category, text in rows if text and category in ADVOCATE_CATEGORIES]
    if not rows:
        raise ValueError("A replacement set needs at least one fact.")

    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            _ensure_advocate_set(cur, uid, actor)
            version = _bump_advocate_set(cur, uid, expected_version)
            cur.execute("DELETE FROM advocate_memory_lines WHERE user_id = %s", (uid,))
            for position, (category, text) in enumerate(rows, 1):
                cur.execute(
                    "INSERT INTO advocate_memory_lines (user_id, category, ord, text, source_ref, created_by) "
                    "VALUES (%s, %s, %s, %s, %s::jsonb, %s)",
                    (uid, category, position, text[:MAX_LINE_CHARS], json.dumps({"kind": "consolidated"}), actor),
                )
            if _advocate_consolidation_column:
                record = (
                    json.dumps({**(snapshot_meta or {}), "before": _snapshot_rows(snapshot)})
                    if snapshot is not None
                    else None
                )
                cur.execute(
                    "UPDATE advocate_memory_sets SET last_consolidation = %s::jsonb WHERE user_id = %s",
                    (record, uid),
                )
            fresh = _fetch_advocate_lines(cur, uid)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"version": version, "lines": fresh}


def get_advocate_consolidation(user_id: str, *, conn: Any = None) -> dict[str, Any] | None:
    """The record of the last merge, or None when there is nothing to undo."""
    uid = _require_user(user_id)
    if not _advocate_consolidation_column:
        return None
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute("SELECT last_consolidation FROM advocate_memory_sets WHERE user_id = %s", (uid,))
        row = cur.fetchone()
    value = (row or {}).get("last_consolidation") if row else None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    return value if isinstance(value, dict) and value.get("before") else None


def undo_advocate_consolidation(
    user_id: str,
    expected_version: int | None = None,
    *,
    actor: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """Put the set back as it was before the last merge. Returns {version, lines, restored}."""
    uid = _require_user(user_id)
    record = get_advocate_consolidation(uid, conn=conn)
    before = list((record or {}).get("before") or [])
    if not before:
        current = get_advocate_memory(uid, conn=conn)
        return {"version": current.get("version"), "lines": current.get("lines") or [], "restored": 0}

    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            version = _bump_advocate_set(cur, uid, expected_version)
            cur.execute("DELETE FROM advocate_memory_lines WHERE user_id = %s", (uid,))
            for position, line in enumerate(before, 1):
                category = str(line.get("category") or "")
                text = " ".join(str(line.get("text") or "").split())
                if not text or category not in ADVOCATE_CATEGORIES:
                    continue
                ref = line.get("source_ref") if isinstance(line.get("source_ref"), dict) else {}
                values = [uid, category, position, text[:MAX_LINE_CHARS], json.dumps(ref), line.get("created_by")]
                columns = "user_id, category, ord, text, source_ref, created_by"
                placeholders = "%s, %s, %s, %s, %s::jsonb, %s"
                if _advocate_use_columns:
                    # A restored fact keeps the work it had already done.
                    columns += ", used_count"
                    placeholders += ", %s"
                    values.append(int(line.get("used_count") or 0))
                cur.execute(
                    f"INSERT INTO advocate_memory_lines ({columns}) VALUES ({placeholders})", tuple(values)
                )
            if _advocate_consolidation_column:
                cur.execute(
                    "UPDATE advocate_memory_sets SET last_consolidation = NULL WHERE user_id = %s", (uid,)
                )
            fresh = _fetch_advocate_lines(cur, uid)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"version": version, "lines": fresh, "restored": len(fresh)}


def record_advocate_use(user_id: str, line_ids: Sequence[str], *, conn: Any = None) -> int:
    """Count one turn's use against the facts it carried. Returns how many were counted.

    Called on the writer's thread after the answer, never in the chat's critical path.
    A database without migration 176 counts nothing and says so once.
    """
    uid = _require_user(user_id)
    ids = [str(value).strip() for value in line_ids if str(value or "").strip()]
    if not ids or not _advocate_use_columns:
        return 0
    with _conn(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute(
                "UPDATE advocate_memory_lines "
                "SET used_count = used_count + 1, last_used_at = NOW() "
                "WHERE user_id = %s AND id = ANY(%s::uuid[])",
                (uid, ids),
            )
            counted = int(cur.rowcount or 0)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return counted


def least_useful_advocate_lines(
    user_id: str,
    *,
    created_by: str,
    limit: int = 5,
    conn: Any = None,
) -> list[dict[str, Any]]:
    """Facts JuriNex learned by itself, least useful first.

    `created_by` narrows this to the writer's own actor, so a fact the advocate typed
    or edited is never a candidate: automatic memory manages its own space, and what a
    person put there is theirs to remove. Never-used facts come out first, then the
    least used, then the longest unused, then the oldest.
    """
    uid = _require_user(user_id)
    actor = str(created_by or "").strip()
    if not actor or limit <= 0:
        return []
    order = (
        "used_count ASC, last_used_at ASC NULLS FIRST, created_at ASC"
        if _advocate_use_columns
        else "created_at ASC"
    )
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            f"SELECT {_advocate_columns()} FROM advocate_memory_lines "
            f"WHERE user_id = %s AND created_by = %s ORDER BY {order} LIMIT %s",
            (uid, actor, int(limit)),
        )
        return [_out(row) or {} for row in cur.fetchall()]


# ── Settings ─────────────────────────────────────────────────────────────────

def get_settings(scope_type: str, scope_id: str, *, conn: Any = None) -> dict[str, Any] | None:
    sid = str(scope_id or "").strip()
    if not sid:
        return None
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            f"SELECT scope_type, scope_id, {', '.join(_settings_flags())}, updated_by, updated_at "
            "FROM memory_settings WHERE scope_type = %s AND scope_id = %s",
            (str(scope_type), sid),
        )
        return _out(cur.fetchone())


def put_settings(
    scope_type: str,
    scope_id: str,
    flags: dict[str, bool],
    updated_by: str | None = None,
    *,
    conn: Any = None,
) -> dict[str, Any]:
    sid = str(scope_id or "").strip()
    if not sid:
        raise ValueError("scope_id is required.")
    if str(scope_type) not in {"user", "case", "firm"}:
        raise ValueError(f"Unknown settings scope '{scope_type}'.")

    current = MemorySettings()
    values = {flag: bool(flags.get(flag, getattr(current, flag))) for flag in SETTINGS_FLAGS}

    with _conn(conn) as connection, connection.cursor() as cur:
        stored_flags = _settings_flags()
        columns = ", ".join(stored_flags)
        placeholders = ", ".join(["%s"] * len(stored_flags))
        updates = ", ".join(f"{flag} = EXCLUDED.{flag}" for flag in stored_flags)
        cur.execute(
            f"INSERT INTO memory_settings (scope_type, scope_id, {columns}, updated_by) "
            f"VALUES (%s, %s, {placeholders}, %s) "
            f"ON CONFLICT (scope_type, scope_id) DO UPDATE SET {updates}, "
            f"updated_by = EXCLUDED.updated_by, updated_at = NOW() "
            f"RETURNING scope_type, scope_id, {columns}, updated_at",
            (str(scope_type), sid, *[values[flag] for flag in stored_flags], updated_by),
        )
        row = cur.fetchone()
        connection.commit()
    return _out(row) or {}


def effective_settings(
    user_id: str | None = None,
    case_key: str | None = None,
    firm_id: str | None = None,
    *,
    conn: Any = None,
) -> MemorySettings:
    """AND the firm, user and case rows. A missing row means "on"."""
    pairs: list[tuple[str, str]] = []
    if firm_id:
        pairs.append(("firm", str(firm_id)))
    if user_id:
        pairs.append(("user", str(user_id)))
    if case_key:
        pairs.append(("case", str(case_key)))
    if not pairs:
        return MemorySettings()

    resolved = MemorySettings()
    try:
        with _conn(conn) as connection, connection.cursor() as cur:
            cur.execute(
                f"SELECT scope_type, scope_id, {', '.join(_settings_flags())} FROM memory_settings "
                "WHERE (scope_type, scope_id) IN (" + ", ".join(["(%s, %s)"] * len(pairs)) + ")",
                [value for pair in pairs for value in pair],
            )
            for row in cur.fetchall():
                resolved = resolved.merged_with(
                    MemorySettings(**{flag: bool(row.get(flag, True)) for flag in SETTINGS_FLAGS})
                )
    except Exception as exc:  # noqa: BLE001 — settings must never break a chat
        logger.warning("[Memory] settings lookup failed: %s", exc)
        return MemorySettings()
    return resolved


# ── Assembly log ─────────────────────────────────────────────────────────────

_LOG_COLUMNS = (
    "case_key, user_id, session_id, chat_id, mode, prefs_version, instructions_version, "
    "sections_loaded, preset_ref, past_chat_ids, model, budget, writes, rejected, proposals, skipped_reason"
)
_LOG_PLACEHOLDERS = (
    "%s, %s, %s::uuid, %s::uuid, %s, %s, %s, %s::jsonb, %s::jsonb, %s::uuid[], %s, %s::jsonb, %s, %s, %s, %s"
)


def write_assembly_log(entry: dict[str, Any], *, conn: Any = None) -> str | None:
    """Record what went into one generation, and what its turn wrote. Never raises."""
    key = str(entry.get("case_key") or "").strip()
    if not key:
        return None
    values: list[Any] = [
        key,
        _text_or_none(entry.get("user_id")),
        _uuid_or_none(entry.get("session_id")),
        _uuid_or_none(entry.get("chat_id")),
        _text_or_none(entry.get("mode")),
        entry.get("prefs_version"),
        entry.get("instructions_version"),
        _json(entry.get("sections_loaded") or []),
        _json(entry.get("preset_ref") or {}),
        [u for u in (_uuid_or_none(v) for v in (entry.get("past_chat_ids") or [])) if u],
        _text_or_none(entry.get("model")),
        _json(entry.get("budget") or {}),
        int(entry.get("writes") or 0),
        int(entry.get("rejected") or 0),
        int(entry.get("proposals") or 0),
        _text_or_none(entry.get("skipped_reason")),
    ]
    try:
        with _conn(conn) as connection, connection.cursor() as cur:
            # Read after _conn has ensured the tables, which settles the flag.
            columns, placeholders = _LOG_COLUMNS, _LOG_PLACEHOLDERS
            if _details_column:
                columns += ", details"
                placeholders += ", %s::jsonb"
                values.append(_json(entry.get("details") or {}))
            cur.execute(
                f"INSERT INTO memory_assembly_log ({columns}) VALUES ({placeholders}) RETURNING id",
                values,
            )
            row = cur.fetchone()
            connection.commit()
        return str(row["id"]) if row else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] assembly log write skipped case_key=%s error=%s", key, exc)
        return None


def list_assembly_log(case_key: str, limit: int = 20, *, conn: Any = None) -> list[dict[str, Any]]:
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT * FROM memory_assembly_log WHERE case_key = %s "
            "ORDER BY created_at DESC LIMIT %s",
            (key, max(1, min(int(limit or 20), 200))),
        )
        return [_out(row) or {} for row in cur.fetchall()]


def get_turn_log(case_key: str, chat_id: str, *, conn: Any = None) -> dict[str, Any] | None:
    """The log row for one chat turn, which exists once the post-turn writer has finished."""
    key = _require_case_key(case_key)
    chat = _uuid_or_none(chat_id)
    if not chat:
        return None
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT * FROM memory_assembly_log WHERE case_key = %s AND chat_id = %s::uuid "
            "ORDER BY created_at DESC LIMIT 1",
            (key, chat),
        )
        return _out(cur.fetchone())


def _text_or_none(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _uuid_or_none(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return str(uuid.UUID(text))
    except (ValueError, AttributeError, TypeError):
        return None


# ── Proposals ────────────────────────────────────────────────────────────────

def add_proposal(
    case_key: str,
    user_id: str | None,
    kind: str,
    text: str,
    source_ref: dict[str, Any] | None = None,
    *,
    status: str = "pending",
    conn: Any = None,
) -> str | None:
    """Record a suggestion, or with status "accepted", an instruction the writer saved itself."""
    key = _require_case_key(case_key)
    body = str(text or "").strip()
    if not body:
        return None
    state = str(status or "pending")
    if state not in _PROPOSAL_STATUSES:
        raise ValueError(f"Unknown proposal status '{status}'.")
    with _conn(conn) as connection, connection.cursor() as cur:
        if state == "pending":
            # Do not stack the same suggestion turn after turn.
            cur.execute(
                "SELECT id FROM memory_proposals WHERE case_key = %s AND status = 'pending' "
                "AND lower(text) = lower(%s) LIMIT 1",
                (key, body),
            )
            if cur.fetchone() is not None:
                connection.rollback()
                return None
        resolved_at = "NULL" if state == "pending" else "NOW()"
        cur.execute(
            "INSERT INTO memory_proposals (case_key, user_id, kind, text, status, source_ref, resolved_at) "
            f"VALUES (%s, %s, %s, %s, %s, %s::jsonb, {resolved_at}) RETURNING id",
            (key, _text_or_none(user_id), str(kind), body, state, _json(source_ref or {})),
        )
        row = cur.fetchone()
        connection.commit()
    return str(row["id"]) if row else None


_VISIBLE_PROPOSALS_SQL = " AND NOT (status = 'pending' AND COALESCE(source_ref->>'hidden', 'false') = 'true')"


def list_proposals(
    case_key: str,
    status: str | None = "pending",
    *,
    include_hidden: bool = False,
    conn: Any = None,
) -> list[dict[str, Any]]:
    """Suggestions under one key, newest first.

    A rule the writer is still counting (pending, with source_ref.hidden) is left out
    unless `include_hidden`: the advocate sees it only once it has been asked for often
    enough, so a one-off request never shows up as a suggestion.
    """
    key = _require_case_key(case_key)
    visible = "" if include_hidden else _VISIBLE_PROPOSALS_SQL
    with _conn(conn) as connection, connection.cursor() as cur:
        if status:
            cur.execute(
                "SELECT * FROM memory_proposals WHERE case_key = %s AND status = %s"
                + visible
                + " ORDER BY created_at DESC LIMIT 100",
                (key, str(status)),
            )
        else:
            cur.execute(
                "SELECT * FROM memory_proposals WHERE case_key = %s"
                + visible
                + " ORDER BY created_at DESC LIMIT 100",
                (key,),
            )
        return [_out(row) or {} for row in cur.fetchall()]


def update_proposal(
    case_key: str,
    proposal_id: str,
    *,
    source_ref: dict[str, Any],
    status: str | None = None,
    conn: Any = None,
) -> bool:
    """Replace a suggestion's source_ref (its request count), and optionally its status."""
    key = _require_case_key(case_key)
    if status is not None and str(status) not in _PROPOSAL_STATUSES:
        raise ValueError(f"Unknown proposal status '{status}'.")
    with _conn(conn) as connection, connection.cursor() as cur:
        if status is None:
            cur.execute(
                "UPDATE memory_proposals SET source_ref = %s::jsonb "
                "WHERE id = %s::uuid AND case_key = %s RETURNING id",
                (_json(source_ref), str(proposal_id), key),
            )
        else:
            cur.execute(
                "UPDATE memory_proposals SET source_ref = %s::jsonb, status = %s, "
                "resolved_at = CASE WHEN %s = 'pending' THEN NULL ELSE NOW() END "
                "WHERE id = %s::uuid AND case_key = %s RETURNING id",
                (_json(source_ref), str(status), str(status), str(proposal_id), key),
            )
        row = cur.fetchone()
        connection.commit()
    return row is not None


def list_user_proposals(
    user_id: str,
    statuses: Sequence[str] = ("pending", "accepted"),
    *,
    exclude_case_key: str | None = None,
    limit: int = 200,
    conn: Any = None,
) -> list[dict[str, Any]]:
    """This advocate's suggestions across their cases, newest first.

    Used to notice a request that keeps coming up in more than one case. The
    advocate's own universal suggestions ("user:<id>" keys) are left out.
    """
    uid = str(user_id or "").strip()
    wanted = [str(s) for s in statuses if str(s) in _PROPOSAL_STATUSES]
    if not uid or not wanted:
        return []
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT id, case_key, kind, text, status, created_at FROM memory_proposals "
            "WHERE user_id = %s AND status = ANY(%s::text[]) AND case_key NOT LIKE 'user:%%' "
            "AND case_key <> %s ORDER BY created_at DESC LIMIT %s",
            (uid, wanted, str(exclude_case_key or ""), max(1, min(int(limit or 200), 1000))),
        )
        return [_out(row) or {} for row in cur.fetchall()]


def reject_proposals_for_instruction(instruction_id: str, *, conn: Any = None) -> int:
    """When the advocate deletes an instruction JuriNex saved from chat, the
    record behind it is marked rejected so the writer does not save it again."""
    target = str(instruction_id or "").strip()
    if not target:
        return 0
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "UPDATE memory_proposals SET status = 'rejected', resolved_at = NOW() "
            "WHERE status = 'accepted' AND source_ref->>'instruction_id' = %s",
            (target,),
        )
        count = int(cur.rowcount or 0)
        connection.commit()
    return count


def get_proposal(case_key: str, proposal_id: str, *, conn: Any = None) -> dict[str, Any] | None:
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT * FROM memory_proposals WHERE id = %s::uuid AND case_key = %s",
            (str(proposal_id), key),
        )
        return _out(cur.fetchone())


def set_proposal_status(
    case_key: str,
    proposal_id: str,
    status: str,
    *,
    conn: Any = None,
) -> bool:
    key = _require_case_key(case_key)
    if str(status) not in {"pending", "accepted", "rejected"}:
        raise ValueError(f"Unknown proposal status '{status}'.")
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "UPDATE memory_proposals SET status = %s, resolved_at = NOW() "
            "WHERE id = %s::uuid AND case_key = %s RETURNING id",
            (str(status), str(proposal_id), key),
        )
        row = cur.fetchone()
        connection.commit()
    return row is not None
