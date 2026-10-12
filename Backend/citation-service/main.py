"""
JuriNex Citation Service — Watchdog → Fetcher → Clerk → Verified Citation Report.

- POST /citation/build-report — 2-stage Claude pipeline (Extraction → Render); returns HTML/MD report.
- POST /citation/report — Run full pipeline (query + user_id); returns report in frontend format.
- GET /citation/reports — List user's reports.
- GET /citation/reports/:id — Get one report (same format as HTML/React).
"""

from __future__ import annotations

import logging
import os
import re
import threading
import asyncio
import time
from collections import deque
import httpx
from pathlib import Path
from urllib.parse import quote
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

from dotenv import load_dotenv
from fastapi import FastAPI, Body, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from claude_proxy import forward_to_claude
from report_builder_claude import build_report, build_report_from_files
from db.client import (
    init_db,
    report_get,
    report_delete,
    report_list_by_user,
    report_list_by_case,
    report_update,
    hitl_queue_list_by_report,
    hitl_queue_update_status,
    hitl_queue_pending_count,
    agent_logs_by_run,
    judgement_get,
    judgement_search_local,
    analytics_get_enterprise_dashboard,
    usage_get_aggregate,
    usage_get_user_breakdown,
    usage_get_by_run,
    pipeline_run_update,
    pipeline_run_get_user_id,
    report_share,
    report_get_shares,
    report_list_firm_shared,
    report_list_shared_with_members,
)
from db.connections import get_qdrant_client, get_neo4j_driver
from pipeline import run_pipeline
from api.middleware import structured_request_logging
from core.logging import configure_structured_logging
from utils.usage_analytics import normalize_aggregate_by_service, normalize_user_by_service
from utils.validators import normalize_case_file_context

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
# Silence noisy third-party libraries
for _noisy in (
    "httpx", "httpcore",
    "google_genai", "google.genai",
    "elastic_transport", "elastic_transport.transport",
    "elasticsearch",
    "urllib3", "urllib3.connectionpool",
    "qdrant_client",
):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
logger = logging.getLogger(__name__)
configure_structured_logging()

_project_root = Path(__file__).resolve().parent
load_dotenv(_project_root / ".env")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


PIPELINE_MAX_CONCURRENT_RUNS = max(1, _env_int("CITATION_MAX_CONCURRENT_RUNS", 6))
RUN_STATE_MAX_ENTRIES = max(50, _env_int("CITATION_RUN_STATE_MAX_ENTRIES", 500))
SYNC_PIPELINE_TIMEOUT_SECONDS = max(60, _env_int("CITATION_SYNC_PIPELINE_TIMEOUT_SECONDS", 480))
CaseFileContextInput = Optional[Union[List[Dict[str, Any]], str]]
_pipeline_slots = threading.BoundedSemaphore(PIPELINE_MAX_CONCURRENT_RUNS)
_run_state_lock = threading.Lock()
_run_state_order: deque[str] = deque()


def _decode_jwt(request: Request) -> Dict[str, Any]:
    """Decode JWT from Authorization header. Returns payload dict or {}."""
    auth = request.headers.get("authorization") or ""
    if not auth.startswith("Bearer "):
        return {}
    token = auth.split(maxsplit=1)[1]
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        return {}
    try:
        import jwt as pyjwt
        return pyjwt.decode(token, secret, algorithms=["HS256"], options={"verify_exp": True})
    except Exception:
        return {}


def _resolve_citation_user_id(request: Optional[Request], body_user_id: Optional[str]) -> str:
    """
    Prefer user_id from the request body when it is a real id (not anonymous).
    Otherwise derive from JWT so usage/citation rows match the logged-in user when the client
    sends Bearer token but body still says anonymous.
    """
    raw = (body_user_id or "").strip()
    if raw and raw.lower() not in ("anonymous", "unknown", "null", "undefined"):
        return raw
    if request is None:
        return raw or "anonymous"
    payload = _decode_jwt(request)
    uid = payload.get("id") or payload.get("userId") or payload.get("sub")
    if uid is not None and str(uid).strip():
        return str(uid).strip()
    return raw or "anonymous"


def _get_token_account_type(request: Request) -> Optional[str]:
    """Return account_type claim from JWT (uppercased), or None."""
    payload = _decode_jwt(request)
    return str(payload.get("account_type") or "").upper() or None


async def _fetch_firm_members(user_id: int) -> List[Dict[str, Any]]:
    """
    Call auth service internal endpoint to get all firm members (id, email, username).
    Falls back to a single-member list on error.
    """
    auth_url = (os.environ.get("AUTH_SERVICE_URL", "http://localhost:5001/api/auth") or "").strip().rstrip("/")
    candidates = [auth_url]
    # Common gateway prefix mismatch seen in local dev setups.
    if "/auth/api/auth" in auth_url:
        candidates.append(auth_url.replace("/auth/api/auth", "/api/auth"))

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            for base in list(dict.fromkeys([c for c in candidates if c])):
                url = f"{base}/internal/user/{user_id}/firm-members"
                res = await client.get(url)
                if res.status_code == 200:
                    return res.json().get("members") or []
    except Exception as exc:
        logger.warning("[AUTH] firm-members fetch failed for user %s: %s", user_id, exc)
    return [{"user_id": user_id, "email": str(user_id), "username": str(user_id), "auth_type": "—", "role": "—"}]


async def _usage_analytics_resolve_user_ids(
    account_type: str,
    scope: str,
    caller_id: Any,
) -> tuple[Optional[List[str]], Dict[str, Dict[str, Any]]]:
    """
    Firm admins: always restrict to firm members (never platform-wide).
    Super admins: scope=platform → all users (None); scope=firm → caller's firm members.
    Returns (user_ids or None for entire platform, display map).
    """
    user_info_map: Dict[str, Dict[str, Any]] = {}
    user_ids: Optional[List[str]] = None

    if account_type == "SUPER_ADMIN" and scope == "platform":
        return None, {}

    # FIRM_ADMIN always firm-scoped; SUPER_ADMIN + firm uses same firm list
    if not caller_id:
        return [], {}
    try:
        cid = int(caller_id)
        members = await _fetch_firm_members(cid)
        if members:
            bulk_users = await _fetch_users_bulk([int(m.get("user_id")) for m in members if m.get("user_id")])
            if bulk_users:
                members = bulk_users
        else:
            members = [{"user_id": cid, "username": str(cid), "email": str(cid)}]
        for m in members:
            uid_str = str(m.get("user_id", ""))
            if uid_str:
                user_ids = user_ids or []
                user_ids.append(uid_str)
                user_info_map[uid_str] = {
                    "display_name": m.get("username") or m.get("email") or uid_str,
                    "username": m.get("username") or m.get("email") or uid_str,
                }
    except Exception as exc:
        logger.warning("[USAGE_ANALYTICS] resolve user scope failed: %s", exc)
        user_ids = [str(caller_id)] if caller_id else []

    return user_ids, user_info_map


async def _fetch_users_bulk(user_ids: List[int]) -> List[Dict[str, Any]]:
    """
    Call auth service bulk users endpoint to get username, auth_type, role for given user IDs.
    Returns list of {user_id, username, email, auth_type, role}.
    """
    if not user_ids:
        return []
    auth_url = (os.environ.get("AUTH_SERVICE_URL", "http://localhost:5001/api/auth") or "").strip().rstrip("/")
    candidates = [auth_url]
    if "/auth/api/auth" in auth_url:
        candidates.append(auth_url.replace("/auth/api/auth", "/api/auth"))
    ids_str = ",".join(str(x) for x in user_ids)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            for base in list(dict.fromkeys([c for c in candidates if c])):
                url = f"{base}/internal/users/bulk?ids={ids_str}"
                res = await client.get(url)
                if res.status_code == 200:
                    return res.json().get("users") or []
    except Exception as exc:
        logger.warning("[AUTH] users-bulk fetch failed for ids %s: %s", user_ids[:5], exc)
    return []


def _html_to_text(content: str) -> str:
    """
    Best-effort HTML → plain text for full judgments:
    - convert <br> to newlines and </p> to paragraph breaks
    - strip script/style and all remaining tags
    - drop obvious boilerplate / JS lines
    - collapse excessive blank lines
    """
    if not isinstance(content, str):
        return str(content or "").strip()
    if "<" not in content and ">" not in content:
        return content.strip()

    text = content
    # Remove script and style blocks completely
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", text)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    # Basic block/line breaks
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p\s*>", "\n\n", text)
    # Strip all other tags
    text = re.sub(r"<[^>]+>", "", text)
    # Normalise newlines
    text = re.sub(r"\r\n|\r", "\n", text)
    # Drop obvious boilerplate / JS / navigation lines
    lines = [ln.strip() for ln in text.split("\n")]
    cleaned_lines = []
    for ln in lines:
        if not ln:
            cleaned_lines.append("")
            continue
        low = ln.lower()
        # Skip analytics, navigation, and site chrome / marketing copy
        if any(tok in low for tok in [
            "window.datalayer",
            "gtag(",
            "google analytics",
            "skip to main content",
            "indian kanoon - search engine",
            "search indian laws and judgments",
            "main navigation",
            "mobile navigation",
            "free features",
            "premium features",
            "prism ai",
            "pricing",
            "login",
            "legal document view",
            "tools for analyzing structure",
            "unlock advanced research with prisma",
            "upgrade to premium",
            "document options",
            "get in pdf",
            "print it!",
            "download court copy",
            "know your kanoon",
            "doc gen hub",

            "counter argument",
            "case predict ai",
            "talk with ik doc",
        ]):
            continue
        # Skip lines that look like CSS / JS / config
        css_token_count = ln.count("{") + ln.count("}") + ln.count(";")
        if css_token_count >= 3 or "var(--" in low:
            continue
        if any(tok in low for tok in ["function(", "=>", "console.log", "document.getelementbyid"]):
            continue
        cleaned_lines.append(ln)

    # Collapse multiple blank lines
    out = []
    last_blank = False
    for ln in cleaned_lines:
        is_blank = (ln.strip() == "")
        if is_blank and last_blank:
            continue
        out.append(ln)
        last_blank = is_blank

    return "\n".join(out).strip()


def _set_run_state(run_id: str, state: Dict[str, Any]) -> None:
    with _run_state_lock:
        prev = _run_state.get(run_id) or {}
        now_ts = time.time()
        merged = {**prev, **state}
        if "started_at_ts" not in merged:
            merged["started_at_ts"] = now_ts
        merged["updated_at_ts"] = now_ts
        if "slot_released" not in merged:
            merged["slot_released"] = False
        _run_state[run_id] = merged
        try:
            _run_state_order.remove(run_id)
        except ValueError:
            pass
        _run_state_order.append(run_id)
        while len(_run_state_order) > RUN_STATE_MAX_ENTRIES:
            stale_run_id = _run_state_order.popleft()
            _run_state.pop(stale_run_id, None)


def _try_acquire_pipeline_slot() -> bool:
    return _pipeline_slots.acquire(blocking=False)


def _release_pipeline_slot() -> None:
    try:
        _pipeline_slots.release()
    except ValueError:
        pass


def _release_pipeline_slot_once(run_id: str) -> None:
    should_release = False
    with _run_state_lock:
        st = _run_state.get(run_id) or {}
        if not st.get("slot_released"):
            st["slot_released"] = True
            _run_state[run_id] = st
            should_release = True
    if should_release:
        _release_pipeline_slot()


app = FastAPI(
    title="JuriNex Citation Service",
    description="Watchdog (local DB → Indian Kanoon → Google) → Fetcher → Clerk → Verified Citation Report.",
    version="2.0.0",
)

CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000,http://localhost:5000").strip().split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(structured_request_logging)

# ── Central error capture (docs/error-logging.md). Vendored copy: ./errorlog ──
from errorlog import install as _install_errorlog  # noqa: E402

_install_errorlog(
    app,
    service_name="citation-service",
    own_code_root=os.path.dirname(os.path.abspath(__file__)),
    parse_helpers=(
        "integrations.gemini._jsonsafe:loads_lenient",
        "agents.autonomous_citation_agent.runner:_parse_json_loose",
    ),
)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(request: Request, exc: RequestValidationError):
    errors = [
        {key: value for key, value in error.items() if key not in {"input", "ctx"}}
        for error in exc.errors()
    ]
    logger.warning(
        "[REQUEST_VALIDATION] Rejected %s %s: %s",
        request.method,
        request.url.path,
        errors,
        extra={"details": {"endpoint": request.url.path, "method": request.method, "validation_errors": errors}},
    )
    return JSONResponse(status_code=422, content={"detail": errors})


# ── Token limit guard (payment-service) ───────────────────────────────────────
_CITATION_LLM_POST_PREFIXES = (
    "/citation/report",
    "/citation/build-report",
    "/citation/report/start",
    "/citation/suggest-keywords",
    "/api/claude",
)

def _quota_cors_headers(request: Request) -> dict:
    """Return CORS headers for short-circuit quota responses.

    The CORSMiddleware is inner to this middleware, so it never sees responses
    returned directly here. We must add the headers manually so the browser can
    read the 429/503 body instead of throwing 'Failed to fetch'.
    """
    origin = request.headers.get("origin", "")
    allowed = [o.strip() for o in CORS_ORIGINS if o.strip()]
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
    path = request.url.path
    if request.method == "POST" and any(path.startswith(p) for p in _CITATION_LLM_POST_PREFIXES):
        try:
            from services.payment_guard import (
                check_token_availability,
                extract_user_id_from_request,
                quota_block_body,
                quota_block_status,
            )
            uid = extract_user_id_from_request(request)
            if not uid:
                payload = _decode_jwt(request)
                uid = payload.get("id") or payload.get("userId") or payload.get("sub")
            if uid:
                result = check_token_availability(
                    uid,
                    endpoint=path,
                    service="citation-service",
                )
                if not result.get("ok"):
                    # TOKEN_CHECK_UNAVAILABLE means the payment service is unreachable
                    # (wrong PAYMENT_SERVICE_URL, cold start, etc.). Fail open so the
                    # citation pipeline is not blocked by an infra misconfiguration.
                    # Real quota exhaustion (code != TOKEN_CHECK_UNAVAILABLE) still blocks.
                    if result.get("code") == "TOKEN_CHECK_UNAVAILABLE":
                        logger.warning(
                            "[PaymentTokenLimit] payment service unreachable — failing open for "
                            "uid=%s path=%s reason=%s",
                            uid, path, result.get("details", {}).get("reason", ""),
                        )
                    else:
                        import json as _json
                        from starlette.responses import Response as _Resp
                        return _Resp(
                            content=_json.dumps(quota_block_body(result)),
                            status_code=quota_block_status(result),
                            media_type="application/json",
                            headers=_quota_cors_headers(request),
                        )
        except Exception as exc:
            # Middleware-level exception (import error, unexpected crash) — fail open
            # to avoid blocking all citation generation for infrastructure issues.
            logger.warning("[PaymentTokenLimit] middleware exception — failing open: %s", exc)
    return await call_next(request)


async def _fetch_case_context(case_id: str, auth_header: Optional[str]):
    """
    Fetch case file context from agentic-document-service.
    Returns (context_items, summary). Always returns something usable:
    - If chunks load → full context items
    - If case data loads but no chunks → stub item with case title so pipeline has a search seed
    - If everything fails → ([], "")
    """
    # Prefer agentic URL, but keep backwards compatibility with DOCUMENT_SERVICE_URL.
    raw_base_url = (
        os.environ.get("AGENTIC_DOCUMENT_SERVICE_URL")
        or os.environ.get("DOCUMENT_SERVICE_URL")
        or os.environ.get("GATEWAY_URL")
        or "http://localhost:8092"
    )
    if not raw_base_url:
        logger.warning("[CASE_CONTEXT] Agentic document service URL not set; skipping case context fetch.")
        return [], ""
    if not auth_header:
        logger.warning("[CASE_CONTEXT] Missing Authorization header; skipping case context fetch.")
        return [], ""

    base_url = raw_base_url.rstrip("/")
    if base_url.endswith("/api/files"):
        base_url = base_url[: -len("/api/files")]
    elif base_url.endswith("/docs"):
        base_url = base_url[: -len("/docs")]
    headers = {"Authorization": auth_header}
    case_title_fallback = ""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # --- Step 1: fetch case metadata ---
            case_url = f"{base_url}/api/files/cases/{case_id}"
            case_resp = await client.get(case_url, headers=headers)
            if case_resp.status_code != 200:
                logger.warning("[CASE_CONTEXT] Case fetch failed (%s) at %s: %s",
                               case_resp.status_code, case_url, case_resp.text[:200])
                return [], ""
            payload = case_resp.json() or {}
            case_data = payload.get("case") or payload or {}

            # Keep case title as fallback search seed
            case_title_fallback = (
                case_data.get("case_title")
                or case_data.get("name")
                or case_data.get("title")
                or ""
            )

            # --- Step 2: resolve candidate folder identifiers ---
            folder_candidates: List[str] = []
            folders = case_data.get("folders") or []
            if folders:
                folder = (folders or [None])[0] or {}
                for value in (
                    folder.get("name"),
                    folder.get("originalname"),
                    folder.get("folder_path"),
                ):
                    if value and str(value).strip():
                        folder_candidates.append(str(value).strip())
            for value in (
                case_data.get("folder_name"),
                case_data.get("folder"),
                case_data.get("folder_path"),
                case_data.get("name"),
                case_title_fallback,
            ):
                if value and str(value).strip():
                    folder_candidates.append(str(value).strip())
            folder_candidates = list(dict.fromkeys(folder_candidates))
            if not folder_candidates:
                logger.warning("[CASE_CONTEXT] No folder name found for case_id=%s; using title stub", case_id)
                # Return a minimal stub so CHECK 1 can still proceed
                if case_title_fallback:
                    return [{"name": "Case", "content": case_title_fallback}], case_title_fallback
                return [], ""

            # --- Step 3: fetch document payload from supported /files route ---
            chunks: List[Dict[str, Any]] = []
            summary = ""
            resolved_folder = ""
            for folder_name in folder_candidates:
                enc_name = quote(str(folder_name), safe='')
                files_url = f"{base_url}/api/files/{enc_name}/files"
                files_resp = await client.get(files_url, headers=headers)
                if files_resp.status_code == 200:
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
                        if not text:
                            continue
                        chunks.append(
                            {
                                "filename": item.get("originalname") or item.get("name") or "document",
                                "content": text,
                            }
                        )
                        if not summary:
                            summary = (
                                item.get("summary")
                                or item.get("document_summary")
                                or item.get("abstract")
                                or ""
                            ).strip()
                    if chunks:
                        resolved_folder = folder_name
                        break
                elif files_resp.status_code not in (404,):
                    logger.warning("[CASE_CONTEXT] Files fetch failed (%s) at %s: %s",
                                   files_resp.status_code, files_url, files_resp.text[:200])
            if not chunks:
                logger.warning("[CASE_CONTEXT] Chunk/doc fetch failed for case_id=%s across folders=%s; using title stub",
                               case_id, folder_candidates)
                # Fall back to case title so pipeline is not completely blind
                stub_content = case_title_fallback or folder_candidates[0]
                return [{"name": "Case", "content": stub_content}], stub_content
            if resolved_folder:
                logger.info("[CASE_CONTEXT] Loaded %d context chunks for case_id=%s via folder=%s",
                            len(chunks), case_id, resolved_folder)

    except Exception as exc:
        logger.warning("[CASE_CONTEXT] Fetch failed: %s", exc)
        # Return title stub if we at least have the case title
        if case_title_fallback:
            return [{"name": "Case", "content": case_title_fallback}], case_title_fallback
        return [], ""

    max_chunks = int(os.environ.get("CASE_CONTEXT_MAX_CHUNKS", "200"))
    chunks = chunks[:max_chunks]

    by_file: Dict[str, List[str]] = {}
    for ch in chunks:
        fname = ch.get("filename") or "document"
        content = (ch.get("content") or "").strip()
        if not content:
            continue
        by_file.setdefault(fname, []).append(content)

    context_items = []
    if summary:
        context_items.append({"name": "Case Summary", "content": summary})

    max_item_chars = int(os.environ.get("CASE_CONTEXT_MAX_ITEM_CHARS", "8000"))
    for fname, texts in by_file.items():
        combined = "\n\n".join(texts)
        if not combined:
            continue
        for i in range(0, len(combined), max_item_chars):
            context_items.append({"name": fname, "content": combined[i:i + max_item_chars]})

    # If chunks existed but all were empty content, fall back to title stub
    if not context_items and case_title_fallback:
        context_items = [{"name": "Case", "content": case_title_fallback}]

    total_chars = sum(len(str(it.get("content") or "")) for it in context_items)
    logger.info("[CASE_CONTEXT] Loaded %d items / %d chunk(s) / %d chars for case_id=%s",
                len(context_items), len(chunks), total_chars, case_id)
    if total_chars < 800:
        logger.warning(
            "[CASE_CONTEXT] Only %d chars of text for case_id=%s — likely a cover-page/snippet only "
            "(full_text_content not extracted upstream). Citations will be poor until the document "
            "is fully text-extracted by the document service.",
            total_chars, case_id,
        )
    return context_items, summary


@app.on_event("startup")
def startup():
    init_db()
    logger.info(
        "[BOOT] Citation service starting with pipeline concurrency=%s run_state_max=%s",
        PIPELINE_MAX_CONCURRENT_RUNS,
        RUN_STATE_MAX_ENTRIES,
    )

    # Neo4j connectivity test (optional)
    driver = get_neo4j_driver()
    if driver:
        try:
            with driver.session() as session:
                result = session.run("RETURN 'Neo4j Connected' AS message")
                msg = result.single()["message"]
                logger.info("[NEO4J] %s", msg)
        except Exception as exc:
            logger.warning("[NEO4J] Test query failed: %s", exc)

    # Qdrant collection init (optional)
    qdrant = get_qdrant_client()
    if qdrant:
        try:
            from qdrant_client.models import VectorParams, Distance
            vector_size = int(os.environ.get("CITATION_EMBED_OUTPUT_DIMS", "768"))
            qdrant_collection = os.environ.get("QDRANT_COLLECTION", "legal_embeddings_v2").strip() or "legal_embeddings_v2"
            if not qdrant.collection_exists(collection_name=qdrant_collection):
                qdrant.create_collection(
                    collection_name=qdrant_collection,
                    vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
                )
                logger.info("[QDRANT] Created collection: %s", qdrant_collection)
            else:
                logger.info("[QDRANT] Collection exists: %s (expected vector size=%d)", qdrant_collection, vector_size)
        except Exception as exc:
            logger.warning("[QDRANT] Init failed: %s", exc)

    # ── Print admin-uploaded judgments table at startup ───────────────────────
    # Runs in a background thread so it does not block the server from accepting
    # requests while embeddings are being generated.
    def _show_admin_judgments_on_startup() -> None:
        try:
            from db.client import fetch_admin_judgments_semantic
            fetch_admin_judgments_semantic(query="", limit=50)
        except Exception as exc:
            logger.warning("[BOOT] Admin judgments table failed: %s", exc)

    import threading as _threading
    _threading.Thread(
        target=_show_admin_judgments_on_startup,
        daemon=True,
        name="startup-admin-table",
    ).start()


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "service": "JuriNex Citation Service",
        "docs": "/docs",
        "report": "POST /citation/report (query, user_id, case_file_context)",
        "reports_list": "GET /citation/reports?user_id=...",
        "report_by_id": "GET /citation/reports/{report_id}",
        "claude_proxy": "POST /api/claude (forward to Anthropic)",
    }


@app.post("/api/claude")
async def claude_proxy(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Forward request to Anthropic Claude API (same logic as proxy.js).
    Keeps API key server-side and avoids CORS. Body: { model, max_tokens, messages, ... }.
    """
    if not body:
        raise HTTPException(status_code=400, detail="JSON body required")
    try:
        result = forward_to_claude(body)
        return result
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("Claude proxy error: %s", e)
        raise HTTPException(status_code=502, detail="Failed to reach Claude API") from e


@app.get("/citation/cases/{canonical_id}/graph")
async def get_case_citation_graph(canonical_id: str) -> Dict[str, Any]:
    """
    Return citation graph for a judgment (by canonical_id), based on Neo4j CITES/FOLLOWS/DISTINGUISHES/OVERRULES edges.
    Only include nodes that exist in our judgments index (i.e. verified or known in local DB/ES).
    """
    cid = (canonical_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="canonical_id is required")

    driver = get_neo4j_driver()
    if not driver:
        raise HTTPException(status_code=503, detail="Citation graph unavailable (Neo4j disabled)")

    # Collect center node + neighbours from Neo4j
    try:
        with driver.session() as session:
            cypher = """
                MATCH (c:CitedCase {caseId: $cid})
                OPTIONAL MATCH (c)-[r1]->(out:CitedCase)
                  WHERE type(r1) IN ['CITES','FOLLOWS','DISTINGUISHES','OVERRULES']
                OPTIONAL MATCH (inp:CitedCase)-[r2]->(c)
                  WHERE type(r2) IN ['CITES','FOLLOWS','DISTINGUISHES','OVERRULES']
                RETURN
                  c.caseId AS id,
                  c.caseName AS name,
                  collect(distinct {dir:'out', type:type(r1), to:out.caseId, toName:out.caseName}) AS outgoing,
                  collect(distinct {dir:'in',  type:type(r2), from:inp.caseId, fromName:inp.caseName}) AS incoming
            """
            rec = session.run(cypher, cid=cid).single()
    except Exception as exc:
        logger.warning("[GRAPH] Neo4j query failed for %s: %s", cid, exc)
        raise HTTPException(status_code=502, detail="Failed to fetch citation graph") from exc

    if not rec:
        return {"success": True, "nodes": [], "edges": []}

    # Build raw node/edge sets
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []

    def _add_node(node_id: str, label: str, role: str = "related") -> None:
        if not node_id:
            return
        if node_id not in nodes:
            nodes[node_id] = {"id": node_id, "label": label or node_id, "role": role}

    center_id = rec.get("id")
    center_name = rec.get("name") or center_id
    _add_node(center_id, center_name, role="center")

    for out in rec.get("outgoing") or []:
        to_id = out.get("to")
        to_name = out.get("toName") or to_id
        rel_type = (out.get("type") or "").upper()
        _add_node(to_id, to_name)
        if center_id and to_id:
            edges.append({"from": center_id, "to": to_id, "type": rel_type})

    for inc in rec.get("incoming") or []:
        from_id = inc.get("from")
        from_name = inc.get("fromName") or from_id
        rel_type = (inc.get("type") or "").upper()
        _add_node(from_id, from_name)
        if from_id and center_id:
            edges.append({"from": from_id, "to": center_id, "type": rel_type})

    # Show all Neo4j nodes; only exclude QUARANTINED ones that exist in local DB
    filtered_nodes: Dict[str, Dict[str, Any]] = {}
    for nid, meta in nodes.items():
        j = judgement_get(nid)
        if j and str(j.get("audit_status") or "").upper() == "QUARANTINED":
            continue
        filtered_nodes[nid] = meta

    filtered_node_ids = set(filtered_nodes.keys())
    filtered_edges = [e for e in edges if e["from"] in filtered_node_ids and e["to"] in filtered_node_ids]

    return {
        "success": True,
        "nodes": list(filtered_nodes.values()),
        "edges": filtered_edges,
    }


@app.get("/citation/judgements/search")
async def search_judgements(
    q: str = "",
    court: str = "",
    area: str = "",
    status: str = "",
    limit: int = 100,
 ) -> Dict[str, Any]:
    """Full-text search + filter across all indexed judgments."""
    from db.connections import get_pg_conn, get_es_client
    from psycopg2.extras import RealDictCursor

    results = []

    # Try Elasticsearch first
    es = get_es_client()
    if es:
        try:
            must = []
            if q.strip():
                must.append({"multi_match": {"query": q, "fields": ["case_name^4", "primary_citation^3", "holding_text^2", "summary_text^2", "full_text"], "type": "best_fields", "fuzziness": "AUTO"}})
            filters = []
            if court:
                filters.append({"term": {"court_code": court}})
            if area:
                filters.append({"term": {"area": area}})
            if status:
                filters.append({"term": {"audit_status": status}})
            es_query = {"bool": {"must": must or [{"match_all": {}}], "filter": filters}}
            resp = es.search(
                index="judgments",
                size=limit,
                query=es_query,
                _source=[  # pyrefly: ignore[unexpected-keyword]  # valid ES-py body param
                    "canonical_id", "case_name", "primary_citation", "court_code", "court_name", "area",
                    "audit_status", "audit_confidence", "year", "judgment_date", "source_type",
                    "coram", "holding_text", "summary_text", "statutes", "excerpt_para", "excerpt_text",
                    "source_url", "official_source_url",
                ],
            )
            for h in resp.get("hits", {}).get("hits", []):
                src = h.get("_source") or {}
                cid = src.get("canonical_id") or h.get("_id")
                score = h.get("_score") or 0
                max_score = resp.get("hits", {}).get("max_score") or 1
                match_pct = int(min(100, (score / max_score) * 100)) if q.strip() else None
                ratio = src.get("holding_text") or src.get("summary_text") or ""
                statutes = src.get("statutes")
                if isinstance(statutes, list):
                    statutes_str = "; ".join(str(s) for s in statutes if s) if statutes else ""
                else:
                    statutes_str = str(statutes or "")
                excerpt = src.get("excerpt_text") or ""
                excerpt_para = src.get("excerpt_para") or ""
                results.append({
                    "canonicalId": cid,
                    "caseName": src.get("case_name") or cid,
                    "primaryCitation": src.get("primary_citation") or "",
                    "court": src.get("court_name") or src.get("court_code") or "",
                    "coram": src.get("coram") or "",
                    "area": src.get("area") or "",
                    "year": src.get("year") or (str(src.get("judgment_date") or "")[:4]),
                    "dateOfJudgment": str(src.get("judgment_date") or ""),
                    "statutes": statutes_str,
                    "ratio": ratio,
                    "excerptPara": excerpt_para,
                    "excerpt": excerpt,
                    "auditStatus": src.get("audit_status") or "not_audited",
                    "confidence": int(src.get("audit_confidence") or 0),
                    "matchPct": match_pct,
                    "source": src.get("source_type") or "local",
                    "sourceUrl": src.get("source_url") or src.get("official_source_url") or "",
                })
            # Enrich results with empty ratio/statutes/excerpt via judgement_get
            for r in results:
                if not (r.get("ratio") or r.get("statutes") or r.get("excerpt")):
                    try:
                        j = judgement_get(str(r.get("canonicalId") or ""))
                        if j:
                            if not r.get("ratio") and j.get("ratio"):
                                r["ratio"] = str(j.get("ratio") or "")
                            if not r.get("statutes"):
                                s = j.get("statutes") or []
                                r["statutes"] = "; ".join(str(x) for x in s) if isinstance(s, list) else str(s or "")
                            if not r.get("excerpt") and j.get("excerpt_text"):
                                r["excerpt"] = str(j.get("excerpt_text") or "")
                            if not r.get("excerptPara") and j.get("excerpt_para"):
                                r["excerptPara"] = str(j.get("excerpt_para") or "")
                            if not r.get("area") and j.get("area"):
                                r["area"] = str(j.get("area") or "")
                    except Exception as exc:
                        logger.debug("[SEARCH] enrich %s: %s", r.get("canonicalId"), exc)
            return {"success": True, "total": len(results), "results": results}
        except Exception as exc:
            logger.warning("[SEARCH] ES failed: %s", exc)

    # Fallback: PostgreSQL (omit 'area' and 'ingested_at' so older schemas work)
    conn = get_pg_conn()
    if not conn:
        return {"success": True, "total": 0, "results": []}
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            where = ["1=1"]
            params: list = []
            if q.strip():
                where.append("case_name ILIKE %s")
                params.append(f"%{q}%")
            if court:
                where.append("court_code = %s")
                params.append(court)
            # Note: 'area' filter omitted so DBs without judgments.area column still work
            params.append(limit)
            cur.execute(
                f"""SELECT canonical_id, case_name, court_code, year, judgment_date,
                           verification_status, confidence_score, source_type
                      FROM judgments WHERE {' AND '.join(where)}
                     ORDER BY year DESC NULLS LAST, judgment_date DESC NULLS LAST LIMIT %s""",
                params,
            )
            for r in cur.fetchall():
                results.append({
                    "canonicalId": r["canonical_id"],
                    "caseName": r["case_name"] or r["canonical_id"],
                    "primaryCitation": "",
                    "court": r["court_code"] or "",
                    "coram": "",
                    "area": r.get("area", "") or "",
                    "year": str(r.get("year") or (r.get("judgment_date") or "")[:4] or ""),
                    "dateOfJudgment": str(r.get("judgment_date") or ""),
                    "statutes": "",
                    "ratio": "",
                    "excerptPara": "",
                    "excerpt": "",
                    "auditStatus": r.get("verification_status") or "not_audited",
                    "confidence": int(r.get("confidence_score") or 0),
                    "matchPct": None,
                    "source": r.get("source_type") or "local",
                    "sourceUrl": "",
                })
            # Enrich PG results via judgement_get
            for r in results:
                if not (r.get("ratio") or r.get("statutes") or r.get("excerpt")):
                    try:
                        j = judgement_get(str(r.get("canonicalId") or ""))
                        if j:
                            if not r.get("ratio") and j.get("ratio"):
                                r["ratio"] = str(j.get("ratio") or "")
                            if not r.get("statutes"):
                                s = j.get("statutes") or []
                                r["statutes"] = "; ".join(str(x) for x in s) if isinstance(s, list) else str(s or "")
                            if not r.get("excerpt") and j.get("excerpt_text"):
                                r["excerpt"] = str(j.get("excerpt_text") or "")
                            if not r.get("excerptPara") and j.get("excerpt_para"):
                                r["excerptPara"] = str(j.get("excerpt_para") or "")
                            if not r.get("area") and j.get("area"):
                                r["area"] = str(j.get("area") or "")
                            if not r.get("sourceUrl"):
                                r["sourceUrl"] = str(j.get("source_url") or j.get("import_source_link") or "")
                    except Exception as exc:
                        logger.debug("[SEARCH] enrich pg %s: %s", r.get("canonicalId"), exc)
        return {"success": True, "total": len(results), "results": results}
    finally:
        conn.close()


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/citation/build-report")
async def build_citation_report(
    query: str = Body(..., embed=True, description="Search query / case context"),
    case_title: Optional[str] = Body(None, embed=True, description="Case title (used as Stage 1 title field)"),
    raw_judgment: Optional[str] = Body(None, embed=True, description="Full raw judgment text (preferred)"),
    case_file_context: CaseFileContextInput = Body(None, embed=True, description="Attached case files [{name, content/snippet}] or manual case facts text"),
    output_format: str = Body("html", embed=True, description="'html' or 'markdown'"),
    case_id: Optional[str] = Body(None, embed=True),
    user_id: Optional[str] = Body("anonymous", embed=True),
    perspective: Optional[str] = Body(None, embed=True, description="Party perspective filter: 'appellant' | 'respondent' | 'court' | 'all'"),
    request: Request = None,  # pyrefly: ignore[bad-function-definition]  # FastAPI injects Request; bare type required
) -> Dict[str, Any]:
    """
    2-Stage Claude Report Builder.

    Stage 1 — Extraction Agent (claude-sonnet-4-6, max_tokens=2048):
      Reads raw judgment text and extracts a 14-field Citation JSON
      (caseName, primaryCitation, court, coram, dateOfJudgment, statutes,
       ratio, excerptPara, excerptText, subsequentTreatment, verificationStatus, …).

    Stage 2 — Render Agent (claude-sonnet-4-6, max_tokens=3000/2000):
      Receives the Citation JSON and renders a professional Legal Citation Report
      in HTML or Markdown following SCC/AIR Indian legal publishing conventions.

    If verificationStatus == 'Invalid / not found', Stage 2 is skipped and an
    error card payload is returned instead.

    **Input (pick one):**
    - `raw_judgment`: full text of the judgment (best quality)
    - `case_file_context`: list of attached documents with content/snippet fields

    **Returns:**
    ```json
    {
        "success": true,
        "report": "<html>…</html>",
        "citationJson": { … },
        "format": "html",
        "verificationStatus": "Verified and authentic"
    }
    ```
    """
    query = (query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    case_file_context = normalize_case_file_context(case_file_context)

    # Fetch case context if case_id provided but no files/raw text
    if case_id and not case_file_context and not raw_judgment:
        auth_header = request.headers.get("authorization") if request else None
        case_file_context, _ = await _fetch_case_context(case_id, auth_header)

    # Inject perspective hint into query context so Stage 1 can tag argument parties correctly
    _perspective = (perspective or "").lower().strip()
    _perspective_hint = ""
    if _perspective and _perspective != "all":
        _perspective_hint = f" [Research perspective: {_perspective} side arguments]"
    _query_with_perspective = query + _perspective_hint

    try:
        if raw_judgment and raw_judgment.strip():
            result = build_report(
                case_title=case_title or query[:120],
                query_context=_query_with_perspective,
                raw_judgment_text=raw_judgment,
                output_format=output_format,
            )
        elif case_file_context:
            result = build_report_from_files(
                query_context=_query_with_perspective,
                case_file_context=case_file_context,
                output_format=output_format,
                case_title=case_title,
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide either raw_judgment text or case_file_context with document content.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[build-report] Pipeline failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e

    if result.get("error"):
        status_val = result.get("status", "failed")
        # Invalid judgment → return error card (not a 500)
        if status_val == "Invalid / not found":
            return {
                "success": False,
                "status": "Invalid / not found",
                "citationJson": result.get("data"),
                "report": None,
            }
        raise HTTPException(status_code=500, detail=result.get("message", "Report build failed"))

    return {
        "success": True,
        "report": result["report"],
        "citationJson": result["citationJson"],
        "format": result.get("format", output_format),
        "verificationStatus": result.get("verificationStatus", ""),
        "argumentParty": result.get("argumentParty", "neutral"),
        "partyArguments": result.get("partyArguments", {}),
        "perspective": _perspective or "all",
        "case_id": case_id,
        "user_id": user_id,
    }


@app.post("/citation/report")
async def generate_citation_report(
    query: str = Body(..., embed=True),
    user_id: Optional[str] = Body("anonymous", embed=True),
    case_id: Optional[str] = Body(None, embed=True),
    case_file_context: CaseFileContextInput = Body(None, embed=True),
    search_results: Optional[List[Dict[str, Any]]] = Body(None, embed=True),
    use_pipeline: bool = Body(True, embed=True),
    retrieval_method: str = Body("indiankanoon", embed=True, description="Retrieval mode: 'indiankanoon' | 'web'"),
    perspective: Optional[str] = Body(None, embed=True, description="Party perspective: 'appellant' | 'respondent' | 'court' | 'all'"),
    custom_keywords: Optional[List[str]] = Body(None, embed=True, description="User-supplied keyword strings injected directly into the IK query pool"),
    selected_keywords: Optional[List[str]] = Body(None, embed=True, description="Keyword chips selected from suggestion panel — bypasses Stage 2 AI query generation"),
    selected_case_names: Optional[List[str]] = Body(None, embed=True, description="Case name chips selected from suggestion panel — searched on IK by title"),
    request: Request = None,  # pyrefly: ignore[bad-function-definition]  # FastAPI injects Request; bare type required
) -> Dict[str, Any]:
    """
    Generate a citation report (user-specific, stored in DB).

    If use_pipeline=True (default): runs Watchdog → Fetcher → Clerk → build report in verified
    citation format (same as frontend ALL_CITATIONS). Returns report_format so the React report
    page can render the same UI.

    If use_pipeline=False: uses only the citation agent (query + case_file_context + search_results)
    and returns report (markdown) + citations (simple list).

    **Returns (pipeline):** success, report_id, report_format: { citations: [...], generatedAt }.
    **Returns (agent only):** success, report, citations, confidence.
    """
    query = (query or "").strip()
    user_id = _resolve_citation_user_id(request, user_id)
    case_file_context = normalize_case_file_context(case_file_context)
    # If case_id provided, fetch case context from document-service when missing
    if case_id and not case_file_context:
        auth_header = request.headers.get("authorization") if request else None
        case_file_context, _ = await _fetch_case_context(case_id, auth_header)

    if not query:
        raise HTTPException(status_code=400, detail="query is required and must be non-empty")

    if use_pipeline:
        import uuid as _pipeline_uuid
        pipeline_run_id = str(_pipeline_uuid.uuid4())
        if request is not None:
            request.state.run_id = pipeline_run_id
        if not _try_acquire_pipeline_slot():
            raise HTTPException(
                status_code=429,
                detail=f"Citation pipeline is busy. Try again shortly. Max concurrent runs: {PIPELINE_MAX_CONCURRENT_RUNS}",
            )
        try:
            out = await asyncio.wait_for(
                asyncio.to_thread(
                    run_pipeline,
                    query=query,
                    user_id=user_id,
                    ingest_external=True,
                    case_file_context=case_file_context or [],
                    case_id=case_id,
                    retrieval_method=retrieval_method,
                    custom_keywords=custom_keywords or [],
                    selected_keywords=selected_keywords or [],
                    selected_case_names=selected_case_names or [],
                    perspective=perspective or "all",
                    run_id=pipeline_run_id,
                ),
                timeout=SYNC_PIPELINE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as e:
            logger.error(
                "Pipeline timed out after %ss for query=%r",
                SYNC_PIPELINE_TIMEOUT_SECONDS,
                query[:120],
            )
            raise HTTPException(
                status_code=504,
                detail=f"Pipeline timed out after {SYNC_PIPELINE_TIMEOUT_SECONDS}s",
            ) from e
        except Exception as e:
            logger.exception("Pipeline failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e)) from e
        finally:
            _release_pipeline_slot()
        if out.get("error"):
            raise HTTPException(status_code=500, detail=out["error"])

        # HITL rows for RED/YELLOW/PENDING/STALE citations are created in CitationRootAgent
        # (hitl_enqueue_citations_from_report) so async /citation/report/start and this path stay consistent.
        report_id_out = out.get("report_id")
        run_id_out = out.get("run_id")
        fmt = out.get("report_format") or {}

        _perspective = (perspective or "all").lower().strip()
        if isinstance(fmt, dict):
            fmt = {**fmt, "perspective": fmt.get("perspective") or _perspective}
            if run_id_out:
                try:
                    from utils.pricing import inr_to_usd

                    usage_rows = usage_get_by_run(run_id_out)
                    total_inr = sum(float(r.get("cost_inr") or 0) for r in usage_rows)
                    total_usd = sum(float(r.get("cost_usd") or 0) for r in usage_rows)
                    if total_inr and not total_usd:
                        total_usd = inr_to_usd(total_inr)
                    fmt = {
                        **fmt,
                        "runCostInr": round(total_inr, 4),
                        "runCostUsd": round(total_usd, 6),
                        "runUsageRecordCount": len(usage_rows),
                    }
                    if report_id_out:
                        report_update(report_id_out, report_format=fmt)
                except Exception as exc:
                    logger.warning("[citation/report] attach run usage costs failed: %s", exc)

        return {
            "success": True,
            "report_id": report_id_out,
            "report_format": fmt,
            "case_id": case_id,
            "run_id": run_id_out,
            "status": out.get("status", "completed"),
            "perspective": _perspective or "all",
        }

    # Legacy agent-only path removed — use use_pipeline=true
    raise HTTPException(
        status_code=410,
        detail="Legacy citation agent is no longer supported. Use use_pipeline=true.",
    )


@app.get("/citation/reports/team")
async def get_team_reports(
    request: Request,
    member_ids: Optional[str] = Query(None, description="Comma-separated firm member user IDs (from frontend)"),
    user_id: Optional[str] = Query(None, description="Caller user ID fallback when JWT secret not configured"),
    account_type: Optional[str] = Query(None, description="Caller account_type fallback when JWT secret not configured"),
    case_id: Optional[str] = Query(None, description="Filter shared reports by case ID (case-specific view)"),
) -> Dict[str, Any]:
    """
    Team shared reports.
    - FIRM_ADMIN (with member_ids): all shared reports owned by any firm member.
    - Other users: only reports explicitly shared with this user.
    member_ids / user_id / account_type are passed from frontend as fallback
    when JWT_SECRET is not configured in the citation service.
    """
    payload = _decode_jwt(request)
    # Use JWT values; fall back to explicit query params when JWT_SECRET is not set
    caller_id = str(payload.get("id") or payload.get("userId") or user_id or "")
    resolved_account_type = str(payload.get("account_type") or account_type or "").upper()
    # Fallback: if member_ids is non-empty, caller likely has firm context (getFirmMembers returned members)
    member_ids_param = (member_ids or "").strip()
    if not resolved_account_type and member_ids_param and caller_id:
        resolved_account_type = "FIRM_ADMIN"

    if resolved_account_type == "FIRM_ADMIN" and caller_id:
        # Use member_ids passed from frontend if available, else try internal fetch
        if member_ids_param:
            ids = [mid.strip() for mid in member_ids_param.split(",") if mid.strip()]
        else:
            try:
                members = await _fetch_firm_members(int(caller_id))
                ids = [str(m.get("user_id")) for m in members if m.get("user_id")]
            except Exception as exc:
                logger.warning("[TEAM] firm-member fetch failed: %s", exc)
                ids = []
        if caller_id not in ids:
            ids.append(caller_id)
        if ids:
            # Reports owned by firm members
            owned = report_list_firm_shared(ids, limit=100, case_id=case_id)
            # Reports shared with any firm member (including by users outside the firm)
            shared_with_us = report_list_shared_with_members(ids, limit=100, case_id=case_id)
            seen = {r["id"] for r in owned}
            for r in shared_with_us:
                if r["id"] not in seen:
                    seen.add(r["id"])
                    owned.append(r)
            reports = sorted(owned, key=lambda x: x.get("created_at") or "", reverse=True)[:100]
        else:
            reports = []
    elif caller_id:
        from db.client import get_pg_conn
        from psycopg2.extras import RealDictCursor as _RDC
        conn = get_pg_conn()
        reports = []
        if conn:
            try:
                with conn.cursor(cursor_factory=_RDC) as cur:
                    # Use EXISTS + jsonb_array_elements so user_id match works for both string/int in stored JSON
                    cur.execute(
                        """
                        SELECT id, user_id, query, created_at, status, case_id, citation_count,
                               hitl_pending_count, shared_with
                          FROM citation_reports r
                         WHERE r.user_id != %s
                           AND r.shared_with IS NOT NULL
                           AND jsonb_array_length(r.shared_with) > 0
                           AND EXISTS (
                             SELECT 1 FROM jsonb_array_elements(r.shared_with) elem
                             WHERE elem->>'user_id' = %s
                           )
                           AND (%s IS NULL OR r.case_id = %s)
                         ORDER BY r.created_at DESC LIMIT 100
                        """,
                        (caller_id, caller_id, case_id, case_id),
                    )
                    reports = cur.fetchall() or []
            finally:
                conn.close()
    else:
        reports = []

    return {"success": True, "reports": [dict(r) for r in reports]}


@app.get("/citation/reports")
async def list_reports(
    user_id: str = Query(..., description="User ID"),
    case_id: Optional[str] = Query(None, description="Filter by case ID"),
) -> Dict[str, Any]:
    """List citation reports. If case_id provided, returns reports for that specific case."""
    if case_id:
        reports = report_list_by_case(case_id, user_id=user_id, limit=50)
    else:
        reports = report_list_by_user(user_id, limit=50)
    return {"success": True, "reports": reports}


@app.delete("/citation/reports/{report_id}")
async def delete_report(
    report_id: str,
    user_id: Optional[str] = Query(None, description="Optional: only allow delete if report belongs to this user"),
) -> Dict[str, Any]:
    """Delete a generated citation report. Optionally pass user_id to restrict to own reports."""
    deleted = report_delete(report_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Report not found or not owned by user")
    return {"success": True, "message": "Report deleted", "report_id": report_id}


@app.get("/citation/firm-members")
async def get_firm_members_for_share(request: Request) -> Dict[str, Any]:
    """Return all firm members for the calling JWT user. Used by the share-report dialog."""
    payload = _decode_jwt(request)
    caller_id = payload.get("id") or payload.get("userId")
    if not caller_id:
        return {"success": True, "members": []}
    try:
        members = await _fetch_firm_members(int(caller_id))
        return {"success": True, "members": members}
    except Exception as exc:
        logger.warning("[SHARE] firm-members fetch failed: %s", exc)
        return {"success": True, "members": []}


@app.get("/citation/reports/{report_id}/shares")
async def get_report_shares_endpoint(report_id: str) -> Dict[str, Any]:
    """Get current shared_with list for a report."""
    shares = report_get_shares(report_id)
    return {"success": True, "shared_with": shares}


@app.post("/citation/reports/{report_id}/share")
async def share_report_endpoint(request: Request, report_id: str, body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """
    Share a citation report with firm members.
    Body: { shared_with: [{user_id, email, username, shared_at}] }
    Only the report owner can share. user_id in entries is normalized to string for JSONB matching.
    """
    import datetime as _dt
    payload = _decode_jwt(request)
    caller_id = str(payload.get("id") or payload.get("userId") or "")

    report = report_get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report_owner = str(report.get("user_id") or "")
    if report_owner and caller_id and report_owner != caller_id:
        raise HTTPException(status_code=403, detail="Only the report owner can share this report")

    shared_entries = body.get("shared_with") or []
    now_iso = _dt.datetime.utcnow().isoformat()
    normalized = []
    for entry in shared_entries:
        e = dict(entry)
        if not e.get("shared_at"):
            e["shared_at"] = now_iso
        if "user_id" in e and e["user_id"] is not None:
            e["user_id"] = str(e["user_id"])
        normalized.append(e)
    ok = report_share(report_id, normalized)
    if not ok:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"success": True, "shared_with": normalized}


@app.get("/citation/judgements/{canonical_id}/full-text")
async def get_judgement_full_text(canonical_id: str) -> Dict[str, Any]:
    """Return the complete judgment text for a citation. Checks judgments table first, then ik_document_assets."""
    j = judgement_get(canonical_id)
    if j:
        raw_full = j.get("full_text") or j.get("raw_content") or ""
        citation_data = j.get("citation_data") or {}
        is_local_admin = bool(j.get("is_local_admin"))
        pdf_bucket_path = (
            j.get("ik_orig_doc_url")
            or j.get("source_url")
            or j.get("official_source_url")
            or j.get("import_source_link")
            or ""
        )
        return {
            "success": True,
            "canonical_id": canonical_id,
            "case_name": j.get("title") or j.get("case_name") or "Judgment",
            "full_text": _html_to_text(raw_full),
            "source_url": j.get("source_url") or j.get("official_source_url") or j.get("import_source_link") or "",
            "source": "local_db",
            "is_local_admin": is_local_admin,
            "pdf_bucket_path": pdf_bucket_path if is_local_admin else "",
            "ik_cite_list": citation_data.get("ikCiteList") or citation_data.get("ik_cite_list") or [],
            "ik_cited_by_list": citation_data.get("ikCitedByList") or citation_data.get("ik_cited_by_list") or [],
            "metadata": {
                "court": j.get("court_name") or j.get("court_code") or "",
                "bench": j.get("bench") or j.get("coram") or "",
                "date": j.get("judgment_date") or j.get("date") or "",
                "citation": j.get("primary_citation") or "",
            },
        }

    # Fall back to ik_document_assets (canonical_id format: "ik:{tid}")
    ik_tid = canonical_id.removeprefix("ik:").strip() if canonical_id.startswith("ik:") else canonical_id.strip()
    if ik_tid:
        from db.client import ik_asset_get
        asset = ik_asset_get(ik_tid)
        if asset:
            raw_resp = asset.get("raw_api_response") or {}
            raw_content = (raw_resp.get("raw_content")
                           or _html_to_text(raw_resp.get("doc_html") or "")
                           or "")
            if not raw_content:
                doc_data = raw_resp.get("doc_data") or {}
                raw_content = _html_to_text(doc_data.get("doc") or "")
            title = asset.get("title") or (raw_resp.get("doc_data") or {}).get("title") or "Judgment"
            source_url = asset.get("orig_doc_url") or f"https://indiankanoon.org/doc/{ik_tid}/"
            gcs_path = asset.get("orig_doc_gcs_path") or ""
            return {
                "success": True,
                "canonical_id": canonical_id,
                "case_name": title,
                "full_text": raw_content,
                "source_url": source_url,
                "source": "local_db",
                "is_local_admin": True,
                "pdf_bucket_path": gcs_path or source_url,
                "ik_cite_list": raw_resp.get("cites") or raw_resp.get("citeList") or [],
                "ik_cited_by_list": raw_resp.get("citedby") or raw_resp.get("citedbyList") or [],
                "metadata": {
                    "court": raw_resp.get("docsource") or "",
                    "bench": raw_resp.get("bench") or raw_resp.get("coram") or "",
                    "date": raw_resp.get("publishdate") or "",
                    "citation": raw_resp.get("citation") or raw_resp.get("primarycitation") or "",
                },
            }

    # Not in any local DB — fetch live from IK API, show result directly without storing
    if ik_tid:
        try:
            from services.indiankanoon_client import ik_fetch_doc
            doc_data = ik_fetch_doc(ik_tid, maxcites=20, maxcitedby=20)
            if doc_data:
                doc_html = doc_data.get("doc") or ""
                raw_content = _html_to_text(doc_html)
                title = doc_data.get("title") or "Judgment"
                ik_url = f"https://indiankanoon.org/doc/{ik_tid}/"
                return {
                    "success": True,
                    "canonical_id": canonical_id,
                    "case_name": title,
                    "full_text": raw_content,
                    "source_url": ik_url,
                    "ik_resource_url": ik_url,
                    "source": "indiankanoon_live",
                    "ik_cite_list": doc_data.get("cites") or doc_data.get("citeList") or [],
                    "ik_cited_by_list": doc_data.get("citedby") or doc_data.get("citedbyList") or [],
                    "metadata": {
                        "court": doc_data.get("docsource") or "",
                        "bench": doc_data.get("bench") or doc_data.get("coram") or "",
                        "date": doc_data.get("publishdate") or doc_data.get("date") or "",
                        "citation": doc_data.get("citation") or "",
                    },
                }
        except Exception as _ik_exc:
            logger.warning("[FULL_TEXT] Live IK fetch failed for tid=%s: %s", ik_tid, _ik_exc)

    raise HTTPException(status_code=404, detail="Judgment not found")


@app.get("/citation/reports/{report_id}")
async def get_report(report_id: str) -> Dict[str, Any]:
    """
    Get one report by ID. Returns report_format (citations + generatedAt) for the frontend.
    If status is pending_hitl, report_format includes pendingMessage and approved citations only;
    after HITL approval, status becomes completed and full report is returned.
    """
    # Guard against invalid UUIDs (e.g. placeholder "—") to avoid DB errors
    try:
        UUID(str(report_id))
    except Exception:
        raise HTTPException(status_code=404, detail="Report not found")

    report = report_get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    fmt = report.get("report_format")
    if isinstance(fmt, str):
        import json
        try:
            fmt = json.loads(fmt)
        except Exception:
            fmt = {"citations": [], "generatedAt": ""}
    dims_meta = report.get("dimensions_metadata") or []
    if isinstance(fmt, dict) and dims_meta and not fmt.get("dimensions"):
        fmt["dimensions"] = dims_meta
    cit_list = (fmt or {}).get("citations") or [] if isinstance(fmt, dict) else []
    print(
        f"[GET_REPORT] report_id={report_id[:8]} citations={len(cit_list)}"
        + (f" vs[0]={cit_list[0].get('verificationStatus','?')}" if cit_list else ""),
        flush=True,
    )
    return {
        "success": True,
        "report_id": report_id,
        "user_id": report.get("user_id"),
        "query": report.get("query"),
        "created_at": report.get("created_at"),
        "status": report.get("status", "completed"),
        "report_format": fmt,
        "hitl_pending_count": report.get("hitl_pending_count") or 0,
    }


@app.get("/citation/hitl/queue")
async def hitl_list(
    report_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    status: Optional[str] = Query("pending"),
) -> Dict[str, Any]:
    """List HITL queue items (pending citations for human verification). Filter by report_id or user_id."""
    from db.client import hitl_queue_list_by_report
    if report_id:
        items = hitl_queue_list_by_report(report_id, status=status)
    else:
        items = []  # TODO: hitl_queue_list_by_user if needed
    return {"success": True, "items": items}


@app.post("/citation/hitl/approve")
async def hitl_approve(
    report_id: str = Body(..., embed=True),
    hitl_ids: Optional[list] = Body(None, embed=True),
    approved: bool = Body(True, embed=True),
    reviewed_by: Optional[str] = Body(None, embed=True),
) -> Dict[str, Any]:
    """
    Approve or reject HITL items. If hitl_ids omitted, all pending items for report_id are updated.
    When all pending items for a report are approved, the report is rebuilt (approved + HITL-approved)
    and status set to completed so the user gets the full citation report.
    """
    # NOTE: report_builder was removed with the legacy pipeline; this handler rebuilds the report
    # inline below from the approved citation_snapshots, so nothing here needs it. The import
    # outlived the module and made every call to this endpoint raise ModuleNotFoundError.
    from db.client import report_get
    pending = hitl_queue_list_by_report(report_id, status="pending")
    if not pending:
        return {"success": True, "message": "No pending HITL items for this report", "report_status": report_get(report_id) or {}}
    to_update = [h for h in pending if not hitl_ids or str(h.get("id")) in [str(i) for i in hitl_ids]]
    new_status = "approved" if approved else "rejected"
    for h in to_update:
        hitl_queue_update_status(str(h["id"]), new_status, reviewed_by=reviewed_by)
    remaining = hitl_queue_pending_count(report_id)
    if remaining == 0:
        # Rebuild full report: approved citations + HITL-approved citation_snapshots
        report = report_get(report_id)
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        fmt = report.get("report_format") or {}
        if isinstance(fmt, str):
            import json
            try:
                fmt = json.loads(fmt)
            except Exception:
                fmt = {}
        approved_items = hitl_queue_list_by_report(report_id, status="approved")
        citations = list(fmt.get("citations") or [])
        seen_ids = {c.get("canonicalId") or c.get("id") for c in citations}
        for h in approved_items:
            snap = h.get("citation_snapshot") or {}
            if not snap:
                continue
            cid = snap.get("canonicalId") or snap.get("id")
            if cid and cid not in seen_ids:
                citations.append(snap)
                seen_ids.add(cid)
        fmt["citations"] = citations
        dims_meta = report.get("dimensions_metadata") or []
        if dims_meta and not fmt.get("dimensions"):
            fmt["dimensions"] = dims_meta
        fmt["status"] = "completed"
        fmt.pop("pendingHITLCount", None)
        fmt.pop("pendingMessage", None)
        report_update(
            report_id,
            report_format=fmt,
            status="completed",
            hitl_pending_count=0,
            hitl_approved_count=len(approved_items),
            dimensions_metadata=dims_meta,
        )
    return {
        "success": True,
        "updated": len(to_update),
        "remaining_pending": remaining,
        "report_id": report_id,
        "report_status": "completed" if remaining == 0 else "pending_hitl",
    }


@app.post("/citation/hitl/{ticket_id}/notify")
async def hitl_notify_me(
    ticket_id: str,
    user_id: str = Body(..., embed=True),
) -> Dict[str, Any]:
    """
    Register a user to be notified when HITL ticket is resolved.
    Stores user_id against the ticket so a notification can be pushed on resolution.
    """
    from db.connections import get_pg_conn
    conn = get_pg_conn()
    if not conn:
        return {"success": False, "error": "Database unavailable"}
    try:
        with conn.cursor() as cur:
            # Store notify subscribers as a JSONB array in hitl_queue
            cur.execute(
                """
                UPDATE hitl_queue
                SET citation_snapshot = jsonb_set(
                    COALESCE(citation_snapshot, '{}'::jsonb),
                    '{notify_users}',
                    COALESCE(citation_snapshot->'notify_users', '[]'::jsonb) || to_jsonb(%s::text),
                    true
                )
                WHERE id = %s
                """,
                (user_id, ticket_id),
            )
        conn.commit()
        logger.info("[HITL] Notify-me registered: user=%s ticket=%s", user_id, ticket_id)
        return {"success": True, "ticket_id": ticket_id, "message": "You will be notified when this citation is verified."}
    except Exception as e:
        logger.warning("[HITL] notify_me failed: %s", e)
        return {"success": False, "error": str(e)}
    finally:
        conn.close()


@app.get("/citation/runs/{run_id}/logs")
async def get_run_logs(
    run_id: str,
    limit: int = Query(200, le=2000),
    since_time: str = Query("", description="ISO timestamp — return only logs created after this time (for polling)"),
) -> Dict[str, Any]:
    """Return agent logs for a pipeline run. Use since_time for incremental polling.

    Timestamps are converted to Asia/Kolkata (IST) so the frontend can display
    user-facing times without having to guess server timezone.
    """
    from db.connections import get_pg_conn
    from psycopg2.extras import RealDictCursor
    conn = get_pg_conn()
    if not conn:
        return {"success": True, "run_id": run_id, "logs": [], "count": 0}
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if since_time:
                cur.execute(
                    """SELECT id, run_id, report_id, agent_name, stage, log_level, message, metadata, created_at
                         FROM agent_logs
                        WHERE run_id = %s AND created_at > %s::timestamptz
                        ORDER BY created_at ASC LIMIT %s""",
                    (run_id, since_time, limit),
                )
            else:
                cur.execute(
                    """SELECT id, run_id, report_id, agent_name, stage, log_level, message, metadata, created_at
                         FROM agent_logs
                        WHERE run_id = %s
                        ORDER BY created_at ASC LIMIT %s""",
                    (run_id, limit),
                )
            rows = cur.fetchall()
        logs = [dict(r) for r in rows]
        from datetime import timezone, timedelta

        ist = timezone(timedelta(hours=5, minutes=30))
        for l in logs:
            ts = l.get("created_at")
            if not ts:
                continue
            # Database often stores naive UTC timestamps; normalize to UTC first if needed.
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            l["created_at"] = ts.astimezone(ist).isoformat()
            
            # psycopg2 returns jsonb as strings if register_json() isn't called
            meta = l.get("metadata")
            if isinstance(meta, str):
                import json
                try:
                    l["metadata"] = json.loads(meta)
                except Exception:
                    pass

        return {"success": True, "run_id": run_id, "logs": logs, "count": len(logs)}
    finally:
        conn.close()


@app.get("/citation/ik-cache")
async def get_ik_cache(
    limit: int = Query(50, le=200),
) -> Dict[str, Any]:
    """
    List recently stored Indian Kanoon document assets (DB cache).
    Returns doc_id, title, docsource, char count, origdoc URL, cache hit count, timestamps.
    """
    try:
        from db.client import ik_asset_list_recent
        rows = ik_asset_list_recent(limit=limit)
        from datetime import timezone
        out = []
        for r in rows:
            r2 = dict(r)
            for ts_key in ("created_at", "updated_at"):
                ts = r2.get(ts_key)
                if ts and hasattr(ts, "isoformat"):
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    r2[ts_key] = ts.isoformat()
            out.append(r2)
        return {"success": True, "count": len(out), "assets": out}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/citation/ik-cache/{doc_id}")
async def get_ik_cache_doc(doc_id: str) -> Dict[str, Any]:
    """Get full cached IK asset for a specific doc_id (includes raw_api_response)."""
    try:
        from db.client import ik_asset_get
        asset = ik_asset_get(doc_id)
        if not asset:
            raise HTTPException(status_code=404, detail=f"No cached data for doc_id={doc_id}")
        from datetime import timezone
        for ts_key in ("created_at", "updated_at"):
            ts = asset.get(ts_key)
            if ts and hasattr(ts, "isoformat"):
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                asset[ts_key] = ts.isoformat()
        return {"success": True, "asset": asset}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/citation/analytics/enterprise")
async def get_enterprise_analytics(
    request: Request,
    days: int = Query(30, ge=1, le=365, description="Number of days for summary and team activity"),
    months: int = Query(6, ge=1, le=24, description="Number of months for volume trend"),
) -> Dict[str, Any]:
    """
    Enterprise usage analytics — restricted to FIRM_ADMIN users.

    Aggregates:
    - summary: total queries / citations / time saved / active users (last N days)
    - volume_trend: monthly queries + citations (last N months)
    - team_activity: per-user stats (last N days)
    """
    payload = _decode_jwt(request)
    account_type = str(payload.get("account_type") or "").upper() or None
    if account_type and account_type not in ("FIRM_ADMIN", "SUPER_ADMIN"):
        raise HTTPException(status_code=403, detail="Access restricted to firm administrators or super admins.")

    # Fetch all firm members (id + email + username + auth_type + role) for the calling user
    caller_id = payload.get("id") or payload.get("userId")
    members: List[Dict[str, Any]] = []
    if caller_id:
        try:
            caller_id = int(caller_id)
            members = await _fetch_firm_members(caller_id)
            # If firm-members returned fallback (username same as user_id), try bulk lookup to get real info
            if members and str(members[0].get("username")) == str(members[0].get("user_id", "")):
                bulk_users = await _fetch_users_bulk([int(m.get("user_id")) for m in members if m.get("user_id")])
                if bulk_users:
                    members = bulk_users
        except Exception as exc:
            logger.warning("[ANALYTICS] firm-members fetch failed: %s", exc)

    # Build user_id → {display_name, username, auth_type, role} map for team activity table
    user_info_map: Dict[str, Dict[str, Any]] = {}
    member_ids: List[str] = []
    for m in members:
        uid_str = str(m.get("user_id", ""))
        if uid_str:
            member_ids.append(uid_str)
            display = m.get("username") or m.get("email") or uid_str
            user_info_map[uid_str] = {
                "display_name": display,
                "username": m.get("username") or m.get("email") or uid_str,
                "auth_type": m.get("auth_type") or "—",
                "role": m.get("role") or "—",
            }

    data = analytics_get_enterprise_dashboard(
        days_window=days,
        months=months,
        member_ids=member_ids if member_ids else None,
        user_info_map=user_info_map if user_info_map else None,
    )

    # Post-process: bulk lookup any team_activity rows that still show user_id (username/display_name == user_id)
    team_activity = data.get("team_activity") or []
    ids_to_lookup = []
    for row in team_activity:
        uid = row.get("user_id", "")
        un = row.get("username") or row.get("display_name") or ""
        if uid and str(un) == str(uid) and uid not in ("anonymous", "Anonymous"):
            try:
                nid = int(uid)
                if nid > 0:
                    ids_to_lookup.append(nid)
            except (ValueError, TypeError):
                pass
    if ids_to_lookup:
        bulk_users = await _fetch_users_bulk(list(set(ids_to_lookup)))
        bulk_map = {str(u.get("user_id")): u for u in bulk_users if u.get("user_id")}
        for row in team_activity:
            uid_str = str(row.get("user_id", ""))
            if uid_str in bulk_map:
                u = bulk_map[uid_str]
                row["username"] = u.get("username") or u.get("email") or row.get("username")
                row["display_name"] = u.get("email") or u.get("username") or row.get("display_name")
                row["auth_type"] = u.get("auth_type") or row.get("auth_type")
                row["role"] = u.get("role") or row.get("role")

    return {"success": True, **data}


@app.get("/citation/analytics/usage")
async def get_citation_usage_analytics(
    request: Request,
    days: int = Query(30, ge=1, le=365, description="Number of days for usage summary"),
    scope: str = Query("firm", description="Scope: 'firm' (firm members) or 'platform' (all users, SUPER_ADMIN only)"),
) -> Dict[str, Any]:
    """
    Admin-only third-party cost analytics (stored in DB; not shown to end users in product).
    Costs are tracked per provider: gemini, claude, document_ai, indian_kanoon, serper.
    - FIRM_ADMIN: always firm-scoped (own firm members only).
    - SUPER_ADMIN + scope=platform: all users / all firms.
    - SUPER_ADMIN + scope=firm: same as firm admin (caller's firm members).
    """
    payload = _decode_jwt(request)
    account_type = str(payload.get("account_type") or "").upper() or None
    caller_id = payload.get("id") or payload.get("userId")

    if account_type not in ("FIRM_ADMIN", "SUPER_ADMIN"):
        raise HTTPException(status_code=403, detail="Access restricted to firm administrators or super admins.")

    scope = (scope or "firm").strip().lower()
    if scope not in ("firm", "platform"):
        scope = "firm"
    if scope == "platform" and account_type != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Platform-wide scope requires SUPER_ADMIN.")

    # FIRM_ADMIN ignores scope=platform — always firm-only
    effective_scope = "firm" if account_type == "FIRM_ADMIN" else scope
    user_ids, user_info_map = await _usage_analytics_resolve_user_ids(account_type, effective_scope, caller_id)

    agg = usage_get_aggregate(days=days, user_ids=user_ids)
    by_user_raw = usage_get_user_breakdown(days=days, user_ids=user_ids)

    by_user: List[Dict[str, Any]] = []
    for row in by_user_raw:
        uid = row.get("user_id") or "unknown"
        info = user_info_map.get(uid) or {}
        raw_svc = row.get("by_service") or {}
        stored_name = (row.get("user_display_name") or "").strip()
        stored_un = (row.get("username") or "").strip()
        display = (
            info.get("display_name")
            or stored_name
            or stored_un
            or info.get("username")
            or uid
        )
        by_user.append({
            "user_id": uid,
            "display_name": display,
            "username": info.get("username") or stored_un or display,
            "total_cost_inr": row.get("total_cost_inr", 0),
            "total_cost_usd": row.get("total_cost_usd", 0),
            "runs": row.get("runs", 0),
            "cost_stores": normalize_user_by_service(raw_svc),
            "by_service": raw_svc,
        })

    return {
        "success": True,
        "effective_scope": effective_scope,
        "summary": {
            "total_cost_inr": agg.get("total_cost_inr", 0),
            "total_cost_usd": agg.get("total_cost_usd", 0),
            "cost_stores": normalize_aggregate_by_service(agg.get("by_service")),
            "by_service": agg.get("by_service", {}),
            "total_queries": agg.get("total_queries", 0),
            "active_users": len(by_user),
        },
        "by_user": by_user,
    }


@app.get("/citation/analytics/usage/by-run/{run_id}")
async def get_citation_usage_by_run(
    request: Request,
    run_id: str,
) -> Dict[str, Any]:
    """Per-run usage breakdown. Owner or super admin; firm admin only if run belongs to a firm member."""
    payload = _decode_jwt(request)
    caller_id = str(payload.get("id") or payload.get("userId") or "")
    account_type = str(payload.get("account_type") or "").upper()

    if not caller_id and not payload:
        raise HTTPException(status_code=401, detail="Authentication required.")

    records = usage_get_by_run(run_id)
    run_user_id = pipeline_run_get_user_id(run_id)
    if not run_user_id and records:
        run_user_id = str(records[0].get("user_id") or "")

    if account_type == "FIRM_ADMIN" and caller_id:
        try:
            cid = int(caller_id)
            members = await _fetch_firm_members(cid)
            mids = {str(m.get("user_id")) for m in members if m.get("user_id")}
            if run_user_id and str(run_user_id) not in mids:
                raise HTTPException(status_code=403, detail="This run is not part of your firm.")
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("[USAGE_BY_RUN] firm check failed: %s", exc)

    if account_type not in ("FIRM_ADMIN", "SUPER_ADMIN") and str(run_user_id or "") != str(caller_id):
        raise HTTPException(status_code=403, detail="Access restricted to run owner or admin.")

    if not records:
        return {"success": True, "run_id": run_id, "records": [], "user_id": run_user_id}

    return {"success": True, "run_id": run_id, "user_id": run_user_id, "records": records}


# In-memory run state: run_id → {status, report_id, report_format, error}
_run_state: Dict[str, Dict[str, Any]] = {}
STALE_RUN_TIMEOUT_SECONDS = max(60, _env_int("CITATION_STALE_RUN_TIMEOUT_SECONDS", 600))
INMEMORY_RUN_TIMEOUT_SECONDS = max(120, _env_int("CITATION_INMEMORY_RUN_TIMEOUT_SECONDS", 900))

def _gemini_grounding_json(prompt: str, max_tokens: int = 1024) -> str:
    """Call Gemini with Google Search grounding tool. Returns raw response text."""
    import os, time as _time
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")
    from google import genai
    from google.genai import types
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    grounding_tool = types.Tool(google_search=types.GoogleSearch())
    config = types.GenerateContentConfig(
        tools=[grounding_tool],
        max_output_tokens=max_tokens,
        temperature=0.0,
    )
    client = genai.Client(api_key=api_key)
    for attempt in range(3):
        try:
            response = client.models.generate_content(model=model, contents=prompt, config=config)
            return getattr(response, "text", None) or ""
        except Exception as exc:
            msg = str(exc)
            if ("429" in msg or "RESOURCE_EXHAUSTED" in msg.upper()) and attempt < 2:
                _time.sleep(8 * (attempt + 1))
                continue
            raise
    # Unreachable (loop always returns or raises) — present so the type checker
    # can see this -> str function never falls through to an implicit None.
    raise RuntimeError("Gemini grounding failed after retries")


@app.post("/citation/suggest-keywords")
async def suggest_citation_keywords(
    request: Request,
    case_id: Optional[str] = Body(None, embed=True),
    query: Optional[str] = Body(None, embed=True),
    case_file_context: CaseFileContextInput = Body(None, embed=True),
) -> Dict[str, Any]:
    """Generate 3 categories of IK keyword suggestions + related landmark cases via Google Grounding.

    Returns:
      statute_keywords, principle_keywords, fact_keywords — lists of search phrase strings.
      related_cases — list of { case_name, citation, relevance, url? } for lawyer reference.
    """
    import json as _json, re as _re

    case_file_context = normalize_case_file_context(case_file_context)
    # Fetch case context if not provided
    if case_id and not case_file_context:
        auth_header_pre = request.headers.get("authorization")
        case_file_context, _ = await _fetch_case_context(case_id, auth_header_pre)

    # Gather ALL chunks for comprehensive analysis
    all_text_parts: List[str] = []
    for f in (case_file_context or []):
        chunk = (f.get("snippet") or f.get("content") or "").strip()
        if chunk:
            all_text_parts.append(chunk)

    full_case_text = "\n\n---\n\n".join(all_text_parts)

    # If substantial text exists, summarize all chunks first for richer keyword quality
    if len(full_case_text) > 5000:
        logger.info("[SUGGEST_KW] Summarizing %d chars across %d chunks before keyword generation",
                    len(full_case_text), len(all_text_parts))

        _sum_system = (
            "You are a senior Indian legal analyst. Read the following case documents carefully and "
            "produce a concise 500-700 word structured case summary covering:\n"
            "1. Parties and their roles\n"
            "2. Factual background (key facts)\n"
            "3. Legal issues and questions in dispute\n"
            "4. Relevant statutes and sections cited (with exact numbers)\n"
            "5. Key legal principles involved\n"
            "Be specific — include exact statute names, section numbers, and concrete facts."
        )
        _sum_user = f"Case documents:\n\n{full_case_text[:40000]}"

        def _call_summary() -> str:
            try:
                raw = forward_to_claude({
                    "model": os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6"),
                    "max_tokens": 1024,
                    "system": _sum_system,
                    "messages": [{"role": "user", "content": _sum_user}],
                })
                for block in (raw.get("content") or []):
                    if isinstance(block, dict) and block.get("type") == "text":
                        return block.get("text", "").strip()
                return ""
            except Exception as e:
                logger.warning("[SUGGEST_KW] Summarization failed: %s", e)
                return ""

        context_text = await asyncio.to_thread(_call_summary)
        if not context_text:
            context_text = full_case_text[:8000]
        else:
            logger.info("[SUGGEST_KW] Case summarized to %d chars for keyword generation", len(context_text))
    elif full_case_text:
        context_text = full_case_text[:8000]
    else:
        context_text = ""

    if not context_text and query:
        context_text = query.strip()
    if not context_text:
        return {"statute_keywords": [], "principle_keywords": [], "fact_keywords": [], "related_cases": []}

    def _clean_json(text: str) -> str:
        text = text.strip()
        text = _re.sub(r"^```(?:json)?\s*\n?", "", text, flags=_re.M)
        text = _re.sub(r"\n?```\s*$", "", text, flags=_re.M).strip()
        m = _re.search(r"\{.*\}", text, _re.DOTALL)
        return m.group(0) if m else text

    # ── Part 1: keyword suggestions via Claude ───────────────────────────────
    kw_system = (
        "You are a senior Indian legal researcher. Given a case description, "
        "generate precise Indian Kanoon search keyword phrases in exactly 3 categories.\n"
        "- statute_keywords: statutes, sections, article numbers directly at issue (e.g. 'Section 300 IPC culpable homicide')\n"
        "- principle_keywords: legal doctrines or principles (e.g. 'res judicata bar second suit')\n"
        "- fact_keywords: the factual scenario in plain language (e.g. 'unauthorized road construction private land municipal corporation')\n"
        "Rules: 3-5 phrases per category. Each phrase 3-8 words. No party names. No Boolean operators.\n"
        'Output ONLY valid JSON: {"statute_keywords":[...],"principle_keywords":[...],"fact_keywords":[...]}'
    )
    kw_user = f"Case description:\n{context_text[:5000]}"

    # ── Part 2: related case name keywords via Google Grounding ─────────────
    case_prompt = (
        "You are a senior Indian advocate doing legal research. "
        "Search Google comprehensively across the following Indian legal databases to find ALL relevant "
        "court judgments for the case described below:\n"
        "- site:indiankanoon.org\n"
        "- site:scconline.com\n"
        "- site:manupatra.com\n"
        "- site:sci.gov.in (Supreme Court of India)\n"
        "- site:judis.nic.in\n"
        "- Indian Kanoon, SCC Online, Manupatra, High Court websites\n\n"
        "Case description:\n"
        f"{context_text[:4000]}\n\n"
        "Find 10 to 15 Indian court judgments (Supreme Court and High Courts) that are most relevant "
        "to the legal issues, statutes, and factual scenario of this case. Include both landmark cases "
        "and recent judgments. Cast a wide net — include cases on the same statutes, same legal principles, "
        "and same fact patterns.\n\n"
        "Output ONLY a JSON object with one key 'case_keywords' whose value is a JSON array of strings. "
        "Each string is a short case name for searching on indiankanoon.org — "
        "format: 'Appellant v Respondent (year)'.\n"
        "Example output:\n"
        '{"case_keywords":["Maneka Gandhi v Union of India (1978)","Olga Tellis v Bombay Municipal Corporation (1985)","State Bank of India v Jah Developers (2019)"]}\n\n'
        "Output only the JSON. No explanations, no citations, no URLs, no markdown."
    )

    kw_result: Dict[str, Any] = {}
    case_keywords: List[str] = []

    def _call_claude_kw() -> Dict[str, Any]:
        import os
        from claude_proxy import forward_to_claude
        import re as _re2
        model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
        raw = forward_to_claude({
            "model": model, "max_tokens": 600, "temperature": 0.0,
            "system": kw_system,
            "messages": [{"role": "user", "content": kw_user}],
        })
        text = ""
        for block in (raw.get("content") or []):
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text", "")
                break
        text = _re2.sub(r"^```(?:json)?\s*\n?", "", text.strip(), flags=_re2.M)
        text = _re2.sub(r"\n?```\s*$", "", text, flags=_re2.M).strip()
        m = _re2.search(r"\{.*\}", text, _re2.DOTALL)
        if m:
            text = m.group(0)
        return _json.loads(text)

    try:
        parsed = await asyncio.to_thread(_call_claude_kw)
        kw_result = {
            "statute_keywords":   [str(k) for k in parsed.get("statute_keywords") or []],
            "principle_keywords": [str(k) for k in parsed.get("principle_keywords") or []],
            "fact_keywords":      [str(k) for k in parsed.get("fact_keywords") or []],
        }
    except Exception as exc:
        logger.warning("[SUGGEST_KW] Claude keyword suggestion failed: %s", exc)
        kw_result = {"statute_keywords": [], "principle_keywords": [], "fact_keywords": []}

    try:
        case_text = await asyncio.to_thread(_gemini_grounding_json, case_prompt, 1500)
        logger.info("[SUGGEST_KW] Raw case grounding response (%d chars): %s",
                    len(case_text or ""), (case_text or "")[:400])

        # Strategy 1: direct JSON parse after cleaning
        try:
            parsed2 = _json.loads(_clean_json(case_text))
            raw_names = parsed2.get("case_keywords") or parsed2.get("cases") or parsed2.get("case_names") or []
            if isinstance(raw_names, list):
                for name in raw_names:
                    name = str(name).strip()
                    if name:
                        case_keywords.append(name)
        except Exception:
            pass

        # Strategy 2: if no results yet, try parsing raw text as a JSON array
        if not case_keywords:
            try:
                m = _re.search(r'\[([^\[\]]+)\]', case_text or "", _re.DOTALL)
                if m:
                    arr = _json.loads('[' + m.group(1) + ']')
                    if isinstance(arr, list):
                        for name in arr:
                            name = str(name).strip()
                            if name and len(name) > 5:
                                case_keywords.append(name)
            except Exception:
                pass

        # Strategy 3: regex extract quoted strings that look like case names (contain 'v' and year)
        if not case_keywords:
            for m in _re.finditer(r'"([^"]{10,120})"', case_text or ""):
                name = m.group(1).strip()
                if _re.search(r'\bv\.?\b|\bvs\.?\b|\bversus\b', name, _re.I) or _re.search(r'\b\d{4}\b', name):
                    case_keywords.append(name)
                    if len(case_keywords) >= 8:
                        break

        case_keywords = [k for k in case_keywords if len(k) > 5][:15]
        logger.info("[SUGGEST_KW] Extracted %d case keywords", len(case_keywords))
    except Exception as exc:
        logger.warning("[SUGGEST_KW] Related case keywords grounding failed: %s", exc)

    return {**kw_result, "case_keywords": case_keywords}


@app.post("/citation/report/start")
async def start_citation_report(
    request: Request,
    query: str = Body("", embed=True),
    user_id: Optional[str] = Body("anonymous", embed=True),
    case_id: Optional[str] = Body(None, embed=True),
    case_file_context: CaseFileContextInput = Body(None, embed=True),
    use_pipeline: bool = Body(True, embed=True),
    retrieval_method: str = Body("indiankanoon", embed=True, description="Retrieval mode: 'indiankanoon' | 'web'"),
    perspective: Optional[str] = Body(None, embed=True, description="Party perspective: 'appellant' | 'respondent' | 'court' | 'all'"),
    custom_keywords: Optional[List[str]] = Body(None, embed=True, description="User-supplied keyword strings injected directly into the IK query pool"),
    selected_keywords: Optional[List[str]] = Body(None, embed=True, description="Keyword chips selected from suggestion panel — bypasses Stage 2 AI query generation"),
    selected_case_names: Optional[List[str]] = Body(None, embed=True, description="Case name chips selected from suggestion panel — searched on IK by title"),
) -> Dict[str, Any]:
    """Start citation report pipeline in background. Returns run_id immediately for log polling."""
    import uuid as _uuid
    from db.client import pipeline_run_insert, agent_log_insert
    from db.connections import get_pg_conn

    query = (query or "").strip()
    user_id = _resolve_citation_user_id(request, user_id)
    perspective = (perspective or "all").strip().lower() or "all"
    case_file_context = normalize_case_file_context(case_file_context)

    # Fetch the FULL case context from the document-service when case_id is provided and the
    # supplied payload is missing OR thin (a ~500-char cover-page snippet). The frontend can
    # send only a short summary; the document service holds the full extracted text/chunks.
    def _ctx_chars(items: Any) -> int:
        return sum(
            len(str((it or {}).get("content") or (it or {}).get("snippet") or "").strip())
            for it in (items or [])
        )

    if case_id and _ctx_chars(case_file_context) < 800:
        auth_header_pre = request.headers.get("authorization")
        fetched, _ = await _fetch_case_context(case_id, auth_header_pre)
        if _ctx_chars(fetched) > _ctx_chars(case_file_context):
            logger.info(
                "[CASE_CONTEXT] Thin payload (%d chars) replaced with full fetched context (%d chars) for case_id=%s",
                _ctx_chars(case_file_context), _ctx_chars(fetched), case_id,
            )
            case_file_context = fetched

    if not _try_acquire_pipeline_slot():
        raise HTTPException(
            status_code=429,
            detail=f"Citation pipeline is busy. Try again shortly. Max concurrent runs: {PIPELINE_MAX_CONCURRENT_RUNS}",
        )

    # Pre-generate run_id so frontend can start polling before pipeline creates it
    run_id = str(_uuid.uuid4())
    request.state.run_id = run_id
    _set_run_state(run_id, {"status": "running", "report_id": None, "report_format": None, "error": None})

    # Seed a first log immediately so frontend sees something
    try:
        pipeline_run_insert(run_id, user_id, query, case_id=case_id)
        agent_log_insert(run_id, None, "root", "start", "INFO",
                         f"Pipeline started — query: {query[:120]}", {"query": query[:500]})
    except Exception as exc:
        logger.warning("[START] DB seed failed: %s", exc)

    auth_header = request.headers.get("authorization")

    def _run_bg():
        try:
            from pipeline import run_pipeline
            out = run_pipeline(
                query=query,
                user_id=user_id,
                ingest_external=True,
                case_file_context=case_file_context or [],
                case_id=case_id,
                retrieval_method=str(retrieval_method or "indiankanoon").strip().lower(),
                custom_keywords=custom_keywords or [],
                selected_keywords=selected_keywords or [],
                selected_case_names=selected_case_names or [],
                perspective=perspective,
                run_id=run_id,
            )
            if out.get("error"):
                _set_run_state(run_id, {"status": "failed", "report_id": None,
                                        "report_format": None, "error": out["error"]})
                try:
                    pipeline_run_update(run_id, "failed", error_message=str(out["error"] or "Pipeline failed"))
                except Exception as exc:
                    logger.warning("[BG_PIPELINE] pipeline_run_update failure failed: %s", exc)
            else:
                report_format = out.get("report_format") or {}
                if isinstance(report_format, dict):
                    report_format = {**report_format, "perspective": report_format.get("perspective") or (perspective if perspective and perspective != "all" else "neutral")}
                    try:
                        from utils.pricing import inr_to_usd
                        usage_rows = usage_get_by_run(run_id)
                        total_inr = sum(float(r.get("cost_inr") or 0) for r in usage_rows)
                        total_usd = sum(float(r.get("cost_usd") or 0) for r in usage_rows)
                        if total_inr and not total_usd:
                            total_usd = inr_to_usd(total_inr)
                        report_format = {
                            **report_format,
                            "runCostInr": round(total_inr, 4),
                            "runCostUsd": round(total_usd, 6),
                            "runUsageRecordCount": len(usage_rows),
                        }
                    except Exception as exc:
                        logger.warning("[START] attach run usage costs failed: %s", exc)
                    rid_out = out.get("report_id")
                    if rid_out:
                        try:
                            report_update(rid_out, report_format=report_format)
                        except Exception as exc:
                            logger.warning("[START] report_update after cost attach failed: %s", exc)
                _set_run_state(run_id, {
                    "status": "completed",
                    "report_id": out.get("report_id"),
                    "report_format": report_format,
                    "error": None,
                })
                try:
                    pipeline_run_update(run_id, "completed",
                                        report_id=out.get("report_id"), error_message=None)
                except Exception as exc:
                    logger.warning("[BG_PIPELINE] pipeline_run_update success failed: %s", exc)
        except Exception as exc:
            logger.exception("[BG_PIPELINE] crashed: %s", exc)
            _set_run_state(run_id, {"status": "failed", "report_id": None,
                                    "report_format": None, "error": str(exc)})
            try:
                pipeline_run_update(run_id, "failed", error_message=str(exc))
            except Exception as e2:
                logger.warning("[BG_PIPELINE] pipeline_run_update crash failed: %s", e2)
        finally:
            _release_pipeline_slot()

    threading.Thread(target=_run_bg, daemon=True, name=f"citation-run-{run_id[:8]}").start()
    try:
        from services.cost_service import pre_run_cost_estimate
        _pre_run_estimate = pre_run_cost_estimate()
    except Exception as exc:
        logger.warning("[START] pre-run cost estimate failed: %s", exc)
        _pre_run_estimate = None
    return {"success": True, "run_id": run_id, "status": "running", "pre_run_cost_estimate": _pre_run_estimate}


@app.get("/citation/runs/{run_id}/status")
async def get_run_status(run_id: str) -> Dict[str, Any]:
    """Poll for pipeline run completion. Returns status + report when done."""
    with _run_state_lock:
        state = dict(_run_state.get(run_id) or {})
    if state:
        if state.get("status") == "running":
            now_ts = time.time()
            last_ts = float(state.get("updated_at_ts") or state.get("started_at_ts") or now_ts)
            age_seconds = max(0, int(now_ts - last_ts))
            if age_seconds >= INMEMORY_RUN_TIMEOUT_SECONDS:
                error = (
                    f"Run timed out after {age_seconds}s without completion. "
                    "Marked as failed to avoid stuck pipeline."
                )
                _set_run_state(run_id, {
                    "status": "failed",
                    "report_id": None,
                    "report_format": None,
                    "error": error,
                })
                try:
                    pipeline_run_update(run_id, "failed", error_message=error)
                except Exception:
                    pass
                _release_pipeline_slot_once(run_id)
                with _run_state_lock:
                    state = dict(_run_state.get(run_id) or {})
        return {"success": True, "run_id": run_id, **state}
    # Fallback: check DB citation_pipeline_runs table
    from db.connections import get_pg_conn
    from psycopg2.extras import RealDictCursor
    from db.client import report_get
    conn = get_pg_conn()
    if conn:
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT status, report_id, error_message, created_at FROM citation_pipeline_runs WHERE id=%s", (run_id,))
                row = cur.fetchone()
            if row:
                report_id = row.get("report_id")
                status = row.get("status")
                report_format = None
                error = row.get("error_message")
                if status == "running":
                    last_log_at = None
                    try:
                        with conn.cursor(cursor_factory=RealDictCursor) as cur:
                            cur.execute(
                                "SELECT MAX(created_at) AS last_log_at FROM agent_logs WHERE run_id=%s",
                                (run_id,),
                            )
                            lr = cur.fetchone() or {}
                            last_log_at = lr.get("last_log_at")
                    except Exception:
                        last_log_at = None
                    from datetime import datetime, timezone
                    now = datetime.now(timezone.utc)
                    stale_from = last_log_at or row.get("created_at")
                    if stale_from is not None:
                        try:
                            # Normalise naive datetimes from DB to UTC before subtraction
                            from datetime import timezone as _tz
                            if hasattr(stale_from, "tzinfo") and stale_from.tzinfo is None:
                                stale_from = stale_from.replace(tzinfo=_tz.utc)
                            age_seconds = (now - stale_from).total_seconds()
                            if age_seconds >= STALE_RUN_TIMEOUT_SECONDS:
                                status = "failed"
                                error = f"Run stalled for {int(age_seconds)}s without progress."
                                try:
                                    pipeline_run_update(run_id, "failed", error_message=error)
                                except Exception:
                                    pass
                        except Exception:
                            pass
                if report_id and status in ("completed", "pending_hitl"):
                    try:
                        report = report_get(report_id)
                        if report:
                            report_format = report.get("report_format")
                            status = report.get("status") or status
                    except Exception as exc:
                        logger.warning("[RUN_STATUS] report_get failed for %s: %s", report_id, exc)
                return {
                    "success": True,
                    "run_id": run_id,
                    "status": status,
                    "report_id": report_id,
                    "report_format": report_format,
                    "error": error,
                }
        finally:
            conn.close()
    return {"success": False, "run_id": run_id, "status": "unknown"}


# ─── Manual Mode: fetch full judgment for a list of case names ────────────────

@app.post("/citation/manual/fetch-case-judgments")
async def manual_fetch_case_judgments(
    request: Request,
    case_names: List[str] = Body(..., embed=True),
    user_id: Optional[str] = Body("anonymous", embed=True),
) -> Dict[str, Any]:
    """
    Manual mode — fetch judgment for each selected case name.
    Priority: local DB → Indian Kanoon → Google.
    Stores IK/Google results to ES+Qdrant+PG in background.
    Returns results immediately without blocking.
    """
    import threading as _threading
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
    from services.indiankanoon_client import ik_fetch_doc

    case_names = [str(n).strip() for n in (case_names or []) if str(n).strip()][:10]
    if not case_names:
        return {"success": False, "error": "case_names is required", "results": [], "not_found": []}

    user_id = _resolve_citation_user_id(request, user_id)

    def _fetch_one(case_name: str) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "case_name": case_name,
            "matched_title": "",
            "full_text": "",
            "source": "not_found",
            "source_url": "",
            "ik_tid": "",
            "metadata": {"court": "", "date": "", "bench": "", "citation": ""},
        }

        # Step 1 — Local ES: same query strings as IK uses for this case name
        try:
            from agents.search_utils import _search_local_one

            # Mirror exactly the two query forms _ik_search_by_case_name sends to IK:
            #   - name_no_year : full case name with trailing year stripped
            #   - first_party  : text before the "v." separator (first party name)
            _name_no_year = re.sub(r'\s*\(\d{4}\)\s*$', '', case_name.strip()).strip()
            _v_split = re.split(r'\s+(?:v\.?s?\.?|versus)\s+', _name_no_year, maxsplit=1, flags=re.I)
            _first_party = _v_split[0].strip()[:60] if _v_split else _name_no_year[:60]

            _seen_cids: set = set()
            _best_hit = None
            for _q in [_name_no_year, _first_party]:
                if not _q:
                    continue
                for _h in (_search_local_one(_q) or []):
                    _cid = str(_h.get("canonical_id") or "").strip()
                    if _cid in _seen_cids:
                        continue
                    _seen_cids.add(_cid)
                    _ft = str(_h.get("full_text") or "").strip()
                    if _ft:
                        _best_hit = (_h, _ft)
                        break
                if _best_hit:
                    break

            if _best_hit:
                h, ft = _best_hit
                result.update({
                    "matched_title": h.get("title") or h.get("case_name") or case_name,
                    "full_text": ft,
                    "source": "local_db",
                    "source_url": h.get("url") or h.get("source_url") or "",
                    "ik_tid": str(h.get("canonical_id") or h.get("tid") or "").removeprefix("ik:"),
                    "canonical_id": str(h.get("canonical_id") or ""),
                    "metadata": {
                        "court": h.get("court") or h.get("court_code") or "",
                        "date": str(h.get("date") or h.get("judgment_date") or ""),
                        "bench": h.get("bench") or h.get("coram") or "",
                        "citation": h.get("ik_citation") or h.get("primary_citation") or "",
                    },
                })
                return result
        except Exception as _exc:
            logger.warning("[MANUAL_FETCH] Local ES search failed for %r: %s", case_name, _exc)

        # Step 2 — Indian Kanoon (only if similarity is high enough)
        try:
            from agents.search_utils import _ik_search_by_case_name
            ik_hits = _ik_search_by_case_name(case_name, top_n=1)
            if ik_hits:
                h = ik_hits[0]
                # Require meaningful similarity — skip if IK returned an unrelated case
                if float(h.get("sim", 0)) < 0.2:
                    return result  # source stays "not_found"
                tid = str(h.get("tid") or "").strip()
                if tid:
                    doc = ik_fetch_doc(tid, maxcites=10, maxcitedby=10)
                    if doc:
                        full_text = _html_to_text(doc.get("doc") or "")
                        ik_url = f"https://indiankanoon.org/doc/{tid}/"
                        result.update({
                            "matched_title": doc.get("title") or h.get("title") or case_name,
                            "full_text": full_text,
                            "source": "indian_kanoon",
                            "source_url": ik_url,
                            "ik_tid": tid,
                            "canonical_id": f"ik:{tid}",
                            "metadata": {
                                "court": doc.get("docsource") or h.get("court") or "",
                                "date": str(h.get("date") or ""),
                                "bench": doc.get("bench") or doc.get("coram") or "",
                                "citation": doc.get("citation") or "",
                            },
                        })
                        return result
        except Exception as _exc:
            logger.warning("[MANUAL_FETCH] IK search failed for %r: %s", case_name, _exc)

        return result

    results = []
    not_found = []
    with ThreadPoolExecutor(max_workers=min(len(case_names), 5)) as pool:
        future_map = {pool.submit(_fetch_one, cn): cn for cn in case_names}
        for fut in _as_completed(future_map):
            try:
                r = fut.result(timeout=45)
                if r["source"] == "not_found":
                    not_found.append(r["case_name"])
                else:
                    results.append(r)
            except Exception as exc:
                logger.warning("[MANUAL_FETCH] fetch_one error: %s", exc)

    # Background storage: ingest IK/Google results that have enough full text
    def _store_bg(_results=results):
        from db.client import judgment_ingest_from_ik
        for r in _results:
            if r.get("source") in ("indian_kanoon", "google") and r.get("ik_tid") and len(r.get("full_text") or "") >= 200:
                try:
                    judgment_ingest_from_ik(
                        ik_tid=r["ik_tid"],
                        case_name=r.get("matched_title") or r.get("case_name") or "",
                        full_text=r.get("full_text") or "",
                        court_code=r.get("metadata", {}).get("court") or "",
                        judgment_date=r.get("metadata", {}).get("date") or "",
                    )
                except Exception as exc:
                    logger.warning("[MANUAL_FETCH_STORE] Failed for tid=%s: %s", r.get("ik_tid"), exc)

    _threading.Thread(target=_store_bg, daemon=True, name="manual-fetch-store").start()

    return {"success": True, "results": results, "not_found": not_found}


# ─── Manual Mode: search local DB + IK by keywords ───────────────────────────

@app.post("/citation/manual/search-by-keywords")
async def manual_search_by_keywords(
    request: Request,
    keywords: List[str] = Body(..., embed=True),
    user_id: Optional[str] = Body("anonymous", embed=True),
    case_id: Optional[str] = Body(None, embed=True),
) -> Dict[str, Any]:
    """
    Manual mode — search local DB + Indian Kanoon for each keyword.
    Returns deduplicated results. Stores new IK hits to ES+Qdrant+PG in background.
    """
    import threading as _threading
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
    from services.indiankanoon_client import ik_search as _ik_search, ik_fetch_doc as _ik_fetch_doc

    keywords = [str(k).strip() for k in (keywords or []) if str(k).strip()][:15]
    if not keywords:
        return {"success": False, "error": "keywords is required", "total": 0, "results": []}

    user_id = _resolve_citation_user_id(request, user_id)

    def _search_one(keyword: str) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []

        # Local ES — same keyword query format as IK (_search_local_one mirrors ik_search)
        try:
            from agents.search_utils import _search_local_one
            for h in _search_local_one(keyword):
                cid = str(h.get("canonical_id") or "").strip()
                tid = str(h.get("tid") or "").strip()
                items.append({
                    "case_name": h.get("title") or h.get("case_name") or "",
                    "snippet": str(h.get("snippet") or h.get("full_text") or "")[:400],
                    "source": h.get("source") or "local_db",
                    "source_url": h.get("url") or h.get("source_url") or "",
                    "ik_tid": tid or (cid.removeprefix("ik:") if cid.startswith("ik:") else ""),
                    "canonical_id": cid,
                    "matched_keyword": keyword,
                    "metadata": {
                        "court": h.get("court") or "",
                        "date": str(h.get("date") or ""),
                        "citation": h.get("ik_citation") or "",
                    },
                })
        except Exception as _exc:
            logger.warning("[MANUAL_KW] Local ES search failed for %r: %s", keyword, _exc)

        # Indian Kanoon — same keyword string
        try:
            ik_resp = _ik_search(keyword, pagenum=0)
            for doc in (ik_resp or {}).get("docs", [])[:5]:
                tid = str(doc.get("tid") or "").strip()
                if not tid:
                    continue
                items.append({
                    "case_name": doc.get("title") or "",
                    "snippet": _html_to_text(doc.get("headline") or "")[:400],
                    "source": "indian_kanoon",
                    "source_url": f"https://indiankanoon.org/doc/{tid}/",
                    "ik_tid": tid,
                    "canonical_id": f"ik:{tid}",
                    "matched_keyword": keyword,
                    "metadata": {
                        "court": doc.get("docsource") or "",
                        "date": "",
                        "citation": "",
                    },
                })
        except Exception as _exc:
            logger.warning("[MANUAL_KW] IK search failed for %r: %s", keyword, _exc)

        return items

    all_items: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=min(len(keywords), 6)) as pool:
        futures = [pool.submit(_search_one, kw) for kw in keywords]
        for fut in _as_completed(futures):
            try:
                all_items.extend(fut.result(timeout=30))
            except Exception as exc:
                logger.warning("[MANUAL_KW] search_one error: %s", exc)

    # Deduplicate by canonical_id
    seen: set = set()
    deduped: List[Dict[str, Any]] = []
    for item in all_items:
        key = item.get("canonical_id") or item.get("ik_tid") or item.get("case_name")
        if key and key not in seen:
            seen.add(key)
            deduped.append(item)

    # Background storage: for IK hits fetch full text then ingest
    def _store_kw_bg(_items=deduped):
        from db.client import judgment_ingest_from_ik
        for item in _items:
            if item.get("source") == "indian_kanoon" and item.get("ik_tid"):
                try:
                    doc = _ik_fetch_doc(item["ik_tid"])
                    if doc:
                        full_text = _html_to_text(doc.get("doc") or "")
                        if len(full_text) >= 200:
                            judgment_ingest_from_ik(
                                ik_tid=item["ik_tid"],
                                case_name=item.get("case_name") or "",
                                full_text=full_text,
                                court_code=item.get("metadata", {}).get("court") or doc.get("docsource") or "",
                                judgment_date=item.get("metadata", {}).get("date") or "",
                            )
                except Exception as exc:
                    logger.warning("[MANUAL_KW_STORE] Failed for tid=%s: %s", item.get("ik_tid"), exc)

    _threading.Thread(target=_store_kw_bg, daemon=True, name="manual-kw-store").start()

    return {"success": True, "total": len(deduped), "results": deduped}
