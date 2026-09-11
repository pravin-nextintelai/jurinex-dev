"""Production orchestration for the isolated Deep Research mode.

Normal Research never imports this module. Deep runs use reservation-based cost control,
bounded runtime/capacity, SSRF-aware source validation, server-owned source links, and
structured source evidence persisted with the answer.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import threading
import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Callable
from urllib.parse import urlsplit

import httpx

from app.core.config import get_settings
from app.services import citation_verification

from . import events, gemini, prompts, report
from .budget import (
    BudgetError,
    BudgetExceededError,
    BudgetTracker,
    PricingPolicy,
    UnknownPricingError,
)
from .config import DeepResearchConfig
from .formatting import normalize_ascii_layout
from .runtime import (
    DeepResearchBusy,
    DeepResearchDeadline,
    DeepResearchRuntime,
    DeepResearchTimeout,
)
from .source_validation import (
    SourceRecord,
    SourceValidationConfig,
    SourceValidator,
    ValidationResult,
)

logger = logging.getLogger(__name__)

_GOOGLE_SEARCH_USD_PER_QUERY = 0.014
_MAX_SEARCH_QUERIES_PER_CALL = 4
_MIN_PLAN_OUTPUT_TOKENS = 512
_MIN_SEARCH_OUTPUT_TOKENS = 1024
_MIN_GAP_OUTPUT_TOKENS = 128
_MIN_SYNTHESIS_OUTPUT_TOKENS = 2048
_MAX_QUOTE_PAGE_BYTES = 250_000
_MAX_QUOTES_PER_FINDING = 8
_MAX_QUOTE_SOURCES_PER_FINDING = 8

_RUNTIME_LOCK = threading.Lock()
_RUNTIMES: dict[tuple[int, float, float], DeepResearchRuntime] = {}
# Blocking SDK calls cannot be cancelled once their worker thread is inside provider
# I/O. Acquire this slot before submitting work so timed-out calls remain bounded and
# cannot fill the shared executor with an unbounded number of zombie requests.
_PROVIDER_CALL_SLOTS = threading.BoundedSemaphore(value=4)

_MARKDOWN_LINK_RE = re.compile(r"!?\[([^\]\n]*)\]\([^\)\n]*\)")
_RAW_URL_RE = re.compile(r"https?://[^\s<>()\[\]]+", re.IGNORECASE)
_SOURCE_REFERENCE_RE = re.compile(r"\[(S\d+)\]", re.IGNORECASE)
_SOURCE_SECTION_RE = re.compile(
    r"(?im)^#{1,3}\s+(?:validated\s+)?(?:sources|references|links|bibliography)\s*$"
)
_HTML_TAG_RE = re.compile(r"(?s)<[^>]*(?:>|\Z)")
_EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
_PHONE_RE = re.compile(
    r"(?<!\w)(?:\+?91[\s.-]?)?(?:\(?0?\d{2,5}\)?[\s.-]?)?\d(?:[\s.-]?\d){7,11}(?!\w)"
)
_UUID_RE = re.compile(
    r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b"
)
_PRIVATE_IDENTIFIER_RE = re.compile(
    r"(?i)\b(?:case|file|client|customer|account|reference|ref|cnr|fir|pan|gstin|aadhaar)"
    r"\s*(?:number|no\.?)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9./_-]{3,}\b"
)
_TITLED_NAME_RE = re.compile(
    r"(?i)\b(?:mr|mrs|ms|miss|dr|shri|smt|adv|advocate)\.?\s+"
    r"[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,3}\b"
)
_COMPANY_RE = re.compile(
    r"(?i)\b[A-Z][A-Za-z0-9&.'’-]*(?:\s+[A-Z][A-Za-z0-9&.'’-]*){0,5}\s+"
    r"(?:private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|llp)\b"
)
_STREET_ADDRESS_RE = re.compile(
    r"(?i)\b(?:flat|plot|house|building|office|shop)\s*(?:no\.?\s*)?[A-Z0-9/-]{1,12}"
    r"(?:[\s,]+[^,;\n]{0,80}\b(?:road|street|lane|nagar|colony|avenue|floor|sector)\b[^,;\n]{0,50})?"
)
_CAPITALIZED_ENTITY_RE = re.compile(
    r"\b[A-Z][A-Za-z'’-]{2,}(?:\s+(?:[A-Z][A-Za-z'’-]{2,}|of|and|the)){1,4}\b"
)
_PUBLIC_ENTITY_ALLOWLIST = {
    "supreme court",
    "supreme court of india",
    "high court",
    "bombay high court",
    "government of india",
    "state of maharashtra",
    "constitution of india",
    "india code",
    "indian penal code",
    "code of criminal procedure",
    "code of civil procedure",
    "bharatiya nyaya sanhita",
    "bharatiya nagarik suraksha sanhita",
    "bharatiya sakshya adhiniyam",
}

_AUTHORITY_ORDER = {
    "primary_legal_authority": 0,
    "official_government": 1,
    "secondary_legal_database": 2,
    "legislative_research": 3,
    "specialist_legal_reporting": 4,
    "newswire": 5,
    "general_news": 6,
    "other": 7,
}

_AUTHORITY_LABELS = {
    "primary_legal_authority": "Primary legal authority",
    "official_government": "Official government source",
    "secondary_legal_database": "Secondary legal database",
    "legislative_research": "Legislative research",
    "specialist_legal_reporting": "Specialist legal reporting",
    "newswire": "Newswire",
    "general_news": "General news",
    "other": "Other web source",
}


def _runtime_for(cfg: DeepResearchConfig) -> DeepResearchRuntime:
    key = (cfg.max_concurrent_runs, cfg.queue_timeout_s, cfg.run_timeout_s)
    with _RUNTIME_LOCK:
        runtime = _RUNTIMES.get(key)
        if runtime is None:
            runtime = DeepResearchRuntime(
                max_concurrency=cfg.max_concurrent_runs,
                queue_timeout_s=cfg.queue_timeout_s,
                run_timeout_s=cfg.run_timeout_s,
            )
            _RUNTIMES[key] = runtime
        return runtime


_SMALL_TALK_WORDS = frozenset({
    "hi", "hii", "hey", "hello", "helo", "yo", "good", "morning", "afternoon", "evening",
    "night", "thanks", "thank", "you", "ok", "okay", "cool", "nice", "great", "please",
    "bye", "goodbye", "how", "are", "u", "is", "there", "test", "testing", "hola", "namaste",
    "jurinex", "sup", "welcome", "fine",
})

# "for this case", "in the uploaded file", "these documents" — the subject is the attachment.
_CASE_REFERENCE_RE = re.compile(
    r"\b(?:this|the|my|our|our\s+client'?s|present|instant|current)\s+"
    r"(?:case|matter|file|files|document|documents|doc|docs|petition|appeal|suit|order|judgment|agreement|contract)\b"
    r"|\buploaded\b|\battached\b|\bthese\s+documents?\b",
    re.IGNORECASE,
)


def _looks_like_small_talk(question: str) -> bool:
    """True only for greetings/chit-chat — conservative, mirrors the chat route's rule."""
    words = re.findall(r"[a-z']+", str(question or "").strip().lower())
    if not words or len(words) > 6:
        return False
    return all(word in _SMALL_TALK_WORDS for word in words)


def _parse_triage(
    text: str,
    fallback: str,
    max_rounds: int,
    *,
    has_case_context: bool = False,
) -> tuple[str, str, list[str]]:
    mode = ""
    chat_reply = ""
    sub_questions: list[str] = []
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                mode = str(parsed.get("mode") or "").strip().lower()
                chat_reply = str(parsed.get("chat_reply") or "").strip()
                raw = parsed.get("sub_questions") or []
                if isinstance(raw, list):
                    sub_questions = [str(item).strip() for item in raw if str(item).strip()]
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    if mode not in {"chat", "general", "legal"}:
        mode = "general"

    # Server-side guard on the triage. A real question asked with case documents attached
    # must never be short-circuited into "chat" (which answers in one sentence, runs zero
    # search rounds, and typically asks the user for details the documents already hold),
    # and must never be researched as "general" (which drops the case context entirely).
    if has_case_context and not _looks_like_small_talk(fallback):
        if mode == "chat":
            logger.info("[DeepResearch] triage override chat->legal (case documents attached)")
            mode, chat_reply = "legal", ""
        elif mode == "general" and _CASE_REFERENCE_RE.search(str(fallback or "")):
            logger.info("[DeepResearch] triage override general->legal (question refers to the case)")
            mode = "legal"

    if mode == "chat":
        return mode, chat_reply, []
    return mode, chat_reply, (sub_questions[:max_rounds] or [fallback])


def _parse_gap(text: str) -> str | None:
    line = (text or "").strip().splitlines()[0].strip() if (text or "").strip() else ""
    if not line or line.upper().startswith("DONE"):
        return None
    return line.strip().strip('"').strip()


def _redact_grounded_text(text: str, private_context: str = "") -> str:
    """Deterministically remove likely private identifiers before live web search."""

    redacted = str(text or "")
    context = str(private_context or "")[:24_000]
    # Names without titles are difficult to identify safely. If a capitalised phrase is
    # present in both the private document and the query, treat it as private unless it
    # is a known public legal institution or enactment.
    if context and redacted:
        entities = {
            match.group(0).strip()
            for match in _CAPITALIZED_ENTITY_RE.finditer(context)
            if 5 <= len(match.group(0).strip()) <= 100
        }
        for entity in sorted(entities, key=len, reverse=True):
            folded = entity.casefold()
            if any(public_name in folded for public_name in _PUBLIC_ENTITY_ALLOWLIST):
                continue
            if folded in redacted.casefold():
                redacted = re.sub(re.escape(entity), "[private entity]", redacted, flags=re.IGNORECASE)

    substitutions = (
        (_EMAIL_RE, "[private email]"),
        (_UUID_RE, "[private identifier]"),
        (_PRIVATE_IDENTIFIER_RE, "[private identifier]"),
        (_PHONE_RE, "[private phone]"),
        (_TITLED_NAME_RE, "[private person]"),
        (_COMPANY_RE, "[private company]"),
        (_STREET_ADDRESS_RE, "[private address]"),
    )
    for pattern, replacement in substitutions:
        redacted = pattern.sub(replacement, redacted)
    return re.sub(r"[ \t]{2,}", " ", redacted).strip()


def _scope_grounding_citations(
    citations: list[dict[str, Any]], round_number: int
) -> list[dict[str, Any]]:
    """Keep only claim-supported chunks and make claim IDs unique across rounds."""

    scoped: list[dict[str, Any]] = []
    for citation in citations or []:
        claim_ids = [
            re.sub(r"[^A-Za-z0-9_-]", "", str(value or ""))[:32]
            for value in citation.get("claim_ids") or []
        ]
        claim_ids = [value for value in dict.fromkeys(claim_ids) if value]
        if not claim_ids:
            continue
        item = dict(citation)
        item["claim_ids"] = [f"r{round_number}:{value}" for value in claim_ids]
        item["claim_texts"] = [
            re.sub(r"\s+", " ", str(value or "")).strip()[:500]
            for value in citation.get("claim_texts") or []
            if str(value or "").strip()
        ][:12]
        scoped.append(item)
    return scoped


def _estimated_max_input_tokens(prompt: str, *, grounded: bool) -> int:
    # UTF-8 bytes are a conservative upper bound for user-visible prompt tokens. Grounded
    # calls reserve extra room for provider-injected search context and metadata.
    encoded = len((prompt or "").encode("utf-8", errors="replace"))
    margin = 16_384 if grounded else 8_192
    multiplier = 2 if grounded else 1
    return min(256_000, max(1, encoded * multiplier + margin))


def _new_budget(cfg: DeepResearchConfig) -> BudgetTracker:
    pricing = PricingPolicy(
        tool_rates_usd_per_use={"google_search": _GOOGLE_SEARCH_USD_PER_QUERY},
    )
    return BudgetTracker(limit_inr=cfg.budget_inr, pricing=pricing)


def _retrieve_provider_future_exception(future: asyncio.Future[Any]) -> None:
    """Consume a detached worker failure after an orchestration timeout/cancellation."""

    if future.cancelled():
        return
    try:
        exc = future.exception()
    except asyncio.CancelledError:
        return
    if exc is not None:
        logger.debug(
            "[DeepResearch] provider worker completed with %s",
            type(exc).__name__,
        )


async def _provider_call(
    deadline: DeepResearchDeadline,
    call: Callable[[], Any],
    *,
    stage: str,
    timeout_s: float,
    on_started: Callable[[], None] | None = None,
) -> Any:
    """Run one blocking SDK operation without allowing unbounded timed-out workers."""

    loop = asyncio.get_running_loop()
    stage_limit = deadline.stage_timeout(stage=stage, timeout_s=timeout_s)
    started_at = loop.time()

    while not _PROVIDER_CALL_SLOTS.acquire(blocking=False):
        remaining = min(
            stage_limit - (loop.time() - started_at),
            deadline.remaining_s,
        )
        if remaining <= 0:
            raise DeepResearchTimeout(stage=stage, timeout_s=stage_limit)
        await asyncio.sleep(min(0.05, remaining))

    slot_owned_here = True
    try:
        if on_started is not None:
            on_started()

        def _invoke_and_release():
            try:
                return call()
            finally:
                _PROVIDER_CALL_SLOTS.release()

        future = loop.run_in_executor(None, _invoke_and_release)
        # asyncio.shield intentionally lets the blocking SDK call finish after the
        # caller's deadline. Always consume its eventual result so a late transport
        # failure cannot produce "Future exception was never retrieved".
        future.add_done_callback(_retrieve_provider_future_exception)
        slot_owned_here = False  # the worker now releases it, even after caller timeout
        remaining = min(
            stage_limit - (loop.time() - started_at),
            deadline.remaining_s,
        )
        if remaining <= 0:
            raise DeepResearchTimeout(stage=stage, timeout_s=stage_limit)
        return await deadline.wait_for(
            asyncio.shield(future),
            stage=stage,
            timeout_s=remaining,
        )
    finally:
        if slot_owned_here:
            _PROVIDER_CALL_SLOTS.release()


def _reserve_call(
    budget: BudgetTracker,
    *,
    model: str,
    prompt: str,
    configured_output_tokens: int,
    minimum_output_tokens: int,
    label: str,
    grounded: bool = False,
    keep_back_inr: float = 0.0,
):
    max_input = _estimated_max_input_tokens(prompt, grounded=grounded)
    max_queries = _MAX_SEARCH_QUERIES_PER_CALL if grounded else 0
    output_cap = budget.max_affordable_output_tokens(
        model,
        max_input,
        configured_output_tokens,
        search_queries=max_queries,
        keep_back_inr=keep_back_inr,
    )
    if output_cap < minimum_output_tokens:
        raise BudgetExceededError(
            required_inr=budget.estimate_call_cost_inr(
                model,
                max_input,
                minimum_output_tokens,
                search_queries=max_queries,
            ),
            available_inr=budget.remaining_inr,
            label=label,
        )
    reservation = budget.reserve_call(
        model,
        max_input,
        output_cap,
        label,
        max_search_queries=max_queries,
    )
    return output_cap, reservation


def _record_usage(model: str, input_tokens: int, output_tokens: int, label: str) -> None:
    try:
        from app.services.token_usage_log import record_token_usage

        record_token_usage(
            context=f"deep_research_{label.lower().replace(' ', '_')}",
            usage={
                "provider": "gemini",
                "model": model,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "totalTokens": input_tokens + output_tokens,
            },
            provider="gemini",
            model_name=model,
        )
    except Exception as exc:  # accounting must never break the answer stream
        logger.debug("[DeepResearch] usage accumulator unavailable: %s", exc)


def _cancel_reservation_safely(budget: BudgetTracker, reservation: Any) -> None:
    try:
        budget.cancel_reservation(reservation)
    except BudgetError:
        pass


def _settle_reservation_maximum(
    budget: BudgetTracker,
    reservation: Any,
    *,
    label: str,
    reason: str,
) -> float:
    """Fail closed when a submitted provider call's precise usage is unknowable."""

    tools = dict(reservation.max_tool_uses)
    search_queries = int(tools.pop("google_search", 0) or 0)
    try:
        cost = budget.add(
            reservation.model,
            reservation.max_input_tokens,
            reservation.max_output_tokens,
            label=f"{label} (conservative settlement)",
            reservation=reservation,
            search_queries=search_queries,
            tool_uses=tools,
        )
    except BaseException:
        _cancel_reservation_safely(budget, reservation)
        raise
    _record_usage(
        reservation.model,
        reservation.max_input_tokens,
        reservation.max_output_tokens,
        label,
    )
    if budget.steps:
        budget.steps[-1]["usage_estimate"] = "reservation_maximum"
        budget.steps[-1]["settlement_reason"] = str(reason or "provider_usage_uncertain")[:120]
    return cost


def _usage_exceeds_reservation(reservation: Any, input_tokens: int, output_tokens: int) -> bool:
    return (
        max(0, int(input_tokens or 0)) > reservation.max_input_tokens
        or max(0, int(output_tokens or 0)) > reservation.max_output_tokens
    )


async def _reason_call(
    deadline: DeepResearchDeadline,
    budget: BudgetTracker,
    cfg: DeepResearchConfig,
    *,
    model: str,
    prompt: str,
    max_output_tokens: int,
    min_output_tokens: int,
    temperature: float,
    thinking_level: str,
    label: str,
    keep_back_inr: float,
) -> str:
    cap, reservation = _reserve_call(
        budget,
        model=model,
        prompt=prompt,
        configured_output_tokens=max_output_tokens,
        minimum_output_tokens=min_output_tokens,
        label=label,
        keep_back_inr=keep_back_inr,
    )
    provider_started = False

    def _mark_started() -> None:
        nonlocal provider_started
        provider_started = True

    try:
        text, input_tokens, output_tokens = await _provider_call(
            deadline,
            lambda: gemini.reason(
                model,
                prompt,
                temperature=temperature,
                max_output_tokens=cap,
                thinking_level=thinking_level,
            ),
            stage=label.lower().replace(" ", "_"),
            timeout_s=cfg.stage_timeout_s,
            on_started=_mark_started,
        )
    except (asyncio.CancelledError, DeepResearchTimeout, TimeoutError) as exc:
        if provider_started:
            _settle_reservation_maximum(
                budget,
                reservation,
                label=label,
                reason=type(exc).__name__,
            )
        else:
            _cancel_reservation_safely(budget, reservation)
        raise
    except BaseException as exc:
        if provider_started:
            _settle_reservation_maximum(
                budget,
                reservation,
                label=label,
                reason=type(exc).__name__,
            )
        else:
            _cancel_reservation_safely(budget, reservation)
        raise
    if _usage_exceeds_reservation(reservation, input_tokens, output_tokens):
        _settle_reservation_maximum(
            budget,
            reservation,
            label=label,
            reason="provider_reported_usage_exceeded_reservation",
        )
        raise BudgetExceededError(
            required_inr=reservation.reserved_inr,
            available_inr=budget.remaining_inr,
            label=f"{label} provider usage exceeded its reservation",
        )
    cost = budget.add(
        model,
        input_tokens,
        output_tokens,
        label=label,
        reservation=reservation,
    )
    _record_usage(model, input_tokens, output_tokens, label)
    logger.info(
        "[DeepResearch] %s model=%s in=%d out=%d cost=₹%.2f",
        label,
        model,
        input_tokens,
        output_tokens,
        cost,
    )
    return text


async def _search_call(
    deadline: DeepResearchDeadline,
    budget: BudgetTracker,
    cfg: DeepResearchConfig,
    *,
    prompt: str,
    label: str,
) -> tuple[str, list[dict[str, Any]]]:
    cap, reservation = _reserve_call(
        budget,
        model=cfg.search_model,
        prompt=prompt,
        configured_output_tokens=min(cfg.max_output_tokens, 8_192),
        minimum_output_tokens=_MIN_SEARCH_OUTPUT_TOKENS,
        label=label,
        grounded=True,
        keep_back_inr=cfg.synthesis_reserve_inr,
    )
    provider_started = False

    def _mark_started() -> None:
        nonlocal provider_started
        provider_started = True

    try:
        text, citations, input_tokens, output_tokens, query_count = await _provider_call(
            deadline,
            lambda: gemini.search(
                cfg.search_model,
                prompt,
                temperature=cfg.temperature,
                max_output_tokens=cap,
                thinking_level=cfg.reasoning_thinking_level,
            ),
            stage="web_search",
            timeout_s=cfg.stage_timeout_s,
            on_started=_mark_started,
        )
    except (asyncio.CancelledError, DeepResearchTimeout, TimeoutError) as exc:
        if provider_started:
            _settle_reservation_maximum(
                budget,
                reservation,
                label=label,
                reason=type(exc).__name__,
            )
        else:
            _cancel_reservation_safely(budget, reservation)
        raise
    except BaseException as exc:
        if provider_started:
            _settle_reservation_maximum(
                budget,
                reservation,
                label=label,
                reason=type(exc).__name__,
            )
        else:
            _cancel_reservation_safely(budget, reservation)
        raise

    try:
        reported_queries = max(0, int(query_count or 0))
    except (TypeError, ValueError, OverflowError):
        reported_queries = 0
    usage_overrun = _usage_exceeds_reservation(reservation, input_tokens, output_tokens)
    query_overrun = reported_queries > _MAX_SEARCH_QUERIES_PER_CALL
    if usage_overrun or query_overrun:
        _settle_reservation_maximum(
            budget,
            reservation,
            label=label,
            reason=(
                "provider_reported_query_count_exceeded_reservation"
                if query_overrun
                else "provider_reported_token_usage_exceeded_reservation"
            ),
        )
        if budget.steps:
            budget.steps[-1]["provider_reported_search_queries"] = reported_queries
        raise BudgetExceededError(
            required_inr=reservation.reserved_inr,
            available_inr=budget.remaining_inr,
            label=f"{label} provider usage exceeded its reservation",
        )

    # Search metadata can be missing even when the provider executed billable internal
    # queries. Settle the reserved maximum in that case instead of treating search as free.
    billable_queries = reported_queries or _MAX_SEARCH_QUERIES_PER_CALL
    try:
        cost = budget.add(
            cfg.search_model,
            input_tokens,
            output_tokens,
            label=label,
            reservation=reservation,
            search_queries=billable_queries,
        )
    except BaseException:
        _cancel_reservation_safely(budget, reservation)
        raise
    if budget.steps:
        budget.steps[-1]["provider_reported_search_queries"] = reported_queries
    _record_usage(cfg.search_model, input_tokens, output_tokens, label)
    logger.info(
        "[DeepResearch] %s model=%s in=%d out=%d queries=%d cost=₹%.2f",
        label,
        cfg.search_model,
        input_tokens,
        output_tokens,
        billable_queries,
        cost,
    )
    return text, citations


def _source_records(citations: list[dict[str, Any]], max_sources: int) -> list[SourceRecord]:
    records: list[SourceRecord] = []
    seen: set[str] = set()
    for citation in citations:
        if not citation.get("claim_ids"):
            continue
        raw_url = str(citation.get("uri") or "").strip()
        if not raw_url:
            continue
        try:
            record = SourceRecord.from_url(raw_url, title=str(citation.get("title") or "").strip() or None)
            key = record.canonical_url or raw_url
        except Exception:
            record = SourceRecord(original_url=raw_url, title=str(citation.get("title") or "").strip() or None)
            key = raw_url
        if key in seen:
            continue
        seen.add(key)
        records.append(record)
        if len(records) >= max_sources:
            break
    return records


def _clean_title(value: str, fallback: str) -> str:
    title = html.unescape(str(value or ""))
    title = _HTML_TAG_RE.sub(" ", title)
    title = re.sub(r"[\x00-\x1f\x7f\\`*_{}\[\]()<>#!|]", " ", title)
    title = re.sub(r"\s+", " ", title).strip()
    safe_fallback = re.sub(r"[^A-Za-z0-9 ._-]", " ", str(fallback or "Web source"))
    return (title or safe_fallback.strip() or "Web source")[:240]


def _merge_source_evidence(
    results: list[ValidationResult],
    raw_citations: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, int]]:
    metadata: dict[str, dict[str, Any]] = {}
    for citation in raw_citations:
        raw = str(citation.get("uri") or "").strip()
        if not raw:
            continue
        entry = metadata.setdefault(raw, {"claim_ids": [], "claim_texts": [], "title": ""})
        entry["claim_ids"].extend(citation.get("claim_ids") or [])
        entry["claim_texts"].extend(citation.get("claim_texts") or [])
        if not entry["title"]:
            entry["title"] = str(citation.get("title") or "").strip()

    checked_at = datetime.now(timezone.utc).isoformat()
    valid_by_final: dict[str, dict[str, Any]] = {}
    by_original: dict[str, dict[str, Any]] = {}
    states: Counter[str] = Counter()
    ordered: list[dict[str, Any]] = []

    for result in results:
        states[result.state.value] += 1
        raw = result.source.original_url
        meta = metadata.get(raw, {})
        final_url = str(result.final_url or "")
        is_secure_valid = bool(result.is_valid and final_url.startswith("https://"))
        if not is_secure_valid:
            continue
        existing = valid_by_final.get(final_url)
        if existing is None:
            domain = (urlsplit(final_url).hostname or "").lower()
            authority = result.final_authority.value
            existing = {
                "source_type": "deep_research_web",
                "source_id": "",
                "title": _clean_title(meta.get("title") or result.source.title or "", domain or "Web source"),
                "publisher": domain,
                "domain": domain,
                "url": final_url,
                "canonical_url": final_url,
                "authority_tier": authority,
                "authority_label": _AUTHORITY_LABELS.get(authority, "Other web source"),
                "validation_status": "valid",
                "validated_at": checked_at,
                "http_status": result.status_code,
                "mime_type": result.mime_type,
                "redirect_count": max(0, len(result.redirect_chain) - 1),
                "claim_ids": [],
                "claim_texts": [],
            }
            valid_by_final[final_url] = existing
            ordered.append(existing)
        existing["claim_ids"].extend(meta.get("claim_ids") or [])
        existing["claim_texts"].extend(meta.get("claim_texts") or [])
        by_original[raw] = existing

    for source in ordered:
        source["claim_ids"] = list(dict.fromkeys(str(v) for v in source["claim_ids"] if v))
        source["claim_texts"] = list(dict.fromkeys(str(v)[:500] for v in source["claim_texts"] if v))[:12]
    ordered.sort(key=lambda item: (_AUTHORITY_ORDER.get(item["authority_tier"], 99), item["domain"], item["title"]))
    for index, source in enumerate(ordered, 1):
        source["source_id"] = f"S{index}"
    return ordered, by_original, dict(states)


def _decoded_page(result: ValidationResult) -> str:
    if not result.body_sample:
        return ""
    decoded = result.body_sample[:_MAX_QUOTE_PAGE_BYTES].decode("utf-8", errors="replace")
    decoded = re.sub(r"(?is)<(?:script|style)\b[^>]*>.*?</(?:script|style)>", " ", decoded)
    decoded = re.sub(r"(?s)<[^>]+>", " ", decoded)
    return re.sub(r"\s+", " ", html.unescape(decoded)).strip()


def _verify_quotes_bounded(quotes: list[str], pages: dict[str, str]) -> dict[str, Any]:
    if not quotes:
        return {"status": "no_quote", "checked": 0, "verified": 0, "unverified": []}
    normalized_pages = [
        re.sub(r"\s+", " ", text).strip().casefold()
        for text in pages.values()
        if text
    ]
    if pages and not normalized_pages:
        return {
            "status": "unchecked",
            "checked": len(quotes),
            "verified": 0,
            "unverified": [],
        }
    unverified: list[str] = []
    verified = 0
    for quote in quotes:
        normalized_quote = re.sub(r"\s+", " ", quote).strip().casefold()
        if normalized_quote and any(normalized_quote in page for page in normalized_pages):
            verified += 1
        else:
            unverified.append(quote)
    status = "verified" if verified and not unverified else "partially_verified" if verified else "unverified"
    return {
        "status": status,
        "checked": len(quotes),
        "verified": verified,
        "unverified": unverified,
    }


def _verify_finding_quotes(
    findings: list[dict[str, Any]],
    results: list[ValidationResult],
    by_original: dict[str, dict[str, Any]],
) -> tuple[int, int]:
    page_by_original = {
        result.source.original_url: _decoded_page(result)
        for result in results
        if result.is_valid
    }
    checked = confirmed = 0
    for finding in findings:
        valid_citations = [
            by_original[raw]
            for raw in (str(c.get("uri") or "") for c in finding.get("citations") or [])
            if raw in by_original
        ]
        # Identity de-duplication keeps one source object per canonical destination.
        finding["citations"] = list({id(item): item for item in valid_citations}.values())
        quotes = citation_verification.extract_quotes(str(finding.get("text") or ""))[
            :_MAX_QUOTES_PER_FINDING
        ]
        if not quotes:
            continue
        urls = list(
            dict.fromkeys(
                str(c.get("uri") or "")
                for c in finding.get("raw_citations") or []
                if c.get("uri")
            )
        )[:_MAX_QUOTE_SOURCES_PER_FINDING]
        pages = {url: page_by_original.get(url, "") for url in urls}
        verification = _verify_quotes_bounded(quotes, pages)
        finding["verification"] = verification
        checked += 1
        if verification.get("status") == "verified":
            confirmed += 1
    return checked, confirmed


def _validated_markdown_url(value: Any) -> str | None:
    url = str(value or "").strip()
    if not url or re.search(r"[\x00-\x20\x7f]", url):
        return None
    try:
        parsed = urlsplit(url)
    except ValueError:
        return None
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return None
    # Parentheses delimit Markdown destinations and must not be able to terminate this link.
    return url.replace("(", "%28").replace(")", "%29")


def _safe_answer_with_sources(
    answer: str,
    sources: list[dict[str, Any]],
    today: str,
    *,
    include_register: bool = True,
) -> tuple[str, list[dict[str, Any]]]:
    cleaned = str(answer or "").strip()
    section = _SOURCE_SECTION_RE.search(cleaned)
    if section:
        cleaned = cleaned[: section.start()].rstrip()
    # Deep output is untrusted live-web/model text. Strip every raw HTML tag before storage,
    # then remove every model-authored link; only the validated register below may be clickable.
    cleaned = _HTML_TAG_RE.sub("", cleaned)
    cleaned = _MARKDOWN_LINK_RE.sub(lambda match: match.group(1).strip() or "source", cleaned)
    cleaned = _RAW_URL_RE.sub("[unvalidated link removed]", cleaned).strip()
    # Character-drawn tables/diagrams the prompt forbids but a model may still
    # emit: rewrite them as Markdown so the STORED answer is clean for every
    # consumer (chat, DOCX/PDF export, merge), not just the React renderer.
    cleaned = normalize_ascii_layout(cleaned)

    candidates: dict[str, tuple[dict[str, Any], str, str, str, str]] = {}
    for source in sources:
        url = _validated_markdown_url(source.get("canonical_url"))
        source_id = str(source.get("source_id") or "").strip().upper()
        if not url or not re.fullmatch(r"S[1-9]\d{0,3}", source_id):
            continue
        domain = (urlsplit(url).hostname or "").lower()
        title = _clean_title(source.get("title") or "", domain or "Web source")
        authority = _clean_title(
            source.get("authority_label") or "",
            "Validated web source",
        )
        safe_source = dict(source)
        safe_source.update(
            {
                "source_type": "deep_research_web",
                "source_id": source_id,
                "title": title,
                "publisher": domain,
                "domain": domain,
                "url": url,
                "canonical_url": url,
                "authority_label": authority,
                "validation_status": "valid",
            }
        )
        safe_source["claim_ids"] = [
            re.sub(r"[^A-Za-z0-9:_-]", "", str(value or ""))[:48]
            for value in source.get("claim_ids") or []
            if str(value or "").strip()
        ][:64]
        safe_source["claim_texts"] = [
            _HTML_TAG_RE.sub("", str(value or "")).strip()[:500]
            for value in source.get("claim_texts") or []
            if str(value or "").strip()
        ][:12]
        candidates[source_id] = (safe_source, url, domain, title, authority)

    def _replace_reference(match: re.Match) -> str:
        source_id = str(match.group(1) or "").upper()
        if source_id in candidates:
            return f"[{source_id}]"
        return "[unverified source removed]"

    cleaned = _SOURCE_REFERENCE_RE.sub(_replace_reference, cleaned)
    used_ids = list(
        dict.fromkeys(
            match.group(1).upper()
            for match in _SOURCE_REFERENCE_RE.finditer(cleaned)
            if match.group(1).upper() in candidates
        )
    )

    source_lines: list[str] = []
    cited_sources: list[dict[str, Any]] = []
    for source_id in used_ids:
        safe_source, url, domain, title, authority = candidates[source_id]
        cited_sources.append(safe_source)
        source_lines.append(
            f"- **[{source_id}]** [{title}]({url}) — {authority} · {domain}"
        )
    if not source_lines or not include_register:
        return cleaned, cited_sources

    lines = ["## Validated sources", *source_lines]
    lines.append(f"\n*Links checked and research current as of {today}.*")
    return f"{cleaned}\n\n" + "\n".join(lines), cited_sources


async def _synthesize(
    deadline: DeepResearchDeadline,
    budget: BudgetTracker,
    cfg: DeepResearchConfig,
    *,
    prompt: str,
) -> AsyncGenerator[tuple[str, Any], None]:
    """Stream bounded raw snapshots, then yield one settled final result payload."""

    cap, reservation = _reserve_call(
        budget,
        model=cfg.synthesis_model,
        prompt=prompt,
        configured_output_tokens=cfg.max_output_tokens,
        minimum_output_tokens=_MIN_SYNTHESIS_OUTPUT_TOKENS,
        label="Synthesis",
    )
    parts: list[str] = []
    input_tokens = output_tokens = 0
    partial = False
    finish_reason = ""
    reservation_settled = False
    cost = 0.0
    next_preview_chars = 160
    last_preview_at = asyncio.get_running_loop().time()
    attempt = 0
    max_attempts = 1 + max(0, int(cfg.synthesis_timeout_retries))

    while attempt < max_attempts:
        attempt += 1
        stream = gemini.synthesis_stream(
            cfg.synthesis_model,
            prompt,
            temperature=cfg.synthesis_temperature,
            max_output_tokens=cap,
            thinking_level=cfg.synthesis_thinking_level,
            use_google_search=False,
        )
        provider_started = False
        retry_timeout = False

        def _mark_started() -> None:
            nonlocal provider_started
            provider_started = True

        try:
            while True:
                chunk = await _provider_call(
                    deadline,
                    lambda: next(stream, None),
                    stage="synthesis",
                    timeout_s=cfg.stage_timeout_s,
                    on_started=_mark_started,
                )
                if chunk is None:
                    break
                delta, chunk_input, chunk_output = gemini.chunk_text_and_usage(chunk)
                reason = gemini.chunk_finish_reason(chunk)
                if reason:
                    finish_reason = reason
                if chunk_input:
                    input_tokens = chunk_input
                if chunk_output:
                    output_tokens = chunk_output
                if delta:
                    parts.append(delta)
                    snapshot = "".join(parts)
                    loop_now = asyncio.get_running_loop().time()
                    if len(snapshot) >= next_preview_chars or loop_now - last_preview_at >= 0.2:
                        yield "preview", snapshot
                        next_preview_chars = len(snapshot) + max(160, len(snapshot) // 32)
                        last_preview_at = loop_now
        except (asyncio.CancelledError, GeneratorExit, DeepResearchTimeout, TimeoutError) as exc:
            if provider_started:
                _settle_reservation_maximum(
                    budget,
                    reservation,
                    label=f"Synthesis attempt {attempt}",
                    reason=type(exc).__name__,
                )
            else:
                _cancel_reservation_safely(budget, reservation)
            raise
        except Exception as exc:
            partial = bool(parts)
            retry_timeout = (
                isinstance(exc, httpx.ReadTimeout)
                and not partial
                and attempt < max_attempts
            )
            logger.warning(
                "[DeepResearch] synthesis stream failed attempt=%d/%d error=%s retry=%s",
                attempt,
                max_attempts,
                type(exc).__name__,
                retry_timeout,
            )
            if provider_started:
                cost = _settle_reservation_maximum(
                    budget,
                    reservation,
                    label=f"Synthesis attempt {attempt}",
                    reason=type(exc).__name__,
                )
                reservation_settled = True
            else:
                _cancel_reservation_safely(budget, reservation)
            if not partial and not retry_timeout:
                raise
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                try:
                    close()
                except (RuntimeError, ValueError):
                    pass

        if not retry_timeout:
            break

        deadline.check(stage="synthesis_retry")
        # Preserve report quality on retries: use the identical prompt, model,
        # thinking level, and output cap. Conservatively settle the timed-out call,
        # then require enough budget for another full-cap attempt.
        cap, reservation = _reserve_call(
            budget,
            model=cfg.synthesis_model,
            prompt=prompt,
            configured_output_tokens=cap,
            minimum_output_tokens=cap,
            label=f"Synthesis retry {attempt}",
        )
        reservation_settled = False
        await asyncio.sleep(min(1.0, deadline.remaining_s))

    if not reservation_settled:
        if _usage_exceeds_reservation(reservation, input_tokens, output_tokens):
            _settle_reservation_maximum(
                budget,
                reservation,
                label="Synthesis",
                reason="provider_reported_usage_exceeded_reservation",
            )
            raise BudgetExceededError(
                required_inr=reservation.reserved_inr,
                available_inr=budget.remaining_inr,
                label="Synthesis provider usage exceeded its reservation",
            )
        try:
            cost = budget.add(
                cfg.synthesis_model,
                input_tokens,
                output_tokens,
                label="Synthesis",
                reservation=reservation,
            )
        except BaseException:
            _cancel_reservation_safely(budget, reservation)
            raise
        _record_usage(cfg.synthesis_model, input_tokens, output_tokens, "Synthesis")
    logger.info(
        "[DeepResearch] synthesis model=%s cap=%d in=%d out=%d cost=₹%.2f finish=%s",
        cfg.synthesis_model,
        cap,
        input_tokens,
        output_tokens,
        cost,
        finish_reason or "unknown",
    )
    answer = "".join(parts).strip()
    if not answer:
        raise RuntimeError("Deep Research synthesis returned no report content")
    if finish_reason and finish_reason != "STOP":
        partial = True
    yield "result", (answer, partial)


async def _run_impl(
    *,
    question: str,
    document_context: str,
    session_id: str,
    on_result: Callable | None,
    cfg: DeepResearchConfig,
    budget: BudgetTracker,
    deadline: DeepResearchDeadline,
    run_id: str,
) -> AsyncGenerator[str, None]:
    now = datetime.now()
    today = f"{now.day} {now:%B %Y}"
    yield events.status(
        "researching",
        f"Deep Research started · configured application budget ₹{cfg.budget_inr:.0f}",
        run_id=run_id,
        phase="planning",
        budget_inr=cfg.budget_inr,
        spent_inr=budget.spent_inr,
    )

    plan_prompt = prompts.planner(
        question,
        cfg.max_rounds,
        # The planner is a NON-grounded call, and synthesis already sends this same case
        # text to the same provider, so withholding it here bought no privacy — it only
        # left the planner blind. Without it, "give me citations for this case" reads as a
        # question about nothing: the planner triaged it as chat and asked the user for a
        # case name that was sitting in the uploaded file. Grounded queries stay protected
        # by _redact_grounded_text(), which strips private identifiers from the question
        # and from every sub-question before any of them reach Google.
        document_context,
        cfg.plan_context_chars,
        today,
    )
    try:
        plan_text = await _reason_call(
            deadline,
            budget,
            cfg,
            model=cfg.reasoning_model,
            prompt=plan_prompt,
            max_output_tokens=4_096,
            min_output_tokens=_MIN_PLAN_OUTPUT_TOKENS,
            temperature=0.1,
            thinking_level=cfg.reasoning_thinking_level,
            label="Plan",
            keep_back_inr=cfg.synthesis_reserve_inr,
        )
    except (DeepResearchTimeout, BudgetError):
        raise
    except Exception as exc:
        logger.warning("[DeepResearch] planning failed: %s", type(exc).__name__)
        plan_text = ""

    mode, chat_reply, queue = _parse_triage(
        plan_text,
        question,
        cfg.max_rounds,
        has_case_context=bool(str(document_context or "").strip()),
    )
    if mode == "chat":
        raw_chat = chat_reply or "Hello! Ask me a question you would like researched on the live web."
        answer, _unused_sources = _safe_answer_with_sources(raw_chat, [], today)
        yield events.chunk(answer, replace=True)
        if on_result is not None:
            await on_result(answer, [])
        report.log_usage_table(budget, cfg, rounds=0, session_id=session_id, answer_length=len(answer), sources=0)
        yield events.done(
            session_id=session_id,
            method="deep_research",
            routing_decision="deep_research_chat",
            answer=answer,
            citations=[],
            used_chunk_ids=[],
            run_id=run_id,
            result_status="complete",
            deep_research=budget.summary() | {"rounds": 0, "mode": "chat", "result_status": "complete"},
        )
        return

    yield events.thinking(
        f"Mode: {mode} · planned {len(queue)} bounded web-search round(s).",
        run_id=run_id,
        phase="planning",
        max_rounds=cfg.max_rounds,
    )
    grounded_question = _redact_grounded_text(question, document_context)
    if not grounded_question:
        grounded_question = "Research the question without using private identifiers."

    answer_context = document_context if mode == "legal" else ""
    findings: list[dict[str, Any]] = []
    all_citations: list[dict[str, Any]] = []
    round_no = 0

    while queue and round_no < cfg.max_rounds:
        raw_sub_question = queue.pop(0)
        sub_question = _redact_grounded_text(raw_sub_question, document_context)
        sub_question = sub_question or grounded_question
        label = f"Round {round_no + 1} search"
        round_prompt = prompts.round_search(
            grounded_question,
            sub_question,
            findings,
            "",  # private case text never enters a Google-grounded call
            cfg.round_context_chars,
            today,
            mode,
        )
        try:
            text, citations = await _search_call(
                deadline,
                budget,
                cfg,
                prompt=round_prompt,
                label=label,
            )
        except BudgetExceededError:
            yield events.thinking(
                "The remaining budget is reserved for synthesis; no further searches will run.",
                run_id=run_id,
                phase="search",
                round=round_no,
                spent_inr=round(budget.spent_inr, 2),
                budget_inr=cfg.budget_inr,
            )
            break
        except DeepResearchTimeout:
            raise
        except Exception as exc:
            logger.warning("[DeepResearch] %s failed: %s", label, type(exc).__name__)
            yield events.thinking(
                f"{label} could not complete; continuing with available evidence.",
                run_id=run_id,
                phase="search",
                round=round_no + 1,
            )
            continue

        citations = _scope_grounding_citations(citations, round_no + 1)
        round_no += 1
        finding = {
            "query": sub_question,
            "text": text,
            "citations": citations,
            "raw_citations": citations,
        }
        findings.append(finding)
        all_citations.extend(citations)
        yield events.status(
            "researching",
            f"Deep research round {round_no}/{cfg.max_rounds} complete",
            run_id=run_id,
            phase="search",
            round=round_no,
            max_rounds=cfg.max_rounds,
            sources_found=len(all_citations),
            spent_inr=round(budget.spent_inr, 2),
            budget_inr=cfg.budget_inr,
        )

        if round_no >= cfg.max_rounds:
            break
        gap_prompt = prompts.gap_check(grounded_question, findings, round_no, cfg.max_rounds, mode)
        try:
            gap_text = await _reason_call(
                deadline,
                budget,
                cfg,
                model=cfg.reasoning_model,
                prompt=gap_prompt,
                max_output_tokens=2_048,
                min_output_tokens=_MIN_GAP_OUTPUT_TOKENS,
                temperature=0.0,
                thinking_level=cfg.reasoning_thinking_level,
                label=f"Round {round_no} gap-check",
                keep_back_inr=cfg.synthesis_reserve_inr,
            )
        except BudgetExceededError:
            break
        except DeepResearchTimeout:
            raise
        except Exception:
            gap_text = "DONE"
        follow_up = _parse_gap(gap_text)
        if not follow_up:
            break
        queue.append(follow_up)

    yield events.status(
        "validating_sources",
        "Validating source destinations, content types, and quoted passages…",
        run_id=run_id,
        phase="source_validation",
        sources_found=len(all_citations),
    )
    records = _source_records(all_citations, cfg.max_sources)
    validator = SourceValidator(
        config=SourceValidationConfig(
            max_redirects=cfg.source_max_redirects,
            max_response_bytes=cfg.source_max_bytes,
            fetch_body_sample=True,
            max_sources_per_call=cfg.max_sources,
            max_concurrency=cfg.source_concurrency,
            max_retries=1,
            request_timeout_s=min(cfg.source_timeout_s, 8.0),
            dns_timeout_s=min(cfg.source_timeout_s, 3.0),
            total_timeout_s=cfg.source_timeout_s,
        )
    )
    validation_results: list[ValidationResult] = []
    if records:
        validation_results = await deadline.wait_for(
            validator.validate_many(records, concurrency=cfg.source_concurrency),
            stage="source_validation",
            timeout_s=cfg.stage_timeout_s,
        )
    sources, by_original, validation_states = _merge_source_evidence(validation_results, all_citations)
    try:
        quote_checks, quote_confirmed = await deadline.wait_for(
            asyncio.to_thread(
                _verify_finding_quotes, findings, validation_results, by_original
            ),
            stage="quote_verification",
            timeout_s=min(cfg.stage_timeout_s, 30.0),
        )
    except DeepResearchTimeout:
        if deadline.expired:
            raise
        logger.warning("[DeepResearch] bounded quote verification timed out; continuing")
        quote_checks = quote_confirmed = 0
    rejected_sources = len(validation_results) - len(sources)
    yield events.status(
        "synthesizing",
        f"Validated {len(sources)} source(s); synthesizing the report…",
        run_id=run_id,
        phase="synthesis",
        sources_found=len(records),
        sources_validated=len(sources),
        sources_rejected=max(0, rejected_sources),
        spent_inr=round(budget.spent_inr, 2),
        budget_inr=cfg.budget_inr,
    )

    synthesis_prompt = prompts.synthesis(
        question,
        findings,
        answer_context,
        cfg.synth_context_chars,
        today,
        mode,
    )
    raw_answer = ""
    synthesis_partial = True
    last_preview = ""
    async for item_type, payload in _synthesize(
        deadline,
        budget,
        cfg,
        prompt=synthesis_prompt,
    ):
        if item_type == "preview":
            preview, _preview_sources = _safe_answer_with_sources(
                str(payload or ""), sources, today, include_register=False
            )
            if preview and preview != last_preview:
                yield events.chunk(preview, replace=True)
                last_preview = preview
        elif item_type == "result":
            raw_answer, synthesis_partial = payload
    if not raw_answer:
        raise RuntimeError("Deep Research synthesis ended without a final result")
    answer, cited_sources = _safe_answer_with_sources(raw_answer, sources, today)
    result_status = "partial" if synthesis_partial or not cited_sources else "complete"
    # Reconcile the live preview with the final server-sanitized, citation-checked report.
    yield events.chunk(answer, replace=True)

    report.log_usage_table(
        budget,
        cfg,
        rounds=round_no,
        session_id=session_id,
        answer_length=len(answer),
        sources=len(cited_sources),
    )
    if on_result is not None and answer:
        await on_result(answer, cited_sources)

    deep_summary = budget.summary() | {
        "rounds": round_no,
        "mode": mode,
        "run_id": run_id,
        "result_status": result_status,
        "sources_discovered": len(records),
        "sources_validated": len(sources),
        "sources_rejected": max(0, rejected_sources),
        "source_validation_states": validation_states,
        "sources_cited": len(cited_sources),
        "quote_checks": quote_checks,
        "quotes_confirmed": quote_confirmed,
        "elapsed_s": round(deadline.elapsed_s, 3),
    }
    yield events.done(
        session_id=session_id,
        method="deep_research",
        routing_decision="deep_research_agent",
        answer=answer,
        citations=cited_sources,
        used_chunk_ids=[],
        run_id=run_id,
        result_status=result_status,
        deep_research=deep_summary,
    )


async def run_deep_research(
    *,
    question: str,
    document_context: str,
    session_id: str,
    llm_config: dict | None = None,
    on_result=None,
) -> AsyncGenerator[str, None]:
    """Run one bounded Deep Research job and emit stable SSE events."""

    cfg = DeepResearchConfig.from_settings(get_settings(), llm_config)
    budget = _new_budget(cfg)
    run_id = str(uuid.uuid4())
    clean_question = str(question or "").strip()
    if not clean_question:
        yield events.error("Deep Research needs a question.", code="deep_research_invalid_question")
        return
    if not gemini.client_available(
        cfg.reasoning_model,
        cfg.search_model,
        cfg.synthesis_model,
    ):
        yield events.error(
            "Deep Research is unavailable because its model provider is not configured.",
            code="deep_research_unavailable",
            retryable=False,
        )
        return

    runtime = _runtime_for(cfg)
    try:
        async with runtime.run(
            queue_timeout_s=cfg.queue_timeout_s,
            run_timeout_s=cfg.run_timeout_s,
        ) as deadline:
            async for event in _run_impl(
                question=clean_question,
                document_context=document_context,
                session_id=session_id or "",
                on_result=on_result,
                cfg=cfg,
                budget=budget,
                deadline=deadline,
                run_id=run_id,
            ):
                yield event
    except asyncio.CancelledError:
        logger.info("[DeepResearch] run cancelled run_id=%s", run_id)
        raise
    except DeepResearchBusy as exc:
        yield events.error(
            "Deep Research is currently at capacity. Please retry shortly.",
            code=exc.code,
            retryable=True,
            run_id=run_id,
        )
    except DeepResearchTimeout as exc:
        yield events.error(
            "Deep Research exceeded its execution deadline before a reliable report was ready.",
            code=exc.code,
            retryable=True,
            run_id=run_id,
            stage=exc.stage,
        )
    except (UnknownPricingError, BudgetExceededError) as exc:
        logger.warning("[DeepResearch] budget preflight failed run_id=%s error=%s", run_id, type(exc).__name__)
        yield events.error(
            "Deep Research could not start the next step within its configured application budget.",
            code="deep_research_budget_exhausted",
            retryable=False,
            run_id=run_id,
            deep_research=budget.summary(),
        )
    except Exception as exc:
        logger.exception("[DeepResearch] run failed run_id=%s type=%s", run_id, type(exc).__name__)
        yield events.error(
            "Deep Research could not complete safely. Please retry.",
            code="deep_research_failed",
            retryable=True,
            run_id=run_id,
        )


__all__ = ["run_deep_research"]
