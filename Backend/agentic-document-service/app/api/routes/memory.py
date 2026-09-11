"""Memory management API — what the advocate sees, edits, forgets and controls.

Mounted at `/api/memory`. Every route authenticates with the *verified* JWT
dependency (`get_current_user`), not the looser header-based identity the chat
routes accept, because these endpoints expose and mutate stored case data.

Case routes resolve `folder_name` through `resolve_case_scope`, which is also
the access check: an unresolvable folder returns 404 rather than an empty
result, so a probe cannot distinguish "no memory" from "not your case".

Concurrency: section writes carry the version the caller last read. A stale
version returns 409 with the current content so the client can merge and retry
instead of overwriting an edit it never saw.
"""
from __future__ import annotations

import logging
from typing import Any, Literal

from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field

from app.api.routes.rbac.auth import get_current_user
from app.services.memory import repository
from app.services.memory.repository import VersionConflict
from app.services.memory.schemas import (
    MAX_INSTRUCTIONS_CHARS,
    MAX_PREFERENCES_CHARS,
    SECTIONS,
    SETTINGS_FLAGS,
    MemorySettings,
    OpName,
    SectionName,
    TagName,
)
from app.services.memory.scope import CaseScope, firm_context_for, resolve_case_scope
from app.services.memory.validator import (
    Rejection,
    strip_tag_prefix,
    validate_instructions,
    validate_line,
    validate_preferences,
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


# ── Layer 1: standing preferences ────────────────────────────────────────────

@router.get("/preferences")
def get_preferences(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    stored = repository.get_preferences(_actor(user)) or {}
    return {
        "content": stored.get("content") or "",
        "version": stored.get("version"),
        "updated_at": stored.get("updated_at"),
        "max_words": 300,
        "max_chars": MAX_PREFERENCES_CHARS,
    }


@router.put("/preferences")
def put_preferences(
    body: ContentUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    problems = validate_preferences(body.content)
    if problems:
        raise _unprocessable(problems)
    try:
        saved = repository.put_preferences(
            _actor(user), body.content, body.version, updated_by=_actor(user)
        )
    except VersionConflict as exc:
        current = repository.get_preferences(_actor(user)) or {}
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": "stale_version",
                "current_version": exc.current_version,
                "content": current.get("content") or "",
            },
        ) from exc
    return {"content": saved.get("content") or "", "version": saved.get("version")}


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
    instructions = repository.get_instructions(scope.case_key) or {}
    case_settings = repository.get_settings("case", scope.case_key)
    effective = repository.effective_settings(
        user_id=scope.user_id, case_key=scope.case_key, firm_id=scope.firm_id
    )
    pending = repository.list_proposals(scope.case_key, "pending")

    return {
        "case_key": scope.case_key,
        "folder_name": scope.folder_name,
        "case_id": scope.case_id,
        "sections": index,
        "summary": summary,
        "instructions": {
            "content": instructions.get("content") or "",
            "version": instructions.get("version"),
            "updated_at": instructions.get("updated_at"),
        },
        "settings": {
            "case": {flag: bool((case_settings or {}).get(flag, True)) for flag in SETTINGS_FLAGS}
            if case_settings
            else None,
            "effective": effective.model_dump(),
        },
        "proposals_pending": len(pending),
        "line_count": sum(int(row.get("line_count") or 0) for row in index),
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


# ── Layer 2: case instructions ───────────────────────────────────────────────

@router.get("/cases/{folder_name}/instructions")
def get_instructions(
    folder_name: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    scope = _scope_or_404(folder_name, user)
    stored = repository.get_instructions(scope.case_key) or {}
    return {
        "case_key": scope.case_key,
        "content": stored.get("content") or "",
        "version": stored.get("version"),
        "updated_at": stored.get("updated_at"),
        "max_chars": MAX_INSTRUCTIONS_CHARS,
    }


@router.put("/cases/{folder_name}/instructions")
def put_instructions(
    folder_name: str,
    body: ContentUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    scope = _scope_or_404(folder_name, user)
    problems = validate_instructions(body.content)
    if problems:
        raise _unprocessable(problems)
    try:
        saved = repository.put_instructions(
            scope.case_key,
            body.content,
            body.version,
            updated_by=_actor(user),
            folder_name=scope.folder_name,
        )
    except VersionConflict as exc:
        current = repository.get_instructions(scope.case_key) or {}
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": "stale_version",
                "current_version": exc.current_version,
                "content": current.get("content") or "",
            },
        ) from exc
    return {"content": saved.get("content") or "", "version": saved.get("version")}


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


# ── Proposals (the model may suggest; only the advocate saves) ────────────────

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
    """Accepting appends the suggestion to the layer it belongs to, validated."""
    scope = _scope_or_404(folder_name, user)
    proposal = repository.get_proposal(scope.case_key, proposal_id)
    if proposal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found.")

    if decision == "reject":
        repository.set_proposal_status(scope.case_key, proposal_id, "rejected")
        return {"id": proposal_id, "status": "rejected"}

    text = str(proposal.get("text") or "").strip()
    kind = str(proposal.get("kind") or "instruction")

    if kind == "instruction":
        stored = repository.get_instructions(scope.case_key) or {}
        merged = "\n".join(filter(None, [str(stored.get("content") or "").strip(), text]))
        problems = validate_instructions(merged)
        if problems:
            raise _unprocessable(problems)
        repository.put_instructions(
            scope.case_key, merged, stored.get("version"), updated_by=_actor(user),
            folder_name=scope.folder_name,
        )
    else:
        stored = repository.get_preferences(_actor(user)) or {}
        merged = "\n".join(filter(None, [str(stored.get("content") or "").strip(), text]))
        problems = validate_preferences(merged)
        if problems:
            raise _unprocessable(problems)
        repository.put_preferences(_actor(user), merged, stored.get("version"), updated_by=_actor(user))

    repository.set_proposal_status(scope.case_key, proposal_id, "accepted")
    return {"id": proposal_id, "status": "accepted", "kind": kind}


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
    """The confirmed case row, the chronology and the documents for one case.

    Each is loaded independently and best-effort: seeding from whatever is
    available beats refusing to seed because one source failed.
    """
    from app.services.container import get_folder_service

    service = get_folder_service()
    case_row: dict[str, Any] | None = None
    if scope.case_id:
        try:
            case_row = service._get_case_from_db(scope.case_id, scope.user_id)  # noqa: SLF001
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Memory] seed could not load case_id=%s: %s", scope.case_id, exc)

    tree: Any = None
    try:
        tree = service.get_chronology(scope.case_id or scope.case_key, folder_name=scope.folder_name)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] seed could not load the chronology for %s: %s", scope.case_key, exc)

    files: list[dict[str, Any]] = []
    try:
        listing = service.get_documents_in_folder(scope.folder_name, scope.user_id) or {}
        files = list(listing.get("documents") or listing.get("files") or [])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] seed could not list documents for %s: %s", scope.folder_name, exc)

    return case_row, tree, files


@router.post("/cases/{folder_name}/seed")
def seed_case(
    folder_name: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Re-run seeding: add what is new since creation, update changed seeded facts."""
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
    )


@router.get("/sections")
def list_section_names() -> dict[str, Any]:
    """The fixed section vocabulary, so the UI does not hardcode it."""
    return {"sections": list(SECTIONS)}
