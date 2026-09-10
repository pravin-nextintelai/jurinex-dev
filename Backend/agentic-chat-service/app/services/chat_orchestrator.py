from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import date, datetime
from typing import Any, AsyncIterator

import jwt

from app.core.config import get_settings
from app.services.chat_helpers import (
    build_active_gcs_uris_from_attached,
    build_attached_files_snapshot,
    build_chat_upload_path,
    format_conversation_history,
    is_valid_uuid,
    parse_attached_files_cell,
    parse_file_ids_from_body,
    resolve_attached_files_for_session,
    simplify_history,
    wants_judgement_search,
)
from app.services.chat_repository import FileChatRepository, FileRepository
from app.services.gcs_service import (
    create_signed_upload_url,
    delete_object_if_exists,
    download_object_buffer,
    get_object_metadata,
    to_gcs_uri,
    upload_file_to_gcs,
)
from app.services.google_drive_service import download_file as download_from_drive
from app.services.llm_config_service import (
    get_llm_config,
    get_multer_upload_ceiling_mb,
    get_next_utc_midnight_iso,
    get_streaming_delay_ms,
    merge_request_overrides,
)
from app.services.llm_policy_service import assert_chat_allowed, assert_stored_file_meets_limits, assert_upload_allowed
from app.services.storage_policy import assert_storage_allowed
from app.services.llm_service import (
    _is_claude_model,
    count_tokens_from_gcs,
    stream_llm_general,
    stream_llm_with_gcs,
)
from app.services.judgement_search_service import JUDGEMENT_SEARCH_SECTION, stream_judgement_search
from app.services.secret_prompt_service import resolve_secret_prompt
from app.services.system_prompt_service import build_system_instruction, build_profile_query_prefix
from app.services.user_profile_service import get_full_profile
from app.services import gemini_cache_service
from app.services.token_usage_log import log_table, log_token_usage_table

logger = logging.getLogger(__name__)
SIGNED_UPLOAD_TOKEN_TTL = 15 * 60
INLINE_PAGE_CHECK_MAX_MB = 20

class _JsonEncoder(json.JSONEncoder):
    """Handle UUID and datetime objects returned by psycopg2."""

    def default(self, o: Any) -> Any:
        if isinstance(o, uuid.UUID):
            return str(o)
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        return super().default(o)


def _sse_line(obj: Any) -> str:
    """Format one SSE event line and live-render the streamed answer in the console."""
    if isinstance(obj, dict):
        etype = obj.get("type")
        if etype == "chunk":
            text = obj.get("text") or ""
            if text:
                print(text, end="", flush=True)
        elif etype in ("done", "error"):
            print(flush=True)
    if isinstance(obj, str):
        return f"data: {obj}\n\n"
    return f"data: {json.dumps(obj, cls=_JsonEncoder)}\n\n"

def _jwt_secret() -> str:
    s = get_settings().jwt_secret
    if not s:
        raise RuntimeError("JWT_SECRET not configured")
    return s


def sign_upload_token(payload: dict[str, Any]) -> str:
    return jwt.encode({**payload, "exp": __import__("time").time() + SIGNED_UPLOAD_TOKEN_TTL}, _jwt_secret(), algorithm="HS256")


def verify_upload_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def _derive_fallback_profile(ctx: dict[str, Any]) -> dict[str, Any] | None:
    """Build minimal profile when auth profile API is unavailable."""
    email = (ctx.get("user_email") or "").strip()
    if not email:
        return None
    name_guess = email.split("@")[0].replace(".", " ").replace("_", " ").strip().title() or email
    return {
        "basic": {"username": name_guess, "email": email, "phone": None},
        "professional": {"email": email},
    }


def _profile_field(profile: dict[str, Any] | None, key: str) -> str | None:
    if not profile:
        return None
    basic = profile.get("basic") or {}
    professional = profile.get("professional") or {}
    for source in (basic, professional, profile):
        val = source.get(key)
        if val:
            return str(val).strip()
    return None


def _profile_name(profile: dict[str, Any] | None) -> str | None:
    if not profile:
        return None
    basic = profile.get("basic") or {}
    professional = profile.get("professional") or {}
    for val in (
        basic.get("username"),
        professional.get("fullname"),
        basic.get("email"),
        professional.get("email"),
        profile.get("full_name"),
        profile.get("name"),
    ):
        if val:
            return str(val).strip()
    return None


def _is_profile_lookup_question(question: str) -> bool:
    q = (question or "").strip().lower()
    if not q:
        return False
    keys = (
        "my name",
        "what is my name",
        "who am i",
        "my email",
        "my role",
        "my organization",
        "my profile",
        "profile details",
    )
    return any(k in q for k in keys)


def _build_profile_lookup_answer(profile: dict[str, Any] | None) -> str:
    name = _profile_name(profile) or "Not set"
    email = _profile_field(profile, "email") or "Not set"
    role = _profile_field(profile, "primary_role") or "Not set"
    org = _profile_field(profile, "organization_name") or "Not set"
    jurisdiction = _profile_field(profile, "primary_jurisdiction") or "Not set"
    return (
        "Here are your current profile details:\n"
        f"- Name: {name}\n"
        f"- Email: {email}\n"
        f"- Role: {role}\n"
        f"- Organization: {org}\n"
        f"- Jurisdiction: {jurisdiction}"
    )


async def get_limits_payload(user_id: str | None) -> dict[str, Any]:
    cfg = await get_llm_config(user_id)
    upload_mb = get_multer_upload_ceiling_mb(cfg)
    return {
        "success": True,
        "data": {
            "max_document_size_mb": cfg.get("max_document_size_mb"),
            "multer_upload_ceiling_mb": cfg.get("multer_upload_ceiling_mb"),
            "max_upload_mb": upload_mb,
            "max_upload_bytes": int(upload_mb * 1024 * 1024),
            "max_upload_files": cfg.get("max_upload_files"),
            "max_file_upload_per_day": cfg.get("max_file_upload_per_day"),
            "max_document_pages": cfg.get("max_document_pages"),
            "max_output_tokens": cfg.get("max_output_tokens"),
            "max_output_tokens_cap": cfg.get("max_output_tokens_cap"),
            "min_output_tokens": cfg.get("min_output_tokens"),
            "model_temperature": cfg.get("model_temperature"),
            "temperature_min": cfg.get("temperature_min"),
            "temperature_max": cfg.get("temperature_max"),
            "streaming_delay_ms": get_streaming_delay_ms(cfg),
            "quota_chats_per_minute": cfg.get("quota_chats_per_minute"),
            "messages_per_hour": cfg.get("messages_per_hour"),
            "chats_per_day": cfg.get("chats_per_day"),
            "total_tokens_per_day": cfg.get("total_tokens_per_day"),
            "next_daily_reset_utc": get_next_utc_midnight_iso(),
            "llm_model": cfg.get("llm_model"),
            "llm_provider": cfg.get("llm_provider"),
            "plan_id": cfg.get("_plan_id"),
            "plan_name": cfg.get("_plan_name"),
        },
    }


async def initiate_upload(user_id: str, filename: str, mimetype: str, size: int) -> dict[str, Any]:
    if not filename:
        raise ValueError("filename is required")
    if size <= 0:
        raise ValueError("size must be a positive number")
    cfg = await get_llm_config(user_id)

    # Per-file limits (size, daily count, PDF pages)
    policy = await assert_upload_allowed(user_id, cfg, size_bytes=size, mimetype=mimetype, originalname=filename)
    if not policy.get("ok"):
        raise ValueError(policy.get("message"))

    # Cumulative storage quota — block before the signed URL is issued
    storage = assert_storage_allowed(user_id, size)
    if not storage.get("ok"):
        err = ValueError(storage.get("message", "Storage limit exceeded"))
        err.code = storage.get("code", "STORAGE_LIMIT_EXCEEDED")   # type: ignore[attr-defined]
        err.details = storage.get("details", {})                    # type: ignore[attr-defined]
        raise err

    bucket = get_settings().gcs_bucket_name
    if not bucket:
        raise RuntimeError("GCS_BUCKET_NAME not configured")
    gcs_path = build_chat_upload_path(user_id, filename)
    signed = create_signed_upload_url(bucket, gcs_path, mimetype or "application/octet-stream")
    token = sign_upload_token(
        {
            "user_id": str(user_id),
            "bucket": bucket,
            "gcs_path": gcs_path,
            "filename": filename,
            "mimetype": mimetype or "application/octet-stream",
            "size": size,
            "kind": "chat_signed_upload",
        }
    )
    return {
        "success": True,
        "data": {
            "upload_url": signed["upload_url"],
            "method": "PUT",
            "headers": {"Content-Type": signed["contentType"]},
            "upload_token": token,
            "gcs_path": gcs_path,
            "gcs_uri": f"gs://{bucket}/{gcs_path}",
            "expires_at": signed["expiresAt"],
        },
    }


async def complete_upload(user_id: str, upload_token: str, filename: str, mimetype: str, size: int) -> dict[str, Any]:
    payload = verify_upload_token(upload_token)
    if not payload or payload.get("kind") != "chat_signed_upload":
        raise ValueError("Invalid or expired upload token")
    if str(payload.get("user_id")) != str(user_id):
        raise PermissionError("Upload token does not belong to this user")

    bucket = get_settings().gcs_bucket_name
    gcs_path = payload["gcs_path"]
    meta = get_object_metadata(bucket, gcs_path)
    object_size = int(meta.get("size") or 0)
    expected = int(size or payload.get("size") or 0)
    if expected > 0 and object_size != expected:
        delete_object_if_exists(bucket, gcs_path)
        raise ValueError(f"Uploaded size mismatch. Expected {expected}, got {object_size}")

    final_name = filename or payload.get("filename") or gcs_path.split("/")[-1]
    final_mime = mimetype or meta.get("content_type") or payload.get("mimetype") or "application/octet-stream"
    cfg = await get_llm_config(user_id)
    buf = None
    if int(cfg.get("max_document_pages") or 0) > 0 and (
        final_mime == "application/pdf" or final_name.lower().endswith(".pdf")
    ):
        if object_size <= INLINE_PAGE_CHECK_MAX_MB * 1024 * 1024:
            buf = download_object_buffer(bucket, gcs_path)
    policy = await assert_upload_allowed(
        user_id, cfg, size_bytes=object_size, buffer=buf, mimetype=final_mime, originalname=final_name
    )
    if not policy.get("ok"):
        delete_object_if_exists(bucket, gcs_path)
        raise ValueError(policy.get("message"))

    # Cumulative storage quota — delete GCS object and reject if over limit
    storage = assert_storage_allowed(user_id, object_size)
    if not storage.get("ok"):
        delete_object_if_exists(bucket, gcs_path)
        err = ValueError(storage.get("message", "Storage limit exceeded"))
        err.code = storage.get("code", "STORAGE_LIMIT_EXCEEDED")   # type: ignore[attr-defined]
        err.details = storage.get("details", {})                    # type: ignore[attr-defined]
        raise err

    row = FileRepository.create(user_id, final_name, gcs_path, final_mime, object_size)
    return {
        "success": True,
        "message": "File uploaded successfully",
        "data": {
            "file_id": row.get("id"),
            "filename": final_name,
            "gcs_uri": f"gs://{bucket}/{gcs_path}",
            "size": object_size,
            "mimetype": final_mime,
        },
    }


async def upload_from_google_drive(user_id: str, file_id: str, access_token: str) -> dict[str, Any]:
    if not file_id:
        raise ValueError("Google Drive file ID is required")
    if not access_token:
        raise ValueError("Google Drive access token is required")
    try:
        downloaded = await download_from_drive(access_token, file_id)
    except Exception as exc:
        msg = str(exc)
        if "invalid_grant" in msg.lower() or "invalid credentials" in msg.lower():
            return {"success": False, "message": "Google Drive access token expired.", "needsAuth": True}
        raise
    buf = downloaded["buffer"]
    filename = downloaded["filename"]
    mime_type = downloaded["mimeType"]
    cfg = await get_llm_config(user_id)
    policy = await assert_upload_allowed(
        user_id, cfg, size_bytes=len(buf), buffer=buf, mimetype=mime_type, originalname=filename
    )
    if not policy.get("ok"):
        raise ValueError(policy.get("message"))

    # Cumulative storage quota — block before writing to GCS
    storage = assert_storage_allowed(user_id, len(buf))
    if not storage.get("ok"):
        err = ValueError(storage.get("message", "Storage limit exceeded"))
        err.code = storage.get("code", "STORAGE_LIMIT_EXCEEDED")   # type: ignore[attr-defined]
        err.details = storage.get("details", {})                    # type: ignore[attr-defined]
        raise err

    bucket = get_settings().gcs_bucket_name
    gcs_path = build_chat_upload_path(user_id, filename)
    gcs_uri = upload_file_to_gcs(bucket, gcs_path, buf, mime_type)
    row = FileRepository.create(user_id, filename, gcs_path, mime_type, len(buf))
    return {
        "success": True,
        "message": "File downloaded from Google Drive and uploaded successfully",
        "data": {
            "file_id": row.get("id"),
            "filename": filename,
            "gcs_uri": gcs_uri,
            "size": len(buf),
            "mimetype": mime_type,
        },
    }


async def _load_files_for_chat(user_id: str, file_ids: list[str], cfg: dict[str, Any]) -> tuple[list[dict], list[str]]:
    bucket = get_settings().gcs_bucket_name
    files = []
    for fid in file_ids:
        row = FileRepository.find_by_id(fid)
        if not row:
            raise ValueError(f"File not found: {fid}")
        if str(row.get("user_id")) != str(user_id):
            raise PermissionError("You do not have permission to access one or more of these files")
        if not row.get("gcs_path"):
            raise ValueError(f"GCS path not found for file {fid}")
        policy = assert_stored_file_meets_limits(row, cfg)
        if not policy.get("ok"):
            raise ValueError(policy.get("message"))
        files.append(row)
    uris = [to_gcs_uri(bucket, f["gcs_path"]) for f in files]
    return files, uris


async def stream_document_chat(ctx: dict[str, Any]) -> AsyncIterator[str]:
    body = ctx.get("request_body") or {}
    user_id = str(ctx["user_id"])
    authorization = ctx.get("authorization")
    llm_cfg = ctx.get("llm_config") or await get_llm_config(user_id)
    llm_req = ctx.get("llm_config_for_request") or merge_request_overrides(llm_cfg, body)
    delay_ms = get_streaming_delay_ms(llm_cfg)

    sse = _sse_line

    yield sse({"type": "status", "status": "initializing", "message": "Starting chat request..."})

    used_secret = bool(body.get("used_secret_prompt"))
    question = (body.get("question") or "").strip()

    # Web-search judgement / citation finder (frontend "Citation" mode or intent).
    # Runs grounded in the uploaded document; bypasses the document cache path.
    if wants_judgement_search(body):
        async for line in stream_judgement_chat(ctx):
            yield line
        return

    if not used_secret and not question:
        yield sse({"type": "error", "message": "Question is required"})
        yield sse("[DONE]")
        return
    if used_secret and not body.get("secret_id"):
        yield sse({"type": "error", "message": "secret_id is required when using secret prompts"})
        yield sse("[DONE]")
        return

    file_ids = parse_file_ids_from_body(body)
    if not file_ids:
        yield sse({"type": "error", "message": "file_id or file_ids is required"})
        yield sse("[DONE]")
        return

    max_files = max(1, int(llm_cfg.get("max_upload_files") or 8))
    if len(file_ids) > max_files:
        yield sse({"type": "error", "message": f"Too many files attached ({len(file_ids)}). Maximum is {max_files}."})
        yield sse("[DONE]")
        return

    has_session = is_valid_uuid(body.get("session_id"))
    final_session = body["session_id"] if has_session else str(uuid.uuid4())
    primary_file = file_ids[0]

    try:
        yield sse({"type": "status", "status": "validating", "message": "Validating file access..."})
        files, uris = await _load_files_for_chat(user_id, file_ids, llm_cfg)
        bucket = get_settings().gcs_bucket_name

        if has_session:
            history_rows = FileChatRepository.get_history(primary_file, final_session)
        else:
            history_rows = FileChatRepository.get_history(primary_file, None)[-5:]

        attached = resolve_attached_files_for_session(history_rows, files[0], primary_file, bucket)
        if len(files) > 1:
            # The request explicitly attached multiple files (file_ids) — they
            # define the grounding set. Without this, the history-derived
            # attachment (which only knows the session's original file) would
            # silently drop every added source.
            attached = build_attached_files_snapshot(files, bucket) or attached
        active_uris = build_active_gcs_uris_from_attached(attached) or uris
        # Only the last Q&A turn is sent as context to the LLM
        conv = format_conversation_history(history_rows[-1:])
        hist_storage = simplify_history(history_rows)

        final_question = question
        final_label = body.get("prompt_label")
        secret_id_save = None
        used_secret_prompt = used_secret
        # The admin-configured Chat Model (llm_chat_config.llm_model) is
        # authoritative — client llm_name never overrides it.
        resolved_model = llm_req.get("llm_model") or llm_cfg.get("llm_model")

        if used_secret:
            secret = await resolve_secret_prompt(str(body["secret_id"]), body.get("additional_input") or "")
            final_question = secret["prompt_text"]
            if question:
                final_question = f"{final_question}\n\nUser question: {question}"
            final_label = secret.get("name") or final_label
            secret_id_save = secret.get("secret_id")
            # secret.llm_name is intentionally ignored — preset prompts use the
            # plan model so caching works identically for custom and preset queries.

        profile = await get_full_profile(user_id, authorization)
        if not profile:
            profile = _derive_fallback_profile(ctx)
        system = build_system_instruction(profile)
        profile_prefix = build_profile_query_prefix(profile)
        if _is_profile_lookup_question(question):
            full_answer = _build_profile_lookup_answer(profile)
            yield sse(
                {
                    "type": "done",
                    "session_id": final_session,
                    "chat_id": None,
                    "answer": full_answer,
                    "file_id": primary_file,
                    "file_ids": file_ids,
                    "filename": files[0].get("originalname"),
                    "answer_length": len(full_answer),
                    "chunks_received": 0,
                    "used_secret_prompt": used_secret_prompt,
                    "prompt_label": final_label,
                    "secret_id": secret_id_save,
                    "cache_session_id": None,
                    "used_gemini_cache": False,
                    "cache_session_metrics": None,
                }
            )
            yield sse("[DONE]")
            return

        # Claude chat models run WITHOUT Gemini explicit caching — the document
        # is sent directly to the Anthropic API by stream_llm_with_gcs below.
        # Clients may also opt out entirely (disable_cache: true — used by the
        # Case Storage "Ask Jurinex" chat): no cache is checked, created, or
        # stored; the request goes straight to direct GCS streaming.
        use_claude = _is_claude_model(resolved_model)
        disable_cache = bool(body.get("disable_cache"))
        if not use_claude and not disable_cache:
            yield sse({"type": "status", "status": "cache_check", "message": "Checking Gemini explicit cache..."})

        # Use the plan/admin-configured model; fall back to ADK default
        from app.core.config import get_settings as _get_settings
        cache_model = resolved_model or _get_settings().adk_model or "gemini-2.5-pro"

        # Download file buffers only when the ADK path still needs the document
        # bytes (cache creation). Once a valid Gemini cache exists, questions are
        # answered against the named cache — re-downloading a large PDF from GCS
        # on every message only adds seconds of latency. If the cache expires
        # between this check and generation, the ADK path yields nothing and the
        # GCS fallback below fetches the bytes itself.
        file_specs = []
        if not use_claude and not disable_cache:
            cache_is_active = await gemini_cache_service.has_active_cache(primary_file)
            if not cache_is_active:
                for f in files:
                    file_specs.append(
                        {
                            "buffer": await asyncio.get_event_loop().run_in_executor(
                                None, lambda path=f["gcs_path"]: download_object_buffer(bucket, path)
                            ),
                            "mimetype": f.get("mimetype") or "application/octet-stream",
                            "filename": f.get("originalname") or "document",
                        }
                    )

        full_answer = ""
        chunk_count = 0
        captured_usage = None
        used_gemini_cache = False
        cache_question = f"{profile_prefix}\n\n{final_question}" if profile_prefix else final_question
        if conv:
            cache_question = f"PREVIOUS CONVERSATION:\n{conv}\n\nCURRENT QUESTION:\n{cache_question}"

        async def _pipe_llm_events(
            events: AsyncIterator[dict[str, Any]],
            *,
            swallow_error_before_output: bool = False,
        ) -> AsyncIterator[str]:
            nonlocal full_answer, chunk_count, captured_usage
            emitted_here = 0  # chunks this generator has sent to the client
            async for ev in events:
                # Authoritative stitched answer from the generator (excludes
                # degenerate/restarted rounds that were streamed live) — replaces
                # the chunk accumulation; never forwarded to the client directly.
                if ev.get("type") in ("final_answer", "done"):
                    authoritative = ev.get("text") or ev.get("answer") or ""
                    # Unconditional replace: an EMPTY stitched answer means every
                    # round was degenerate — the streamed garbage must not survive.
                    full_answer = authoritative
                    continue
                if ev.get("type") == "thought":
                    yield sse({"type": "thought", "text": ev.get("text", "")})
                elif ev.get("type") == "status":
                    yield sse(
                        {
                            "type": "status",
                            "status": ev.get("status") or "continuing",
                            "message": ev.get("message") or "Continuing...",
                        }
                    )
                elif ev.get("type") == "chunk":
                    full_answer += ev.get("text", "")
                    chunk_count += 1
                    emitted_here += 1
                    yield sse({"type": "chunk", "text": ev.get("text", "")})
                    if delay_ms > 0:
                        await asyncio.sleep(delay_ms / 1000.0)
                elif ev.get("type") == "usage":
                    captured_usage = ev
                    metrics = ev.get("sessionMetrics")
                    if metrics:
                        yield sse({"type": "cache_session", "cache_session_metrics": metrics})
                    yield sse({"type": "usage", "tokenUsage": ev, "sessionMetrics": metrics})
                elif ev.get("type") == "error":
                    if swallow_error_before_output and emitted_here == 0:
                        # Nothing has reached the client yet, so let the caller
                        # fall back (ADK context-cache path -> direct GCS
                        # streaming) instead of surfacing an internal failure
                        # such as ADK's "Context variable not found" as the reply.
                        logger.warning(
                            "LLM stream error before any output (%s: %s) — falling back",
                            ev.get("code", "LLM_STREAM_ERROR"),
                            ev.get("message"),
                        )
                        break
                    logger.warning("LLM stream error: %s", ev.get("message"))
                    yield sse({"type": "error", "message": ev.get("message", "LLM stream error"), "code": ev.get("code", "LLM_STREAM_ERROR")})
                    break

        # ── ADK ContextCacheConfig path (Gemini only — Claude runs uncached) ──
        # ADK manages the Gemini explicit cache lifecycle automatically:
        # creation, TTL extension, refresh after N uses. No validate_cache_exists needed.
        if not use_claude and not disable_cache:
            try:
                yield sse({"type": "status", "status": "cache_check", "message": "Checking Gemini explicit cache..."})
                async for line in _pipe_llm_events(
                    gemini_cache_service.ask_with_context_cache(
                        file_id=primary_file,
                        question=cache_question,
                        user_id=user_id,
                        file_specs=file_specs,
                        system_instruction=system,
                        model_name=cache_model,
                        llm_config=llm_req,
                        chat_session_id=final_session,
                    ),
                    # The direct GCS path below is the fallback for this one.
                    swallow_error_before_output=True,
                ):
                    yield line

                if full_answer.strip():
                    used_gemini_cache = True
            except (Exception, BaseException) as cache_exc:
                if isinstance(cache_exc, GeneratorExit):
                    pass
                else:
                    logger.warning("ADK cache path failed (%s); falling back to GCS", cache_exc)
                    # If ADK failed, we might want to clear the priming status to force re-upload
                    # but let's see if GCS fallback works first.

        # ── Direct GCS streaming: primary path for Claude, fallback for Gemini ──
        if not full_answer.strip():
            if not use_claude and not disable_cache:
                logger.warning("Falling back to direct GCS streaming")
            yield sse(
                {
                    "type": "status",
                    "status": "generating",
                    "message": "Generating response..." if use_claude else "Processing document...",
                }
            )
            try:
                async for line in _pipe_llm_events(
                    stream_llm_with_gcs(
                        question=cache_question,
                        gcs_uris=active_uris,
                        llm_config=llm_req,
                        system_instruction=system,
                        model_name=resolved_model,
                        metadata={
                            "userId": user_id,
                            "fileId": primary_file,
                            "sessionId": final_session,
                            "endpoint": "/api/chat/ask/stream",
                        },
                    )
                ):
                    yield line
            except (Exception, BaseException) as gcs_exc:
                if isinstance(gcs_exc, GeneratorExit):
                    pass
                else:
                    logger.warning("GCS path failed: %s", gcs_exc)

        if not full_answer.strip():
            yield sse({"type": "error", "message": "Received empty response from LLM"})
            yield sse("[DONE]")
            return

        question_save = final_label if used_secret_prompt else question

        # GCS fallback path — persist usage since ask_with_context_cache didn't handle it
        # GCS fallback path — no explicit cache was used, so we don't log cache metrics here.

        try:
            cache_metrics = await gemini_cache_service.get_status_for_file(primary_file, session_id=final_session)
        except Exception:
            cache_metrics = None
        yield sse({"type": "cache_session", "cache_session_metrics": cache_metrics})

        yield sse({"type": "status", "status": "saving", "message": "Saving conversation to database..."})
        attached_snapshot = build_attached_files_snapshot(files, bucket)
        saved = {}
        try:
            saved = FileChatRepository.save_chat(
                primary_file,
                user_id,
                question_save or final_question,
                full_answer,
                final_session,
                used_secret_prompt=used_secret_prompt,
                prompt_label=final_label,
                secret_id=secret_id_save,
                chat_history=hist_storage,
                attached_files=attached_snapshot,
                # Case Storage ("Ask Jurinex") chats are tagged so they never
                # appear in ChatModel's conversation listings (which filter on
                # chat_type='chat_model'); per-file history has no type filter.
                chat_type="case_storage" if body.get("chat_source") == "case_storage" else "chat_model",
            )
        except Exception as save_exc:
            logger.warning("save_chat failed (answer will still be delivered): %s", save_exc)

        token_usage_payload = (
            {
                "inputTokens": captured_usage.get("inputTokens"),
                "cachedTokens": captured_usage.get("cachedTokens"),
                "newPromptTokens": captured_usage.get("newPromptTokens"),
                "outputTokens": captured_usage.get("outputTokens"),
                "totalTokens": captured_usage.get("totalTokens"),
                "queryCost": captured_usage.get("queryCost"),
                "cachedCost": captured_usage.get("cachedCost"),
                "promptCost": captured_usage.get("promptCost"),
                "outputCost": captured_usage.get("outputCost"),
                "modelName": captured_usage.get("modelName") or resolved_model,
                "pricing": captured_usage.get("pricing"),
                "cacheMechanism": captured_usage.get("cacheMechanism"),
            }
            if captured_usage
            else None
        )
        log_token_usage_table(
            context="stream_document_chat",
            usage=token_usage_payload,
            model_name=resolved_model,
            endpoint="/api/chat/ask/stream",
            session_id=final_session,
            user_id=user_id,
            answer_length=len(full_answer),
            chunks_received=chunk_count,
            cache_mechanism="gemini_explicit_adk" if used_gemini_cache else "gcs_fallback",
            max_output_tokens=llm_req.get("max_output_tokens"),
        )
        yield sse(
            {
                "type": "done",
                "session_id": final_session,
                "chat_id": saved.get("id"),
                "answer": full_answer,
                "file_id": primary_file,
                "file_ids": file_ids,
                "filename": files[0].get("originalname"),
                "answer_length": len(full_answer),
                "chunks_received": chunk_count,
                "used_secret_prompt": used_secret_prompt,
                "prompt_label": final_label,
                "secret_id": secret_id_save,
                "cache_session_id": None,
                "used_gemini_cache": used_gemini_cache,
                "cache_session_metrics": cache_metrics,
                "output_truncated": bool(captured_usage and captured_usage.get("outputTruncated")),
                "finish_reason": captured_usage.get("finishReason") if captured_usage else None,
                "token_usage": token_usage_payload,
            }
        )
        yield sse("[DONE]")
    except Exception as exc:
        logger.exception("stream_document_chat failed")
        yield sse({"type": "error", "message": str(exc)})
        yield sse("[DONE]")


async def stream_general_chat(ctx: dict[str, Any]) -> AsyncIterator[str]:
    body = ctx.get("request_body") or {}
    user_id = str(ctx["user_id"])
    authorization = ctx.get("authorization")
    llm_cfg = ctx.get("llm_config") or await get_llm_config(user_id)
    llm_req = ctx.get("llm_config_for_request") or merge_request_overrides(llm_cfg, body)
    delay_ms = get_streaming_delay_ms(llm_cfg)

    sse = _sse_line

    yield sse({"type": "status", "status": "initializing", "message": "Starting legal chat..."})
    question = (body.get("question") or "").strip()

    # Web-search judgement / citation finder (no document attached).
    if wants_judgement_search(body):
        async for line in stream_judgement_chat(ctx):
            yield line
        return

    if not question:
        yield sse({"type": "error", "message": "Question is required"})
        yield sse("[DONE]")
        return

    has_session = is_valid_uuid(body.get("session_id"))
    final_session = body["session_id"] if has_session else str(uuid.uuid4())

    try:
        yield sse({"type": "status", "status": "fetching", "message": "Loading your professional profile..."})
        profile = await get_full_profile(user_id, authorization)
        if not profile:
            profile = _derive_fallback_profile(ctx)
        profile_prefix = build_profile_query_prefix(profile)
        if _is_profile_lookup_question(question):
            full_answer = _build_profile_lookup_answer(profile)
            yield sse({"type": "metadata", "session_id": final_session})
            yield sse(
                {
                    "type": "done",
                    "session_id": final_session,
                    "chat_id": None,
                    "answer": full_answer,
                    "answer_length": len(full_answer),
                    "chunks_received": 0,
                    "is_general_chat": True,
                }
            )
            yield sse("[DONE]")
            return
        previous = FileChatRepository.get_general_history(user_id, final_session) if has_session else []
        # Only the last Q&A turn is sent as context to the LLM
        conv = format_conversation_history(previous[-1:])
        # No document attached — use general-chat system instruction (no doc-grounding rules)
        system = build_system_instruction(profile, is_document_chat=False)
        prompt = question
        if conv:
            prompt = f"PREVIOUS CONVERSATION:\n{conv}\n\nCURRENT QUESTION:\n{question}"
        if profile_prefix:
            prompt = f"{profile_prefix}\n\n{prompt}"

        yield sse({"type": "status", "status": "generating", "message": "Generating legal response..."})
        yield sse({"type": "metadata", "session_id": final_session})

        full_answer = ""
        chunk_count = 0
        captured_usage = None
        # The admin-configured Chat Model (llm_chat_config.llm_model) is
        # authoritative — client llm_name never overrides it.
        resolved_model = llm_req.get("llm_model") or llm_cfg.get("llm_model")

        async for ev in stream_llm_general(
            prompt_text=prompt,
            llm_config=llm_req,
            system_instruction=system,
            model_name=resolved_model,
            metadata={
                "userId": user_id,
                "sessionId": final_session,
                "endpoint": "/api/chat/ask/general/stream",
            },
        ):
            if ev.get("type") == "thought":
                yield sse({"type": "thought", "text": ev.get("text", "")})
            elif ev.get("type") == "status":
                yield sse(
                    {
                        "type": "status",
                        "status": ev.get("status") or "continuing",
                        "message": ev.get("message") or "Continuing...",
                    }
                )
            elif ev.get("type") == "chunk":
                full_answer += ev.get("text", "")
                chunk_count += 1
                yield sse({"type": "chunk", "text": ev.get("text", "")})
                if delay_ms > 0:
                    await asyncio.sleep(delay_ms / 1000.0)
            elif ev.get("type") == "usage":
                captured_usage = ev
            elif ev.get("type") in ("final_answer", "done"):
                authoritative = ev.get("text") or ev.get("answer") or ""
                # Unconditional replace (see doc path) — garbage must not survive.
                full_answer = authoritative

        if not full_answer.strip():
            yield sse({"type": "error", "message": "Received empty response from LLM"})
            yield sse("[DONE]")
            return

        yield sse({"type": "status", "status": "saving", "message": "Saving conversation to database..."})
        hist_storage = simplify_history(previous)
        saved = FileChatRepository.save_chat(
            None,
            user_id,
            question,
            full_answer,
            final_session,
            chat_history=hist_storage,
        )

        token_usage_payload = (
            {
                "inputTokens": captured_usage.get("inputTokens"),
                "outputTokens": captured_usage.get("outputTokens"),
                "totalTokens": captured_usage.get("totalTokens"),
                "modelName": captured_usage.get("modelName") or resolved_model,
            }
            if captured_usage
            else None
        )
        # Report the model ACTUALLY used (DeepSeek for free tier, or whatever the
        # fallback chain landed on) — not the admin's configured model.
        actual_model = (captured_usage.get("modelName") if captured_usage else None) or resolved_model
        log_token_usage_table(
            context="stream_general_chat",
            usage=token_usage_payload,
            model_name=actual_model,
            endpoint="/api/chat/ask/general/stream",
            session_id=final_session,
            user_id=user_id,
            answer_length=len(full_answer),
            chunks_received=chunk_count,
            max_output_tokens=llm_req.get("max_output_tokens"),
        )
        yield sse(
            {
                "type": "done",
                "session_id": final_session,
                "chat_id": saved.get("id"),
                "answer": full_answer,
                "answer_length": len(full_answer),
                "chunks_received": chunk_count,
                "is_general_chat": True,
                "output_truncated": bool(captured_usage and captured_usage.get("outputTruncated")),
                "finish_reason": captured_usage.get("finishReason") if captured_usage else None,
                "token_usage": token_usage_payload,
            }
        )
        yield sse("[DONE]")
    except Exception as exc:
        logger.exception("stream_general_chat failed")
        yield sse({"type": "error", "message": str(exc)})
        yield sse("[DONE]")


async def stream_judgement_chat(ctx: dict[str, Any]) -> AsyncIterator[str]:
    """Web-search grounded judgement / citation finder.

    Works with or without an uploaded document:
    - With files: identifies the document's legal issues and searches the web for
      relevant judgements / case law.
    - Without files: searches the web for judgements relevant to the question.

    Emits a ``sources`` SSE event with the grounding links, and appends a
    "## Sources" section to the saved answer.
    """
    body = ctx.get("request_body") or {}
    user_id = str(ctx["user_id"])
    authorization = ctx.get("authorization")
    llm_cfg = ctx.get("llm_config") or await get_llm_config(user_id)
    llm_req = ctx.get("llm_config_for_request") or merge_request_overrides(llm_cfg, body)
    delay_ms = get_streaming_delay_ms(llm_cfg)

    sse = _sse_line

    # ── Background step trace (logged to console as an ASCII table at the end) ──
    _t0 = time.monotonic()
    _last = [_t0]
    trace: list[list[Any]] = []

    def step(name: str, status: str, detail: str = "") -> None:
        now = time.monotonic()
        trace.append([
            f"{len(trace) + 1}",
            name,
            status,
            (detail[:60] if detail else "-"),
            f"{(now - _last[0]) * 1000:.0f}",
            f"{(now - _t0) * 1000:.0f}",
        ])
        _last[0] = now

    def flush_trace() -> None:
        log_table(
            "JUDGEMENT / CITATION SEARCH - BACKGROUND TRACE",
            ["#", "Step", "Status", "Detail", "dt ms", "Total ms"],
            trace,
        )

    yield sse({"type": "status", "status": "initializing", "message": "Starting citation search..."})

    question = (body.get("question") or "").strip()
    used_secret = body.get("used_secret", False)
    if used_secret:
        secret = await resolve_secret_prompt(str(body["secret_id"]), body.get("additional_input") or "")
        question = secret["prompt_text"]
    
    file_ids = parse_file_ids_from_body(body)
    step("Classify request", "citation_mode", f"files={len(file_ids)} question={'yes' if question else 'no'}")
    if not question and not file_ids:
        step("Validate input", "error", "no question and no document")
        flush_trace()
        yield sse({"type": "error", "message": "Question or a document is required"})
        yield sse("[DONE]")
        return

    has_session = is_valid_uuid(body.get("session_id"))
    final_session = body["session_id"] if has_session else str(uuid.uuid4())
    primary_file = file_ids[0] if file_ids else None
    
    # The admin-configured Chat Model (llm_chat_config.llm_model) is
    # authoritative — client llm_name never overrides it.
    resolved_model = (
        llm_req.get("llm_model")
        or llm_cfg.get("llm_model")
        or "gemini-2.5-pro"
    )
    
    try:
        file_specs: list[dict[str, Any]] = []
        file_uris: list[str] = []
        files: list[dict[str, Any]] = []
        bucket = get_settings().gcs_bucket_name
        # Vertex can read gs:// URIs directly (no 20MB inline-request limit);
        # an API-key client cannot, so it must receive inline bytes.
        use_api_key = bool(get_settings().gemini_api_key)
        if file_ids:
            yield sse({"type": "status", "status": "validating", "message": "Validating file access..."})
            files, file_uris = await _load_files_for_chat(user_id, file_ids, llm_cfg)
            if use_api_key:
                for f in files:
                    file_specs.append(
                        {
                            "buffer": await asyncio.get_event_loop().run_in_executor(
                                None, lambda path=f["gcs_path"]: download_object_buffer(bucket, path)
                            ),
                            "mimetype": f.get("mimetype") or "application/octet-stream",
                            "filename": f.get("originalname") or "document",
                        }
                    )
                _kb = sum(len(s.get("buffer") or b"") for s in file_specs) // 1024
                step("Load documents", "ok", f"{len(files)} file(s), {_kb} KB (inline)")
            else:
                step("Load documents", "ok", f"{len(files)} file(s) via GCS URI")
        else:
            step("Load documents", "skipped", "no document attached")

        # Conversation history (last turn only, mirroring the other chat flows)
        if primary_file:
            history_rows = (
                FileChatRepository.get_history(primary_file, final_session)
                if has_session
                else FileChatRepository.get_history(primary_file, None)[-5:]
            )
        else:
            history_rows = (
                FileChatRepository.get_general_history(user_id, final_session) if has_session else []
            )
        conv = format_conversation_history(history_rows[-1:])
        step("Load history", "ok", f"{len(history_rows)} turn(s)")

        profile = await get_full_profile(user_id, authorization)
        if not profile:
            profile = _derive_fallback_profile(ctx)
        # Use the non-document-grounded base: the judgement section explains how to
        # use any attached document (extract issues, then search), which would
        # otherwise conflict with the "answer ONLY from the document" grounding rule.
        system = build_system_instruction(profile, is_document_chat=False) + JUDGEMENT_SEARCH_SECTION
        profile_prefix = build_profile_query_prefix(profile)

        if file_ids:
            # Instruct the model to extract concrete facts FIRST, then search for
            # factually parallel judgements — not just topically related ones.
            fact_extraction_prefix = (
                "TASK: Find court judgements whose FACTS are similar to the facts in the attached document.\n\n"
                "STEP 1 — Extract facts from the document:\n"
                "Read the attached document carefully and identify:\n"
                "  a) The specific dispute/incident (what happened, when, where)\n"
                "  b) The parties involved (type of parties, their relationship)\n"
                "  c) The exact legal claims or offences alleged\n"
                "  d) The specific relief or remedy being sought\n"
                "  e) Any specific statutes, sections, or contracts mentioned\n\n"
                "STEP 2 — Build FACT-SPECIFIC search queries:\n"
                "Use those extracted facts to build search queries like:\n"
                "  '[specific fact] [specific section] court judgment India'\n"
                "  '[type of dispute] [specific circumstance] High Court quash'\n"
                "Run at least 3-4 searches with different fact-combinations.\n\n"
                "STEP 3 — Only cite judgements where the FACTS match:\n"
                "A judgement is relevant ONLY if:\n"
                "  - The type of dispute/incident is the same or very similar\n"
                "  - The parties are in a similar relationship\n"
                "  - The court dealt with the same specific legal question arising from similar facts\n"
                "DO NOT cite cases that merely discuss the same statute or legal principle "
                "if the underlying facts are completely different.\n\n"
            )
            user_q = question or "Find judgements with similar facts to the attached document."
            search_question = fact_extraction_prefix + "USER QUESTION: " + user_q
        else:
            search_question = question or "Find court judgements and case law relevant to this legal matter."

        if conv:
            search_question = f"PREVIOUS CONVERSATION:\n{conv}\n\nCURRENT QUESTION:\n{search_question}"
        if profile_prefix:
            search_question = f"{profile_prefix}\n\n{search_question}"

        step("Build prompt", "ok", f"model={resolved_model} q_len={len(search_question)}")
        yield sse({"type": "status", "status": "searching", "message": "Searching the web for relevant judgements..."})
        yield sse({"type": "metadata", "session_id": final_session})

        search_queries: list[str] = []
        full_answer = ""
        chunk_count = 0
        captured_usage = None
        sources: list[dict[str, Any]] = []
        search_error: str | None = None

        async for ev in stream_judgement_search(
            question=search_question,
            llm_config=llm_req,
            system_instruction=system,
            file_specs=file_specs or None,
            gcs_uris=file_uris or None,
            model_name=resolved_model,
            metadata={
                "userId": user_id,
                "fileId": primary_file,
                "sessionId": final_session,
                "endpoint": "/api/chat/ask/judgement/stream",
            },
        ):
            etype = ev.get("type")
            if etype == "thought":
                yield sse({"type": "thought", "text": ev.get("text", "")})
            elif etype == "status":
                yield sse(
                    {
                        "type": "status",
                        "status": ev.get("status") or "continuing",
                        "message": ev.get("message") or "Continuing...",
                    }
                )
            elif etype == "chunk":
                full_answer += ev.get("text", "")
                chunk_count += 1
                yield sse({"type": "chunk", "text": ev.get("text", "")})
                if delay_ms > 0:
                    await asyncio.sleep(delay_ms / 1000.0)
            elif etype == "sources":
                sources = ev.get("sources") or []
                search_queries = ev.get("queries") or []
                yield sse({"type": "sources", "sources": sources, "queries": search_queries})
            elif etype == "usage":
                captured_usage = ev
            elif etype == "error":
                # Capture but don't surface yet — we fall back to a model-knowledge
                # answer below so the user is never left with a blank card.
                search_error = ev.get("message")
                step("Web search", "error", (search_error or "")[:60])

        step(
            "Web search",
            "ok" if full_answer.strip() else "empty",
            f"queries={len(search_queries)} sources={len(sources)} chunks={chunk_count}",
        )

        # ── Fallback: grounding unavailable/empty → answer from model knowledge ──
        if not full_answer.strip():
            logger.warning("Judgement grounding empty (err=%s); falling back to model knowledge", search_error)
            step("Fallback", "model_knowledge", (search_error or "grounding returned no text")[:60])
            yield sse({"type": "status", "status": "generating", "message": "Composing judgement answer..."})
            fb_system = system + (
                "\n\nNOTE: live web search was unavailable or returned no results for this query. Answer from "
                "your own legal knowledge using Gemini 2.5 Pro, but follow these rules strictly:\n"
                "- Begin with this exact line: '> ⚠️ Live web search was unavailable or returned no results, so the "
                "judgements below are from general knowledge and MUST be independently verified "
                "on Indian Kanoon or the official court website before relying on them.'\n"
                "- Only mention landmark/well-established reported judgements you are highly "
                "confident actually exist. If unsure, say you cannot confirm a specific case.\n"
                "- Do NOT write any URLs, 'Indian Kanoon:' lines, or fake source links — you "
                "have no verified sources."
            )
            async for ev in stream_llm_general(
                prompt_text=search_question,
                llm_config=llm_req,
                system_instruction=fb_system,
                model_name=resolved_model,
                metadata={
                    "userId": user_id,
                    "sessionId": final_session,
                    "endpoint": "/api/chat/ask/judgement/stream",
                },
            ):
                if ev.get("type") == "thought":
                    yield sse({"type": "thought", "text": ev.get("text", "")})
                elif ev.get("type") == "status":
                    yield sse(
                        {
                            "type": "status",
                            "status": ev.get("status") or "continuing",
                            "message": ev.get("message") or "Continuing...",
                        }
                    )
                elif ev.get("type") == "chunk":
                    full_answer += ev.get("text", "")
                    chunk_count += 1
                    yield sse({"type": "chunk", "text": ev.get("text", "")})
                    if delay_ms > 0:
                        await asyncio.sleep(delay_ms / 1000.0)
                elif ev.get("type") == "usage":
                    captured_usage = ev
                elif ev.get("type") in ("final_answer", "done"):
                    authoritative = ev.get("text") or ev.get("answer") or ""
                    # Unconditional replace: an EMPTY stitched answer means every
                    # round was degenerate — the streamed garbage must not survive.
                    full_answer = authoritative

        if not full_answer.strip():
            step("Generate answer", "empty", (search_error or "no judgements found")[:60])
            flush_trace()
            yield sse({"type": "error", "message": search_error or "Could not generate a judgement answer. Please try again."})
            yield sse("[DONE]")
            return
        step("Generate answer", "ok", f"{len(full_answer)} chars")

        # Log the grounding sources as their own console table.
        if sources:
            log_table(
                "JUDGEMENT / CITATION SEARCH - SOURCES",
                ["#", "Title", "URL"],
                [[str(i + 1), (s.get("title") or "")[:50], (s.get("uri") or "")] for i, s in enumerate(sources)],
            )

        # The model already renders each case with an inline clickable [Source](url)
        # link, so the answer is persisted as-is (no extra Sources section).
        answer_to_save = full_answer

        yield sse({"type": "status", "status": "saving", "message": "Saving conversation to database..."})
        hist_storage = simplify_history(history_rows)
        saved = {}
        try:
            attached_snapshot = build_attached_files_snapshot(files, bucket) if files else []
            if sources:
                if attached_snapshot is None:
                    attached_snapshot = []
                attached_snapshot.append({"type": "sources_metadata", "sources": sources})
            
            saved = FileChatRepository.save_chat(
                primary_file,
                user_id,
                question or "Find relevant judgements",
                answer_to_save,
                final_session,
                chat_history=hist_storage,
                attached_files=attached_snapshot,
            )
            step("Save chat", "ok", f"chat_id={saved.get('id')}")
        except Exception as save_exc:
            step("Save chat", "error", str(save_exc)[:60])
            logger.warning("save_chat (judgement) failed: %s", save_exc)

        token_usage_payload = (
            {
                "inputTokens": captured_usage.get("inputTokens"),
                "outputTokens": captured_usage.get("outputTokens"),
                "totalTokens": captured_usage.get("totalTokens"),
                "modelName": captured_usage.get("modelName") or resolved_model,
            }
            if captured_usage
            else None
        )
        log_token_usage_table(
            context="stream_judgement_chat",
            usage=token_usage_payload,
            model_name=resolved_model,
            endpoint="/api/chat/ask/judgement/stream",
            session_id=final_session,
            user_id=user_id,
            answer_length=len(full_answer),
            chunks_received=chunk_count,
            cache_mechanism="web_search_grounding",
            max_output_tokens=llm_req.get("max_output_tokens"),
        )
        flush_trace()
        yield sse(
            {
                "type": "done",
                "session_id": final_session,
                "chat_id": saved.get("id"),
                "answer": answer_to_save,
                "file_id": primary_file,
                "file_ids": file_ids,
                "filename": files[0].get("originalname") if files else None,
                "answer_length": len(answer_to_save),
                "chunks_received": chunk_count,
                "sources": sources,
                "is_general_chat": not bool(file_ids),
                "used_web_search": True,
                "token_usage": token_usage_payload,
            }
        )
        yield sse("[DONE]")
    except Exception as exc:
        logger.exception("stream_judgement_chat failed")
        step("Fatal error", "error", str(exc)[:60])
        flush_trace()
        yield sse({"type": "error", "message": str(exc)})
        yield sse("[DONE]")


def get_user_files_payload(user_id: str) -> dict[str, Any]:
    files = FileRepository.find_by_user(user_id)
    return {
        "success": True,
        "data": {
            "files": [
                {
                    "id": f.get("id"),
                    "filename": f.get("originalname"),
                    "size": f.get("size"),
                    "mimetype": f.get("mimetype"),
                    "status": f.get("status"),
                    "created_at": f.get("created_at"),
                }
                for f in files
            ]
        },
    }


def get_chat_history_payload(user_id: str, file_id: str, session_id: str | None) -> dict[str, Any]:
    if not is_valid_uuid(file_id):
        raise ValueError("Invalid file_id format. file_id must be a valid UUID.")
    file_row = FileRepository.find_by_id(file_id)
    if not file_row:
        raise ValueError("File not found")
    if str(file_row.get("user_id")) != str(user_id):
        raise PermissionError("You do not have permission to access this file")
    history_rows = FileChatRepository.get_history(file_id, session_id)
    bucket = get_settings().gcs_bucket_name
    attached = resolve_attached_files_for_session(history_rows, file_row, file_id, bucket)
    file_ids = list({a.get("file_id") for a in attached if a.get("file_id")}) if attached else [file_id]
    history = []
    for r in history_rows:
        raw_attached = parse_attached_files_cell(r.get("attached_files"))
        sources = []
        final_attached = raw_attached
        if isinstance(raw_attached, list):
            # Extract sources_metadata if present
            sources_item = next((item for item in raw_attached if isinstance(item, dict) and item.get("type") == "sources_metadata"), None)
            if sources_item:
                sources = sources_item.get("sources") or []
                # Filter out the metadata item from the files list
                final_attached = [item for item in raw_attached if not (isinstance(item, dict) and item.get("type") == "sources_metadata")]
        
        history.append({
            "id": r.get("id"),
            "question": r.get("question"),
            "answer": r.get("answer"),
            "session_id": r.get("session_id"),
            "created_at": r.get("created_at"),
            "used_secret_prompt": bool(r.get("used_secret_prompt")),
            "prompt_label": r.get("prompt_label"),
            "secret_id": r.get("secret_id"),
            "file_id": r.get("file_id") or file_id,
            "attached_files": final_attached,
            "sources": sources,
        })
    return {
        "success": True,
        "data": {
            "file_id": file_id,
            "filename": file_row.get("originalname"),
            "session_id": session_id,
            "history": history,
            "count": len(history),
            "attached_files": attached,
            "file_ids": file_ids,
        },
    }


def get_document_sessions_payload(user_id: str, file_id: str) -> dict[str, Any]:
    if not is_valid_uuid(file_id):
        raise ValueError("Invalid file_id format")
    file_row = FileRepository.find_by_id(file_id)
    if not file_row:
        raise ValueError("File not found")
    if str(file_row.get("user_id")) != str(user_id):
        raise PermissionError("Forbidden")
    sessions = FileChatRepository.get_document_sessions_for_file(file_id)
    return {
        "success": True,
        "data": {
            "file_id": file_id,
            "filename": file_row.get("originalname"),
            "sessions": sessions,
            "count": len(sessions),
        },
    }


def get_general_history_payload(user_id: str, session_id: str) -> dict[str, Any]:
    if not is_valid_uuid(session_id):
        raise ValueError("Invalid session_id format")
    rows = FileChatRepository.get_general_history(user_id, session_id)
    history = []
    for r in rows:
        raw_attached = parse_attached_files_cell(r.get("attached_files"))
        sources = []
        final_attached = raw_attached
        if isinstance(raw_attached, list):
            sources_item = next((item for item in raw_attached if isinstance(item, dict) and item.get("type") == "sources_metadata"), None)
            if sources_item:
                sources = sources_item.get("sources") or []
                final_attached = [item for item in raw_attached if not (isinstance(item, dict) and item.get("type") == "sources_metadata")]
        
        history.append({
            "id": r.get("id"),
            "question": r.get("question"),
            "answer": r.get("answer"),
            "session_id": r.get("session_id"),
            "created_at": r.get("created_at"),
            "used_secret_prompt": False,
            "prompt_label": None,
            "file_id": None,
            "is_general_chat": True,
            "attached_files": final_attached,
            "sources": sources,
        })
    return {
        "success": True,
        "data": {"session_id": session_id, "history": history, "count": len(history), "is_general_chat": True},
    }


# Backward compat alias used by pipeline tools
parse_file_ids = parse_file_ids_from_body
stream_file_chat = stream_document_chat
