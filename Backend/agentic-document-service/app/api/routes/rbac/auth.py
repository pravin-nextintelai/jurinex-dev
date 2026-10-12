"""
FastAPI dependency for JWT authentication.

Mirrors the behaviour of document-service/middleware/auth.js:
  - Extracts Bearer token from the Authorization header
  - Verifies the JWT with JWT_SECRET
  - Resolves account_type from the auth service when the token carries SOLO
    (handles old tokens issued before FIRM_ADMIN / FIRM_USER was added)
  - Populates a CurrentUser dict used by the RBAC endpoints
"""
from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import Header, HTTPException, status

from app.core.config import get_settings

logger = logging.getLogger("agentic_document_service.rbac.auth")


def _decode_jwt(token: str, secret: str) -> dict[str, Any]:
    """Decode and verify a JWT using PyJWT."""
    try:
        import jwt as pyjwt  # PyJWT
        return pyjwt.decode(token, secret, algorithms=["HS256"])
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Invalid or expired token: {exc}",
        )


def _fetch_account_type(user_id: int, auth_url: str) -> str:
    """Call auth service to resolve account_type (fallback: SOLO)."""
    try:
        resp = httpx.get(
            f"{auth_url}/api/auth/internal/user/{user_id}/account-type",
            timeout=3.0,
        )
        resp.raise_for_status()
        value = resp.json().get("account_type", "SOLO") or "SOLO"
        return str(value).strip().upper()
    except Exception as exc:
        logger.warning("Could not fetch account_type from auth service: %s", exc)
        return "SOLO"


def get_current_user(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """FastAPI dependency — validates the JWT and returns the current user dict."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required",
        )

    token = authorization.split(" ", 1)[1].strip()
    settings = get_settings()

    if not settings.jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="JWT_SECRET is not configured on this service",
        )

    payload = _decode_jwt(token, settings.jwt_secret)

    user_id = payload.get("id") or payload.get("userId")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User ID missing from token",
        )

    account_type = str(payload.get("account_type") or "SOLO").strip().upper()
    if account_type == "SOLO":
        resolved = _fetch_account_type(int(user_id), settings.auth_service_url)
        if resolved and resolved != "SOLO":
            account_type = resolved

    first = payload.get("first_name", "") or ""
    last = payload.get("last_name", "") or ""
    full_name = (
        payload.get("name")
        or payload.get("full_name")
        or " ".join(filter(None, [first, last])).strip()
        or None
    )

    user = {
        "id": int(user_id),
        "name": full_name,
        "email": payload.get("email"),
        "role": payload.get("role", "user"),
        "account_type": account_type,  # SOLO | FIRM_ADMIN | FIRM_USER
    }
    try:
        from errorlog import set_user
        set_user(user["id"], user.get("email"))
    except Exception:
        pass
    return user
