from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator

from app.core.config import get_settings

logger = logging.getLogger(__name__)

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception as exc:  # pragma: no cover
    psycopg = None
    dict_row = None
    logger.exception(
        "psycopg import failed; folder/case listing will fall back to empty in-memory state: %s",
        exc,
    )

# Fail fast if Cloud SQL is unreachable so uvicorn --reload does not look hung.
_CONNECT_TIMEOUT_SECONDS = 8


def _connect(url: str) -> Any:
    return psycopg.connect(
        url,
        row_factory=dict_row,
        connect_timeout=_CONNECT_TIMEOUT_SECONDS,
    )


_PSYCOPG_MISSING_LOGGED = False


def is_db_available() -> bool:
    global _PSYCOPG_MISSING_LOGGED
    settings = get_settings()
    if settings.database_url and psycopg is None and not _PSYCOPG_MISSING_LOGGED:
        _PSYCOPG_MISSING_LOGGED = True
        logger.error(
            "DATABASE_URL is set but psycopg failed to import. "
            'Reinstall with: pip install "psycopg[binary]" in the service venv.'
        )
    return bool(psycopg and settings.database_url)


@contextmanager
def get_db_connection() -> Iterator[Any]:
    settings = get_settings()
    if not psycopg or not settings.database_url:
        raise RuntimeError("Database access is not configured for the agentic document service.")
    conn = _connect(settings.database_url)
    try:
        yield conn
    finally:
        conn.close()


def is_payment_db_available() -> bool:
    settings = get_settings()
    return bool(psycopg and settings.payment_db_url)


@contextmanager
def get_payment_db_connection() -> Iterator[Any]:
    settings = get_settings()
    if not psycopg or not settings.payment_db_url:
        raise RuntimeError("Payment database access is not configured.")
    conn = _connect(settings.payment_db_url)
    try:
        yield conn
    finally:
        conn.close()


def is_draft_db_available() -> bool:
    """Draft_DB holds generated_documents, user_drafts, template_assets (agent-draft-service)."""
    settings = get_settings()
    return bool(psycopg and settings.agent_prompts_database_url)


@contextmanager
def get_draft_db_connection() -> Iterator[Any]:
    settings = get_settings()
    if not psycopg or not settings.agent_prompts_database_url:
        raise RuntimeError("Draft database access is not configured (set DRAFT_DATABASE_URL).")
    conn = _connect(settings.agent_prompts_database_url)
    try:
        yield conn
    finally:
        conn.close()
