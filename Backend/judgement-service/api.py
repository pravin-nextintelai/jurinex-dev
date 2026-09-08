"""
FastAPI transport layer for the judgement-service search pipeline.

Thin by design: request validation, session lookup and background vault
writes live here; all pipeline logic is in agents.py / tools.py. Every
credential comes from .env via config.get_settings().

Run:  python -m uvicorn api:app --host 0.0.0.0 --port 8002
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date
from typing import Any

import httpx
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from agents import (
    analyze_case,
    apply_client_role,
    enrich_custom_issue,
    generate_case_summary,
    generate_citation_analysis,
    run_issue_search,
    safe_generate_queries,
    run_search_pipeline,
)
from auth import jwt_verification_enabled, resolve_user_id
from config import get_settings
from schemas import (
    AddIssueRequest,
    AdvancedSearchRequest,
    AnalyzeCaseFreshRequest,
    AnalyzeCaseRequest,
    AnalyzeResponse,
    Candidate,
    CaseContext,
    Issue,
    KeywordSet,
    RefinedItem,
    RefineRequest,
    RefineResponse,
    ReportStatusRequest,
    ResultItem,
    RunSearchRequest,
    SearchRequest,
    SearchResponse,
)
from stores import elastic, postgres, sessions, store_health
from tools import (
    IK_RATES_INR,
    band_for,
    case_court_profile,
    citation_guardian,
    composite_score,
    flush_usage_events,
    set_court_scope,
    set_date_scope,
    set_usage_identity,
    embedder,
    cosine,
    fetch_case_pages,
    grounded_good_law_check,
    ik_client,
    ik_cost_start,
    merge_cost_ledger,
    highlight_fragment_html,
    normalize_ws,
    run_cost_log,
    parse_document,
    parse_document_pages,
    squash_ws,
    strip_html,
    to_ik_operators,
    year_from_text,
)
from schemas import ScoredResult, SignalSet

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("judgement.api")

settings = get_settings()

app = FastAPI(
    title="Jurinex Judgement Service",
    description="Agent-orchestrated Indian case-law retrieval with closed-world citation safety.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _log_agent_configuration() -> None:
    """Say at boot which model and prompt every LLM agent is running on —
    the admin console's or the ones in code."""
    from agent_config import log_startup_summary

    await asyncio.to_thread(log_startup_summary)


@app.on_event("shutdown")
async def _close_ik_http_pool() -> None:
    """Release the IK client's shared keep-alive connection pool."""
    await ik_client.aclose()


@app.get("/health/agents")
async def health_agents() -> dict[str, Any]:
    """Which configuration every LLM agent is actually running on: the admin
    console row (source=db, with its id and model) or the hardcoded default.
    `acceptedDbNames` lists the agent_prompts.name values each agent answers
    to, so a row can be added for exactly the agent intended."""
    from agent_config import describe_agents

    agents = await asyncio.to_thread(describe_agents)
    return {
        "table": "public.agent_prompts",
        "database": "Draft_DB (DRAFT_DB_URL)",
        "modelCatalogue": "public.llm_models (DOC_DB_URL)",
        "fromAdminDb": sum(1 for a in agents if a["source"] == "db"),
        "fromDefaults": sum(1 for a in agents if a["source"] != "db"),
        "agents": agents,
    }


@app.post("/health/agents/reload")
async def health_agents_reload() -> dict[str, Any]:
    """Drop the 2-minute config cache so an admin edit applies immediately."""
    from agent_config import invalidate

    invalidate()
    return {"status": "ok", "reloaded": True}


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "judgement-service",
        "port": settings.port,
        "ikTokenConfigured": bool(settings.ik_token),
        "ikTokenRejected": ik_client.auth_failed,
        "geminiConfigured": bool(settings.google_api_key),
        "jwtVerification": jwt_verification_enabled(),
        "scoringPhase": settings.scoring_phase,
        "phaseWeights": settings.phase_weights,
        "relevanceJudge": {
            "enabled": settings.relevance_judge_enabled,
            "weight": settings.relevance_judge_weight,
        },
        "ikDoctypes": settings.ik_doctypes,
        "stores": store_health(),
    }


# ─── Vault write path (flywheel) — async, never blocks the response ─────────

def _vault_write(response: SearchResponse) -> None:
    session = sessions.load(response.sessionId) or {}
    meta_by_issue = {i["id"]: i.get("candidateMeta", {}) for i in session.get("issues", [])}
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for issue in response.issues:
        meta = meta_by_issue.get(issue.id, {})
        for item in issue.results:
            if item.band == "GREEN" and item.docId not in seen:
                seen.add(item.docId)
                m = meta.get(item.docId, {})
                rows.append({
                    "doc_id": item.docId, "title": item.title, "court": item.court,
                    "year": item.year, "headline": m.get("headline", ""),
                    "num_citedby": m.get("numCitedby", 0),
                })
    if rows:
        written = postgres.vault_upsert(rows)
        logger.info("[vault] persisted %d/%d GREEN survivors", written, len(rows))


# ─── Research history (stored in citationTest) ──────────────────────────────

def _tag_session(session_id: str, user_id: str | None, case_title: str | None = None,
                 case_id: str | None = None) -> None:
    """Attach ownership + display title + source case to a stored session
    so history can be listed per user and per case."""
    session = sessions.load(session_id)
    if session is None:
        return
    changed = False
    for key, value in (("userId", user_id), ("caseTitle", case_title), ("caseId", case_id)):
        if value and session.get(key) != value:
            session[key] = value
            changed = True
    if changed:
        # Ownership/title tag is a milestone: the history list and the
        # ownership check read it immediately — write durably.
        sessions.save_sync(session_id, session)


@app.get("/api/v1/sessions")
async def list_sessions(http_request: Request) -> dict[str, Any]:
    """Research history, newest first. Strictly scoped to the verified
    caller — anonymous callers get no history, never everyone's."""
    user_id = resolve_user_id(http_request)
    if not user_id:
        return {"sessions": []}
    rows = await asyncio.to_thread(postgres.session_list, user_id)
    return {"sessions": rows}


@app.get("/api/v1/search/{session_id}")
async def get_session(session_id: str, http_request: Request) -> dict[str, Any]:
    """Reopen a stored research session: case context, suggested issues,
    every fetched citation, and saved approve/reject decisions."""
    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    owner = session.get("userId")
    caller = resolve_user_id(http_request)
    # Owned sessions open only for their owner; legacy unowned sessions
    # stay reachable by direct id (they no longer appear in any list).
    if owner and str(owner) != str(caller or ""):
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    statuses: dict[str, dict[str, str]] = {}
    for issue in session.get("issues", []):
        reports = issue.get("reports") or {}
        if reports:
            statuses[str(issue["id"])] = {
                doc_id: (entry or {}).get("status", "pending")
                for doc_id, entry in reports.items()
            }
    return {
        "sessionId": session_id,
        "caseTitle": session.get("caseTitle"),
        "caseContext": session.get("caseContext"),
        "researchMode": session.get("researchMode", "issues"),
        "groundsMeta": session.get("groundsMeta") or None,
        "forumCourt": session.get("forumCourt") or None,
        "suggestedIssues": session.get("suggestedIssues", []),
        "issues": [
            {key: issue.get(key) for key in ("id", "issue", "title", "groundLabel",
                                             "keywords", "results")}
            for issue in session.get("issues", [])
        ],
        "statuses": statuses,
    }


@app.delete("/api/v1/search/{session_id}")
async def delete_session(session_id: str, http_request: Request) -> dict[str, Any]:
    """Delete a stored research session — its results, citation reports and
    approve/reject decisions — from cache AND database. Same visibility rule
    as opening a session: owned sessions can only be deleted by their owner."""
    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    owner = session.get("userId")
    caller = resolve_user_id(http_request)
    if owner and str(owner) != str(caller or ""):
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    db_deleted = await asyncio.to_thread(sessions.delete, session_id)
    if not db_deleted and postgres.available:
        # Durable copy still exists — the session would resurrect on the
        # next cache miss. Fail honestly so the UI can offer a retry.
        raise HTTPException(status_code=500,
                            detail="Could not delete the stored research — please try again")
    return {"deleted": True, "sessionId": session_id}


# ─── Two-phase interactive flow (Citation Research UI) ──────────────────────
# Phase 1: /analyze → case context + system-suggested issues (no IK spend).
# Phase 2: /search/run → retrieval for the issues the user selected and/or
#          typed in their own words.

def _gather_case_text(text: str | None, file_ref: str | None) -> str:
    parts: list[str] = []
    if file_ref:
        try:
            doc_text = parse_document(file_ref)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"Could not read fileRef: {exc}")
        if doc_text:
            parts.append(doc_text)
    if text and text.strip():
        parts.append(text.strip())
    if not parts:
        raise HTTPException(status_code=400,
                            detail="caseInput must include text and/or a readable fileRef")
    return "\n\n---\n\n".join(parts)


@app.post("/api/v1/analyze", response_model=AnalyzeResponse)
async def analyze(request: SearchRequest, http_request: Request) -> AnalyzeResponse:
    set_usage_identity(resolve_user_id(http_request))
    raw_text = await asyncio.to_thread(_gather_case_text, request.caseInput.text,
                                       request.caseInput.fileRef)
    session_id, context, issues, grounds_meta = await analyze_case(
        raw_text, mode=request.mode, query_style=request.queryStyle,
        client_role=request.role)
    _tag_session(session_id, resolve_user_id(http_request))
    return AnalyzeResponse(
        sessionId=session_id, caseContext=context, suggestedIssues=issues,
        needsClarification=context.needs_clarification,
        clarificationQuestion=context.clarification_question,
        researchMode=request.mode, groundsMeta=grounds_meta or None,
    )


@app.post("/api/v1/analyze/case", response_model=AnalyzeResponse)
async def analyze_from_case(request: AnalyzeCaseRequest, http_request: Request) -> AnalyzeResponse:
    """Analyze one of the user's existing cases: documents + page-numbered
    chunks are pulled from the agentic document service, so suggested
    issues carry 'file, page N' source references."""
    auth_header = http_request.headers.get("authorization")
    user_id = resolve_user_id(http_request, request.userId)
    set_usage_identity(user_id, request.caseId)
    try:
        case_title, pages, llm_text, full_text = await fetch_case_pages(
            request.caseId, auth_header, user_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Document service unreachable: {exc}")

    if request.text and request.text.strip():
        note = request.text.strip()
        llm_text = f"{llm_text}\n\n[LAWYER'S INSTRUCTION]\n{note}"
        full_text = f"{full_text}\n\n{note}"

    session_id, context, issues, grounds_meta = await analyze_case(
        llm_text, source_text=full_text, pages=pages, mode=request.mode,
        query_style=request.queryStyle, client_role=request.role)
    _tag_session(session_id, user_id, case_title or None, str(request.caseId))
    return AnalyzeResponse(
        sessionId=session_id, caseContext=context, suggestedIssues=issues,
        needsClarification=context.needs_clarification,
        clarificationQuestion=context.clarification_question,
        caseId=request.caseId, caseTitle=case_title or None,
        researchMode=request.mode, groundsMeta=grounds_meta or None,
    )


@app.post("/api/v1/analyze/case/fresh", response_model=AnalyzeResponse)
async def analyze_fresh_case(request: AnalyzeCaseFreshRequest,
                             http_request: Request) -> AnalyzeResponse:
    """Fresh-matter research (own route): the case has NO drafted pleading
    yet, so there are no grounds to read. ALL of the case's source documents
    are pulled from the agentic document service and the lawyer's stated
    OBJECTIVE (what the client wants) drives PROPOSED grounds — then the
    identical pipeline (query generation → IK fan-out → per-judgment
    verification → reports) runs unchanged."""
    objective = (request.objective or "").strip()
    if not objective:
        raise HTTPException(status_code=400,
                            detail="objective is required — describe what the client wants to achieve")
    auth_header = http_request.headers.get("authorization")
    user_id = resolve_user_id(http_request, request.userId)
    set_usage_identity(user_id, request.caseId)
    try:
        case_title, pages, llm_text, full_text = await fetch_case_pages(
            request.caseId, auth_header, user_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Document service unreachable: {exc}")

    # The objective leads the LLM text, and joins the source text so the
    # anti-invention guard doesn't strike objective-derived statements.
    llm_text = f"[CLIENT'S OBJECTIVE]\n{objective}\n\n{llm_text}"
    full_text = f"{full_text}\n\n{objective}"

    session_id, context, issues, grounds_meta = await analyze_case(
        llm_text, source_text=full_text, pages=pages, mode="fresh",
        objective=objective, query_style=request.queryStyle,
        client_role=request.role)
    _tag_session(session_id, user_id, case_title or None, str(request.caseId))
    return AnalyzeResponse(
        sessionId=session_id, caseContext=context, suggestedIssues=issues,
        needsClarification=context.needs_clarification,
        clarificationQuestion=context.clarification_question,
        caseId=request.caseId, caseTitle=case_title or None,
        researchMode="fresh", groundsMeta=grounds_meta or None,
    )


@app.post("/api/v1/analyze/upload", response_model=AnalyzeResponse)
async def analyze_upload(http_request: Request,
                         files: list[UploadFile] = File(default=[]),
                         file: UploadFile | None = File(default=None),
                         text: str = Form(default=""),
                         mode: str = Form(default="issues"),
                         title: str = Form(default=""),
                         queryStyle: str = Form(default="simple"),
                         role: str = Form(default="")) -> AnalyzeResponse:
    """One or more uploaded documents analysed together as a single matter.
    `files` is the multi-upload field; the legacy single `file` field still
    works. Every page keeps its own filename so issue source references
    remain per-document ('file, page N'). `title` names the research in
    history; blank falls back to the first filename."""
    set_usage_identity(resolve_user_id(http_request))
    uploads = [u for u in [*(files or []), file] if u is not None]
    if not uploads:
        raise HTTPException(status_code=400, detail="Upload at least one document")
    pages = []
    doc_parts: list[str] = []
    for upload in uploads:
        data = await upload.read()
        file_pages = await asyncio.to_thread(parse_document_pages, data, upload.filename or "")
        pages.extend(file_pages)
        doc_text = "\n\n".join(p.text for p in file_pages if p.text.strip())
        if doc_text:
            # Header marks document boundaries for the extractor when the
            # matter spans several uploads; a single file stays untouched.
            doc_parts.append(f"[DOCUMENT: {upload.filename or 'document'}]\n{doc_text}"
                             if len(uploads) > 1 else doc_text)
    parts = [p for p in ("\n\n---\n\n".join(doc_parts), text.strip()) if p]
    if not parts:
        raise HTTPException(status_code=400, detail="Uploaded file produced no readable text")
    mode = mode if mode in ("issues", "grounds", "combined") else "issues"
    query_style = queryStyle if queryStyle in ("simple", "advanced") else "simple"
    client_role = role if role in ("petitioner", "respondent") else None
    session_id, context, issues, grounds_meta = await analyze_case(
        "\n\n---\n\n".join(parts), pages=pages, mode=mode, query_style=query_style,
        client_role=client_role)
    stem = (uploads[0].filename or "").rsplit(".", 1)[0] or None
    fallback = f"{stem} (+{len(uploads) - 1} more)" if stem and len(uploads) > 1 else stem
    _tag_session(session_id, resolve_user_id(http_request),
                 title.strip()[:200] or fallback)
    return AnalyzeResponse(
        sessionId=session_id, caseContext=context, suggestedIssues=issues,
        needsClarification=context.needs_clarification,
        clarificationQuestion=context.clarification_question,
        researchMode=mode, groundsMeta=grounds_meta or None,
    )


@app.post("/api/v1/search/{session_id}/run", response_model=SearchResponse)
async def search_run(session_id: str, request: RunSearchRequest,
                     background: BackgroundTasks, http_request: Request) -> SearchResponse:
    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId — analyze first")
    set_usage_identity(resolve_user_id(http_request), session.get("caseId"))
    context = CaseContext.model_validate(session.get("caseContext") or {})
    suggested = [Issue.model_validate(i) for i in session.get("suggestedIssues", [])]

    if request.issueIds is not None:
        wanted = set(request.issueIds)
        chosen = [i for i in suggested if i.id in wanted]
    else:
        chosen = list(suggested)
    next_id = max((i.id for i in suggested), default=0)
    custom_issues: list[Issue] = []
    for custom in request.customIssues:
        if custom.strip():
            next_id += 1
            custom_issues.append(Issue(id=next_id, issue=custom.strip()))
    if custom_issues:
        # User-typed issues get the SAME treatment as suggested ones:
        # normalized framing + doctrine + statutory hook, so query
        # generation and verification run from identical signals.
        chosen.extend(await asyncio.gather(
            *(enrich_custom_issue(i, context) for i in custom_issues)))
    if not chosen:
        raise HTTPException(status_code=400, detail="No issues selected and none provided")
    # A locked role holds for run-time custom issues and legacy sessions too.
    apply_client_role(chosen, context.client_role)

    # The user explicitly chose what to search — a pending clarification
    # no longer blocks (their own issues ARE the clarification).
    context.needs_clarification = False
    context.clarification_question = None

    # Court scope (the three Advanced-search boxes on the issues step):
    # selected boxes become ONE doctypes list that replaces the env default
    # for every query of this run. Nothing selected = behaviour unchanged.
    scope = request.courtScope
    scope_tokens: list[str] = []
    if scope is not None:
        if scope.supremeCourt:
            scope_tokens.append("supremecourt")
        if scope.caseCourt:
            profile = case_court_profile(
                context.forum, f"{context.procedural_history} {context.raw_case_summary}")
            # "All applicable courts" fallback: the case names no High Court
            # we can map — search every High Court rather than none.
            scope_tokens.append((profile or {}).get("doctype") or "highcourts")
        for token in scope.courts:
            token = token.strip().lower()
            if re.fullmatch(r"[a-z_-]+", token):  # doctype tokens only, never query text
                scope_tokens.append(token)
    seen_tokens: set[str] = set()
    scope_tokens = [t for t in scope_tokens if not (t in seen_tokens or seen_tokens.add(t))]
    set_court_scope(",".join(scope_tokens) if scope_tokens else None)

    # Date range: rides on EVERY query of this run as fromdate:/todate:.
    date_parts: list[str] = []
    if request.fromdate.strip():
        date_parts.append(f"fromdate:{_ik_date(request.fromdate, 'fromdate')}")
    if request.todate.strip():
        date_parts.append(f"todate:{_ik_date(request.todate, 'todate')}")
    set_date_scope(" ".join(date_parts) if date_parts else None)

    logger.info("[run] session %s issueIds=%s custom=%d overrides=%s courts=%s dates=%s",
                session_id, request.issueIds, len(request.customIssues),
                {k: len(v) for k, v in (request.queryOverrides or {}).items()} or "none",
                ",".join(scope_tokens) or "default",
                " ".join(date_parts) or "all")
    response = await run_issue_search(session_id, context, chosen,
                                      query_overrides=request.queryOverrides or None)
    if ik_client.auth_failed and not any(i.results for i in response.issues):
        # An auth failure must never masquerade as an honest empty result.
        raise HTTPException(status_code=502, detail=(
            "Indian Kanoon rejected the API token (HTTP 403) — the prepaid "
            "account is out of balance or the token expired. Recharge at "
            "api.indiankanoon.org (or set a new INDIAN_KANOON_TOKEN and "
            "restart), then run the search again."))
    _tag_session(session_id, resolve_user_id(http_request))
    background.add_task(_vault_write, response)
    return response


@app.post("/api/v1/search/{session_id}/issues")
async def add_session_issue(session_id: str, request: AddIssueRequest,
                            http_request: Request) -> dict[str, Any]:
    """A user-typed issue or ground joins the session with the SAME
    analyze-time treatment as system-suggested ones: normalized framing +
    doctrine + statutory hook (enrichment) and its own generated IK queries,
    stored in the session — the card renders identically and /run reuses
    the stored keywords, including per-query curation."""
    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId — analyze first")
    owner = session.get("userId")
    caller = resolve_user_id(http_request)
    if owner and str(owner) != str(caller or ""):
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    text = (request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Provide the issue text")
    context = CaseContext.model_validate(session.get("caseContext") or {})
    suggested = [Issue.model_validate(i) for i in session.get("suggestedIssues", [])]
    next_id = max((i.id for i in suggested), default=0) + 1
    issue = await enrich_custom_issue(Issue(id=next_id, issue=text), context)
    siblings = [f"Issue {j.id}: {j.title or j.issue[:70]}" for j in suggested]
    kw = await safe_generate_queries(issue, context, sibling_issues=siblings,
                                     style=session.get("queryStyle", "simple"))
    issue.queries = list(kw.anchor_queries)
    session["suggestedIssues"] = [i.model_dump() for i in suggested] + [issue.model_dump()]
    session.setdefault("issueKeywords", {})[str(next_id)] = kw.model_dump()
    # Milestone: the user's very next action is Run search — possibly on
    # another process. Durable before responding.
    await asyncio.to_thread(sessions.save_sync, session_id, session)
    return {"sessionId": session_id, "issue": issue.model_dump()}


# ─── POST /api/v1/search ─────────────────────────────────────────────────────

@app.post("/api/v1/search", response_model=SearchResponse)
async def search(request: SearchRequest, background: BackgroundTasks) -> SearchResponse:
    case = request.caseInput
    parts: list[str] = []
    if case.fileRef:
        try:
            doc_text = await asyncio.to_thread(parse_document, case.fileRef)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"Could not read fileRef: {exc}")
        if doc_text:
            parts.append(doc_text)
    if case.text and case.text.strip():
        parts.append(case.text.strip())
    if not parts:
        raise HTTPException(status_code=400, detail="caseInput must include text and/or a readable fileRef")

    raw_text = "\n\n---\n\n".join(parts)
    response = await run_search_pipeline(raw_text, mode=request.mode)
    background.add_task(_vault_write, response)
    return response


@app.post("/api/v1/search/upload", response_model=SearchResponse)
async def search_upload(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    text: str = Form(default=""),
) -> SearchResponse:
    """Multipart convenience wrapper: uploaded case file (+ optional typed
    instruction) routed through the same Document Context Service."""
    data = await file.read()
    doc_text = await asyncio.to_thread(parse_document, None, data, file.filename or "")
    parts = [p for p in (doc_text, text.strip()) if p]
    if not parts:
        raise HTTPException(status_code=400, detail="Uploaded file produced no readable text")
    response = await run_search_pipeline("\n\n---\n\n".join(parts))
    background.add_task(_vault_write, response)
    return response


# ─── Per-citation report (VIEW → Report/Document tabs) ──────────────────────

_FACT_STOPWORDS = frozenset(
    "the of and in a to is for under whether not on by with or any that this be as "
    "was were has have had it its at from an are court india".split())


def _factual_relevance(case_facts: str, doc_text: str) -> float:
    """Deterministic: share of the case's distinctive fact terms that appear
    in the judgment text. Never LLM-estimated."""
    fact_tokens = {t for t in re.findall(r"[a-z0-9]+", case_facts.lower())
                   if len(t) > 3 and t not in _FACT_STOPWORDS}
    if not fact_tokens:
        return 0.0
    doc_tokens = set(re.findall(r"[a-z0-9]+", doc_text.lower()))
    return round(len(fact_tokens & doc_tokens) / len(fact_tokens), 4)


_STRENGTH_BY_BAND = {"GREEN": "Strong", "YELLOW": "Moderate", "RED": "Weak"}

# Bench fallback: IK /docmeta bench/author are frequently empty, but the
# judgment text itself names the coram — HC headers ("HON'BLE MR. JUSTICE …",
# "CORAM: …, J.") and SC signature blocks ("………J. (ABHAY S. OKA)").
_JUSTICE_RE = re.compile(
    r"(?i)\bHON[O'U]*RABLE\s+(?:THE\s+)?(?:MR\.?|MRS\.?|MS\.?|DR\.?|SHRI|SMT\.?)?\s*"
    r"(?:CHIEF\s+)?JUSTICE\s+([A-Z][A-Za-z.\-' ]{2,50}?)(?=\s*(?:,|\n|;|AND\b|&|$))")
_HONBLE_RE = re.compile(
    r"(?i)\bHON'?BLE\s+(?:THE\s+)?(?:MR\.?|MRS\.?|MS\.?|DR\.?|SHRI|SMT\.?)?\s*"
    r"(?:CHIEF\s+)?JUSTICE\s+([A-Z][A-Za-z.\-' ]{2,50}?)(?=\s*(?:,|\n|;|AND\b|&|$))")
_CORAM_SUFFIX_RE = re.compile(r"\b([A-Z][A-Za-z.\-' ]{3,50}?),\s*(?:C\.?J\.?I?|JJ?\.)(?=[\s,)\]]|$)")
_SIGNATURE_RE = re.compile(r"JJ?\.?\s*[\(\[]\s*([A-Z][A-Za-z.\-' ]{3,40}?)\s*[\)\]]")


def _bench_from_text(doc_text: str) -> list[str]:
    """Deterministic coram extraction from the judgment's own text — used
    only when /docmeta returns no bench/author. Names are taken verbatim
    from the text, never guessed."""
    names: list[str] = []
    for chunk in (doc_text[:6000], doc_text[-3500:]):
        for pattern in (_JUSTICE_RE, _HONBLE_RE, _CORAM_SUFFIX_RE, _SIGNATURE_RE):
            for m in pattern.finditer(chunk):
                name = re.sub(r"\s+", " ", m.group(1)).strip(" .,-")
                if len(name) >= 4 and all(name.lower() != n.lower() for n in names):
                    names.append(name)
    return names[:6]


@app.get("/api/v1/search/{session_id}/report/{issue_id}/{doc_id}")
async def citation_report(session_id: str, issue_id: int, doc_id: str,
                          http_request: Request):
    """Full legal-intelligence report for one surfaced citation. Closed
    world holds: reports exist only for docIds already in this session's
    guardian-verified results. LLM analysis is grounded on the fetched
    judgment text and cached in the session."""
    from schemas import CitationAnalysis, CitationReport, JudgmentCaseSummary

    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    issue = next((i for i in session.get("issues", []) if i["id"] == issue_id), None)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"issueId {issue_id} not in session")
    item = next((r for r in issue.get("results", []) if r["docId"] == doc_id), None)
    if item is None:
        # Never generate a report for a docId that wasn't verified into results.
        raise HTTPException(status_code=404, detail="docId is not part of this issue's verified results")

    set_usage_identity(resolve_user_id(http_request), session.get("caseId"))
    cost_tracker = ik_cost_start()
    doc_text, info = await ik_client.fetch_doc_bundle(doc_id)
    meta = await ik_client.fetch_doc_meta(doc_id)
    context = session.get("caseContext") or {}
    case_facts = f"{context.get('facts', '')} {context.get('raw_case_summary', '')}"

    reports = issue.setdefault("reports", {})
    cached = reports.get(doc_id)
    if cached and cached.get("analysis"):
        analysis = CitationAnalysis.model_validate(cached["analysis"])
    else:
        analysis = await generate_citation_analysis(
            issue.get("issue", ""), context.get("raw_case_summary", ""),
            item.get("title", ""), doc_text or item.get("headline", ""))
        reports[doc_id] = {**(cached or {}), "analysis": analysis.model_dump()}
        sessions.save(session_id, session)

    bench_raw = meta.get("bench") or meta.get("author") or ""
    bench = [b.strip() for b in bench_raw.split(",") if b.strip()][:6]
    if not bench and doc_text:
        # /docmeta gave nothing — read the coram from the judgment itself.
        bench = _bench_from_text(doc_text)

    # Web-grounded good-law check (Google Search grounding) — cached per
    # session; an empty (failed) check is retried on the next view.
    good_law_check = (reports.get(doc_id) or {}).get("goodLawCheck") or {}
    if not good_law_check and settings.good_law_web_check:
        good_law_check = await grounded_good_law_check(
            item.get("title", ""), item.get("court", ""), item.get("year"))
        if good_law_check:
            reports[doc_id] = {**(reports.get(doc_id) or {}), "goodLawCheck": good_law_check}
            sessions.save(session_id, session)

    # Advocate-grade judgment summary (100-word paragraph + 8-line note) —
    # grounded on the fetched judgment text, tailored to this issue via the
    # prompt's Context line, cached per session; empty (failed) output is not
    # cached so it is retried on the next view.
    summary_cached = (reports.get(doc_id) or {}).get("caseSummary") or {}
    if summary_cached:
        case_summary = JudgmentCaseSummary.model_validate(summary_cached)
    else:
        matter_context = ". ".join(part for part in (
            issue.get("issue", "").strip(),
            context.get("raw_case_summary", "")[:800].strip(),
        ) if part)
        case_summary = await generate_case_summary(
            item.get("title", ""), doc_text or "", matter_context,
            date.today().isoformat())
        if case_summary.summary100 or case_summary.note:
            reports[doc_id] = {**(reports.get(doc_id) or {}),
                               "caseSummary": case_summary.model_dump()}
            sessions.save(session_id, session)

    # The user now has the final judgement report — fold this view into the
    # session ledger and print the true END-TO-END bill, nothing skipped.
    cost_ledger = merge_cost_ledger(session.get("costLedger"), cost_tracker)
    session["costLedger"] = cost_ledger
    sessions.save(session_id, session)
    run_cost_log(cost_ledger,
                 f"END-TO-END session {session_id[:8]} — through report view {doc_id}",
                 step=cost_tracker)
    await asyncio.to_thread(flush_usage_events, cost_tracker,
                            session_id=session_id, stage="report_view")
    return CitationReport(
        docId=doc_id,
        issueId=issue_id,
        issue=issue.get("issue", ""),
        title=item.get("title", ""),
        court=item.get("court", ""),
        publishDate=meta.get("publishdate") or info.get("publishdate", ""),
        author=meta.get("author", ""),
        bench=bench,
        url=item.get("url", ""),
        status=(reports.get(doc_id) or {}).get("status", "pending"),
        band=item.get("band", "RED"),
        applicabilityStrength=_STRENGTH_BY_BAND.get(item.get("band"), "Weak"),
        semanticMatch=float((item.get("signals") or {}).get("semantic", 0.0)),
        factualRelevance=_factual_relevance(case_facts, doc_text or ""),
        signals=item.get("signals") or {},
        excerpt=item.get("pinpoint") or item.get("headline") or None,
        matchedTerms=item.get("matchedTerms") or [],
        citesTotal=info.get("citesTotal", 0),
        # /doc sometimes returns an empty citedbyList even when the search
        # index knows the count — fall back to the search-time metadata.
        citedByTotal=info.get("citedByTotal", 0) or int(
            (issue.get("candidateMeta", {}).get(doc_id) or {}).get("numCitedby", 0)),
        casesCitedSample=info.get("casesCitedSample", []),
        citedBySample=info.get("citedBySample", []),
        goodLawCheck=good_law_check,
        analysis=analysis,
        caseSummary=case_summary,
        documentText=(doc_text or "")[:400000],
        generatedOn=date.today().isoformat(),
    )


@app.post("/api/v1/search/{session_id}/report/{issue_id}/{doc_id}/status")
async def set_report_status(session_id: str, issue_id: int, doc_id: str,
                            request: ReportStatusRequest):
    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    issue = next((i for i in session.get("issues", []) if i["id"] == issue_id), None)
    if issue is None or not any(r["docId"] == doc_id for r in issue.get("results", [])):
        raise HTTPException(status_code=404, detail="Citation not found in session")
    reports = issue.setdefault("reports", {})
    reports[doc_id] = {**(reports.get(doc_id) or {}), "status": request.status}
    sessions.save(session_id, session)
    return {"docId": doc_id, "issueId": issue_id, "status": request.status}


# ─── POST /api/v1/search/{sessionId}/refine (Section 10) ────────────────────

_AFTER_RE = re.compile(r"(?i)\bafter\s+((?:19|20)\d{2})")
_BEFORE_RE = re.compile(r"(?i)\bbefore\s+((?:19|20)\d{2})")


def _facet_match(item: ResultItem, req: RefineRequest) -> bool:
    court = req.court
    year_from, year_to, band = req.yearFrom, req.yearTo, req.band
    query = req.query or ""
    if court is None:
        for name in ("supreme court", "high court", "district", "tribunal"):
            if name in query.lower():
                court = name
                break
    if year_from is None:
        m = _AFTER_RE.search(query)
        if m:
            year_from = int(m.group(1))
    if year_to is None:
        m = _BEFORE_RE.search(query)
        if m:
            year_to = int(m.group(1))
    if court and court.lower() not in (item.court or "").lower():
        return False
    if year_from and (item.year is None or item.year < year_from):
        return False
    if year_to and (item.year is None or item.year > year_to):
        return False
    if band and item.band != band:
        return False
    return True


def _keyword_match(item: ResultItem, meta: dict[str, Any], query: str) -> bool:
    haystack = normalize_ws(" ".join([
        item.title or "", item.pinpoint or "",
        str(meta.get(item.docId, {}).get("headline", "")),
    ]))
    terms = [t for t in normalize_ws(query).split() if len(t) > 2]
    return bool(terms) and all(t in haystack for t in terms)


async def _semantic_order(items: list[ResultItem], meta: dict[str, Any],
                          query: str) -> dict[str, float]:
    """Cosine against the cached Qdrant embeddings — reuse, don't recompute
    (misses only occur if the cache expired)."""
    query_vec = await embedder.embed_query(query)
    candidates = [
        Candidate(doc_id=item.docId, title=item.title,
                  headline=str(meta.get(item.docId, {}).get("headline", "")))
        for item in items
    ]
    vectors = await embedder.embed_candidates(candidates) if query_vec else {}
    scores: dict[str, float] = {}
    for item in items:
        vec = vectors.get(item.docId)
        scores[item.docId] = max(0.0, cosine(query_vec, vec)) if (query_vec and vec) else 0.0
    return scores


@app.post("/api/v1/search/{session_id}/refine", response_model=RefineResponse)
async def refine(session_id: str, request: RefineRequest) -> RefineResponse:
    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    issue = next((i for i in session.get("issues", []) if i["id"] == request.issueId), None)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"issueId {request.issueId} not in session")

    items = [ResultItem.model_validate(r) for r in issue.get("results", [])]
    meta = issue.get("candidateMeta", {})

    # Escape hatch — the ONLY search-within path allowed to hit IK.
    if request.mode == "ik_escape":
        return await _ik_escape(session_id, request, issue)

    if request.mode == "facet":
        flags = {item.docId: _facet_match(item, request) for item in items}
        ordered = sorted(items, key=lambda i: flags[i.docId], reverse=True)
    elif request.mode == "keyword":
        flags = {item.docId: _keyword_match(item, meta, request.query) for item in items}
        ordered = sorted(items, key=lambda i: flags[i.docId], reverse=True)
    else:  # semantic
        scores = await _semantic_order(items, meta, request.query)
        flags = {item.docId: scores[item.docId] >= 0.5 for item in items}
        ordered = sorted(items, key=lambda i: scores[i.docId], reverse=True)

    # Reorder / de-emphasise — NEVER hard-delete: every result stays in the
    # view; non-matching ones are only demoted.
    refined = [RefinedItem(result=item, matchesRefinement=flags[item.docId],
                           demoted=not flags[item.docId]) for item in ordered]
    matched = sum(1 for f in flags.values() if f)

    escape = None
    if matched == 0:
        escape = {
            "offer": "No cached result matches this refinement. Search all of Indian Kanoon for it?",
            "how": {"mode": "ik_escape", "query": request.query, "issueId": request.issueId},
        }
    return RefineResponse(sessionId=session_id, issueId=request.issueId,
                          mode=request.mode, items=refined,
                          matchedCount=matched, escapeHatch=escape)


async def _ik_escape(session_id: str, request: RefineRequest,
                     issue: dict[str, Any]) -> RefineResponse:
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="ik_escape requires a query")
    docs = await ik_client.search(request.query)
    pool: dict[str, Candidate] = {}
    for doc in docs[:settings.ik_candidate_cap]:
        doc_id = str(doc.get("tid") or "").strip()
        if not doc_id or doc_id in pool:
            continue
        title = strip_html(str(doc.get("title") or "")).strip()
        pool[doc_id] = Candidate(
            doc_id=doc_id, title=title,
            court=str(doc.get("docsource") or "").strip(),
            year=year_from_text(str(doc.get("publishdate") or ""), title),
            headline=strip_html(str(doc.get("headline") or "")).strip(),
            num_citedby=int(doc.get("numcitedby") or 0),
            source_url=f"https://indiankanoon.org/doc/{doc_id}/",
            matched_terms=[request.query],
        )
    candidates = list(pool.values())
    issue_text = str(issue.get("issue", request.query))
    from tools import rerank  # local import avoids cycle at module load
    semantic = await rerank(issue_text, candidates)

    scored: list[ScoredResult] = []
    for cand in candidates:
        sem = semantic.get(cand.doc_id, 0.0)
        signals = SignalSet(semantic_match=round(sem, 4),
                            keyword_match=1.0 if cand.matched_terms else 0.0)
        result = composite_score(signals, settings.phase_weights)
        result.doc_id = cand.doc_id
        result.band = band_for(sem)
        scored.append(result)
    scored.sort(key=lambda r: r.score, reverse=True)

    # Closed-world rule holds here too: guardian verifies against exactly
    # the pool this escape-hatch fetch produced. No bypass, ever.
    clean, _drops = citation_guardian.verify(scored, pool)

    refined = [
        RefinedItem(
            result=ResultItem(
                docId=r.doc_id, title=pool[r.doc_id].title, court=pool[r.doc_id].court,
                year=pool[r.doc_id].year, band=r.band, score=r.score,
                url=pool[r.doc_id].source_url,
                signals={"semantic": r.breakdown.semantic_match},
                chips=[pool[r.doc_id].court or "Court",
                       f"{round(r.breakdown.semantic_match * 100)}% on point"],
            ),
            matchesRefinement=True,
        )
        for r in clean
    ]
    return RefineResponse(sessionId=session_id, issueId=request.issueId,
                          mode="ik_escape", items=refined, matchedCount=len(refined))


# ─── Advanced Search (direct Indian Kanoon query, no pipeline) ──────────────

_DATE_YMD = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")   # HTML <input type=date>
_DATE_DMY = re.compile(r"^(\d{1,2})-(\d{1,2})-(\d{4})$")   # IK wire format


def _ik_date(value: str, field: str) -> str:
    """Normalise either date form to IK's DD-MM-YYYY wire format."""
    v = value.strip()
    m = _DATE_YMD.match(v)
    if m:
        return f"{int(m.group(3))}-{int(m.group(2))}-{m.group(1)}"
    m = _DATE_DMY.match(v)
    if m:
        return f"{int(m.group(1))}-{int(m.group(2))}-{m.group(3)}"
    raise HTTPException(status_code=422, detail=f"{field} must be a date in DD-MM-YYYY form")


def _es_unavailable_detail() -> str:
    """The 503 body for a library request when ES never connected — carries
    the REAL reason (missing driver, bad credential, wrong URL) instead of
    sending everyone to check ELASTICSEARCH_URL."""
    reason = getattr(elastic, "failure_reason", None)
    detail = "The local judgment library (Elasticsearch) is not reachable"
    if reason:
        detail += f" — {reason}"
    return detail + ". Search Indian Kanoon instead, or restart the service once it is fixed."


def _log_provenance(stage: str, source: str, summary: str,
                    docs: list[dict[str, Any]] | None = None) -> None:
    """WHICH judgments were served, and WHERE each came from. The [cost]
    table only counts calls; this prints the docIds themselves so the
    console shows, per request, whether the judgment came out of the local
    Elasticsearch library or off Indian Kanoon."""
    logger.info("[source] %s — source: %s — %s", stage, source, summary)
    for i, doc in enumerate(docs or [], 1):
        logger.info("[source]    %2d. doc %-10s %-10s %-28s %s", i,
                    doc.get("docId") or "?", doc.get("date") or "-",
                    (doc.get("court") or "-")[:28],
                    (doc.get("title") or "")[:60])


def _ik_doc_origin(cost_tracker: dict[str, Any]) -> str:
    """Where ONE Indian Kanoon-path document actually came from: the local
    library and the 7-day cache both short-circuit the billed fetch."""
    if cost_tracker.get("library"):
        return "the local library (Elasticsearch) — no IK call"
    if cost_tracker.get("cached") and not cost_tracker.get("billed"):
        return "the 7-day document cache — no IK call"
    return "Indian Kanoon /doc (billed)"


@app.post("/api/v1/advanced-search")
async def advanced_search(request: AdvancedSearchRequest,
                          http_request: Request) -> dict[str, Any]:
    """User-driven Indian Kanoon search: the filled criteria are combined
    into one formInput with IK's own directives and results are returned
    exactly as IK ranks them — no issue analysis, no verifier, no bands.
    Directives ride inside formInput (not separate params) because that is
    what IK's own advanced form emits and it keeps keyword-less searches
    (e.g. bench + date range alone) valid."""
    parts: list[str] = []
    if request.query.strip():
        # AND/OR/NOT are authored in readable form; IK's wire format is
        # ANDD/ORR/NOTT — same translation the pipeline queries get.
        parts.append(to_ik_operators(request.query))
    for directive, value in (("title", request.title), ("cite", request.cite),
                             ("author", request.author), ("bench", request.bench),
                             ("doctypes", request.doctypes)):
        if value.strip():
            parts.append(f"{directive}:{normalize_ws(value.replace(', ', ','))}")
    if request.fromdate.strip():
        parts.append(f"fromdate:{_ik_date(request.fromdate, 'fromdate')}")
    if request.todate.strip():
        parts.append(f"todate:{_ik_date(request.todate, 'todate')}")
    if not parts:
        raise HTTPException(status_code=422, detail="Fill in at least one search field")
    if request.sortby != "relevance":
        parts.append(f"sortby:{request.sortby}")
    form_input = " ".join(parts)

    # Same console bill as the pipeline runs: one tracker per advanced
    # search, printed via run_cost_log so IK spend is never silent.
    set_usage_identity(resolve_user_id(http_request))
    cost_tracker = ik_cost_start()
    data = await ik_client.search_raw(form_input, pagenum=max(0, request.pagenum))
    if data is None:
        detail = ("Indian Kanoon rejected the API token — the prepaid account may be "
                  "out of balance." if ik_client.auth_failed else
                  "Indian Kanoon could not be reached — please try again in a moment.")
        raise HTTPException(status_code=502, detail=detail)
    if data.get("errmsg"):
        raise HTTPException(status_code=502, detail=str(data["errmsg"]))

    results: list[dict[str, Any]] = []
    for doc in data.get("docs") or []:
        doc_id = str(doc.get("tid") or "").strip()
        if not doc_id:
            continue
        results.append({
            "docId": doc_id,
            "title": strip_html(str(doc.get("title") or "")).strip(),
            "headline": strip_html(str(doc.get("headline") or "")).strip(),
            "court": str(doc.get("docsource") or "").strip(),
            "date": str(doc.get("publishdate") or "").strip(),
            "numCitedby": int(doc.get("numcitedby") or 0),
            "url": f"https://indiankanoon.org/doc/{doc_id}/",
        })

    # IK reports the total as "Showing X - Y of N" text (or a bare count in
    # older responses); the parsed total drives real pagination client-side.
    found = str(data.get("found") or "")
    m = re.search(r"of\s+([\d,]+)", found)
    total = int(m.group(1).replace(",", "")) if m else (
        int(found.replace(",", "")) if found.replace(",", "").strip().isdigit() else None)
    has_more = ((request.pagenum + 1) * 10 < total) if total is not None else len(results) >= 10

    billed = dict(cost_tracker["billed"])
    ik_total = sum(IK_RATES_INR[kind] * count for kind, count in billed.items())
    _log_provenance(
        f"ADVANCED SEARCH page {request.pagenum + 1}",
        "Indian Kanoon /search (billed)" if billed.get("search")
        else "the cached copy of this exact query — no IK call",
        f"{len(results)} judgment(s) for: {form_input[:70]}"
        if results else f"NOT FOUND — nothing matched: {form_input[:70]}",
        results)
    run_cost_log(cost_tracker,
                 f"ADVANCED SEARCH — page {request.pagenum + 1} — {form_input[:70]}")
    await asyncio.to_thread(flush_usage_events, cost_tracker,
                            session_id=None, stage="advanced_search")
    return {
        "formInput": form_input,
        # Mirrored in the browser console: where these judgments came from.
        "servedFrom": ("Indian Kanoon /search (billed)" if billed.get("search")
                       else "cached copy of this exact query (no IK call)"),
        "pagenum": request.pagenum,
        "found": found,
        "total": total,
        "hasMore": has_more,
        "results": results,
        # Mirrored in the browser console by the Advanced Search modal.
        "cost": {
            "billedSearches": billed.get("search", 0),
            "cachedHits": cost_tracker["cached"],
            "ratePerSearchInr": IK_RATES_INR["search"],
            "totalInr": round(ik_total, 2),
        },
    }


@app.get("/api/v1/advanced-search/doc/{doc_id}")
async def advanced_search_doc(doc_id: str, http_request: Request) -> dict[str, Any]:
    """Document view for the Advanced Search popup — the full judgment as
    Indian Kanoon serves it (its own HTML, sanitized client-side before
    rendering) plus bench/author metadata and cites/cited-by samples, so
    clicking a result opens the judgment in-app like IK's own doc page."""
    set_usage_identity(resolve_user_id(http_request))
    cost_tracker = ik_cost_start()
    raw, meta = await asyncio.gather(ik_client.fetch_doc_raw(doc_id),
                                     ik_client.fetch_doc_meta(doc_id))
    if raw is None:
        detail = ("Indian Kanoon rejected the API token — the prepaid account may be "
                  "out of balance." if ik_client.auth_failed else
                  "Indian Kanoon could not be reached — please try again in a moment.")
        raise HTTPException(status_code=502, detail=detail)

    billed = dict(cost_tracker["billed"])
    ik_total = sum(IK_RATES_INR[kind] * count for kind, count in billed.items())
    _log_provenance(
        f"DOCUMENT VIEW doc {doc_id}", _ik_doc_origin(cost_tracker),
        (raw.get("title") or meta.get("title") or "")[:70])
    run_cost_log(cost_tracker, f"ADVANCED SEARCH — document view {doc_id}")
    await asyncio.to_thread(flush_usage_events, cost_tracker,
                            session_id=None, stage="advanced_search_doc")
    return {
        "docId": doc_id,
        "servedFrom": _ik_doc_origin(cost_tracker),
        "title": raw.get("title") or meta.get("title", ""),
        "court": meta.get("docsource") or raw.get("docsource", ""),
        "publishdate": raw.get("publishdate") or meta.get("publishdate", ""),
        "author": meta.get("author", ""),
        "bench": meta.get("bench", ""),
        "citesCount": raw.get("numcites", 0),
        "citedByCount": raw.get("numcitedby", 0),
        "casesCited": raw.get("casesCited", []),
        "citedBy": raw.get("citedBy", []),
        "html": raw.get("html", ""),
        "url": f"https://indiankanoon.org/doc/{doc_id}/",
        "cost": {
            "billed": billed,
            "cachedHits": cost_tracker["cached"],
            "totalInr": round(ik_total, 2),
        },
    }


# ─── Local judgment library (Elasticsearch mirror of fetched judgments) ─────

# How many qualifying judgments the keyword engine will re-rank (and page
# through). The full match count is still reported; only ordering past this
# many results is out of reach.
LIBRARY_RANK_POOL_CAP = 300

def _iso_date(value: str, field: str) -> str:
    """Either date form → yyyy-MM-dd for the ES publishdate range."""
    v = value.strip()
    m = _DATE_YMD.match(v)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = _DATE_DMY.match(v)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    raise HTTPException(status_code=422, detail=f"{field} must be a date in DD-MM-YYYY form")


def _es_court_clauses(doctypes: str) -> list[dict[str, Any]]:
    """docsource filters mirroring IK doctype tokens (shared with the
    pipeline's library-first fetch — tools.es_court_clauses)."""
    from tools import es_court_clauses
    return es_court_clauses(doctypes)


async def _local_engine_search(request: AdvancedSearchRequest) -> dict[str, Any]:
    """The paragraph-aware ES legal engine behind /local-search for keyword
    queries: parse → qualify (strict/flexible) → paragraph evidence →
    weighted re-rank → paginate. Response shape identical to the legacy
    path so the popup renders it unchanged."""
    from tools import es_legal_search, parse_legal_query
    parsed = parse_legal_query(request.query)
    mode = request.searchMode
    if mode == "auto":
        # IK parity: every word typed must appear in the judgment, quoted
        # phrases verbatim. Loose BM25 recall is still reachable, but only
        # by asking for it (searchMode='flexible').
        mode = "strict"
    fromdate_iso = (_iso_date(request.fromdate, "fromdate")
                    if request.fromdate.strip() else None)
    todate_iso = (_iso_date(request.todate, "todate")
                  if request.todate.strip() else None)
    # IK-style paging: re-ranking happens in-process, so pull a candidate
    # pool big enough for the page being viewed (bounded — deep paging past
    # the cap is not served) and report the TRUE qualifying count, not the
    # size of the pool.
    pagenum = max(0, request.pagenum)
    pool = min(LIBRARY_RANK_POOL_CAP,
               max(get_settings().es_candidate_limit, (pagenum + 1) * 10 + 20))
    stats: dict[str, Any] = {}
    ranked = await asyncio.to_thread(
        es_legal_search, parsed, mode=mode, doctypes=request.doctypes,
        fromdate_iso=fromdate_iso, todate_iso=todate_iso,
        limit=pool, stats=stats)
    if stats.get("failed"):
        # The same 503 the field-criteria path raises. Reporting an ES
        # timeout as "NOT FOUND in the library" tells the user their search
        # has no results when the search was never actually run.
        raise HTTPException(status_code=503, detail=(
            "The local judgment library did not respond — try again, or "
            "search Indian Kanoon instead."))
    if request.sortby == "mostrecent":
        ranked.sort(key=lambda d: d.get("publishdate") or "", reverse=True)
    elif request.sortby == "leastrecent":
        ranked.sort(key=lambda d: d.get("publishdate") or "9999")

    page = ranked[pagenum * 10:(pagenum + 1) * 10]
    results = [{
        "docId": d["tid"],
        "title": d["title"],
        "headline": d.get("headline") or "",
        "court": d.get("docsource") or "",
        "date": d.get("publishdate") or "",
        "numCitedby": int(d.get("numcitedby") or 0),
        "url": f"https://indiankanoon.org/doc/{d['tid']}/",
        "fromLibrary": True,
        # The paragraphs this judgment matched on, matched words marked.
        "evidence": d.get("evidence") or [],
        # Explainability (internal/debug — the popup ignores unknown keys).
        "esScore": d.get("esScore"),
        "finalScore": d.get("finalScore"),
        "matchedPhrases": d.get("matchedPhrases") or [],
        "matchedParagraphs": d.get("matchedParagraphs") or [],
    } for d in page]
    total = int(stats.get("total") or len(ranked))
    start = pagenum * 10 + 1 if results else 0
    end = pagenum * 10 + len(results)
    shown = normalize_ws(request.query)
    if request.doctypes.strip():
        shown += f" doctypes:{normalize_ws(request.doctypes.replace(', ', ','))}"
    settings_es = get_settings()
    did_you_mean = None
    if total == 0:
        from library_suggest import did_you_mean as _dym

        def _count(candidate: str) -> int:
            probe: dict[str, Any] = {}
            es_legal_search(parse_legal_query(candidate), mode=mode,
                            doctypes=request.doctypes, fromdate_iso=fromdate_iso,
                            todate_iso=todate_iso, limit=1, stats=probe)
            return int(probe.get("total") or 0)

        did_you_mean = _dym(request.query, parsed["terms"],
                            suggest=elastic.suggest_words, count=_count)
        if did_you_mean:
            logger.info("[source] MY LIBRARY did-you-mean: %r -> %r (%d judgments)",
                        request.query, did_you_mean["query"], did_you_mean["total"])
    _log_provenance(
        f"MY LIBRARY page {pagenum + 1} ({mode} engine)",
        f"Elasticsearch [{settings_es.elastic_paragraph_index} + "
        f"{settings_es.elastic_index}] (free)",
        f"{len(results)} of {total} judgment(s) for: {shown[:70]}"
        if results else f"NOT FOUND in the library — nothing matched: {shown[:70]}",
        results)
    return {
        "formInput": shown,
        "source": "local_library",
        "servedFrom": (f"your library — Elasticsearch "
                       f"[{settings_es.elastic_paragraph_index} + "
                       f"{settings_es.elastic_index}] (free)"),
        "mode": mode,
        # Offered when nothing matched and a spelling fix would: the popup
        # shows "Did you mean …?" and re-runs with it on click.
        "didYouMean": did_you_mean,
        "pagenum": pagenum,
        "found": f"{start} - {end} of {total}" if total else "",
        "total": total,
        # Deep pages past the ranked pool are not served, so never promise
        # a next page the engine cannot produce.
        "hasMore": bool(results) and end < min(total, LIBRARY_RANK_POOL_CAP),
        "results": results,
        "cost": {"billedSearches": 0, "cachedHits": 0,
                 "ratePerSearchInr": 0.0, "totalInr": 0.0},
    }


@app.post("/api/v1/local-search")
async def local_search(request: AdvancedSearchRequest,
                       http_request: Request) -> dict[str, Any]:
    """IK-style advanced search over the LOCAL judgment library — the
    Elasticsearch mirror of every judgment this system has fetched from
    Indian Kanoon (same docIds, ZERO IK spend). Same grammar as IK:
    space-separated terms must ALL appear, "quoted phrases" verbatim; same
    filters and sort; 10 results per page via pagenum. Response shape is
    identical to /advanced-search so the popup renders either source."""
    if not elastic.available:
        raise HTTPException(status_code=503, detail=_es_unavailable_detail())

    # Keyword-only searches go through the paragraph-aware legal engine
    # (strict phrase qualification + proximity re-rank). Field criteria
    # (title:/cite:/author:/bench:) keep the field-level path below.
    if request.query.strip() and not any(v.strip() for v in (
            request.title, request.cite, request.author, request.bench)):
        return await _local_engine_search(request)

    must: list[dict[str, Any]] = []
    must_not: list[dict[str, Any]] = []
    filters: list[dict[str, Any]] = []

    def _text_clauses(value: str, fields: list[str]) -> None:
        # IK grammar: "quoted phrases" verbatim, remaining words all-AND,
        # A OR B either, NOT X excluded — one parser for every library query.
        from library_query import boolean_clauses
        got_must, got_must_not = boolean_clauses(value, fields)
        must.extend(got_must)
        must_not.extend(got_must_not)

    if request.query.strip():
        _text_clauses(request.query, ["text", "title^2"])
    if request.title.strip():
        _text_clauses(request.title, ["title"])
    if request.cite.strip():
        must.append({"match_phrase": {"text": normalize_ws(request.cite)}})
    if request.author.strip():
        must.append({"match": {"author": {"query": request.author, "operator": "and"}}})
    if request.bench.strip():
        must.append({"match": {"bench": {"query": request.bench, "operator": "and"}}})
    court_should = _es_court_clauses(request.doctypes)
    if court_should:
        filters.append({"bool": {"should": court_should, "minimum_should_match": 1}})
    date_range: dict[str, str] = {}
    if request.fromdate.strip():
        date_range["gte"] = _iso_date(request.fromdate, "fromdate")
    if request.todate.strip():
        date_range["lte"] = _iso_date(request.todate, "todate")
    if date_range:
        filters.append({"range": {"publishdate": date_range}})
    if not must and not filters:
        raise HTTPException(status_code=422, detail="Fill in at least one search field")

    sort: list | None = None
    if request.sortby == "mostrecent":
        sort = [{"publishdate": {"order": "desc", "missing": "_last"}}]
    elif request.sortby == "leastrecent":
        sort = [{"publishdate": {"order": "asc", "missing": "_last"}}]

    pagenum = max(0, request.pagenum)
    resp = await asyncio.to_thread(
        elastic.search_judgments,
        {"bool": {"must": must or [{"match_all": {}}], "must_not": must_not,
                  "filter": filters}},
        sort, pagenum)
    if resp is None:
        raise HTTPException(status_code=503, detail=(
            "The local judgment library did not respond — try again, or "
            "search Indian Kanoon instead."))

    hits = resp.get("hits") or {}
    total = int(((hits.get("total") or {}).get("value")) or 0)
    results: list[dict[str, Any]] = []
    for hit in hits.get("hits") or []:
        src = hit.get("_source") or {}
        frags = (hit.get("highlight") or {}).get("text") or []
        doc_id = str(src.get("tid") or hit.get("_id") or "")
        evidence = [{"paragraph": None, "html": highlight_fragment_html(f)}
                    for f in frags[:3] if highlight_fragment_html(f)]
        results.append({
            "docId": doc_id,
            "title": src.get("title") or doc_id,
            "headline": strip_html(" … ".join(frags)).strip(),
            "court": src.get("docsource") or "",
            "date": src.get("publishdate") or "",
            "numCitedby": int(src.get("numcitedby") or 0),
            "url": f"https://indiankanoon.org/doc/{doc_id}/",
            "fromLibrary": True,
            "evidence": evidence,
        })

    # Same display string the IK path shows, so the popup's query chip works.
    shown: list[str] = []
    if request.query.strip():
        shown.append(normalize_ws(request.query))
    for directive, value in (("title", request.title), ("cite", request.cite),
                             ("author", request.author), ("bench", request.bench),
                             ("doctypes", request.doctypes)):
        if value.strip():
            shown.append(f"{directive}:{normalize_ws(value.replace(', ', ','))}")
    if request.fromdate.strip():
        shown.append(f"fromdate:{_ik_date(request.fromdate, 'fromdate')}")
    if request.todate.strip():
        shown.append(f"todate:{_ik_date(request.todate, 'todate')}")
    if request.sortby != "relevance":
        shown.append(f"sortby:{request.sortby}")

    start = pagenum * 10 + 1 if results else 0
    end = pagenum * 10 + len(results)
    _log_provenance(
        f"MY LIBRARY page {pagenum + 1} (field criteria)",
        f"Elasticsearch [{get_settings().elastic_index}] (free)",
        f"{len(results)} of {total} judgment(s) for: {' '.join(shown)[:70]}"
        if results else
        f"NOT FOUND in the library — nothing matched: {' '.join(shown)[:70]}",
        results)
    return {
        "formInput": " ".join(shown),
        "source": "local_library",
        "servedFrom": (f"your library — Elasticsearch "
                       f"[{get_settings().elastic_index}] (free)"),
        "pagenum": pagenum,
        "found": f"{start} - {end} of {total}" if total else "",
        "total": total,
        "hasMore": (pagenum + 1) * 10 < total,
        "results": results,
        # The library is free — zeros keep the popup's cost logging uniform.
        "cost": {"billedSearches": 0, "cachedHits": 0,
                 "ratePerSearchInr": 0.0, "totalInr": 0.0},
    }


# IK's own doc HTML carries the author/bench headings even when the
# library's indexed fields were never filled by a /docmeta call.
_DOC_AUTHOR_RE = re.compile(r'<h3 class="doc_author">(.*?)</h3>', re.S | re.I)
_DOC_BENCH_RE = re.compile(r'<h3 class="doc_bench">(.*?)</h3>', re.S | re.I)


def _library_meta(doc: dict[str, Any]) -> tuple[str, str]:
    """Author and bench for a library judgment: the indexed fields when a
    /docmeta call ever filled them, else IK's own headings inside the stored
    HTML — so an opened judgment shows its full masthead, not a blank one."""
    html = doc.get("doc") or ""
    author = (doc.get("author") or "").strip()
    bench = (doc.get("bench") or "").strip()
    if not author:
        m = _DOC_AUTHOR_RE.search(html)
        if m:
            author = re.sub(r"^Author:\s*", "", strip_html(m.group(1)).strip())
    if not bench:
        m = _DOC_BENCH_RE.search(html)
        if m:
            bench = re.sub(r"^Bench:\s*", "", strip_html(m.group(1)).strip())
    return squash_ws(author), squash_ws(bench)


def _library_html(doc: dict[str, Any]) -> str:
    """The judgment body for the in-app viewer. IK's own HTML is kept
    verbatim when the library has it; a text-only copy (indexed before the
    HTML column existed) is escaped into paragraphs so it still renders."""
    from html import escape

    html = (doc.get("doc") or "").strip()
    if html:
        return html
    text = (doc.get("text") or "").strip()
    if not text:
        return ""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    return "".join(f"<p>{escape(p)}</p>" for p in paras)


@app.get("/api/v1/local-search/doc/{doc_id}")
async def local_search_doc(doc_id: str) -> dict[str, Any]:
    """Document view for the LOCAL library — served ONLY from Elasticsearch.
    Unlike /advanced-search/doc/{docId} this never falls back to Indian
    Kanoon: a judgment the library has not collected comes back as a plain
    404 ("not found in your library"), so picking "My library" can never
    spend IK credit."""
    if not elastic.available:
        raise HTTPException(status_code=503, detail=_es_unavailable_detail())

    doc = await asyncio.to_thread(elastic.get_judgment, doc_id)
    body = _library_html(doc or {})
    if not doc or not body:
        _log_provenance(
            f"MY LIBRARY doc {doc_id}",
            f"Elasticsearch [{get_settings().elastic_index}] (free)",
            "NOT FOUND — this judgment is not in the library"
            if not doc else "NOT FOUND — the library copy carries no text")
        raise HTTPException(status_code=404, detail=(
            "This judgment is not in your library — switch the source to "
            "Indian Kanoon to fetch it."))

    author, bench = _library_meta(doc)
    if author or bench:
        # Enrich the stored copy once, so author:/bench: searches over the
        # library find it later (best-effort — never fails a doc view).
        await asyncio.to_thread(elastic.update_judgment, str(doc_id),
                                {"author": author, "bench": bench})

    _log_provenance(
        f"MY LIBRARY doc {doc_id}",
        f"Elasticsearch [{get_settings().elastic_index}] (free)",
        f"{(doc.get('title') or '')[:60]} — complete judgment, "
        f"{len(body):,} chars, no IK call")

    return {
        "docId": str(doc.get("tid") or doc_id),
        "source": "local_library",
        "servedFrom": (f"your library — Elasticsearch "
                       f"[{get_settings().elastic_index}] (free)"),
        "title": doc.get("title") or "",
        "court": doc.get("docsource") or "",
        "publishdate": doc.get("publishdate") or "",
        "author": author,
        "bench": bench,
        "citesCount": int(doc.get("numcites") or 0),
        "citedByCount": int(doc.get("numcitedby") or 0),
        "casesCited": doc.get("casesCited") or [],
        "citedBy": doc.get("citedBy") or [],
        "html": body,
        "url": f"https://indiankanoon.org/doc/{doc_id}/",
        # Free by construction — keeps the popup's cost logging uniform.
        "cost": {"billed": {}, "cachedHits": 0, "totalInr": 0.0},
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host=settings.api_host, port=settings.port, reload=settings.debug)
