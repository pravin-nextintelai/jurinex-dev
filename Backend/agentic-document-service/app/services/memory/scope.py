"""Resolve "which case is this, and may this user see it" before any memory access.

Every memory read and write is keyed by `case_key`. This module is the single
place that derives one, so the key rule lives in exactly one function:

    str(cases.id)               a real case row is linked to the folder
    "folder:" || user_files.id  a folder with no case row yet (storage folders)
    the raw folder name         only for temp-* intake folders, which have no
                                folder row yet and are rebound on case create
                                (the same convention as case_chronology.case_key)

Display names are never the key: folder names are unique only per user, and the
existing folder lookup already resolves "latest wins" across firm members.

Identity: the chat routes accept an unverified `X-User-Id` header, so
`verified_user_id` prefers a signature-verified JWT and only falls back to the
header when no token was sent at all.
"""
from __future__ import annotations

import base64
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.memory.scope")

# The chat path already pays an HTTP call to resolve firm members; this keeps a
# second one per turn from doubling that cost.
_ACCESS_TTL_SECONDS = 60.0
_access_lock = threading.Lock()
_access_cache: dict[str, tuple[float, list[str], dict[str, Any]]] = {}

_FOLDER_LOOKUP_SQL = """
SELECT uf.id::text        AS folder_id,
       uf.originalname    AS folder_name,
       uf.folder_path     AS folder_path,
       c.id::text         AS case_id
FROM user_files uf
LEFT JOIN cases c ON c.folder_id = uf.id
WHERE uf.is_folder = true
  AND uf.originalname = %s
  AND uf.user_id::text = ANY(%s::text[])
ORDER BY (c.id IS NOT NULL) DESC, uf.created_at DESC
LIMIT 1
"""


@dataclass(frozen=True)
class CaseScope:
    """Everything a memory call needs, and nothing it does not."""

    case_key: str
    folder_name: str
    user_id: str
    folder_id: str | None = None
    case_id: str | None = None
    firm_id: str | None = None
    is_limited_firm_user: bool = False
    accessible_user_ids: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_intake(self) -> bool:
        """True while the case is still a temp-* intake folder."""
        return self.case_id is None and self.case_key.startswith("temp-")


def is_real_user(user_id: Any) -> bool:
    """Memory is never keyed to 'anonymous' or to a non-numeric id."""
    text = str(user_id or "").strip()
    if not text or text.lower() == "anonymous":
        return False
    return text.isdigit()


def verified_user_id(x_user_id: str | None, authorization: str | None) -> str | None:
    """Signature-verified JWT id when a token is present, else the header.

    A spoofed `X-User-Id` alongside a valid token would otherwise let one user
    read another's memory, so the token always wins when it verifies.
    """
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    if token:
        secret = str(get_settings().jwt_secret or "")
        if secret:
            try:
                import jwt as pyjwt  # PyJWT

                payload = pyjwt.decode(token, secret, algorithms=["HS256"])
                uid = _claim_user_id(payload)
                if uid:
                    if x_user_id and str(x_user_id).strip() and str(x_user_id).strip() != uid:
                        logger.warning(
                            "[Memory] X-User-Id=%s does not match the verified token id=%s; using the token.",
                            x_user_id,
                            uid,
                        )
                    return uid
            except Exception as exc:  # noqa: BLE001 — an invalid token is not fatal here
                logger.debug("[Memory] token verification failed: %s", exc)
        else:
            # No secret configured (local dev): read the payload without trusting it.
            uid = _claim_user_id(_decode_unverified(token))
            if uid:
                return uid

    header = str(x_user_id or "").strip()
    return header or None


def _claim_user_id(payload: dict[str, Any] | None) -> str | None:
    if not payload:
        return None
    uid = payload.get("id") or payload.get("userId") or payload.get("user_id") or payload.get("sub")
    return str(uid) if uid is not None else None


def _decode_unverified(token: str) -> dict[str, Any] | None:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        body = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(body.encode("utf-8")).decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


def _access_context(user_id: str) -> tuple[list[str], dict[str, Any]]:
    """(accessible user ids, firm context), cached briefly per user."""
    now = time.monotonic()
    with _access_lock:
        hit = _access_cache.get(user_id)
        if hit and now < hit[0]:
            return hit[1], hit[2]

    accessible: list[str] = [user_id]
    firm: dict[str, Any] = {}
    try:
        from app.services.container import get_folder_service

        service = get_folder_service()
        resolved = service._get_accessible_user_ids(user_id)  # noqa: SLF001
        if resolved:
            accessible = [str(v) for v in resolved if v is not None]
        firm = service._get_firm_context(user_id) or {}  # noqa: SLF001
    except Exception as exc:  # noqa: BLE001 — fall back to the user alone
        logger.warning("[Memory] access context fallback for user_id=%s: %s", user_id, exc)

    with _access_lock:
        _access_cache[user_id] = (now + _ACCESS_TTL_SECONDS, accessible, firm)
    return accessible, firm


def clear_access_cache() -> None:
    with _access_lock:
        _access_cache.clear()


def firm_context_for(user_id: str) -> tuple[str | None, bool]:
    """(firm id, is firm admin) for settings routes that carry no folder."""
    if not is_real_user(user_id):
        return None, False
    _, firm = _access_context(str(user_id))
    firm_id = _text_or_none(firm.get("firmId") or firm.get("firm_id"))
    return firm_id, bool(firm.get("isFirmAdmin"))


def accessible_user_ids_for(user_id: str) -> tuple[str, ...]:
    """The user ids whose cases this advocate can see (their own, plus the firm's)."""
    if not is_real_user(user_id):
        return ()
    accessible, _ = _access_context(str(user_id))
    return tuple(accessible)


def resolve_case_scope(
    folder_name: str | None,
    user_id: str | None,
    *,
    authorization: str | None = None,
) -> CaseScope | None:
    """Resolve the case behind a folder name, or None when memory must not run.

    None is returned (and memory silently skipped) when the user is anonymous,
    the database is unavailable, the folder is not visible to this user, or a
    limited firm user has no assignment on the case. Chat must never fail
    because memory could not resolve.
    """
    name = str(folder_name or "").strip()
    uid = str(user_id or "").strip()
    if not name or not is_real_user(uid):
        return None
    if not is_db_available():
        return None

    accessible, firm = _access_context(uid)
    firm_id = _text_or_none(firm.get("firmId") or firm.get("firm_id"))
    account_type = str(firm.get("accountType") or "").strip().upper()
    limited = account_type == "FIRM_USER" and not bool(firm.get("isFirmAdmin"))

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(_FOLDER_LOOKUP_SQL, [name, accessible])
            row = cur.fetchone()

            if row is None:
                # Intake: the temp folder has no user_files row yet. Key by the
                # temp name, exactly like case_chronology, and rebind on create.
                if name.lower().startswith("temp-"):
                    return CaseScope(
                        case_key=name,
                        folder_name=name,
                        user_id=uid,
                        firm_id=firm_id,
                        is_limited_firm_user=limited,
                        accessible_user_ids=tuple(accessible),
                    )
                logger.info("[Memory] no accessible folder for user_id=%s folder=%s", uid, name)
                return None

            case_id = _text_or_none(row.get("case_id"))
            folder_id = _text_or_none(row.get("folder_id"))

            if limited and case_id:
                cur.execute(
                    "SELECT 1 FROM case_assignments WHERE case_id::text = %s AND user_id::text = %s LIMIT 1",
                    [case_id, uid],
                )
                if cur.fetchone() is None:
                    logger.info(
                        "[Memory] limited firm user_id=%s has no assignment on case_id=%s", uid, case_id
                    )
                    return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] scope resolution failed folder=%s user_id=%s: %s", name, uid, exc)
        return None

    case_key = case_id or (f"folder:{folder_id}" if folder_id else name)

    scope = CaseScope(
        case_key=case_key,
        folder_name=str(row.get("folder_name") or name),
        user_id=uid,
        folder_id=folder_id,
        case_id=case_id,
        firm_id=firm_id,
        is_limited_firm_user=limited,
        accessible_user_ids=tuple(accessible),
    )
    _adopt_orphaned_keys(scope, name)
    return scope


def _adopt_orphaned_keys(scope: CaseScope, folder_name: str) -> None:
    """Move memory written before this folder had a case row onto the real key.

    A case created through the legacy Node service never runs the create-time
    rebind, so rows can be left under the intake name or the folder key. This
    is a one-time, best-effort catch-up on first access.
    """
    if not scope.case_id:
        return
    candidates = [key for key in (folder_name, f"folder:{scope.folder_id}") if key and key != scope.case_key]
    if not candidates:
        return
    try:
        from app.services.memory import repository

        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM case_memory_sections WHERE case_key = %s LIMIT 1",
                [scope.case_key],
            )
            if cur.fetchone() is not None:
                return
            cur.execute(
                "SELECT case_key FROM case_memory_sections WHERE case_key = ANY(%s::text[]) LIMIT 1",
                [candidates],
            )
            orphan = cur.fetchone()
        if not orphan:
            return
        repository.rebind_case_key(str(orphan["case_key"]), scope.case_key, scope.folder_name)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] orphan adoption skipped for case_key=%s: %s", scope.case_key, exc)


def _text_or_none(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None
