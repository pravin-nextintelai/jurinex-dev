"""
Admin endpoints for reading and updating chatbot_config at runtime.
Changes take effect immediately (config cache is invalidated on update).
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.schemas.models import ConfigResponse, ConfigUpdateRequest
from app.services.chatbot import (
    RETIRED_MODELS,
    TEXT_MODEL,
    invalidate_config_cache,
    load_chatbot_config,
)
from app.services.db import get_db_connection, is_db_available

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _build_config_response(cfg) -> ConfigResponse:
    return ConfigResponse(
        config_key="default",
        model_text=cfg.model_text,
        model_audio=cfg.model_audio,
        max_tokens=cfg.max_tokens,
        temperature=cfg.temperature,
        top_p=cfg.top_p,
        top_k_results=cfg.top_k_results,
        voice_name=cfg.voice_name,
        language_code=cfg.language_code,
        speaking_rate=cfg.speaking_rate,
        pitch=cfg.pitch,
        volume_gain_db=cfg.volume_gain_db,
        system_prompt=cfg.system_prompt,
        audio_system_prompt=cfg.audio_system_prompt,
    )


@router.get("/config", response_model=ConfigResponse, summary="Get active chatbot config")
async def get_config() -> ConfigResponse:
    loop = asyncio.get_running_loop()
    cfg = await loop.run_in_executor(None, load_chatbot_config)
    return _build_config_response(cfg)


@router.put("/config", response_model=ConfigResponse, summary="Update chatbot config")
async def update_config(request: ConfigUpdateRequest) -> ConfigResponse:
    if not is_db_available():
        raise HTTPException(status_code=503, detail="Database not available")

    if request.model_text is not None and request.model_text.strip() != TEXT_MODEL:
        raise HTTPException(
            status_code=400,
            detail=f"model_text is pinned to {TEXT_MODEL} and cannot be changed",
        )
    if request.model_audio is not None and (
        request.model_audio.strip().removeprefix("models/") in RETIRED_MODELS
    ):
        raise HTTPException(
            status_code=400,
            detail=f"model_audio {request.model_audio!r} is retired on the Gemini API",
        )

    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided to update")

    set_clause = ", ".join(f"{col} = %s" for col in updates)
    values = list(updates.values())

    def _do_update():
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE chatbot_config SET {set_clause}, updated_at = NOW() "
                    f"WHERE config_key = 'default'",
                    values,
                )
            conn.commit()
        invalidate_config_cache()

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _do_update)
    return await get_config()
