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
    MAX_SECTION_LINES,
    MAX_SUMMARY_LINES,
    SECTIONS,
    SETTINGS_FLAGS,
    MemorySettings,
)
from app.services.memory.validator import ResolvedOp

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
    _tables_ready = True


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
    for table, column in _CASE_TABLES:
        savepoint = f"sp_memory_{table}"
        try:
            cur.execute(f"SAVEPOINT {savepoint}")
            cur.execute(f"DELETE FROM {table} WHERE {column} = ANY(%s::text[])", (clean,))
            counts[table] = int(cur.rowcount or 0)
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

        connection.commit()
    logger.info("[Memory] rebind %s -> %s moved=%s", old, new, counts)
    return counts


# ── Settings ─────────────────────────────────────────────────────────────────

def get_settings(scope_type: str, scope_id: str, *, conn: Any = None) -> dict[str, Any] | None:
    sid = str(scope_id or "").strip()
    if not sid:
        return None
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT scope_type, scope_id, enabled, write_enabled, recall_enabled, "
            "instructions_enabled, sensitive_enabled, updated_by, updated_at "
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
    columns = ", ".join(SETTINGS_FLAGS)
    placeholders = ", ".join(["%s"] * len(SETTINGS_FLAGS))
    updates = ", ".join(f"{flag} = EXCLUDED.{flag}" for flag in SETTINGS_FLAGS)

    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            f"INSERT INTO memory_settings (scope_type, scope_id, {columns}, updated_by) "
            f"VALUES (%s, %s, {placeholders}, %s) "
            f"ON CONFLICT (scope_type, scope_id) DO UPDATE SET {updates}, "
            f"updated_by = EXCLUDED.updated_by, updated_at = NOW() "
            f"RETURNING scope_type, scope_id, {columns}, updated_at",
            (str(scope_type), sid, *[values[flag] for flag in SETTINGS_FLAGS], updated_by),
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
                "SELECT scope_type, scope_id, enabled, write_enabled, recall_enabled, "
                "instructions_enabled, sensitive_enabled FROM memory_settings "
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


def list_proposals(
    case_key: str,
    status: str | None = "pending",
    *,
    conn: Any = None,
) -> list[dict[str, Any]]:
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        if status:
            cur.execute(
                "SELECT * FROM memory_proposals WHERE case_key = %s AND status = %s "
                "ORDER BY created_at DESC LIMIT 100",
                (key, str(status)),
            )
        else:
            cur.execute(
                "SELECT * FROM memory_proposals WHERE case_key = %s ORDER BY created_at DESC LIMIT 100",
                (key,),
            )
        return [_out(row) or {} for row in cur.fetchall()]


def list_saved_from_chat(case_key: str, limit: int = 10, *, conn: Any = None) -> list[dict[str, Any]]:
    """Instructions the writer saved on its own from an explicit request, newest first."""
    key = _require_case_key(case_key)
    with _conn(conn) as connection, connection.cursor() as cur:
        cur.execute(
            "SELECT * FROM memory_proposals WHERE case_key = %s AND status = 'accepted' "
            "AND source_ref->>'auto' = 'true' ORDER BY created_at DESC LIMIT %s",
            (key, max(1, min(int(limit or 10), 50))),
        )
        return [_out(row) or {} for row in cur.fetchall()]


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
