from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from app.core.limiter import limiter
from app.core.config import get_settings
from app.schemas.models import ChatRequest, ChatResponse
from app.services.chatbot import text_chat
from app.services.session_service import get_or_create_session, save_exchange, get_history
from app.services.token_usage_service import log_token_usage

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger("ai_chatbot.chat")


@router.post("", response_model=ChatResponse, summary="Text chat (Gemini function-calling)")
@limiter.limit(lambda: get_settings().rate_limit_chat)
async def chat_endpoint(
    body: ChatRequest,
    request: Request,
    background_tasks: BackgroundTasks,
) -> ChatResponse:
    ip_address = request.client.host if request.client else None
    logger.info("POST /api/chat  session=%s  ip=%s", body.session_id, ip_address)

    loop = asyncio.get_running_loop()

    # Session lookup/create — fast DB query, but still blocking so run in thread
    session_id = await loop.run_in_executor(
        None, get_or_create_session, body.session_id, "text"
    )
    logger.debug("POST /api/chat  resolved_session=%s", session_id)

    # Gemini API call (2–6 s, blocking) — runs in thread pool so the event loop
    # stays free to serve other requests concurrently
    result = await loop.run_in_executor(None, text_chat, body.message, session_id)
    logger.debug("POST /api/chat  answer_len=%d", len(result.answer or ""))

    # DB writes happen AFTER the response is returned to the user.
    # This cuts ~20–50 ms off perceived latency without losing any data.
    model_name = _get_text_model()
    background_tasks.add_task(save_exchange, session_id, body.message, result.answer)
    background_tasks.add_task(
        log_token_usage,
        session_id=session_id,
        mode="text",
        model_name=model_name,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        ip_address=ip_address,
    )

    logger.info("POST /api/chat  done  session=%s", session_id)
    return ChatResponse(answer=result.answer, session_id=session_id)


@router.get("/history/{session_id}", summary="Fetch conversation history")
async def chat_history(session_id: str, limit: int = 20) -> list[dict]:
    loop = asyncio.get_running_loop()
    messages = await loop.run_in_executor(
        None, lambda: get_history(session_id, limit=limit)
    )
    if not messages:
        raise HTTPException(status_code=404, detail="Session not found or empty")
    return messages


def _get_text_model() -> str:
    from app.services.chatbot import TEXT_MODEL, load_chatbot_config
    try:
        return load_chatbot_config().model_text
    except Exception:
        return TEXT_MODEL
