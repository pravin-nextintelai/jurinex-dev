"""
FastAPI app for JuriNex Agent Draft Service.

Routers (each agent/domain in its own file):
- api/template_routes  — Template gallery (list, get, preview image).
- api/draft_routes     — Drafts (create, list, get, update, attach-case, template fields).
- api/section_routes   — Section generation (Drafter + Critic): generate, refine, get sections.
- api/ingestion_routes — Ingestion agent: POST /api/ingest, POST /api/orchestrate/upload.
- api/librarian_routes — Librarian agent: POST /api/retrieve, POST /api/orchestrate/retrieve, GET /api/test/librarian.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

# Logging: show orchestrator → agent task in console
logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
logging.getLogger("agents.orchestrator.agent").setLevel(logging.INFO)

# Load .env from agent-draft-service root
_project_root = Path(__file__).resolve().parent.parent
load_dotenv(_project_root / ".env")

app = FastAPI(
    title="JuriNex Agent Draft Service",
    description="Ingestion (GCS → Document AI → chunk → embed → DB), Librarian (retrieve), templates & drafts.",
    version="1.0.1",
)

# Force reload trigger: v2.5 migration
app.state.migration_version = "2.5.pro.v1"

# CORS
_allowed_origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173,https://ailearn.co.in").strip().split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Central error capture (docs/error-logging.md). Vendored copy: ../errorlog ──
from errorlog import install as _install_errorlog  # noqa: E402

_install_errorlog(
    app,
    service_name="agent-draft-service",
    own_code_root=_project_root,
    parse_helpers=("services.agent_modifier_service:_clean_json",),
)

# Request logging
_request_logger = logging.getLogger("api.request")
_draft_logger = logging.getLogger("agent_draft_service.app")

# Routes that consume LLM tokens and must respect the shared plan token pool
_GUARDED_PREFIXES = (
    "/api/orchestrate",
    "/api/assemble",
    "/api/ingest",
    "/api/extract-fields",
    "/api/retrieve",
    "/api/agent-modifier",
)


def _is_llm_consuming_post(path: str, method: str) -> bool:
    if method != "POST":
        return False
    if any(path.startswith(p) for p in _GUARDED_PREFIXES):
        return True
    if "/sections/" in path and any(
        path.endswith(suffix)
        for suffix in ("/generate", "/refine", "/generate-html", "/retry")
    ):
        return True
    if path.endswith("/assemble"):
        return True
    return False


def _extract_user_id_from_jwt(request: Request) -> str | None:
    """Decode Bearer JWT and return the user id claim."""
    auth = request.headers.get("authorization") or ""
    if not auth.startswith("Bearer "):
        return None
    token = auth.split(maxsplit=1)[1]
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        return None
    try:
        import jwt as pyjwt
        payload = pyjwt.decode(token, secret, algorithms=["HS256"], options={"verify_exp": True})
        uid = payload.get("id") or payload.get("userId") or payload.get("sub")
        return str(uid) if uid else None
    except Exception:
        return None


@app.middleware("http")
async def attach_user_context_middleware(request: Request, call_next):
    """Attach authenticated user id to context for shared token pool logging."""
    from services.request_context import current_user_id

    uid = _extract_user_id_from_jwt(request)
    token = current_user_id.set(uid) if uid else None
    try:
        return await call_next(request)
    finally:
        if token is not None:
            current_user_id.reset(token)


def _quota_cors_headers(request: Request) -> dict:
    """CORS headers for short-circuit quota responses.

    The payment middleware is outermost in the stack (added last via @app.middleware),
    so CORSMiddleware never sees responses returned directly here. Add headers manually
    so the browser can read the 429/503 body instead of throwing 'Failed to fetch'.
    """
    origin = request.headers.get("origin", "")
    allowed = [o.strip() for o in _allowed_origins if o.strip()]
    if origin and (origin in allowed or "*" in allowed):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        }
    return {}


@app.middleware("http")
async def payment_token_limit_middleware(request: Request, call_next):
    """Block LLM-consuming POST routes when payment-service reports no tokens available."""
    from services.request_context import current_model_override

    override_token = None
    if _is_llm_consuming_post(request.url.path, request.method):
        try:
            from services.payment_token_guard import (
                check_token_availability,
                quota_block_body,
                quota_block_status,
            )
            uid = _extract_user_id_from_jwt(request)
            if uid:
                result = check_token_availability(
                    uid,
                    endpoint=request.url.path,
                    service="agent-draft-service",
                )
                if not result.get("ok"):
                    body = json.dumps(quota_block_body(result))
                    return Response(
                        content=body,
                        status_code=quota_block_status(result),
                        media_type="application/json",
                        headers=_quota_cors_headers(request),
                    )
                # Free-tier → DeepSeek: payment-service decides centrally and returns
                # the override in `details`. Thread the model id into the request
                # context so services/llm_service.call_llm routes to DeepSeek (with
                # Gemini fallback). Absent/None for paid users → no behavior change.
                details = result.get("details") or {}
                model_override = details.get("llm_model_override")
                if details.get("llm_provider_override") == "deepseek" and model_override:
                    override_token = current_model_override.set(str(model_override))
        except Exception as exc:
            _draft_logger.warning("[PaymentTokenLimit] middleware error: %s", exc)
            if os.environ.get("TOKEN_CHECK_FAIL_OPEN", "false").lower() != "true":
                body = json.dumps({
                    "success": False,
                    "code": "TOKEN_CHECK_UNAVAILABLE",
                    "message": "Unable to verify token availability.",
                })
                return Response(
                    content=body,
                    status_code=503,
                    media_type="application/json",
                    headers=_quota_cors_headers(request),
                )
    try:
        return await call_next(request)
    finally:
        if override_token is not None:
            current_model_override.reset(override_token)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log every incoming request (method + path)."""
    _request_logger.info("API called: %s %s", request.method, request.url.path)
    return await call_next(request)


# --- Routers (each agent/domain in separate file) ---
from api import (
    agent_modifier_routes,
    agent_routes,
    draft_routes,
    ingestion_routes,
    librarian_routes,
    section_routes,
    template_routes,
    universal_sections_routes,
    assemble_routes,
)

app.include_router(agent_routes.router)
app.include_router(agent_modifier_routes.router)
app.include_router(template_routes.router)
app.include_router(draft_routes.router)
app.include_router(section_routes.router)
app.include_router(universal_sections_routes.router)
app.include_router(assemble_routes.router)
app.include_router(ingestion_routes.router)
app.include_router(librarian_routes.router)


# --- Core endpoints (root, health, endpoint list) ---
@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "service": "JuriNex Agent Draft Service",
        "docs": "/docs",
        "ingest": "POST /api/ingest (Bearer JWT; file)",
        "orchestrate_upload": "POST /api/orchestrate/upload (Bearer JWT; file)",
        "orchestrate_upload_multiple": "POST /api/orchestrate/upload-multiple (Bearer JWT; files[]; queue + worker)",
        "ingestion_job_status": "GET /api/ingestion/jobs/{job_id}",
        "ingestion_draft_job_status": "GET /api/ingestion/draft-jobs/{draft_job_id}",
        "ingestion_batch_status": "GET /api/ingestion/batches/{batch_id} (job_ids optional)",
        "retrieve": "POST /api/retrieve (Bearer JWT; query)",
        "orchestrate_retrieve": "POST /api/orchestrate/retrieve (Bearer JWT; query → Librarian)",
        "test_librarian": "GET /api/test/librarian",
        "templates": "GET /api/templates",
        "template_by_id": "GET /api/templates/{template_id}",
        "template_preview_image": "GET /api/templates/{template_id}/preview-image",
    }


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/endpoints")
def list_test_endpoints() -> Dict[str, Any]:
    """List endpoints for testing Orchestrator → Ingestion and Librarian."""
    base = "http://localhost:8000"
    return {
        "description": "Test Orchestrator → Ingestion (upload) and Orchestrator → Librarian (retrieve).",
        "endpoints": [
            {
                "name": "Orchestrator + Ingestion (upload)",
                "method": "POST",
                "path": "/api/orchestrate/upload",
                "url": f"{base}/api/orchestrate/upload",
                "body": "form-data",
                "fields": {"file": "required", "folder_path": "optional", "draft_id": "optional", "case_id": "optional"},
                "flow": "Upload → Orchestrator → Ingestion → GCS → Document AI → chunk → embed → DB.",
            },
            {
                "name": "Ingestion only (no orchestrator)",
                "method": "POST",
                "path": "/api/ingest",
                "url": f"{base}/api/ingest",
                "body": "form-data",
                "fields": {"file": "required", "user_id": "from JWT", "folder_path": "optional"},
                "flow": "Direct: GCS → Document AI → chunk → embed → DB.",
            },
            {
                "name": "Librarian (retrieve)",
                "method": "POST",
                "path": "/api/retrieve",
                "url": f"{base}/api/retrieve",
                "body": "JSON",
                "fields": {"query": "required", "file_ids": "optional", "top_k": "optional", "draft_id": "optional"},
                "flow": "Query → Librarian → embed → vector search → top-k chunks.",
            },
            {
                "name": "Orchestrator + Librarian (retrieve)",
                "method": "POST",
                "path": "/api/orchestrate/retrieve",
                "url": f"{base}/api/orchestrate/retrieve",
                "body": "JSON",
                "fields": {"query": "required", "file_ids": "optional", "top_k": "optional", "draft_id": "optional"},
                "flow": "Query → Orchestrator → Librarian → chunks, context, agent_tasks.",
            },
        ],
        "test_order": "1) POST /api/orchestrate/upload with a PDF. 2) POST /api/orchestrate/retrieve or /api/retrieve with query.",
    }
