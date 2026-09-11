"""The parties in an advocate's cases, for keeping case details out of universal instructions.

A universal instruction loads into every case, so "refer to Pawar as the
Applicant" must be refused there: it names a party to one matter. The names
come from the case forms the advocate confirmed (`cases.petitioners` and
`cases.respondents`) across every case they can see, cached briefly per user.
Everything here is best-effort; an unavailable database means no names, never
an error.
"""
from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

from app.services.db import get_db_connection, is_db_available
from app.services.memory.scope import accessible_user_ids_for, is_real_user
from app.services.memory.seed import _as_list, _person_name

logger = logging.getLogger("agentic_document_service.memory.parties")

CACHE_TTL_SECONDS = 300
MAX_CASES = 500
STATEMENT_TIMEOUT = "1500ms"

_lock = threading.Lock()
_cache: dict[str, tuple[float, tuple[str, ...]]] = {}


def party_names_for_user(user_id: str | None, *, conn: Any = None) -> tuple[str, ...]:
    """Every petitioner and respondent name in the cases this advocate can see."""
    uid = str(user_id or "").strip()
    if not is_real_user(uid):
        return ()
    now = time.monotonic()
    with _lock:
        hit = _cache.get(uid)
        if hit and now < hit[0]:
            return hit[1]

    names = _load(uid, conn)
    with _lock:
        _cache[uid] = (now + CACHE_TTL_SECONDS, names)
    return names


@contextmanager
def _connection(existing: Any = None) -> Iterator[Any]:
    if existing is not None:
        yield existing
        return
    with get_db_connection() as conn:
        yield conn


def _load(uid: str, conn: Any) -> tuple[str, ...]:
    if conn is None and not is_db_available():
        return ()
    owners = [str(v) for v in accessible_user_ids_for(uid) if str(v).strip()] or [uid]
    found: list[str] = []
    seen: set[str] = set()
    try:
        with _connection(conn) as connection, connection.cursor() as cur:
            try:
                cur.execute("SELECT set_config('statement_timeout', %s, true)", (STATEMENT_TIMEOUT,))
                cur.execute(
                    "SELECT petitioners, respondents FROM cases WHERE user_id::text = ANY(%s::text[]) "
                    "ORDER BY id DESC LIMIT %s",
                    (owners, MAX_CASES),
                )
                for row in cur.fetchall():
                    for column in ("petitioners", "respondents"):
                        for item in _as_list(row.get(column)):
                            name = _person_name(item)
                            if name and name.lower() not in seen:
                                seen.add(name.lower())
                                found.append(name)
            finally:
                # Read-only; ending the transaction drops the local timeout.
                connection.rollback()
    except Exception as exc:  # noqa: BLE001 — never block an instruction over a lookup
        logger.warning("[Memory] party names unavailable for user_id=%s: %s", uid, exc)
        return ()
    return tuple(found)


def forget_cached(user_id: str | None) -> None:
    """Drop the cached names for one user, e.g. after a case is created."""
    with _lock:
        _cache.pop(str(user_id or "").strip(), None)
