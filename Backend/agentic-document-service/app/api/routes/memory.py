"""Memory management API — what the advocate sees, edits, forgets and controls.

Mounted at `/api/memory`. Every route authenticates with the *verified* JWT
dependency (`get_current_user`), not the looser header-based identity the chat
routes accept, because these endpoints expose and mutate stored case data.

Case routes resolve `folder_name` through `resolve_case_scope`, which is also
the access check: an unresolvable folder returns 404 rather than an empty
result, so a probe cannot distinguish "no memory" from "not your case".

Concurrency: section and instruction writes carry the version the caller last
read. A stale version returns 409 with the current content so the client can
merge and retry instead of overwriting an edit it never saw.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field

from app.api.routes.rbac.auth import get_current_user
from app.services.memory import repository
from app.services.memory.instructions import annotate, normalize_session_id, user_proposal_key
from app.services.memory.repository import VersionConflict
from app.services.memory.schemas import (
    MAX_INSTRUCTION_ITEM_CHARS,
    MAX_INSTRUCTION_ITEMS,
    MAX_INSTRUCTIONS_CHARS,
    MAX_PREFERENCES_CHARS,
    SECTIONS,
    SETTINGS_FLAGS,
    InstructionScope,
    MemorySettings,
    OpName,
    OverrideType,
    SectionName,
    TagName,
)
from app.services.memory.scope import CaseScope, firm_context_for, resolve_case_scope
from app.services.memory.validator import (
    Rejection,
    instruction_set_room,
    split_instruction_text,
    strip_tag_prefix,
    validate_instruction_item,
    validate_line,
)

logger = logging.getLogger("agentic_document_service.api.memory")


class _StructuredErrorRoute(APIRoute):
    """Return this router's structured error bodies as real JSON.

    The service-wide HTTPException handler in main.py stringifies `detail` so it
    can attach CORS headers. That suits plain messages, but a 409 carrying the
    current section content, or a 422 carrying rule codes, would reach the
    browser as an unparseable Python repr — and the client could not recover
    from a stale edit.

    Routes here raise dict details; this unwraps them into a normal JSON
    response (which the CORS middleware decorates as usual). String details are
    re-raised untouched, so every other route in the service keeps its existing
    error shape.
    """

    def get_route_handler(self) -> Callable[[Request], Any]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except HTTPException as exc:
                if isinstance(exc.detail, dict):
                    return JSONResponse(
                        status_code=exc.status_code,
                        content=exc.detail,
                        headers=getattr(exc, "headers", None),
                    )
                raise

        return handler


router = APIRouter(prefix="/api/memory", tags=["memory"], route_class=_StructuredErrorRoute)

_INSTRUCTION_SET_CAPS = {"case": MAX_INSTRUCTIONS_CHARS, "user": MAX_PREFERENCES_CHARS}


# ── Request models ───────────────────────────────────────────────────────────

class ContentUpdate(BaseModel):
    content: str = Field(default="", max_length=MAX_INSTRUCTIONS_CHARS * 2)
    # The version the client last read. null on first write.
    version: int | None = None


class LineInput(BaseModel):
    tag: TagName = "stated"
    text: str
    document: str | None = None


class SectionOpRequest(BaseModel):
    op: OpName = "append_line"
    version: int | None = None
    tag: TagName = "stated"
    text: str = ""
    document: str | None = None
    line_id: str | None = None
    lines: list[LineInput] = Field(default_factory=list)


class SettingsUpdate(BaseModel):
    enabled: bool | None = None
    write_enabled: bool | None = None
    recall_enabled: bool | None = None
    instructions_enabled: bool | None = None
    sensitive_enabled: bool | None = None

    def flags(self, current: dict[str, Any] | None) -> dict[str, bool]:
        """Merge the patch over what is stored, defaulting to on."""
        base = MemorySettings()
        merged: dict[str, bool] = {}
        for flag in SETTINGS_FLAGS:
            sent = getattr(self, flag)
            if sent is not None:
                merged[flag] = bool(sent)
            elif current is not None and flag in current:
                merged[flag] = bool(current[flag])
            else:
                merged[flag] = bool(getattr(base, flag))
        return merged


class InstructionCreate(BaseModel):
    text: str = Field(max_length=MAX_INSTRUCTION_ITEM_CHARS * 2)
    version: int | None = None
    enabled: bool = True
    # True when the text is the Polish suggestion rather than the advocate's own words.
    polished: bool = False


class InstructionPatch(BaseModel):
    text: str | None = Field(default=None, max_length=MAX_INSTRUCTION_ITEM_CHARS * 2)
    enabled: bool | None = None
    version: int | None = None


class OverrideUpdate(BaseModel):
    override: OverrideType
    session_id: str | None = None
    # null clears the override, so the item's own switch applies again.
    enabled: bool | None = None


class PolishRequest(BaseModel):
    text: str = Field(max_length=MAX_INSTRUCTION_ITEM_CHARS * 4)
    scope: InstructionScope = "case"


# ── Shared helpers ───────────────────────────────────────────────────────────

def _actor(user: dict[str, Any]) -> str:
    return str(user.get("id"))


def _scope_or_404(folder_name: str, user: dict[str, Any]) -> CaseScope:
    scope = resolve_case_scope(folder_name, _actor(user))
    if scope is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{folder_name}' was not found, or you do not have access to it.",
        )
    return scope


def _unprocessable(problems: list[Rejection]) -> HTTPException:
    return HTTPException(
        # Literal 422: newer Starlette renamed the constant, older releases lack
        # the new name, and requirements are not pinned.
        status_code=422,
        detail={
            "detail": "rejected",
            "problems": [{"code": p.code, "message": p.detail} for p in problems],
        },
    )


def _conflict(exc: VersionConflict) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "detail": "stale_version",
            "section": exc.section,
            "expected_version": exc.expected,
            "current_version": exc.current_version,
            "lines": exc.current_lines,
        },
    )


def _instruction_conflict(exc: VersionConflict, scope_type: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "detail": "stale_version",
            "scope": scope_type,
            "expected_version": exc.expected,
            "current_version": exc.current_version,
            "items": exc.current_lines,
        },
    )


def _document_names(scope: CaseScope) -> list[str]:
    """Uploaded document names, used to check an [extracted] line names a real file."""
    try:
        from app.services.container import get_folder_service

        payload = get_folder_service().get_documents_in_folder(scope.folder_name, scope.user_id)
        records = payload.get("documents") or payload.get("files") or []
        return [str(r.get("name") or r.get("originalname") or "") for r in records]
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] document list unavailable for %s: %s", scope.folder_name, exc)
        return []


def _resolved_op(request: SectionOpRequest, section: str) -> Any:
    """Build a repository op from a user-authored request.

    User edits skip the dedupe pass the extractor goes through: a person editing
    their own case file means what they typed.
    """
    from app.services.memory.validator import ResolvedOp

    if request.op in {"create_section", "rewrite_section"}:
        return ResolvedOp(
            op=request.op,
            section=section,
            lines=[
                {
                    "tag": line.tag,
                    "text": strip_tag_prefix(line.text),
                    "source_ref": _user_source_ref(line.document),
                }
                for line in request.lines
            ],
        )
    return ResolvedOp(
        op=request.op,
        section=section,
        tag=request.tag,
        text=strip_tag_prefix(request.text),
        line_id=request.line_id,
        source_ref=_user_source_ref(request.document),
    )


def _user_source_ref(document: str | None) -> dict[str, Any]:
    ref: dict[str, Any] = {"kind": "user"}
    if document:
        ref["document"] = document
    return ref


def _seed_meta(case_key: str) -> dict[str, Any]:
    try:
        return repository.get_seed_meta(case_key)
    except Exception as exc:  # noqa: BLE001 — bookkeeping must never break the panel
        logger.debug("[Memory] seed bookkeeping unavailable for %s: %s", case_key, exc)
        return {}


def _party_names(user: dict[str, Any]) -> tuple[str, ...]:
    """Party names from the advocate's cases, for keeping case details out of universal rules."""
    from app.services.memory.parties import party_names_for_user

    try:
        return party_names_for_user(_actor(user))
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] party names unavailable: %s", exc)
        return ()


# ── Instructions (universal and per case, one switch per item) ───────────────

def _instruction_target(
    scope_type: str,
    folder_name: str | None,
    user: dict[str, Any],
) -> tuple[str, CaseScope | None]:
    """(the set's scope id, the case for context).

    Universal instructions belong to the advocate; a folder name with them only
    says which case's overrides to show. Case instructions need the folder.
    """
    if scope_type == "user":
        case_scope = _scope_or_404(folder_name, user) if folder_name else None
        return _actor(user), case_scope
    if not folder_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="folder_name is required for case instructions.",
        )
    case_scope = _scope_or_404(folder_name, user)
    return case_scope.case_key, case_scope


def _check_instruction(text: str, scope_type: str, user: dict[str, Any]) -> str:
    """The cleaned text, or a 422 with the rule it breaks."""
    clean = " ".join(str(text or "").split())
    problems = validate_instruction_item(
        clean, scope_type=scope_type, party_names=_party_names(user) if scope_type == "user" else ()
    )
    if problems:
        raise _unprocessable(problems)
    return clean


def _instruction_set_payload(
    scope_type: str,
    scope_id: str,
    case_scope: CaseScope | None,
    session_id: str | None,
) -> dict[str, Any]:
    data = repository.get_instruction_set(scope_type, scope_id)
    ids = [str(item.get("id")) for item in data.get("items") or [] if item.get("id")]
    session = normalize_session_id(session_id)
    overrides: dict[str, Any] = {}
    if ids and (case_scope is not None or session):
        overrides = repository.get_instruction_overrides(
            ids, case_key=case_scope.case_key if case_scope else None, session_id=session or None
        )
    items = annotate(data.get("items") or [], scope_type, overrides)
    return {
        "scope": scope_type,
        "version": data.get("version"),
        "items": items,
        "case_key": case_scope.case_key if case_scope else None,
        "session_id": session or None,
        "max_items": MAX_INSTRUCTION_ITEMS,
        "max_item_chars": MAX_INSTRUCTION_ITEM_CHARS,
        "max_chars": _INSTRUCTION_SET_CAPS[scope_type],
    }


@router.get("/instructions")
def list_instructions(
    scope: InstructionScope = Query(default="user"),
    folder_name: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """One set of instructions with, when a case or session is given, each item's state there."""
    scope_id, case_scope = _instruction_target(scope, folder_name, user)
    return _instruction_set_payload(scope, scope_id, case_scope, session_id)


@router.post("/instructions")
def add_instruction(
    body: InstructionCreate,
    scope: InstructionScope = Query(default="user"),
    folder_name: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    scope_id, case_scope = _instruction_target(scope, folder_name, user)
    text = _check_instruction(body.text, scope, user)
    current = repository.get_instruction_set(scope, scope_id)
    room = instruction_set_room(current.get("items") or [], text, scope_type=scope)
    if room is not None:
        raise _unprocessable([room])
    ref: dict[str, Any] = {"kind": "user"}
    if body.polished:
        ref["polished"] = True
    try:
        result = repository.add_instruction(
            scope, scope_id, text, body.version, enabled=body.enabled, origin="user", source_ref=ref, actor=_actor(user)
        )
    except VersionConflict as exc:
        raise _instruction_conflict(exc, scope) from exc
    logger.info("[Memory] user_id=%s added %s instruction -> v%s", _actor(user), scope, result.get("version"))
    item = annotate([result.get("item") or {}], scope, {})[0]
    return {"scope": scope, "version": result.get("version"), "item": item, "case_key": case_scope.case_key if case_scope else None}


@router.patch("/instructions/{instruction_id}")
def update_instruction(
    instruction_id: str,
    body: InstructionPatch,
    scope: InstructionScope = Query(default="user"),
    folder_name: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Change an item's text, or switch it on or off everywhere it applies."""
    scope_id, _case_scope = _instruction_target(scope, folder_name, user)
    text = _check_instruction(body.text, scope, user) if body.text is not None else None
    if text is None and body.enabled is None:
        raise _unprocessable([Rejection("empty", "Nothing to change.")])
    try:
        result = repository.update_instruction(
            scope, scope_id, instruction_id, body.version, text=text, enabled=body.enabled, actor=_actor(user)
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except VersionConflict as exc:
        raise _instruction_conflict(exc, scope) from exc
    return {"scope": scope, "version": result.get("version"), "item": annotate([result.get("item") or {}], scope, {})[0]}


@router.delete("/instructions/{instruction_id}")
def delete_instruction(
    instruction_id: str,
    scope: InstructionScope = Query(default="user"),
    folder_name: str | None = Query(default=None),
    version: int | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Remove one instruction. One JuriNex saved from chat is not saved again by itself."""
    scope_id, _case_scope = _instruction_target(scope, folder_name, user)
    try:
        result = repository.delete_instruction(scope, scope_id, instruction_id, version, actor=_actor(user))
    except VersionConflict as exc:
        raise _instruction_conflict(exc, scope) from exc
    if not result.get("deleted"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That instruction no longer exists.")
    item = result.get("item") or {}
    if str(item.get("origin") or "") == "chat":
        try:
            repository.reject_proposals_for_instruction(instruction_id)
        except Exception as exc:  # noqa: BLE001 — the delete itself has happened
            logger.warning("[Memory] could not mark the chat record for %s: %s", instruction_id, exc)
    logger.info("[Memory] user_id=%s deleted %s instruction %s", _actor(user), scope, instruction_id)
    return {"scope": scope, "version": result.get("version"), "deleted": True, "id": instruction_id}


@router.put("/instructions/{instruction_id}/override")
def set_instruction_override(
    instruction_id: str,
    body: OverrideUpdate,
    scope: InstructionScope = Query(default="user"),
    folder_name: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Switch one item off (or back on) for this case only, or mute it for one chat."""
    scope_id, case_scope = _instruction_target(scope, folder_name, user)
    current = repository.get_instruction_set(scope, scope_id)
    if not any(str(item.get("id")) == str(instruction_id) for item in current.get("items") or []):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That instruction no longer exists.")

    if body.override == "case":
        if scope != "user":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A case instruction already applies to one case; use its own switch.",
            )
        if case_scope is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="folder_name is required to switch an instruction off for a case.",
            )
        override_id = case_scope.case_key
    else:
        override_id = normalize_session_id(body.session_id)
        if not override_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="session_id is required to mute an instruction for a chat.",
            )

    repository.set_instruction_override(instruction_id, body.override, override_id, body.enabled, actor=_actor(user))
    return {"id": instruction_id, "override": body.override, "enabled": body.enabled}


@router.post("/instructions/polish")
def polish_instruction_route(
    body: PolishRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Tidy a draft instruction. Returns a suggestion; nothing is saved."""
    from app.services.memory.polish import polish_instruction

    names = _party_names(user) if body.scope == "user" else ()
    return polish_instruction(body.text, scope_type=body.scope, party_names=names).as_dict()


def _replace_from_text(
    scope_type: str,
    scope_id: str,
    content: str,
    version: int | None,
    user: dict[str, Any],
) -> dict[str, Any]:
    """The old one-box save: the text becomes the whole set, one item per line."""
    texts = split_instruction_text(content)
    problems: list[Rejection] = []
    names = _party_names(user) if scope_type == "user" else ()
    for text in texts:
        problems.extend(validate_instruction_item(text, scope_type=scope_type, party_names=names))
    if problems:
        raise _unprocessable(problems)
    if len(texts) > MAX_INSTRUCTION_ITEMS:
        raise _unprocessable([Rejection("set_full", f"At most {MAX_INSTRUCTION_ITEMS} instructions can be kept here.")])
    if sum(len(t) for t in texts) > _INSTRUCTION_SET_CAPS[scope_type]:
        raise _unprocessable(
            [Rejection("too_long", f"These are capped at {_INSTRUCTION_SET_CAPS[scope_type]} characters in total.")]
        )
    try:
        result = repository.replace_instruction_set(
            scope_type,
            scope_id,
            [{"text": text, "enabled": True, "origin": "user", "source_ref": {"kind": "user"}} for text in texts],
            version,
            actor=_actor(user),
        )
    except VersionConflict as exc:
        raise _instruction_conflict(exc, scope_type) from exc
    items = annotate(result.get("items") or [], scope_type, {})
    return {"scope": scope_type, "version": result.get("version"), "items": items, "content": "\n".join(texts)}


# ── Layer 1: the advocate's universal instructions (older "preferences" routes) ──

@router.get("/preferences")
def get_preferences(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    payload = _instruction_set_payload("user", _actor(user), None, None)
    payload["content"] = "\n".join(
        str(item.get("text") or "") for item in payload["items"] if item.get("enabled", True)
    )
    payload["max_words"] = 300
    return payload


@router.put("/preferences")
def put_preferences(
    body: ContentUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return _replace_from_text("user", _actor(user), body.content, body.version, user)


# ── Case overview ────────────────────────────────────────────────────────────

@router.get("/cases/{folder_name}")
def get_case_memory(
    folder_name: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Everything the "What JuriNex knows about this case" panel needs."""
    scope = _scope_or_404(folder_name, user)
    index = repository.get_section_index(scope.case_key)
    summary = repository.get_section(scope.case_key, "summary")
    instructions = repository.get_instruction_set("case", scope.case_key)
    case_settings = repository.get_settings("case", scope.case_key)
    effective = repository.effective_settings(
        user_id=scope.user_id, case_key=scope.case_key, firm_id=scope.firm_id
    )
    pending = repository.list_proposals(scope.case_key, "pending")
    seed_meta = _seed_meta(scope.case_key)
    items = instructions.get("items") or []

    return {
        "case_key": scope.case_key,
        "folder_name": scope.folder_name,
        "case_id": scope.case_id,
        "sections": index,
        "summary": summary,
        "instructions": {
            "version": instructions.get("version"),
            "count": len(items),
            "enabled_count": sum(1 for item in items if item.get("enabled", True)),
        },
        "settings": {
            "case": {flag: bool((case_settings or {}).get(flag, True)) for flag in SETTINGS_FLAGS}
            if case_settings
            else None,
            "effective": effective.model_dump(),
        },
        "proposals_pending": len(pending),
        "line_count": sum(int(row.get("line_count") or 0) for row in index),
        # When the case was last filled from its details, and whether that may
        # happen on its own (it may not after "forget everything").
        "seed": {
            "seeded_at": seed_meta.get("seeded_at"),
            "auto_seed": seed_meta.get("auto_seed") is not False,
        },
    }


@router.get("/cases/{folder_name}/sections/{section}")
def get_section(
    folder_name: str,
    section: SectionName,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    scope = _scope_or_404(folder_name, user)
    data = repository.get_section(scope.case_key, section)
    if data is None:
        return {"section": section, "version": None, "lines": []}
    return data


@router.post("/cases/{folder_name}/sections/{section}/ops")
def apply_section_op(
    folder_name: str,
    section: SectionName,
    body: SectionOpRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Apply one of the five memory operations under its version token."""
    scope = _scope_or_404(folder_name, user)

    candidates: list[tuple[str, str, str | None]] = []
    if body.op in {"create_section", "rewrite_section"}:
        candidates = [(line.tag, line.text, line.document) for line in body.lines]
        if not candidates:
            raise _unprocessable([Rejection("empty", "No lines were supplied.")])
    elif body.op == "append_line":
        candidates = [(body.tag, body.text, body.document)]
    elif body.op == "replace_line":
        # An empty replacement is the documented way to delete one line.
        if str(body.text or "").strip():
            candidates = [(body.tag, body.text, body.document)]
        if not body.line_id:
            raise _unprocessable([Rejection("missing_line_id", "replace_line needs a line_id.")])
    elif body.op == "delete_section":
        candidates = []

    if candidates:
        doc_names = _document_names(scope) if any(t == "extracted" for t, _, _ in candidates) else None
        problems = []
        for tag, text, document in candidates:
            rejection = validate_line(
                tag, text, section=section, doc_names=doc_names,
                source="document" if tag == "extracted" else "user",
                document=document,
            )
            if rejection:
                problems.append(rejection)
        if problems:
            raise _unprocessable(problems)

    try:
        result = repository.apply_op(
            scope.case_key,
            _resolved_op(body, section),
            body.version,
            actor=_actor(user),
            folder_name=scope.folder_name,
        )
    except VersionConflict as exc:
        raise _conflict(exc) from exc
    except ValueError as exc:
        raise _unprocessable([Rejection("invalid", str(exc))]) from exc

    logger.info(
        "[Memory] user_id=%s case_key=%s op=%s section=%s -> v%s",
        _actor(user), scope.case_key, body.op, section, result.get("version"),
    )
    return result


@router.delete("/cases/{folder_name}/sections/{section}")
def delete_section(
    folder_name: str,
    section: SectionName,
    version: int | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    from app.services.memory.validator import ResolvedOp

    scope = _scope_or_404(folder_name, user)
    try:
        return repository.apply_op(
            scope.case_key,
            ResolvedOp(op="delete_section", section=section),
            version,
            actor=_actor(user),
        )
    except VersionConflict as exc:
        raise _conflict(exc) from exc


@router.delete("/cases/{folder_name}/lines/{line_id}")
def delete_line(
    folder_name: str,
    line_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Forget one fact. A deletion is a deletion: nothing is softened or kept."""
    scope = _scope_or_404(folder_name, user)
    deleted = repository.delete_line(scope.case_key, line_id, actor=_actor(user))
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That memory line no longer exists.")
    return {"deleted": True, "id": line_id}


@router.delete("/cases/{folder_name}")
def forget_case(
    folder_name: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Forget everything about this case: memory, instructions and proposals."""
    scope = _scope_or_404(folder_name, user)
    counts = repository.delete_all(scope.case_key)
    logger.info("[Memory] user_id=%s forgot case_key=%s counts=%s", _actor(user), scope.case_key, counts)
    return {"case_key": scope.case_key, "deleted": counts}


# ── Layer 2: case instructions (older one-box routes, kept for compatibility) ──

@router.get("/cases/{folder_name}/instructions")
def get_instructions(
    folder_name: str,
    session_id: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    scope = _scope_or_404(folder_name, user)
    payload = _instruction_set_payload("case", scope.case_key, scope, session_id)
    payload["content"] = "\n".join(
        str(item.get("text") or "") for item in payload["items"] if item.get("enabled", True)
    )
    return payload


@router.put("/cases/{folder_name}/instructions")
def put_instructions(
    folder_name: str,
    body: ContentUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    scope = _scope_or_404(folder_name, user)
    return _replace_from_text("case", scope.case_key, body.content, body.version, user)


# ── Settings ─────────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings_route(
    scope_type: Literal["user", "case", "firm"] = Query(default="user", alias="scope"),
    folder_name: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    scope_id, case_scope = _settings_target(scope_type, folder_name, user)
    stored = repository.get_settings(scope_type, scope_id) if scope_id else None
    effective = repository.effective_settings(
        user_id=_actor(user),
        case_key=case_scope.case_key if case_scope else None,
        firm_id=(case_scope.firm_id if case_scope else firm_context_for(_actor(user))[0]),
    )
    defaults = MemorySettings()
    return {
        "scope": scope_type,
        "scope_id": scope_id,
        "settings": {
            flag: bool((stored or {}).get(flag, getattr(defaults, flag))) for flag in SETTINGS_FLAGS
        },
        "stored": stored is not None,
        "effective": effective.model_dump(),
    }


@router.put("/settings")
def put_settings_route(
    body: SettingsUpdate,
    scope_type: Literal["user", "case", "firm"] = Query(default="user", alias="scope"),
    folder_name: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    scope_id, case_scope = _settings_target(scope_type, folder_name, user)
    if not scope_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not resolve a {scope_type} to save these settings against.",
        )
    current = repository.get_settings(scope_type, scope_id)
    saved = repository.put_settings(
        scope_type, scope_id, body.flags(current), updated_by=_actor(user)
    )
    effective = repository.effective_settings(
        user_id=_actor(user),
        case_key=case_scope.case_key if case_scope else None,
        firm_id=(case_scope.firm_id if case_scope else firm_context_for(_actor(user))[0]),
    )
    logger.info(
        "[Memory] user_id=%s settings scope=%s id=%s -> %s",
        _actor(user), scope_type, scope_id, {f: saved.get(f) for f in SETTINGS_FLAGS},
    )
    return {
        "scope": scope_type,
        "scope_id": scope_id,
        "settings": {flag: bool(saved.get(flag, True)) for flag in SETTINGS_FLAGS},
        "effective": effective.model_dump(),
    }


def _settings_target(
    scope_type: str,
    folder_name: str | None,
    user: dict[str, Any],
) -> tuple[str | None, CaseScope | None]:
    """Resolve which row a settings call addresses, enforcing the firm guard."""
    if scope_type == "user":
        return _actor(user), None

    if scope_type == "case":
        if not folder_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="folder_name is required for case-level memory settings.",
            )
        case_scope = _scope_or_404(folder_name, user)
        return case_scope.case_key, case_scope

    # Firm-wide settings are an admin action: one advocate must not be able to
    # switch memory off for everyone else in the firm.
    account_type = str(user.get("account_type") or "").strip().upper()
    firm_id, is_firm_admin = firm_context_for(_actor(user))
    if account_type != "FIRM_ADMIN" and not is_firm_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a firm admin can change firm-wide memory settings.",
        )
    if not firm_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No firm is associated with this account.",
        )
    return firm_id, None


# ── Assembly log ─────────────────────────────────────────────────────────────

@router.get("/cases/{folder_name}/log")
def get_assembly_log(
    folder_name: str,
    limit: int = Query(default=20, ge=1, le=200),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Which layer versions went into recent generations — "why did the output change"."""
    scope = _scope_or_404(folder_name, user)
    return {"case_key": scope.case_key, "entries": repository.list_assembly_log(scope.case_key, limit)}


@router.get("/cases/{folder_name}/turns/{chat_id}")
def get_turn(
    folder_name: str,
    chat_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """What memory did after one chat turn.

    The writer runs after the answer is delivered, so the chat polls this until
    `ready` is true and then tells the advocate what changed.
    """
    scope = _scope_or_404(folder_name, user)
    row = repository.get_turn_log(scope.case_key, chat_id)
    if row is None:
        return {"chat_id": chat_id, "ready": False}
    details = row.get("details") if isinstance(row.get("details"), dict) else {}
    seeded = details.get("seeded")
    return {
        "chat_id": chat_id,
        "ready": True,
        "writes": int(row.get("writes") or 0),
        "proposals": int(row.get("proposals") or 0),
        "rejected": int(row.get("rejected") or 0),
        "skipped_reason": row.get("skipped_reason"),
        "lines": list(details.get("lines") or []),
        "instructions": list(details.get("instructions") or []),
        "suggestions": list(details.get("suggestions") or []),
        "instructions_applied": len(details.get("instructions_applied") or []),
        "seeded": seeded if isinstance(seeded, dict) else None,
    }


# ── Suggestions (the model may suggest; only the advocate saves) ─────────────

def _accept_suggestion(
    proposal: dict[str, Any],
    *,
    case_scope: CaseScope | None,
    user: dict[str, Any],
) -> dict[str, Any]:
    """Turn an accepted suggestion into an instruction item in the right set."""
    text = " ".join(str(proposal.get("text") or "").split())
    scope_type = "case" if str(proposal.get("kind") or "instruction") == "instruction" and case_scope else "user"
    if scope_type == "case":
        scope_id = case_scope.case_key  # type: ignore[union-attr]
    else:
        scope_id = _actor(user)
    _check_instruction(text, scope_type, user)
    current = repository.get_instruction_set(scope_type, scope_id)
    room = instruction_set_room(current.get("items") or [], text, scope_type=scope_type)
    if room is not None:
        raise _unprocessable([room])
    source = proposal.get("source_ref") if isinstance(proposal.get("source_ref"), dict) else {}
    ref: dict[str, Any] = {"kind": "learned", "proposal_id": str(proposal.get("id") or "")}
    if source.get("learned_from"):
        ref["learned_from"] = source.get("learned_from")
    result = repository.add_instruction(
        scope_type, scope_id, text, None, origin="learned", source_ref=ref, actor=_actor(user)
    )
    return {"scope": scope_type, "version": result.get("version"), "item": result.get("item")}


@router.get("/cases/{folder_name}/proposals")
def list_proposals(
    folder_name: str,
    status_filter: str | None = Query(default="pending", alias="status"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    scope = _scope_or_404(folder_name, user)
    return {
        "case_key": scope.case_key,
        "proposals": repository.list_proposals(scope.case_key, status_filter),
    }


@router.post("/cases/{folder_name}/proposals/{proposal_id}/{decision}")
def resolve_proposal(
    folder_name: str,
    proposal_id: str,
    decision: Literal["accept", "reject"],
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Accepting adds the suggestion to the set it belongs to, validated."""
    scope = _scope_or_404(folder_name, user)
    proposal = repository.get_proposal(scope.case_key, proposal_id)
    if proposal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found.")
    if str(proposal.get("status") or "pending") != "pending":
        # Already handled, perhaps in another window: never add it twice.
        return {"id": proposal_id, "status": proposal.get("status"), "kind": proposal.get("kind")}

    if decision == "reject":
        repository.set_proposal_status(scope.case_key, proposal_id, "rejected")
        return {"id": proposal_id, "status": "rejected"}

    added = _accept_suggestion(proposal, case_scope=scope, user=user)
    repository.set_proposal_status(scope.case_key, proposal_id, "accepted")
    return {"id": proposal_id, "status": "accepted", "kind": proposal.get("kind"), **added}


@router.get("/suggestions")
def list_user_suggestions(
    status_filter: str | None = Query(default="pending", alias="status"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Suggestions for all of this advocate's cases: rules noticed in more than one matter."""
    return {"scope": "user", "proposals": repository.list_proposals(user_proposal_key(_actor(user)), status_filter)}


@router.post("/suggestions/{proposal_id}/{decision}")
def resolve_user_suggestion(
    proposal_id: str,
    decision: Literal["accept", "reject"],
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    key = user_proposal_key(_actor(user))
    proposal = repository.get_proposal(key, proposal_id)
    if proposal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suggestion not found.")
    if str(proposal.get("status") or "pending") != "pending":
        return {"id": proposal_id, "status": proposal.get("status")}
    if decision == "reject":
        repository.set_proposal_status(key, proposal_id, "rejected")
        return {"id": proposal_id, "status": "rejected"}
    added = _accept_suggestion(proposal, case_scope=None, user=user)
    repository.set_proposal_status(key, proposal_id, "accepted")
    return {"id": proposal_id, "status": "accepted", **added}


# ── Case lifecycle: export, import, seed ─────────────────────────────────────

class ImportRequest(BaseModel):
    payload: dict[str, Any]
    # False merges into what the case already knows. True replaces its memory
    # sections, instructions and case-level settings with the file's.
    replace: bool = False


@router.get("/cases/{folder_name}/export")
def export_case_memory(
    folder_name: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Everything JuriNex knows about this case, as a portable JSON document."""
    from app.services.memory.export import export_case

    scope = _scope_or_404(folder_name, user)
    logger.info("[Memory] user_id=%s exported case_key=%s", _actor(user), scope.case_key)
    return export_case(scope)


@router.post("/cases/{folder_name}/import")
def import_case_memory(
    folder_name: str,
    body: ImportRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Load an export into this case. Every line is re-validated on the way in."""
    from app.services.memory.export import import_case

    scope = _scope_or_404(folder_name, user)
    try:
        return import_case(
            scope,
            body.payload,
            actor=_actor(user),
            replace=body.replace,
            doc_names=_document_names(scope),
        )
    except VersionConflict as exc:
        raise _conflict(exc) from exc
    except ValueError as exc:
        raise _unprocessable([Rejection("invalid_export", str(exc))]) from exc


def _seed_inputs(scope: CaseScope) -> tuple[dict[str, Any] | None, Any, list[dict[str, Any]]]:
    """The confirmed case row, the chronology and the documents for one case."""
    from app.services.memory.seed import load_seed_inputs

    return load_seed_inputs(scope)


@router.post("/cases/{folder_name}/seed")
def seed_case(
    folder_name: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Fill memory from the case details on request.

    Adds what is new, updates changed seeded facts, and restores seeded lines
    the advocate deleted earlier: pressing the button is asking for all of it.
    It also switches automatic seeding back on after "forget everything".
    """
    from app.services.memory.seed import seed_case_memory

    scope = _scope_or_404(folder_name, user)
    case_row, tree, files = _seed_inputs(scope)
    return seed_case_memory(
        scope.case_key,
        folder_name=scope.folder_name,
        user_id=scope.user_id,
        firm_id=scope.firm_id,
        case_row=case_row,
        tree=tree,
        files=files,
        actor=_actor(user),
        respect_deletions=False,
    )


@router.get("/sections")
def list_section_names() -> dict[str, Any]:
    """The fixed section vocabulary, so the UI does not hardcode it."""
    return {"sections": list(SECTIONS)}
