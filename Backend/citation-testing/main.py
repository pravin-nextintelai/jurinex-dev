"""
Citation Testing Service — compare Gemini (Google Grounding) vs Claude (Serper) citation research.

Port: 8003 (local dev), PORT=8080 (Cloud Run)

Endpoints:
  GET  /                           — service info
  GET  /health                     — health check
  GET  /citation-test/cases        — list user cases from agentic-document-service
  POST /citation-test/research     — run 1-iteration citation pipeline (method: gemini | claude)
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
for _noisy in ("httpx", "httpcore", "google_genai", "google.genai"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

_project_root = Path(__file__).resolve().parent
_env_file = _project_root / ".env"
if _env_file.is_file():
    load_dotenv(_env_file)

_DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5000",
    "https://jurinex.netlify.app",
    "https://jurinex-dev.netlify.app",
    "https://nexintel.netlify.app",
    "https://auth.jurinex.ai",
    "https://www.jurinex.ai",
    "https://ailearn.co.in",
    "https://www.ailearn.co.in",
]

# Cloud Run may set CORS_ORIGINS to localhost-only; always merge with production defaults.
_extra_cors = os.environ.get("CORS_ORIGINS", "").strip()
CORS_ORIGINS = list(_DEFAULT_CORS_ORIGINS)
if _extra_cors:
    CORS_ORIGINS.extend(o.strip() for o in _extra_cors.split(",") if o.strip())
_seen_cors: set[str] = set()
CORS_ORIGINS = [o for o in CORS_ORIGINS if o not in _seen_cors and not _seen_cors.add(o)]

# Safety net for Netlify previews and ailearn subdomains.
CORS_ORIGIN_REGEX = os.environ.get(
    "CORS_ORIGIN_REGEX",
    r"https://([a-z0-9-]+\.)*(ailearn\.co\.in|netlify\.app|jurinex\.ai)(:\d+)?$",
)

logger.info("[CORS] allowed origins: %s", CORS_ORIGINS)

AGENTIC_DOCUMENT_SERVICE_URL = (
    os.environ.get("AGENTIC_DOCUMENT_SERVICE_URL")
    or os.environ.get("DOCUMENT_SERVICE_URL")
    or "http://localhost:8092"
).rstrip("/")

app = FastAPI(
    title="JuriNex Citation Testing Service",
    description="Test Gemini (Google Grounding) vs Claude (Serper) citation research in 1 iteration.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Central error capture (docs/error-logging.md). Vendored copy: ./errorlog ──
from errorlog import install as _install_errorlog  # noqa: E402

_install_errorlog(app, service_name="citation-testing", own_code_root=os.path.dirname(os.path.abspath(__file__)))


async def _fetch_user_cases(auth_header: Optional[str]) -> List[Dict[str, Any]]:
    """Fetch case list from agentic-document-service /api/files/cases."""
    if not auth_header:
        return []
    base = AGENTIC_DOCUMENT_SERVICE_URL
    if base.endswith("/api/files"):
        base = base[: -len("/api/files")]
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{base}/api/files/cases",
                headers={"Authorization": auth_header},
            )
            if resp.status_code != 200:
                logger.warning("[CASES] fetch failed %s: %s", resp.status_code, resp.text[:200])
                return []
            data = resp.json() or {}
            cases = data.get("cases") or data.get("data") or (data if isinstance(data, list) else [])
            return list(cases)
    except Exception as exc:
        logger.warning("[CASES] fetch error: %s", exc)
        return []


async def _fetch_case_context(case_id: str, auth_header: Optional[str]) -> str:
    """
    Fetch case documents from agentic-document-service and build a combined context string.
    Mirrors the logic in citation-service/main.py _fetch_case_context.
    """
    if not auth_header:
        return ""
    base = AGENTIC_DOCUMENT_SERVICE_URL
    if base.endswith("/api/files"):
        base = base[: -len("/api/files")]

    context_parts: List[str] = []
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Get case metadata
            case_resp = await client.get(
                f"{base}/api/files/cases/{case_id}",
                headers={"Authorization": auth_header},
            )
            if case_resp.status_code != 200:
                logger.warning("[CASE_CTX] case fetch failed %s", case_resp.status_code)
                return ""
            payload = case_resp.json() or {}
            case_data = payload.get("case") or payload or {}
            case_title = (
                case_data.get("case_title") or case_data.get("name") or case_data.get("title") or ""
            )
            if case_title:
                context_parts.append(f"Case Title: {case_title}")

            # Resolve folder
            folder_candidates: List[str] = []
            for f in (case_data.get("folders") or []):
                for key in ("name", "originalname", "folder_path"):
                    v = f.get(key) if isinstance(f, dict) else None
                    if v:
                        folder_candidates.append(str(v).strip())
            for key in ("folder_name", "folder", "folder_path", "name"):
                v = case_data.get(key)
                if v:
                    folder_candidates.append(str(v).strip())
            folder_candidates = list(dict.fromkeys(folder_candidates))

            # Fetch document files
            for folder_name in folder_candidates:
                enc = quote(folder_name, safe="")
                files_resp = await client.get(
                    f"{base}/api/files/{enc}/files",
                    headers={"Authorization": auth_header},
                )
                if files_resp.status_code != 200:
                    continue
                files_payload = files_resp.json() or {}
                files = files_payload.get("files") or files_payload.get("data") or []
                for item in files:
                    text = (
                        item.get("full_text_content")
                        or item.get("summary")
                        or item.get("content")
                        or item.get("snippet")
                        or ""
                    ).strip()
                    if text:
                        fname = item.get("originalname") or item.get("name") or "document"
                        context_parts.append(f"[{fname}]\n{text[:3000]}")
                if context_parts:
                    break

    except Exception as exc:
        logger.warning("[CASE_CTX] error: %s", exc)

    return "\n\n".join(context_parts)[:8000]


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "service": "JuriNex Citation Testing Service",
        "version": "1.0.0",
        "endpoints": {
            "cases": "GET /citation-test/cases?user_id=...",
            "research": "POST /citation-test/research",
        },
    }


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/citation-test/cases")
async def list_cases(
    request: Request,
    user_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """List user's cases from agentic-document-service."""
    auth_header = request.headers.get("authorization")
    cases = await _fetch_user_cases(auth_header)
    return {"success": True, "cases": cases}


@app.post("/citation-test/research")
async def run_research(
    request: Request,
    method: str = Body("gemini", embed=True, description="'gemini' (Google Grounding) or 'claude' (Serper)"),
    case_id: Optional[str] = Body(None, embed=True, description="Case ID from agentic-document-service"),
    case_query: Optional[str] = Body(None, embed=True, description="Optional query override; auto-derived from case title if omitted"),
    case_context: Optional[str] = Body(None, embed=True, description="Manual case context override"),
    user_id: Optional[str] = Body(None, embed=True),
) -> Dict[str, Any]:
    """
    Run 1-iteration citation research pipeline.

    Flow: Case Analyzer → Research Decomposer → Query Planner → Search → Extract
    - method=gemini → Gemini 2.5 Flash with Google Search grounding
    - method=claude → Claude Sonnet 4.6 with Serper API web search
    Both paths apply the same T1/T2 authority allowlist as citation-service.
    """
    method = (method or "gemini").lower().strip()
    if method not in ("gemini", "claude"):
        raise HTTPException(status_code=400, detail="method must be 'gemini' or 'claude'")

    if not case_id and not case_query and not case_context:
        raise HTTPException(status_code=400, detail="Provide at least case_id or case_query")

    # Fetch case context from agentic-document-service
    resolved_context = case_context or ""
    if case_id and not resolved_context:
        auth_header = request.headers.get("authorization")
        resolved_context = await _fetch_case_context(case_id, auth_header)

    run_id = str(uuid.uuid4())
    state: Dict[str, Any] = {
        "run_id": run_id,
        "user_id": user_id or "anonymous",
        "case_query": (case_query or "").strip(),
        "case_context": resolved_context,
        "case_id": case_id,
        "method": method,
    }

    try:
        import asyncio
        from agents.citation_test_agent.runner import run_test_pipeline
        state = await asyncio.to_thread(run_test_pipeline, state)
    except Exception as exc:
        logger.exception("[RESEARCH] Pipeline failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if state.get("error"):
        raise HTTPException(status_code=400, detail=state["error"])

    return {
        "success": True,
        "run_id": run_id,
        "method": state.get("method_used", method),
        "citations": state.get("citations") or [],
        "search_results": state.get("search_results") or [],
        "gaps": state.get("gaps") or [],
        "elapsed_seconds": state.get("elapsed_seconds"),
        "case_id": case_id,
        "case_context_length": len(resolved_context),
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT") or os.environ.get("API_PORT", "8003"))
    host = os.environ.get("API_HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=True)
