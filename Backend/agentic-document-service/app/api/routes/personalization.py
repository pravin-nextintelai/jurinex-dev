"""Personalization API — prompt-pattern profile + generated chat instruction.

Mounted at /api/files/personalization (registered BEFORE the files router so
the static prefix wins over the /api/files/{folder_name} wildcard routes).

  GET    /status                       counters, latest profile summary, active instruction
  GET    /profile                      latest profile JSON (or the default for a new user)
  POST   /profile/rebuild              run the Profile Builder now (folds in a partial batch)
  POST   /instructions/generate        profile + session prompts -> instruction markdown
  POST   /instructions/activate        "Add to system" (mode: replace | append)
  GET    /instructions                 history (active first)
  GET    /instructions/active          the instruction currently appended to the chat prompt
  POST   /instructions/deactivate      turn personalization off
  DELETE /instructions/{id}
  GET    /prompts                      logged prompts (optionally for one session)

Memory is FILES only — the same shape as a Claude project memory. There are no
chat-history endpoints here: raw conversations are the chat UI's own store
(`folder_chats`), not memory.

Project-scoped memory (a project is a case; `project_id` is its folder name):

  GET    /memory/projects/{project_id}         listing: slug + description, no content
  GET    /memory/projects/{project_id}/{slug}  one file
  DELETE /memory/projects/{project_id}/{slug}  hard delete

All three resolve the caller with `_extract_user_id` — the same auth path the rest of
this router uses — and go through the project store, so the user_id + folder_name filter
is applied in SQL. A project can never address another project's rows.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.routes.custom_prompts import _extract_user_id
from app.services import personalization_service as svc
from app.services import memory_service as memory_svc
from app.services.personalization_prompts import DEFAULT_LEGAL_PROFILE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/files/personalization", tags=["personalization"])


class GenerateInstructionRequest(BaseModel):
    session_id: str | None = None
    # auto (session if given, else recent) | session | history (past prompts)
    scope: str | None = Field(default="auto", pattern="^(auto|session|history)$")
    # history scope: first import the matching old chats into the prompt log (memory flow)
    import_history: bool = False
    # Case scope: with a folder only THAT case's prompts are used — every case is
    # kept separate. Omit for prompts across all cases.
    folder_name: str | None = None


class DeactivateRequest(BaseModel):
    folder_name: str | None = None


class ActivateInstructionRequest(BaseModel):
    instruction_text: str = Field(min_length=1, max_length=20_000)
    mode: str = Field(default="replace", pattern="^(replace|append)$")
    # manual (typed) | generated (profile + session) | polished (typed, then AI-rewritten)
    origin: str | None = Field(default=None, pattern="^(manual|generated|polished)$")
    source_profile_version: int | None = None
    source_session_id: str | None = None
    # The generator's behaviour analysis (kept with the row for the UI).
    behaviour_analysis: dict[str, Any] | None = None
    # Given → the instruction applies only to that case; None → the user's global one.
    folder_name: str | None = None


class PolishInstructionRequest(BaseModel):
    instruction_text: str = Field(min_length=1, max_length=20_000)


class RebuildRequest(BaseModel):
    allow_partial: bool = True


class ImportHistoryRequest(BaseModel):
    """Empty body = the user's whole chat history; else one session / one case folder."""

    session_id: str | None = None
    folder_name: str | None = None


class MemorySettingsRequest(BaseModel):
    # `enabled` is the single switch the UI sends; it cascades to generate_from_chats.
    enabled: bool | None = None
    generate_from_chats: bool | None = None
    sensitive_data: bool | None = None


class MemoryFileWriteRequest(BaseModel):
    path: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=4_000)
    title: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=180)
    folder_name: str | None = None


class RememberRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4_000)
    title: str | None = Field(default=None, max_length=120)
    folder_name: str | None = None


class ForgetRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    folder_name: str | None = None


class UpdateTopicRequest(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    content: str | None = Field(default=None, max_length=4_000)
    pinned: bool | None = None


def _wrap(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, ValueError):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=503, detail=str(exc))
    return HTTPException(status_code=500, detail=f"Personalization request failed: {exc}")


@router.get("/status")
def personalization_status(
    folder_name: str | None = Query(default=None),
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return svc.get_status(user_id, folder_name=folder_name)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


@router.get("/profile")
def personalization_profile(
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        latest = svc.get_latest_profile(user_id)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    if latest:
        return {"profile": latest, "is_default": False}
    return {
        "profile": {"version": 0, "prompts_covered": 0, "profile_json": DEFAULT_LEGAL_PROFILE},
        "is_default": True,
    }


@router.post("/profile/rebuild")
def personalization_profile_rebuild(
    body: RebuildRequest | None = None,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    """Synchronous rebuild (manual button / debugging). The chat path never calls this."""
    user_id = _extract_user_id(authorization, x_user_id)
    allow_partial = True if body is None else bool(body.allow_partial)
    try:
        before = svc.get_latest_profile(user_id)
        after = svc.rebuild_profile(user_id, allow_partial=allow_partial)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    rebuilt = bool(after) and (before is None or int(after["version"]) > int(before["version"]))
    return {"profile": after, "rebuilt": rebuilt, "is_default": after is None}


@router.post("/import-history")
def personalization_import_history(
    body: ImportHistoryRequest | None = None,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    """Run old chats through the normal flow: prompts logged (counter +1, batch_no),
    Profile Builder scheduled in the background when a batch completes."""
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return svc.import_chat_history(
            user_id,
            session_id=body.session_id if body else None,
            folder_name=body.folder_name if body else None,
        )
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


@router.post("/instructions/generate")
def personalization_generate(
    body: GenerateInstructionRequest | None = None,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    session_id = body.session_id if body else None
    try:
        return svc.generate_instruction(
            user_id,
            session_id=session_id,
            scope=(body.scope if body and body.scope else "auto"),
            import_history=bool(body.import_history) if body else False,
            folder_name=body.folder_name if body else None,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Personalization] generate failed user_id=%s: %s", user_id, exc)
        raise _wrap(exc) from exc


@router.post("/instructions/polish")
def personalization_polish(
    body: PolishInstructionRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    """Rewrite a hand-written draft into the standard instruction format (keeps every preference)."""
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return svc.polish_instruction(user_id, body.instruction_text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Personalization] polish failed user_id=%s: %s", user_id, exc)
        raise _wrap(exc) from exc


@router.post("/instructions/activate")
def personalization_activate(
    body: ActivateInstructionRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return svc.activate_instruction(
            user_id,
            body.instruction_text,
            mode=body.mode,
            origin=body.origin,
            source_profile_version=body.source_profile_version,
            source_session_id=body.source_session_id,
            behaviour=body.behaviour_analysis,
            folder_name=body.folder_name,
        )
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


@router.get("/instructions")
def personalization_instructions(
    limit: int = Query(default=20, ge=1, le=100),
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> list[dict[str, Any]]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return svc.list_instructions(user_id, limit=limit)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


@router.get("/instructions/active")
def personalization_active(
    folder_name: str | None = Query(default=None),
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    """The instruction that applies: the case's own (folder_name) if any, else the global one."""
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return {"instruction": svc.get_active_instruction(user_id, folder_name=folder_name)}
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


@router.post("/instructions/deactivate")
def personalization_deactivate(
    body: DeactivateRequest | None = None,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    """Turn off the instruction that applies to the case (its own, else the global one)."""
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        result = svc.deactivate_instructions(user_id, folder_name=body.folder_name if body else None)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    return {"success": True, **result}


@router.delete("/instructions/{instruction_id}")
def personalization_delete(
    instruction_id: str,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        deleted = svc.delete_instruction(user_id, instruction_id)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Instruction not found")
    return {"success": True, "id": instruction_id}


@router.get("/prompts")
def personalization_prompts(
    session_id: str | None = Query(default=None),
    folder_name: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> list[dict[str, Any]]:
    """Logged prompts: one session's, else one case's (folder_name), else the user's recent ones."""
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        if session_id:
            # Prompt log first; older chats (pre-feature) fall back to folder_chats.
            rows, _source = svc.get_session_history(user_id, session_id, limit=limit)
            return rows
        return svc.get_recent_prompts(user_id, limit=limit, folder_name=folder_name)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


# ── Claude-style memory (topic notes + past-chat search) ─────────────────────

@router.get("/memory/settings")
def memory_settings_get(
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return memory_svc.get_settings_for_user(user_id)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


@router.put("/memory/settings")
def memory_settings_put(
    body: MemorySettingsRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return memory_svc.update_settings(
            user_id,
            enabled=body.enabled,
            generate_from_chats=body.generate_from_chats,
            sensitive_data=body.sensitive_data,
        )
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


@router.get("/memory/topics")
def memory_topics_list(
    folder_name: str | None = Query(default=None),
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> list[dict[str, Any]]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return memory_svc.list_topics(user_id, folder_name)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


@router.get("/memory/files")
def memory_files_list(
    folder_name: str | None = Query(default=None),
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> list[dict[str, Any]]:
    """Lightweight listing: path + one-line description for every memory file."""
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return memory_svc.list_memory(user_id, folder_name)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


@router.get("/memory/file")
def memory_file_get(
    path: str = Query(min_length=1, max_length=200),
    folder_name: str | None = Query(default=None),
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        row = memory_svc.read_memory(user_id, path, folder_name=folder_name)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    if not row:
        raise HTTPException(status_code=404, detail="Memory file not found")
    return row


@router.put("/memory/file")
def memory_file_put(
    body: MemoryFileWriteRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        row = memory_svc.write_memory(
            user_id,
            body.path,
            body.content,
            title=body.title,
            description=body.description,
            folder_name=body.folder_name,
        )
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    if not row:
        raise HTTPException(status_code=422, detail="Could not write that memory file.")
    return row


@router.post("/memory/remember")
def memory_remember(
    body: RememberRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        row = memory_svc.remember_explicit(
            user_id, body.text, folder_name=body.folder_name, title=body.title
        )
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    if not row:
        raise HTTPException(status_code=422, detail="Could not save that memory.")
    return row


@router.post("/memory/forget")
def memory_forget(
    body: ForgetRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        removed = memory_svc.forget_matching(user_id, body.query, folder_name=body.folder_name)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    return {"removed": len(removed), "topics": removed}


@router.patch("/memory/topics/{topic_id}")
def memory_topic_update(
    topic_id: str,
    body: UpdateTopicRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        row = memory_svc.update_topic(
            user_id, topic_id, title=body.title, content=body.content, pinned=body.pinned
        )
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    if not row:
        raise HTTPException(status_code=404, detail="Memory topic not found")
    return row


@router.delete("/memory/topics/{topic_id}")
def memory_topic_delete(
    topic_id: str,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        deleted = memory_svc.delete_topic(user_id, topic_id)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory topic not found")
    return {"success": True, "id": topic_id}


# ── Project-scoped memory (hard isolation; a project is a case) ───────────────

@router.get("/memory/projects/{project_id}")
def project_memory_list(
    project_id: str,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> list[dict[str, Any]]:
    """Every memory file saved for ONE project: slug + description, never content."""
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return memory_svc.list_project_memory(user_id, project_id)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


@router.get("/memory/projects/{project_id}/{slug}")
def project_memory_get(
    project_id: str,
    slug: str,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        row = memory_svc.read_project_memory(user_id, project_id, slug)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    if not row:
        raise HTTPException(status_code=404, detail="Memory file not found in this project")
    return row


@router.delete("/memory/projects/{project_id}/{slug}")
def project_memory_delete(
    project_id: str,
    slug: str,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        deleted = memory_svc.delete_project_memory(user_id, project_id, slug)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory file not found in this project")
    return {"deleted": True, "project_id": project_id, "slug": slug}


@router.get("/memory/search")
def memory_search(
    q: str = Query(min_length=1, max_length=200),
    folder_name: str | None = Query(default=None),
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    """Search MEMORY FILES. Raw conversations are not part of Memory and are not searched."""
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        topics = memory_svc.search_topics(user_id, q, folder_name=folder_name)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    return {"topics": topics}
