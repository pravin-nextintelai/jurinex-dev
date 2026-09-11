"""Which instructions apply to one generation, and the switches that decide it.

An advocate has two sets of instructions: universal ones that apply in every
case, and one set per case. Each item has its own switch. On top of that, a
universal item can be switched off for one case (it does not suit that matter),
and any item can be muted for one chat session (not this conversation).

Precedence, most specific first:

    session override  ->  case override (universal items only)  ->  the item's switch

Everything here is a pure decision over what the repository returns; the only
database access is through the repository.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

from app.services.memory import repository

USER_PROPOSAL_PREFIX = "user:"


def user_proposal_key(user_id: str | None) -> str:
    """Suggestions for all of an advocate's cases live under this pseudo case key."""
    return f"{USER_PROPOSAL_PREFIX}{str(user_id or '').strip()}"


def normalize_session_id(value: str | None) -> str:
    """Stored session ids are dashed UUIDs; a request may send 32 bare hex digits."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        return str(uuid.UUID(raw))
    except (ValueError, AttributeError, TypeError):
        return raw


def effective_enabled(item: dict[str, Any], scope_type: str, override: dict[str, Any] | None) -> bool:
    """Whether one item applies right now, given its switch and any overrides."""
    state = override or {}
    if state.get("session") is not None:
        return bool(state["session"])
    if str(scope_type) == "user" and state.get("case") is not None:
        return bool(state["case"])
    return bool(item.get("enabled", True))


def annotate(
    items: Iterable[dict[str, Any]],
    scope_type: str,
    overrides: dict[str, dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Copy each item with its override states and the resulting `effective` flag."""
    out: list[dict[str, Any]] = []
    for item in items:
        state = (overrides or {}).get(str(item.get("id")), {}) or {}
        copy = dict(item)
        copy["case_override"] = state.get("case") if str(scope_type) == "user" else None
        copy["session_override"] = state.get("session")
        copy["effective"] = effective_enabled(item, scope_type, state)
        out.append(copy)
    return out


@dataclass
class InstructionContext:
    """The instructions one generation should follow."""

    user_version: int | None = None
    case_version: int | None = None
    user_items: list[dict[str, Any]] = field(default_factory=list)
    case_items: list[dict[str, Any]] = field(default_factory=list)
    applied_ids: list[str] = field(default_factory=list)
    muted_ids: list[str] = field(default_factory=list)


def _empty_set(scope_type: str) -> dict[str, Any]:
    return {"scope_type": scope_type, "scope_id": None, "version": None, "items": []}


def resolve_instructions(
    user_id: str | None,
    case_key: str | None,
    session_id: str | None = None,
    *,
    include_case: bool = True,
) -> InstructionContext:
    """Load both sets and keep only the items that apply to this case and session."""
    uid = str(user_id or "").strip()
    key = str(case_key or "").strip()
    user_set = repository.get_instruction_set("user", uid) if uid else _empty_set("user")
    case_set = repository.get_instruction_set("case", key) if (key and include_case) else _empty_set("case")

    ids = [str(item.get("id")) for item in [*user_set["items"], *case_set["items"]] if item.get("id")]
    session = normalize_session_id(session_id)
    overrides: dict[str, dict[str, Any]] = {}
    if ids and (key or session):
        overrides = repository.get_instruction_overrides(ids, case_key=key or None, session_id=session or None)

    user_items = annotate(user_set["items"], "user", overrides)
    case_items = annotate(case_set["items"], "case", overrides)
    every = [*user_items, *case_items]
    return InstructionContext(
        user_version=user_set.get("version"),
        case_version=case_set.get("version"),
        user_items=[item for item in user_items if item["effective"]],
        case_items=[item for item in case_items if item["effective"]],
        applied_ids=[str(item["id"]) for item in every if item["effective"]],
        muted_ids=[str(item["id"]) for item in every if not item["effective"]],
    )


def render_items(items: Sequence[dict[str, Any]]) -> str:
    """One instruction per line, as the model sees them."""
    return "\n".join(f"- {str(item.get('text') or '').strip()}" for item in items if str(item.get("text") or "").strip())
