from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
import logging
import re
import time
import uuid

from datetime import datetime
from pathlib import PurePosixPath
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Body, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.legal_case_management.agent import (
    answer_case_folder_chat,
    create_case_folder,
    create_case_with_folder,
    delete_case_tool,
    enqueue_case_documents,
    extract_case_fields_from_case_folder,
    get_case_chronology,
    get_case_detail,
    list_documents_in_case_folder,
    get_case_processing_status,
    list_case_folders,
    list_cases_tool,
    store_case_documents,
    update_case_tool,
)
from app.schemas.contracts import (
    DocumentReference,
    FolderChatRequest,
    LearningQuestionAnswerPayload,
    LearningQuestionGeneratePayload,
)
from app.core.config import get_settings
from app.services.container import get_folder_service
from app.services.adapters import gcs
from app.services.adapters import google_drive_tool
from app.services.db import get_db_connection, is_db_available
from app.services.llm_chat_config import (
    get_llm_chat_config,
    get_request_upload_ceiling_mb,
    get_streaming_delay_ms,
    merge_folder_chat_request_llm_overrides,
)
from app.services.legal_system_prompt import build_document_qa_system_prompt, build_legal_system_prompt, fetch_full_profile
from app.services.learning_agent_controller import LearningAgentController
from app.services.learning_folder_document_context import build_learning_folder_document_context
from app.services.learning_question_validator import sanitize_public_popup
from app.services.learning_response_parser import parse_learning_model_output
from app.services.llm_policy_service import assert_upload_allowed, assert_storage_allowed
from app.services.secret_manager_api import get_secret_prompt_detail, list_secret_prompts
from app.services.secret_prompt_display import (
    post_process_secret_prompt_response,
    resolve_query_and_display,
    resolve_secret_prompt_llm_name,
)
from app.services.token_usage import (
    enforce_limits,
    estimate_streaming_token_request,
    estimate_tokens_from_text,
    log_llm_usage,
)
from app.services.token_usage_log import (
    begin_token_usage_session,
    bind_token_usage_session,
    flush_aggregated_token_usage_table,
    log_draft_token_usage,
    record_token_usage,
    unbind_token_usage_session,
    usage_entry_count,
)


router = APIRouter(prefix="/api/files", tags=["files"])
logger = logging.getLogger("agentic_document_service.api.files")


_DEEP_RESEARCH_META_CITATION: dict[str, Any] = {
    "source_type": "deep_research_meta",
    "deep_research": True,
    "method": "deep_research",
    "schema_version": 1,
}


def _bounded_int(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        parsed = default
    return min(maximum, max(minimum, parsed))


def _estimate_deep_research_token_request(
    question_text: str = "",
    *,
    llm_config: dict[str, Any] | None = None,
    max_rounds: int = 4,
) -> dict[str, int]:
    """Conservative firm-cap admission estimate for the bounded Deep pipeline only."""
    normalized = str(question_text or "").strip()
    question_chars = len(normalized)
    question_tokens = max(1, (question_chars + 3) // 4)
    rounds = _bounded_int(max_rounds, default=4, minimum=1, maximum=8)
    config = llm_config if isinstance(llm_config, dict) else {}
    synthesis_output_tokens = _bounded_int(
        config.get("max_summarization_output_tokens")
        or config.get("max_output_tokens")
        or 32_768,
        default=32_768,
        minimum=4_096,
        maximum=32_768,
    )

    plan_output_tokens = 4_096
    search_output_tokens = min(synthesis_output_tokens, 8_192)
    gap_output_tokens = 2_048

    # These reserves mirror the hard Deep context bounds and allow for each stage's
    # static instructions. Findings can grow by one full search output per round.
    estimated_input_tokens = question_tokens + 1_500 + 2_048
    estimated_output_tokens = plan_output_tokens
    for round_index in range(rounds):
        prior_findings_tokens = round_index * search_output_tokens
        estimated_input_tokens += (
            question_tokens
            + prior_findings_tokens
            + 512  # planned sub-question
            + 2_048  # search-stage instructions
        )
        estimated_output_tokens += search_output_tokens
        if round_index < rounds - 1:
            current_findings_tokens = (round_index + 1) * search_output_tokens
            estimated_input_tokens += question_tokens + current_findings_tokens + 1_024
            estimated_output_tokens += gap_output_tokens

    estimated_input_tokens += (
        question_tokens
        + (rounds * search_output_tokens)
        + 3_000  # 12,000-character private synthesis context
        + 4_096  # synthesis-stage instructions
    )
    estimated_output_tokens += synthesis_output_tokens

    stage_tokens = estimated_input_tokens + estimated_output_tokens
    safety_reserve_tokens = max(2_048, (stage_tokens + 9) // 10)
    return {
        "question_chars": question_chars,
        "max_rounds": rounds,
        "estimated_input_tokens": int(estimated_input_tokens),
        "estimated_output_tokens": int(estimated_output_tokens),
        "safety_reserve_tokens": int(safety_reserve_tokens),
        "estimated_total_tokens": int(stage_tokens + safety_reserve_tokens),
    }


def _deep_research_persistence_citations(citations: list[Any] | None) -> list[Any]:
    """Append one durable mode marker without mutating the emitted source list."""
    persisted = list(citations or [])
    has_marker = any(
        isinstance(citation, dict)
        and citation.get("source_type") == "deep_research_meta"
        and citation.get("deep_research") is True
        for citation in persisted
    )
    if not has_marker:
        persisted.append(dict(_DEEP_RESEARCH_META_CITATION))
    return persisted


def _build_learning_citations_from_chunks(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for ch in chunks[:8]:
        meta = ch.get("metadata") or {}
        snippet = str(ch.get("content") or "").strip()
        if len(snippet) > 220:
            snippet = f"{snippet[:220]}..."
        citations.append(
            {
                "source_id": str(ch.get("source_id") or ch.get("chunk_id") or "").strip(),
                "doc_id": str(meta.get("document_name") or ch.get("document_name") or "document").strip(),
                "page": ch.get("page_number"),
                "text_snippet": snippet,
                "pincite": f"Para {int(ch.get('metadata', {}).get('chunk_index') or 0) + 1}" if ch.get("metadata") else "",
            }
        )
    return citations


_COMPREHENSIVE_QUERY_KEYWORDS = (
    "summary", "summarize", "summarise", "summaries", "summarization", "summarisation",
    "comprehensive", "detailed", "in detail", "in-depth", "in depth", "overview",
    "elaborate", "thorough", "exhaustive", "everything", "entire case", "whole case",
    "full summary", "full detail", "full details", "full overview", "full picture",
    "complete summary", "complete overview", "list all", "all events", "all the events",
    "all data", "all the data", "all facts", "all details", "all dates", "all documents",
    "all information", "all the information", "all points", "key points",
)


def _is_comprehensive_query(query: str) -> bool:
    """True when the question wants a broad / whole-case answer (summary, all events,
    detailed overview, "list all data in a table", etc.). Such questions keep the FULL
    document context instead of focused chunks, so the answer can cover the entire case."""
    q = (query or "").lower()
    if any(kw in q for kw in _COMPREHENSIVE_QUERY_KEYWORDS):
        return True
    # Breadth signal + a content noun, in ANY word order — catches phrasings the keyword
    # list misses, e.g. "list of data and event all in tabular format".
    breadth = any(w in q for w in ("all", "every", "each", "tabular", "table", "list of", "list the", "list out"))
    content = any(n in q for n in ("data", "event", "detail", "fact", "point", "date",
                                   "document", "information", "record", "proceeding",
                                   "timeline", "chronolog", "history", "part"))
    return breadth and content


# Deep/extreme tier: a STRONGER signal than comprehensive. These route to the multi-pass
# generator (outline -> per-section expansion) for an exhaustive, report-style answer.
_DEEP_QUERY_KEYWORDS = (
    "deep analysis", "deep-dive", "deep dive", "deeply analyze", "deeply analyse",
    "extreme detail", "extremely detailed", "exhaustive analysis", "exhaustive report",
    "in-depth analysis", "in depth analysis", "detailed report", "full report",
    "comprehensive report", "complete report", "deep report", "thorough analysis",
    "detailed analysis", "extensive analysis", "extensive report", "section by section",
    "section-by-section", "as detailed as possible", "maximum detail", "leave no detail",
    "everything in detail", "extreme depth", "extremely deep", "deep legal analysis",
)


def _find_numbered_headings(text: str) -> list:
    """Match top-level numbered headings, newline- AND markdown-tolerant: '1. ', '2) ',
    '**1. ...**', '### 1. ...', '> 1. ...', '- 1. ...', indented, up to 3-digit numbers.
    Used by _is_deep_query to count a prompt's explicit numbered sections — a long, highly
    structured prompt signals an extreme/exhaustive report ask."""
    import re
    return list(re.finditer(r"(?m)^[ \t>#*\-]*(\d{1,3})[.)]\s+(.+?)\*{0,2}\s*$", text or ""))


def _is_deep_query(query: str) -> bool:
    """True for EXTREME / exhaustive report asks (a strict escalation of comprehensive).
    These route to a single full-document deep call with a no-ceiling, follow-the-user's-
    structure prompt. Implies comprehensive (full document + temperature bump)."""
    q = (query or "").lower()
    if any(kw in q for kw in _DEEP_QUERY_KEYWORDS):
        return True
    # intensity word + an analysis/report noun, in ANY order.
    intensity = any(w in q for w in ("deep", "extreme", "exhaustive", "extensive", "exhaustively"))
    artefact = any(n in q for n in ("analysis", "analyse", "analyze", "report", "breakdown",
                                    "study", "review", "assessment", "dossier", "brief"))
    if intensity and artefact:
        return True
    # A prompt that enumerates many numbered sections IS a structured multi-part brief — treat it
    # as deep regardless of length. A concise 14-point ask (<1500 chars) must still get the deep,
    # no-ceiling, completion-contract path, not the comprehensive prompt's "1,200-2,500 word" cap.
    if len(_find_numbered_headings(query or "")) >= 6:
        return True
    # Long, explicitly-structured prompts (e.g. a multi-section court-ready brief with many
    # tables) are extreme even without an intensity word — route them to the deep call too.
    if len(query or "") > 1500:
        n_sections = len(_find_numbered_headings(query or ""))
        n_tables = q.count("| ---") + q.count("|---") + q.count("create a table") + q.count("table:")
        cues = any(c in q for c in ("court-ready", "court ready", "litigation intelligence",
                                    "stress test", "claim verification", "red-team", "red team",
                                    "hallucination trap", "exact structure", "page reference"))
        if n_sections >= 4 or n_tables >= 3 or cues:
            return True
    return False


# Pure social / greeting tokens — a message made ENTIRELY of these needs no document context.
_GREETING_WORDS = {
    "hi", "hii", "hiii", "hey", "heya", "hello", "helo", "hlo", "yo", "sup", "hola",
    "namaste", "namaskar", "gm", "gn", "good", "morning", "afternoon", "evening", "night",
    "greetings", "thanks", "thank", "thankyou", "thx", "ty", "tysm", "welcome",
    "ok", "okay", "okey", "cool", "nice", "great", "awesome", "fine", "alright",
    "how", "are", "you", "u", "doing", "hru", "howdy", "there",
    "yes", "no", "yeah", "yep", "nope", "hmm", "test", "testing", "ping",
}


def _is_trivial_query(query: str) -> bool:
    """True for greetings / chit-chat that need NO document context (e.g. 'hi', 'hello',
    'good morning', 'how are you', 'thanks'). Conservative: only fires when the message is short
    AND every word is a known social token — so a real question is never starved of context."""
    import re
    q = (query or "").strip().lower()
    if not q:
        return True
    words = re.findall(r"[a-z']+", q)
    if not words or len(words) > 6:
        return False
    return all(w in _GREETING_WORDS for w in words)


def _doc_context_char_budget(
    query: str, *, learning_mode: bool, is_deep: bool, is_comprehensive: bool,
    model_name: str | None = None,
) -> int:
    """Dynamically size the document context to the QUESTION (relevance/speed over blind cost):
      - greeting / chit-chat   ->   8,000  (~3K tokens; barely any doc — 'hi' shouldn't load the case)
      - normal specific ask    ->  90,000  (~33K tokens; a focused slice for a narrow question)
      - comprehensive / broad  -> 260,000  (~95K tokens)
      - extreme / deep         -> 550,000  (~200K tokens; the whole doc even for large PDFs)
      - learning mode          -> 160,000  (unchanged)
    gemma-4's context WINDOW is ~262K tokens, but a free-tier key is rate-limited to only
    16,000 INPUT tokens/minute — so any tier above ~13K tokens 429s on Gemma no matter the
    window. When the answering model is Gemma, the budget is hard-capped to
    settings.gemma_max_context_chars (default 48K chars ≈ 12K tokens) so a single request stays
    under the per-minute quota. Raise GEMMA_MAX_CONTEXT_CHARS once billing lifts the ceiling."""
    if learning_mode:
        budget = 160000
    elif _is_trivial_query(query):
        budget = 8000
    elif is_deep:
        budget = 550000
    elif is_comprehensive:
        budget = 260000
    else:
        budget = 90000
    try:
        from app.services.adapters.document_ai import _is_gemma_model
        if _is_gemma_model(model_name):
            from app.core.config import get_settings
            cap = int(getattr(get_settings(), "gemma_max_context_chars", 48000) or 48000)
            if cap > 0:
                budget = min(budget, cap)
    except Exception:
        pass
    return budget


def _extract_template_text_sync(data: bytes, mime_type: str | None, filename: str | None) -> str:
    """Extract an uploaded draft TEMPLATE as plain text for injection into the prompt.

    gemma-4-31b-it does NOT accept PDF/image/file Parts on the Gemini Developer API
    (inline PDF -> 500; rasterized images / Files-API -> empty output — verified live,
    consistent with Google's own note that Gemma models are not served file/image input
    on this API). So the template is fed as TEXT. Prefer fast local extraction; fall back
    to the OCR adapter (Document AI) for scanned/empty PDFs.
    """
    from app.services.adapters.word import extract_word_text, is_word_filename, is_word_mime

    if is_word_mime(mime_type) or is_word_filename(filename or ""):
        return (extract_word_text(data, mime_type=mime_type, filename=filename) or "").strip()
    # Digital PDF templates extract instantly via pypdf. Prefer layout-mode extraction:
    # normal extract_text() can collapse a pleading cause title into one huge line and
    # then emit wrapped words one-per-line, which destroys section mapping. Layout mode
    # preserves the visible PDF line breaks the template actually uses.
    try:
        import io as _io
        import re as _re
        from pypdf import PdfReader  # type: ignore
        pages = PdfReader(_io.BytesIO(data)).pages
        layout_pages = []
        for page in pages:
            try:
                raw = page.extract_text(extraction_mode="layout") or ""
            except TypeError:
                raw = ""
            if raw.strip():
                cleaned_lines = []
                for line in raw.replace("\r", "\n").split("\n"):
                    stripped = _re.sub(r"[ \t]+", " ", line).strip()
                    cleaned_lines.append(stripped)
                layout_pages.append("\n".join(cleaned_lines).strip())
        layout_text = "\n\n".join(p for p in layout_pages if p).strip()
        if len(layout_text) > 40:
            return layout_text
        text = "\n".join((page.extract_text() or "") for page in pages).strip()
        if len(text) > 40:
            return text
    except Exception:
        pass
    # Fallback (scanned template / non-PDF): full OCR adapter.
    try:
        from app.services.adapters import ocr as _ocr
        return (_ocr.extract_text_from_bytes(data, mime_type or "application/pdf", filename or "template").text or "").strip()
    except Exception:
        return ""


# Section-heading keywords that mark a template's structure (recitals, schedules,
# signature/witness blocks, pleading blocks, etc.).
_SKELETON_KEYWORDS = re.compile(
    r"^(RECITALS?|WHEREAS|NOW\s+TH(IS|E)|DEFINITIONS?|SCHEDULE|ANNEXURE|APPENDIX|EXHIBIT|"
    r"IN\s+WITNESS\s+WHEREOF|SIGNATURE|SIGNED|WITNESS|VERIFICATION|AFFIDAVIT|PRAYER|"
    r"TESTIMONIUM|ARTICLE|CLAUSE|SECTION|PART)\b",
    re.IGNORECASE,
)
# A numbered / lettered clause line ("1. TERM", "(a) ...", "2) RENT").
_SKELETON_NUM_RE = re.compile(r"^\(?([0-9]{1,2}|[a-zA-Z])[.)]\s+(.+)$")


def _extract_template_skeleton(template_text: str, *, max_items: int = 45) -> list[str]:
    """Parse an ordered list of the template's own section/heading labels.

    Structure-first drafting (mirrors how a human drafter works): rather than hoping the
    model loosely imitates the template's layout, we hand it the template's explicit
    skeleton and require the draft to expand EVERY section, in order. Heuristic and
    lossless-optional — the model still has the full template (attached PDF or injected
    text); the skeleton is a completeness/ordering aid, so an imperfect parse cannot make
    the draft worse.
    """
    if not template_text:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for raw in template_text.replace("\r", "\n").split("\n"):
        line = raw.strip().strip("*").strip()
        if not line:
            continue
        label = ""
        m = _SKELETON_NUM_RE.match(line)
        if m:
            num, rest = m.group(1), m.group(2)
            head = re.split(r"[:.]", rest, 1)[0].strip()
            head = " ".join(head.split()[:8])
            label = f"{num}. {head}".strip() if head else f"{num}."
        elif len(line) <= 60:
            letters = [c for c in line if c.isalpha()]
            is_caps = bool(letters) and (sum(c.isupper() for c in letters) / len(letters)) > 0.8
            if (is_caps and len(line) > 2) or _SKELETON_KEYWORDS.match(line):
                label = " ".join(line.split()[:10])
        if not label:
            continue
        key = re.sub(r"\s+", " ", label.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(label)
        if len(out) >= max_items:
            break
    return out


# ── Draft pipeline: session-scoped fact-inventory cache ──────────────────────
# The Stage-B fact inventory depends only on the case's supporting documents, which
# don't change within a drafting session — so re-drafts / "make it longer" follow-ups
# reuse it and skip the single most expensive pipeline call. Keyed by a hash of the
# doc-set (ids + text lengths) so a NEW upload invalidates the entry automatically.
_DRAFT_FACTINV_CACHE: dict[str, str] = {}
_DRAFT_FACTINV_CACHE_MAX = 40

# Models a draft request may select, per role. Allowlisted so an arbitrary model string can
# never be injected through the request body. The DRAFT engine writes the sections; the
# STRUCTURE model maps the template (Stage A); the GUARDIAN audits/repairs the result
# (Stage D/E) — guardian and structure share the wider list (they are read/critique tasks,
# so the cheap flash models are legitimate choices there).
_DRAFT_ALLOWED_MODELS = {
    "gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-2.5-flash",
    "claude-opus-4-8", "claude-sonnet-5",
    "gemma-4-31b-it", "gemma-4-26b-a4b-it",
}
_STRUCTURE_ALLOWED_MODELS = _DRAFT_ALLOWED_MODELS
_GUARDIAN_ALLOWED_MODELS = _DRAFT_ALLOWED_MODELS

# Shown when a free-tier Gemma chat exhausts its per-minute input-token quota and the request
# can't be satisfied by waiting (see GemmaInputTPMExceeded). Actionable, not a raw 429 dump.
_GEMMA_INPUT_TPM_USER_MESSAGE = (
    "This question needs more of the case than the current free-tier model allows per minute "
    "(16,000 input tokens/min on Gemma). Try a narrower question, ask again in about a minute, "
    "switch the chat model, or enable billing to lift the limit."
)

# Shown when a Gemma comprehensive/deep NON-STREAM call runs past its (already generous) timeout.
# We deliberately do NOT chain a second generic-QA call after this: the timed-out call's executor
# thread cannot be cancelled and is still consuming the 16K/min input budget, so a second call would
# just stack on top and 429. A clean retry message is both honest and cheaper.
_GEMMA_SLOW_TIMEOUT_USER_MESSAGE = (
    "The free-tier model is responding slowly right now and this detailed answer ran past the time "
    "limit. Please try again in a minute (the free tier is throttled and can be temporarily "
    "overloaded), ask a narrower question, switch the chat model, or enable billing for faster, "
    "higher-priority responses."
)


def _draft_factinv_key(folder_name: str, user_id: Any, doc_texts: list[dict]) -> str:
    sig = "|".join(sorted(
        f"{d.get('file_id')}:{len(str(d.get('text') or ''))}" for d in (doc_texts or [])
    ))
    raw = f"{folder_name}::{user_id}::{sig}"
    return hashlib.sha256(raw.encode("utf-8", "ignore")).hexdigest()


def _draft_factinv_cache_put(key: str, value: str) -> None:
    if not key or not value:
        return
    _DRAFT_FACTINV_CACHE[key] = value
    while len(_DRAFT_FACTINV_CACHE) > _DRAFT_FACTINV_CACHE_MAX:
        try:
            del _DRAFT_FACTINV_CACHE[next(iter(_DRAFT_FACTINV_CACHE))]
        except StopIteration:
            break


def _split_text_for_sse_stream(text: str, *, max_chunk_chars: int = 48) -> list[str]:
    """Slice model output into small SSE chunks for incremental UI rendering.

    The slices preserve the EXACT original content — every space and newline — so
    the chunks, once concatenated by the client, equal the input verbatim. That is
    what keeps Markdown structure intact, especially tables (whose header, ``|---|``
    separator, and rows must each stay on their own line) when a table row is split
    across several stream deltas. We break on a nearby space/newline for nicer
    word-by-word streaming, but never add, drop, or collapse any character.

    Only for answers that arrive WHOLE (vector path / non-stream fallback — notably Gemma
    under GEMMA_DISABLE_STREAMING, whose reply lands in one piece). A live provider stream
    already emits its own deltas: never re-split those here, or the UI is paced twice.
    """
    text = text or ""
    if not text:
        return []
    if len(text) <= max_chunk_chars:
        return [text]
    chunks: list[str] = []
    i, n = 0, len(text)
    while i < n:
        end = min(i + max_chunk_chars, n)
        if end < n:
            # Prefer to cut at the last space/newline in the window so words and
            # table cells aren't split mid-token; fall back to a hard cut.
            cut = max(text.rfind(" ", i, end), text.rfind("\n", i, end))
            if cut > i:
                end = cut + 1
        chunks.append(text[i:end])
        i = end
    return chunks


def _gemini_chunk_text(chunk: Any) -> str:
    raw = getattr(chunk, "text", None)
    if raw is not None and str(raw).strip() != "":
        return str(raw)
    return ""


def _gemini_chunk_parts(chunk: Any) -> tuple[str, str]:
    """Split a streaming chunk into (answer_text, thought_text).

    gemma-4 streams its reasoning as content parts flagged ``thought=True``; the SDK's
    ``chunk.text`` EXCLUDES those, so a thought-only chunk looks empty and the stream loop would
    skip every chunk (never setting ``streamed``) and fall back to a non-stream dump. We read the
    parts directly: ``thought=True`` parts are surfaced as live 'thinking', the rest are the
    answer. Falls back to ``chunk.text`` when no parts are exposed (older response shape)."""
    answer: list[str] = []
    thought: list[str] = []
    try:
        for cand in (getattr(chunk, "candidates", None) or []):
            content = getattr(cand, "content", None)
            for part in (getattr(content, "parts", None) or []):
                t = getattr(part, "text", None)
                if not t:
                    continue
                if getattr(part, "thought", False):
                    thought.append(str(t))
                else:
                    answer.append(str(t))
    except Exception:
        pass
    if not answer and not thought:
        raw = getattr(chunk, "text", None)
        if raw:
            answer.append(str(raw))
    return "".join(answer), "".join(thought)


def _learning_case_excerpt_for_remediation(doc_texts: list[dict[str, Any]], *, max_chars: int = 48000) -> str:
    """Concatenate folder document text for the remediation agent (capped)."""
    parts: list[str] = []
    used = 0
    joiner = "\n\n---\n\n"
    for doc in doc_texts or []:
        name = str(doc.get("name") or "document").strip()
        text = str(doc.get("text") or "").strip()
        if not text:
            continue
        block = f"[Document: {name}]\n{text[:20000]}"
        extra = len(joiner) + len(block) if parts else len(block)
        if used + extra > max_chars:
            room = max_chars - used - (len(joiner) if parts else 0)
            if room > 400:
                parts.append(f"[Document: {name}]\n{text[: max(0, room - 30)]}")
            break
        parts.append(block)
        used += extra
    return joiner.join(parts)


async def _yield_text_as_streaming_chunks(
    sse_fn,
    text: str,
    *,
    delay_ms: int = 0,
) -> AsyncGenerator[str, None]:
    """Emit type=chunk SSE events; optional delay between chunks from summarization_chat_config.

    delay_ms is admin-configurable (llm_chat_config.get_streaming_delay_ms) and defaults to 0, i.e.
    no pacing — so callers that omit it behave exactly as if the parameter did not exist.
    """
    import asyncio

    for piece in _split_text_for_sse_stream(text):
        if piece:
            yield sse_fn({"type": "chunk", "text": piece})
        if delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000.0)


async def _stream_blocking_generator(loop, gen_factory, *, label: str) -> AsyncGenerator[str, None]:
    """
    Bridge a blocking token generator (Claude/DeepSeek SDK stream) into async.

    Runs the generator in a worker thread, pushes deltas through a queue, and
    coalesces whatever deltas are already waiting into a single yield so slow
    consumers get fewer, larger SSE frames instead of thousands of tiny ones.
    """
    import asyncio

    sentinel = object()
    queue: asyncio.Queue = asyncio.Queue()
    errors: list[str] = []
    done = False

    def _run() -> None:
        try:
            for piece in gen_factory():
                loop.call_soon_threadsafe(queue.put_nowait, piece)
        except Exception as exc:  # surfaced after drain below
            errors.append(str(exc))
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, sentinel)

    future = loop.run_in_executor(None, _run)
    while not done:
        piece = await queue.get()
        if piece is sentinel:
            break
        parts: list[str] = [piece] if piece else []
        while True:  # drain already-queued deltas into one frame
            try:
                nxt = queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if nxt is sentinel:
                done = True
                break
            if nxt:
                parts.append(nxt)
        if parts:
            yield "".join(parts)
    try:
        await future
    except Exception as exc:
        errors.append(str(exc))
    if errors:
        raise RuntimeError(f"{label}_stream_failed: {errors[0]}")


def _text_flag(value: Any) -> bool:
    """
    Parse folder_chats.used_secret_prompt — a TEXT column holding 'true'/'false'.
    bool('false') is True in Python, so a plain bool() cast misclassifies every
    custom question as a preset.
    """
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in ("true", "t", "1", "yes")


# Document-context character budgets sized to each provider's real context
# window (≈4 chars/token, leaving room for system prompt + question + output).
# A fixed small cap here silently drops document text and makes the model
# answer "Not mentioned in the document." for anything past the cutoff.
_PROVIDER_CONTEXT_CHAR_BUDGET = {
    "gemini": 800_000,   # ~200k tokens of a 1M-token window
    "claude": 600_000,   # ~150k tokens of a 200k-token window
    "deepseek": 380_000,  # ~95k tokens of a 128k-token window
    "kimi": 700_000,      # ~175k tokens of kimi-k2.6's 256k window (k3 holds 1M)
}


def _build_document_context(doc_texts: list[dict[str, Any]], char_limit: int) -> str:
    """
    Join document texts into one context block within char_limit.

    When the combined text exceeds the budget, every document receives a fair
    share (smaller documents donate unused allowance to larger ones) instead of
    the first document consuming the entire budget and later ones being dropped.
    """
    docs = [
        (str(d.get("name") or "document"), (d.get("text") or "").strip())
        for d in doc_texts or []
    ]
    docs = [(name, text) for name, text in docs if text]
    if not docs:
        return ""
    overhead = sum(len(f"[Document: {name}]\n") for name, _ in docs) + 7 * (len(docs) - 1)
    budget = max(0, char_limit - overhead)
    total = sum(len(text) for _, text in docs)
    allocations: dict[int, int] = {}
    if total <= budget:
        allocations = {i: len(text) for i, (_, text) in enumerate(docs)}
    else:
        remaining = budget
        # Smallest docs first: they fit whole and donate leftover share.
        pending = sorted(range(len(docs)), key=lambda i: len(docs[i][1]))
        while pending:
            share = remaining // len(pending)
            index = pending.pop(0)
            take = min(len(docs[index][1]), share)
            allocations[index] = take
            remaining -= take
    parts = [
        f"[Document: {name}]\n{text[: allocations[i]]}"
        for i, (name, text) in enumerate(docs)
        if allocations.get(i)
    ]
    return "\n\n---\n\n".join(parts)


class InternalAnalyticsRequest(BaseModel):
    userIds: list[int | str] = []
    startDate: str | None = None
    endDate: str | None = None


@router.post("/internal/analytics/users")
def get_internal_user_analytics(body: InternalAnalyticsRequest) -> dict[str, Any]:
    normalized_user_ids = _normalize_internal_user_ids(body.userIds)
    req_id = uuid.uuid4().hex[:8]
    started_at = time.perf_counter()
    logger.info(
        "[InternalAnalytics][%s] START users=%s range=%s..%s",
        req_id,
        body.userIds,
        body.startDate,
        body.endDate,
    )
    if not normalized_user_ids:
        logger.info("[InternalAnalytics][%s] DONE users=0 rows=0 elapsed_ms=0", req_id)
        return {"success": True, "data": {}}

    analytics_map = _get_internal_user_analytics_map(
        normalized_user_ids,
        start_date=body.startDate,
        end_date=body.endDate,
        req_id=req_id,
    )
    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    logger.info(
        "[InternalAnalytics][%s] DONE users=%s rows=%s elapsed_ms=%s",
        req_id,
        len(normalized_user_ids),
        len(analytics_map),
        elapsed_ms,
    )
    return {"success": True, "data": analytics_map}


def _extract_role_id_from_token(authorization: str | None) -> str | None:
    """Decode JWT Bearer token and return the user's role_id UUID.

    Falls back to resolving role_id via authservice using domain_role for tokens
    issued before role_id was added to the JWT payload.
    """
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1]
    try:
        import jwt as pyjwt
        secret = get_settings().jwt_secret
        if not secret:
            return None
        payload = pyjwt.decode(token, secret, algorithms=["HS256"])
        role_id = payload.get("role_id")
        if role_id:
            return str(role_id)
        # Fallback: old token has no role_id — resolve from domain_role via authservice
        domain_role = payload.get("domain_role")
        if domain_role and domain_role != "OTHER":
            return _resolve_role_id_from_authservice(domain_role)
        return None
    except Exception:  # noqa: BLE001
        return None


def _resolve_role_id_from_authservice(domain_role: str) -> str | None:
    """Call authservice to resolve a domain_role string → role UUID."""
    try:
        import httpx
        base = (get_settings().auth_service_url or "").rstrip("/")
        if not base:
            return None
        response = httpx.get(
            f"{base}/api/auth/internal/roles/by-name/{domain_role}",
            timeout=3.0,
        )
        if response.status_code == 200:
            return str(response.json().get("id") or "") or None
        return None
    except Exception:  # noqa: BLE001
        return None


def _extract_plan_id_from_token(authorization: str | None) -> int | None:
    """Decode JWT, extract user_id, then look up their active subscription plan_id."""
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1]
    try:
        import jwt as pyjwt
        secret = get_settings().jwt_secret
        if not secret:
            return None
        payload = pyjwt.decode(token, secret, algorithms=["HS256"])
        raw_uid = payload.get("id") or payload.get("userId") or payload.get("user_id")
        if not raw_uid:
            return None
        uid_int = int(raw_uid)
        from app.services.payment_plan_service import get_user_active_plan

        plan = get_user_active_plan(uid_int, authorization=authorization)
        return int(plan["id"]) if plan and plan.get("id") is not None else None
    except Exception:  # noqa: BLE001
        return None


@router.get("/secrets")
def list_secrets_endpoint(
    fetch: str | None = Query(None),
    authorization: str | None = Header(None),
    x_user_plan_id: str | None = Header(None),
) -> list[dict[str, Any]]:
    """List secret prompts from `secret_manager` filtered by the caller's role_id and plan_id.

    The gateway injects `x-user-plan-id` (resolved from the payment service) before
    forwarding here, so no separate payment DB connection is required.
    """
    user_role_id = _extract_role_id_from_token(authorization)
    # Prefer header injected by gateway; fall back to direct payment DB lookup
    if x_user_plan_id and x_user_plan_id.strip().lstrip("-").isdigit():
        user_plan_id: int | None = int(x_user_plan_id)
    else:
        user_plan_id = _extract_plan_id_from_token(authorization)
    if not user_role_id or user_plan_id is None:
        logger.debug(
            "[secrets] list skipped — missing role_id=%s or plan_id=%s",
            user_role_id,
            user_plan_id,
        )
        return []
    logger.debug("[secrets] list request role_id=%s plan_id=%s", user_role_id, user_plan_id)
    try:
        return list_secret_prompts(fetch=fetch, user_role_id=user_role_id, user_plan_id=user_plan_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("[secrets] list failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch secrets: " + str(exc),
        ) from exc


@router.get("/secrets/{secret_id}")
def get_secret_by_id_endpoint(secret_id: str) -> dict[str, Any]:
    """Return one secret’s metadata + value from GCP (same contract as legacy document-service)."""
    try:
        body = get_secret_prompt_detail(secret_id)
        if body is None:
            raise HTTPException(status_code=404, detail="❌ Secret config not found in DB")
        return body
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail="Internal Server Error: " + str(exc),
        ) from exc


class CreateFolderRequest(BaseModel):
    folderName: str
    parentPath: str = ""

class GenerateUploadUrlRequest(BaseModel):
    filename: str
    mimetype: str = "application/octet-stream"
    size: int = 0

class CompleteUploadRequest(BaseModel):
    gcsPath: str
    filename: str
    mimetype: str = "application/octet-stream"
    size: int = 0
    # False → Case Storage upload: persist only, skip the processing pipeline.
    process: bool = True


class DriveImportRequest(BaseModel):
    file_ids: list[str]
    # process=false → Case Storage import: keep the files, skip OCR/chunking/embeddings.
    process: bool = True


class DraftExportDocxRequest(BaseModel):
    markdown: str
    title: str | None = None
    filename: str | None = None


class DraftUpdateRequest(BaseModel):
    session_id: str
    markdown: str


def _user_id_as_int(user_id: str | None) -> int | None:
    """Numeric user id for payment-service token caps (mirrors Node userId)."""
    if not user_id or user_id == "anonymous":
        return None
    try:
        return int(user_id)
    except (TypeError, ValueError):
        return None


def _resolve_user_id(x_user_id: str | None, authorization: str | None) -> str | None:
    if x_user_id:
        return x_user_id
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload = parts[1]
        payload += "=" * ((4 - len(payload) % 4) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")).decode("utf-8"))
        user_id = decoded.get("id") or decoded.get("userId") or decoded.get("user_id") or decoded.get("sub")
        return str(user_id) if user_id is not None else None
    except Exception:
        return None


def _normalize_internal_user_ids(values: list[int | str] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        text = str(value).strip()
        if text and text not in seen:
            seen.add(text)
            normalized.append(text)
    return normalized


def _get_internal_user_analytics_map(
    normalized_user_ids: list[str],
    *,
    start_date: str | None = None,
    end_date: str | None = None,
    req_id: str = "na",
) -> dict[str, dict[str, Any]]:
    logger.info(
        "[InternalAnalytics][%s] PHASE=prepare normalized_user_ids=%s",
        req_id,
        normalized_user_ids,
    )
    analytics_map: dict[str, dict[str, Any]] = {
        user_id: {
            "documentsUploadedCount": 0,
            "uploadedBytes": 0,
            "latestUploadAt": None,
            "casesCreatedCount": 0,
            "assignedCasesCount": 0,
            "createdCases": [],
        }
        for user_id in normalized_user_ids
    }
    if not normalized_user_ids:
        logger.info("[InternalAnalytics][%s] PHASE=prepare empty_user_list", req_id)
        return analytics_map

    filters: list[str] = []
    params: list[Any] = [normalized_user_ids]
    if start_date:
        filters.append("c.created_at >= %s")
        params.append(start_date)
    if end_date:
        filters.append("c.created_at <= %s")
        params.append(end_date)
    created_filter = f" AND {' AND '.join(filters)}" if filters else ""

    logger.info(
        "[InternalAnalytics][%s] PHASE=query-build filters=%s",
        req_id,
        filters,
    )

    created_sql = f"""
        WITH created_cases AS (
          SELECT
            c.id::text AS case_id,
            c.user_id::text AS user_id,
            c.case_title,
            c.status,
            c.created_at,
            folder.originalname AS folder_name,
            folder.folder_path AS parent_folder_path,
            folder.gcs_path AS case_folder_gcs_path,
            CASE
              WHEN folder.id IS NULL THEN NULL
              WHEN COALESCE(folder.folder_path, '') = '' THEN folder.originalname
              WHEN RIGHT(folder.folder_path, LENGTH(folder.originalname)) = folder.originalname THEN folder.folder_path
              ELSE folder.folder_path || '/' || folder.originalname
            END AS case_folder_path
          FROM cases c
          LEFT JOIN user_files folder
            ON folder.id = c.folder_id
           AND folder.is_folder = TRUE
          WHERE c.user_id::text = ANY(%s::text[])
            {created_filter}
        ),
        created_case_docs AS (
          SELECT
            cc.user_id,
            cc.case_id,
            cc.case_title,
            cc.status,
            cc.created_at,
            cc.case_folder_path,
            cc.case_folder_gcs_path,
            COALESCE(case_docs.document_count, 0) AS document_count,
            COALESCE(case_docs.uploaded_bytes, 0) AS uploaded_bytes,
            case_docs.latest_upload_at
          FROM created_cases cc
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*) AS document_count,
              COALESCE(SUM(uf.size), 0) AS uploaded_bytes,
              MAX(uf.created_at) AS latest_upload_at
            FROM user_files uf
            WHERE uf.is_folder = FALSE
              AND (
                (
                  cc.case_folder_gcs_path IS NOT NULL
                  AND uf.gcs_path LIKE cc.case_folder_gcs_path || '%%'
                )
                OR (
                  cc.case_folder_path IS NOT NULL
                  AND (
                    uf.folder_path = cc.case_folder_path
                    OR uf.folder_path LIKE cc.case_folder_path || '/%%'
                  )
                )
              )
          ) AS case_docs ON TRUE
        )
        SELECT
          user_id,
          COUNT(*) AS cases_created_count,
          COALESCE(SUM(document_count), 0) AS document_count,
          COALESCE(SUM(uploaded_bytes), 0) AS uploaded_bytes,
          MAX(latest_upload_at) AS latest_upload_at,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'caseId', case_id,
                'caseTitle', case_title,
                'status', status,
                'createdAt', created_at,
                'caseFolderPath', case_folder_path,
                'caseFolderGcsPath', case_folder_gcs_path,
                'documentsCount', document_count,
                'uploadedBytes', uploaded_bytes,
                'latestUploadAt', latest_upload_at
              )
              ORDER BY created_at DESC
            ),
            '[]'::json
          ) AS created_cases
        FROM created_case_docs
        GROUP BY user_id
    """
    assigned_sql = """
        SELECT
          user_id::text AS user_id,
          COUNT(*) AS assigned_cases_count
        FROM case_assignments
        WHERE user_id::text = ANY(%s::text[])
        GROUP BY user_id::text
    """

    with get_db_connection() as conn:
        try:
            created_result = conn.execute(created_sql, tuple(params)).fetchall()
            logger.info(
                "[InternalAnalytics][%s] PHASE=query-created-cases rows=%s",
                req_id,
                len(created_result),
            )
        except Exception as exc:
            logger.exception(
                "[InternalAnalytics][%s] PHASE=query-created-cases ERROR users=%s start=%s end=%s error=%s",
                req_id,
                normalized_user_ids,
                start_date,
                end_date,
                exc,
            )
            raise

        try:
            assigned_result = conn.execute(assigned_sql, (normalized_user_ids,)).fetchall()
        except Exception as exc:
            logger.warning(
                "[InternalAnalytics][%s] PHASE=query-assigned-cases WARN users=%s error=%s",
                req_id,
                normalized_user_ids,
                exc,
            )
            assigned_result = []

    logger.info(
        "[InternalAnalytics][%s] PHASE=query-merged created_rows=%s assigned_rows=%s",
        req_id,
        len(created_result),
        len(assigned_result),
    )

    for row in created_result:
        uid = str(row.get("user_id"))
        analytics_map[uid] = {
            **(analytics_map.get(uid) or {}),
            "documentsUploadedCount": int(row.get("document_count") or 0),
            "uploadedBytes": int(row.get("uploaded_bytes") or 0),
            "latestUploadAt": row.get("latest_upload_at"),
            "casesCreatedCount": int(row.get("cases_created_count") or 0),
            "createdCases": row.get("created_cases") if isinstance(row.get("created_cases"), list) else [],
        }
    for row in assigned_result:
        uid = str(row.get("user_id"))
        analytics_map[uid] = {
            **(analytics_map.get(uid) or {}),
            "assignedCasesCount": int(row.get("assigned_cases_count") or 0),
        }

    logger.info(
        "[InternalAnalytics][%s] PHASE=assemble users_in_map=%s",
        req_id,
        list(analytics_map.keys()),
    )
    return analytics_map


def _read_inline_text(file_bytes: bytes, upload: UploadFile) -> str | None:
    # Uploaded files should always be fed into the extraction stage first.
    # That keeps OCR/text extraction, semantic chunking, embedding, and DB
    # persistence on one consistent ingestion path.
    return None


def _build_gcs_object_path(user_id: str, folder_name: str, filename: str) -> str:
    safe_name = (filename or f"upload-{uuid.uuid4().hex[:8]}").replace("\\", "_").replace("/", "_").replace(" ", "_")
    return str(PurePosixPath(user_id) / "documents" / folder_name / f"{uuid.uuid4().hex[:10]}_{safe_name}")


def _normalize_gs_uri_from_record(gcs_path: str | None) -> str | None:
    import re as _re
    raw = (gcs_path or "").strip()
    if not raw:
        return None

    # Strip gs://bucket/ prefix to work on the object path only
    settings = get_settings()
    bucket_name = settings.gcs_input_bucket_name or settings.gcs_bucket_name or "fileinputbucket"
    if raw.startswith("gs://"):
        object_path = raw[len(f"gs://{bucket_name}/"):]
    else:
        object_path = raw.lstrip("/")

    # Heal doubled prefix: "{uid}/documents/{uid}/cases/{rest}"
    # → "{uid}/documents/{rest}"
    fixed = _re.sub(
        r"^(\d+/documents/)\d+/cases/",
        r"\1",
        object_path,
    )
    # Also heal "{uid}/documents/{uid}/documents/{rest}" → "{uid}/documents/{rest}"
    fixed = _re.sub(
        r"^(\d+/documents/)\d+/documents/",
        r"\1",
        fixed,
    )

    return f"gs://{bucket_name}/{fixed}"


def _get_file_record_for_user(file_id: str, user_id: str) -> dict[str, Any] | None:
    if not is_db_available():
        return None
    accessible_user_ids = get_folder_service()._get_accessible_user_ids(user_id)
    if not accessible_user_ids:
        return None
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, user_id, originalname, mimetype, size, gcs_path, status, created_at,
                   full_text_content, processed_at, updated_at, page_count
            FROM user_files
            WHERE id::text = %s
              AND is_folder = false
              AND user_id::text = ANY(%s::text[])
            LIMIT 1
            """,
            [file_id, accessible_user_ids],
        )
        return cur.fetchone()


def _get_public_table_columns(cur: Any, table_name: str) -> set[str]:
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        [table_name],
    )
    return {row["column_name"] for row in cur.fetchall()}


def _parse_jsonish(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            return None
    return value


def _page_texts_from_stamped_ocr(text: str) -> list[str]:
    """Split stored OCR on [PAGE n] / form-feed stamps into a dense 1..N list."""
    from app.services.chronology.pages import split_into_pages

    slices = split_into_pages(text or "")
    if not slices:
        return []
    max_number = max(item.number for item in slices)
    by_number = {item.number: item.text for item in slices}
    return [by_number.get(index, "") for index in range(1, max_number + 1)]


_MAX_OCR_PAGE_WINDOW = 8


def _ocr_page_texts_for_record(record: dict[str, Any] | None) -> list[str]:
    if not record:
        return []
    text = str(record.get("full_text_content") or "")
    stamped = _page_texts_from_stamped_ocr(text)
    if stamped:
        return stamped
    cleaned = text.strip()
    return [cleaned] if cleaned else []


def _ocr_text_page_dict(page_number: int, page_text: str) -> dict[str, Any]:
    body = str(page_text or "").strip()
    lines = [
        {"type": "line", "text": line.strip()}
        for line in body.splitlines()
        if line.strip()
    ]
    return {
        "pageNumber": page_number,
        "dimension": {"width": None, "height": None, "unit": ""},
        "text": body,
        "blocks": [],
        "paragraphs": [],
        "lines": lines,
        "tables": [],
    }


def _virtualized_ocr_payload(
    record: dict[str, Any] | None,
    *,
    page_from: int,
    page_to: int,
) -> dict[str, Any] | None:
    """Return OCR for a small page window. The original PDF is served via signed URL, not here."""
    texts = _ocr_page_texts_for_record(record)
    try:
        stored_count = int((record or {}).get("page_count") or 0)
    except (TypeError, ValueError):
        stored_count = 0
    page_count = max(len(texts), stored_count)
    if page_count <= 0:
        return None
    start = max(1, min(int(page_from or 1), page_count))
    end = max(start, min(int(page_to or start), page_count))
    if end - start + 1 > _MAX_OCR_PAGE_WINDOW:
        end = start + _MAX_OCR_PAGE_WINDOW - 1
    pages = [
        _ocr_text_page_dict(number, texts[number - 1] if number <= len(texts) else "")
        for number in range(start, end + 1)
    ]
    window_text = "\n\n".join(item["text"] for item in pages if item.get("text"))
    return {
        "available": True,
        "pageCount": page_count,
        "page": start,
        "pageTo": end,
        "virtualized": True,
        "structuredJson": {
            "schemaVersion": 1,
            "source": "virtualized_page_text",
            "provider": "user_files.full_text_content",
            "text": window_text,
            "pageCount": page_count,
            "pages": pages,
        },
        "extractedText": window_text,
        "metadata": {
            "virtualized": True,
            "pageSource": "page_stamps",
            "returnedPages": [start, end],
        },
    }


def _split_text_evenly_by_pages(text: str, page_count: int) -> list[str]:
    cleaned = (text or "").strip()
    if not cleaned or page_count <= 1:
        return [cleaned] if cleaned else []
    lines = [line for line in cleaned.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    nonempty_chars = sum(len(line) for line in lines if line.strip()) or len(cleaned)
    target = max(1, nonempty_chars // page_count)
    pages: list[str] = []
    current: list[str] = []
    current_chars = 0
    for line in lines:
        current.append(line)
        current_chars += len(line)
        remaining_lines = len(lines) - (sum(len(page.splitlines()) for page in pages) + len(current))
        remaining_pages = page_count - len(pages) - 1
        if remaining_pages > 0 and current_chars >= target and remaining_lines >= remaining_pages:
            page_text = "\n".join(current).strip()
            if page_text:
                pages.append(page_text)
            current = []
            current_chars = 0
    tail = "\n".join(current).strip()
    if tail:
        pages.append(tail)
    while len(pages) < page_count:
        pages.append("")
    return pages[:page_count]


# Never pull a large original off GCS just to reconstruct OCR pages for the viewer.
# A 49MB writ petition was adding ~15–20s to GET /file/{id}/view before the modal opened.
_MAX_PDF_FALLBACK_BYTES = 8 * 1024 * 1024


def _pdf_page_texts_from_record(record: dict[str, Any] | None) -> list[str]:
    if not record:
        return []
    mime = str(record.get("mimetype") or "").lower()
    name = str(record.get("originalname") or "").lower()
    if "pdf" not in mime and not name.endswith(".pdf"):
        return []
    size = int(record.get("size") or 0)
    if size > _MAX_PDF_FALLBACK_BYTES:
        logger.info(
            "[files.ocr] skip original PDF download for page-text fallback file_id=%s size=%s",
            record.get("id"),
            size,
        )
        return []
    gs_uri = _normalize_gs_uri_from_record(record.get("gcs_path"))
    if not gs_uri:
        return []
    try:
        import io
        from pypdf import PdfReader  # type: ignore

        pdf_bytes = gcs.download_bytes(gs_uri)
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return [(page.extract_text() or "").strip() for page in reader.pages]
    except Exception as exc:
        logger.debug("[files.ocr] PDF page-text fallback skipped file_id=%s error=%s", record.get("id"), exc)
        return []


def _fallback_structured_ocr_from_text(
    text: str,
    *,
    source: str = "processed_text",
    page_texts: list[str] | None = None,
) -> dict[str, Any] | None:
    cleaned = (text or "").strip()
    supplied_pages = [(part or "").strip() for part in (page_texts or [])]
    supplied_pages = supplied_pages if any(supplied_pages) else []
    if not cleaned and supplied_pages:
        cleaned = "\n\n".join(part for part in supplied_pages if part).strip()
    if not cleaned:
        return None
    # Keep the fallback compact: the real Document AI structure is preferred when present,
    # but processed uploads still get a reconstructed OCR panel from stored extracted text.
    pages: list[dict[str, Any]] = []
    if supplied_pages:
        resolved_page_texts = supplied_pages
    else:
        page_chunks = re.split(r"\n\s*(?:-{3,}|={3,}|Page\s+\d+\s*(?:of\s*\d+)?)\s*\n", cleaned, flags=re.IGNORECASE)
        resolved_page_texts = [chunk.strip() for chunk in page_chunks if chunk.strip()] or [cleaned]
    for index, page_text in enumerate(resolved_page_texts):
        lines = [
            {"type": "line", "text": line.strip()}
            for line in str(page_text or "").splitlines()
            if line.strip()
        ]
        pages.append({
            "pageNumber": index + 1,
            "dimension": {"width": None, "height": None, "unit": ""},
            "text": str(page_text or "").strip(),
            "blocks": [],
            "paragraphs": [],
            "lines": lines,
            "tables": [],
        })
    return {
        "schemaVersion": 1,
        "source": source,
        "provider": source,
        "text": cleaned,
        "pageCount": len(pages),
        "pages": pages,
    }


def _fallback_file_ocr_payload(
    record: dict[str, Any] | None,
    *,
    download_original_pdf: bool = False,
) -> dict[str, Any] | None:
    if not record:
        return None
    text = str(record.get("full_text_content") or "").strip()
    # Viewer path must not download the original PDF. Stored Document AI JSON / full_text_content
    # is enough; the browser already fetches the file via the signed URL for the left panel.
    pdf_page_texts = _pdf_page_texts_from_record(record) if download_original_pdf else []
    if not any(pdf_page_texts):
        pdf_page_texts = _page_texts_from_stamped_ocr(text)
    stored_page_count = 0
    try:
        stored_page_count = int(record.get("page_count") or 0)
    except (TypeError, ValueError):
        stored_page_count = 0
    page_count = len(pdf_page_texts) or stored_page_count
    if not any(pdf_page_texts) and text and page_count > 1:
        pdf_page_texts = _split_text_evenly_by_pages(text, page_count)
    if not text and any(pdf_page_texts):
        text = "\n\n".join(part for part in pdf_page_texts if part).strip()
    if not text:
        return None
    structured = _fallback_structured_ocr_from_text(
        text,
        source="processed_file_text",
        page_texts=pdf_page_texts or None,
    )
    timestamp = record.get("processed_at") or record.get("updated_at") or record.get("created_at")
    processed_at = timestamp.isoformat() if hasattr(timestamp, "isoformat") else timestamp
    return {
        "available": True,
        "pageCount": (structured or {}).get("pageCount") or page_count or 1,
        "confidence": None,
        "status": "processed",
        "processedAt": processed_at,
        "structuredJson": structured,
        "extractedText": text,
        "metadata": {
            "source": "user_files.full_text_content",
            "fallback": True,
            "pageSource": "original_pdf" if pdf_page_texts else "full_text_content",
        },
    }


def _ocr_payload_page_count(payload: dict[str, Any] | None) -> int:
    if not payload:
        return 0
    structured = _parse_jsonish(payload.get("structuredJson") or payload.get("structured_json"))
    pages = structured.get("pages") if isinstance(structured, dict) else None
    if isinstance(pages, list) and pages:
        return len(pages)
    try:
        return int(payload.get("pageCount") or payload.get("page_count") or 0)
    except (TypeError, ValueError):
        return 0


def _choose_ocr_payload(
    stored: dict[str, Any] | None,
    fallback: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not stored:
        return fallback
    if not fallback:
        return stored
    stored_pages = _ocr_payload_page_count(stored)
    fallback_pages = _ocr_payload_page_count(fallback)
    stored_structured = _parse_jsonish(stored.get("structuredJson") or stored.get("structured_json"))
    stored_has_structured_pages = bool(
        isinstance(stored_structured, dict)
        and isinstance(stored_structured.get("pages"), list)
        and stored_structured.get("pages")
    )
    if not stored_has_structured_pages or fallback_pages > stored_pages:
        merged = dict(fallback)
        if stored.get("confidence") is not None:
            merged["confidence"] = stored.get("confidence")
        if stored.get("processedAt"):
            merged["processedAt"] = stored.get("processedAt")
        metadata = dict(merged.get("metadata") or {})
        metadata["replacedIncompleteStoredOcr"] = True
        merged["metadata"] = metadata
        return merged
    return stored


def _get_file_ocr_extraction(file_id: str, *, include_structure: bool = False) -> dict[str, Any] | None:
    if not is_db_available():
        return None
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            columns = _get_public_table_columns(cur, "document_ai_extractions")
            file_column = "file_id" if "file_id" in columns else (
                "template_file_id" if "template_file_id" in columns else None
            )
            if not file_column:
                return None

            wanted = [
                "page_count",
                "confidence_score",
                "average_confidence",
                "processing_status",
                "processed_at",
                "updated_at",
                "created_at",
            ]
            if include_structure:
                # Prefer structured_schema over raw Document AI JSON — raw_response is often tens of MB.
                wanted.extend(["extracted_text", "metadata", "structured_schema"])
            select_columns = [column for column in wanted if column in columns]
            if not select_columns:
                return None

            order_columns = [column for column in ("processed_at", "updated_at", "created_at") if column in columns]
            order_expr = ", ".join(f"{column} DESC NULLS LAST" for column in order_columns) or file_column
            cur.execute(
                f"""
                SELECT {", ".join(select_columns)}
                FROM document_ai_extractions
                WHERE {file_column}::text = %s
                ORDER BY {order_expr}
                LIMIT 1
                """,
                [file_id],
            )
            row = cur.fetchone()
    except Exception as exc:
        logger.debug("[files.ocr] file_id=%s lookup skipped: %s", file_id, exc)
        return None

    if not row:
        return None

    processed_at = row.get("processed_at") or row.get("updated_at") or row.get("created_at")
    out: dict[str, Any] = {
        "available": True,
        "pageCount": row.get("page_count"),
        "confidence": row.get("average_confidence") if row.get("average_confidence") is not None else row.get("confidence_score"),
        "status": row.get("processing_status") or "processed",
        "processedAt": processed_at.isoformat() if hasattr(processed_at, "isoformat") else processed_at,
    }
    if include_structure:
        structured = _parse_jsonish(row.get("structured_schema"))
        if not structured:
            raw_response = None
            if "raw_response" in columns:
                try:
                    with get_db_connection() as conn, conn.cursor() as cur:
                        cur.execute(
                            f"""
                            SELECT raw_response
                            FROM document_ai_extractions
                            WHERE {file_column}::text = %s
                            LIMIT 1
                            """,
                            [file_id],
                        )
                        raw_row = cur.fetchone() or {}
                        raw_response = raw_row.get("raw_response")
                except Exception:
                    raw_response = None
            structured = _parse_jsonish(raw_response)
        out.update({
            "structuredJson": structured,
            "extractedText": row.get("extracted_text") or "",
            "metadata": _parse_jsonish(row.get("metadata")) or {},
        })
    return out


def _get_file_processing_status_payload(file_id: str, user_id: str) -> dict[str, Any] | None:
    """
    Build the same shape the legacy document-service GET /files/status/:file_id returns
    (used by AnalysisPage polling and document preview).
    """
    if not is_db_available():
        return None
    accessible = get_folder_service()._get_accessible_user_ids(user_id)
    if not accessible:
        return None
    fid = file_id.strip()
    if not fid:
        return None
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, user_id, originalname, mimetype, size, gcs_path, status,
                       processing_progress, current_operation, summary, updated_at, processed_at,
                       full_text_content
                FROM user_files
                WHERE id::text = %s
                  AND COALESCE(is_folder, false) = false
                  AND user_id::text = ANY(%s::text[])
                LIMIT 1
                """,
                (fid, accessible),
            )
            row = cur.fetchone()
            if not row:
                return None
            chunk_count = 0
            try:
                cur.execute(
                    "SELECT COUNT(*)::int AS c FROM file_chunks WHERE file_id::text = %s",
                    (fid,),
                )
                cr = cur.fetchone()
                if cr:
                    chunk_count = int(cr.get("c") or 0)
            except Exception:
                pass
    except Exception as exc:
        logger.warning("[files.status] file_id=%s lookup error: %s", fid, exc)
        return None

    st = str(row.get("status") or "unknown")
    prog = float(row.get("processing_progress") or 0)
    updated = row.get("updated_at")
    last_updated = updated.isoformat() if hasattr(updated, "isoformat") else str(updated or "")
    proc_at = row.get("processed_at")
    processed_at = proc_at.isoformat() if proc_at is not None and hasattr(proc_at, "isoformat") else proc_at

    out: dict[str, Any] = {
        "document_id": str(row.get("id") or fid),
        "filename": row.get("originalname") or "",
        "status": st,
        "processing_progress": prog,
        "current_operation": str(row.get("current_operation") or ""),
        "chunk_count": chunk_count,
        "last_updated": last_updated,
        "summary": row.get("summary"),
        "processed_at": processed_at,
        "mime_type": row.get("mimetype") or "",
        "file_size": int(row.get("size") or 0),
        "job_error": None,
        "job_status": "unknown",
        "embeddings_generated": 0,
        "embeddings_total": 0,
        "chunks_saved": chunk_count,
        "estimated_pages": None,
        "chunking_method": None,
    }
    ftc = row.get("full_text_content")
    if ftc:
        out["full_text_content"] = ftc

    ocr_summary = _get_file_ocr_extraction(fid, include_structure=False)
    if ocr_summary:
        out["ocr_available"] = True
        out["ocr_page_count"] = ocr_summary.get("pageCount")
        out["ocr_confidence"] = ocr_summary.get("confidence")
        out["ocr_processed_at"] = ocr_summary.get("processedAt")
    elif ftc:
        out["ocr_available"] = True
        out["ocr_page_count"] = None
        out["ocr_confidence"] = None
        out["ocr_processed_at"] = processed_at
        out["ocr_source"] = "full_text_content"
    else:
        out["ocr_available"] = False
    return out


def _upload_to_gcs_and_build_document(
    user_id: str,
    folder_name: str,
    *,
    filename: str | None,
    mimetype: str | None,
    file_bytes: bytes,
) -> DocumentReference:
    # Sync + bytes-based on purpose: the GCS upload is a blocking network call, so the
    # upload routes run this in the threadpool (one task per file, concurrently) instead
    # of serially on the event loop — a multi-file upload must never freeze the service.
    mimetype = mimetype or "application/octet-stream"
    filename = filename or f"upload-{uuid.uuid4().hex[:8]}"
    gcs_path = _build_gcs_object_path(user_id, folder_name, filename)
    gs_uri = gcs.upload_bytes(file_bytes, gcs_path, mimetype, bucket_type="input")
    return DocumentReference(
        document_name=filename,
        mime_type=mimetype,
        document_uri=gs_uri,
        inline_text=None,
        metadata={
            "size": len(file_bytes),
            "original_name": filename,
            "gcs_path": gs_uri,
        },
    )


def _upload_drive_bytes_and_build_document(
    user_id: str,
    folder_name: str,
    *,
    filename: str,
    mime_type: str,
    data: bytes,
    source_file_id: str,
) -> DocumentReference:
    gcs_path = _build_gcs_object_path(user_id, folder_name, filename)
    gs_uri = gcs.upload_bytes(data, gcs_path, mime_type, bucket_type="input")
    return DocumentReference(
        document_name=filename,
        mime_type=mime_type or "application/octet-stream",
        document_uri=gs_uri,
        inline_text=None,
        metadata={
            "size": len(data),
            "original_name": filename,
            "gcs_path": gs_uri,
            "source": "google_drive",
            "google_drive_file_id": source_file_id,
        },
    )


@router.get("/chat-sessions")
async def get_analysis_chat_sessions(
    page: int = 1,
    limit: int = 20,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    """Return paginated analysis chat sessions (chat_type = 'analysis') for the current user."""
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not is_db_available():
        raise HTTPException(status_code=503, detail="Database not configured")

    offset = (page - 1) * limit
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, question, answer, used_chunk_ids, created_at,
                   session_id, file_id, used_secret_prompt, prompt_label, chat_history
            FROM file_chats
            WHERE user_id = %s AND (chat_type = 'analysis' OR (chat_type IS NULL AND file_id IS NOT NULL))
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            (user_id, limit, offset),
        ).fetchall()

    return [dict(r) for r in rows]


@router.get("/file/{file_id}/view")
async def view_file(
    file_id: str,
    page: int | None = None,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    record = _get_file_record_for_user(file_id, user_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found")

    gs_uri = _normalize_gs_uri_from_record(record.get("gcs_path"))
    if not gs_uri:
        raise HTTPException(status_code=404, detail="Document storage path is missing")

    try:
        signed_url = gcs.signed_read_url(gs_uri, expiration_minutes=60)
    except Exception as exc:
        logger.exception("[Route:view_file] file_id=%s failed to sign read URL: %s", file_id, exc)
        raise HTTPException(status_code=500, detail="Could not generate document view URL") from exc

    page_number = max(1, page or 1)
    # Signed URL for the original PDF. OCR is virtualized: only the requested page of text,
    # never the whole file from GCS and never every page of structured JSON.
    ocr_payload = _virtualized_ocr_payload(record, page_from=page_number, page_to=page_number)
    logger.info(
        "[Route:view_file] file_id=%s page=%s ocr_page_count=%s returned_pages=%s virtualized=true",
        file_id,
        page_number,
        (ocr_payload or {}).get("pageCount") or 0,
        1 if ocr_payload else 0,
    )
    return {
        "success": True,
        "document": {
            "id": str(record.get("id") or file_id),
            "name": record.get("originalname") or "document",
            "mimetype": record.get("mimetype") or "application/octet-stream",
            "size": int(record.get("size") or 0),
            "status": record.get("status") or "",
        },
        "signedUrl": signed_url,
        "viewUrl": signed_url,
        "viewUrlWithPage": f"{signed_url}#page={page_number}",
        "page": page_number,
        "ocr": ocr_payload,
    }


@router.get("/file/{file_id}/ocr-pages")
async def get_ocr_pages(
    file_id: str,
    from_page: int = Query(default=1, alias="from", ge=1),
    to_page: int | None = Query(default=None, alias="to", ge=1),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Windowed OCR text for the virtualized right-hand panel. Does not touch GCS."""
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    record = _get_file_record_for_user(file_id, user_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found")
    end = to_page if to_page is not None else from_page
    ocr_payload = _virtualized_ocr_payload(record, page_from=from_page, page_to=end)
    if not ocr_payload:
        raise HTTPException(status_code=404, detail="OCR text is not available")
    logger.info(
        "[Route:ocr_pages] file_id=%s from=%s to=%s page_count=%s",
        file_id,
        ocr_payload.get("page"),
        ocr_payload.get("pageTo"),
        ocr_payload.get("pageCount"),
    )
    return {
        "success": True,
        "pageCount": ocr_payload.get("pageCount"),
        "from": ocr_payload.get("page"),
        "to": ocr_payload.get("pageTo"),
        "ocr": ocr_payload,
    }


@router.get("/llm-limits")
async def get_llm_limits_for_client(
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Upload caps from `summarization_chat_config` merged with the user's active plan limits."""
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    cfg = get_llm_chat_config(user_id=user_id, plan_limit_mode="summarization")
    ceiling = get_request_upload_ceiling_mb(cfg)
    return {
        "success": True,
        "data": {
            "max_file_size_mb": cfg.get("max_file_size_mb"),
            "max_document_size_mb": cfg.get("max_document_size_mb"),
            "max_upload_mb": ceiling,
            "max_upload_bytes": ceiling * 1024 * 1024,
            "max_upload_files": cfg.get("max_upload_files"),
            "max_file_upload_per_day": cfg.get("max_file_upload_per_day"),
            "max_document_pages": cfg.get("max_document_pages"),
            "max_context_documents": cfg.get("max_context_documents"),
            "max_conversation_history": cfg.get("max_conversation_history"),
            "total_tokens_per_day": cfg.get("total_tokens_per_day"),
            "messages_per_hour": cfg.get("messages_per_hour"),
            "chats_per_day": cfg.get("chats_per_day"),
            "quota_chats_per_minute": cfg.get("quota_chats_per_minute"),
            "plan_name": cfg.get("_plan_name"),
            "plan_id": cfg.get("_plan_id"),
        },
    }


@router.get("/user-usage-and-plan/{user_id}")
def get_user_usage_and_plan_for_payment(
    user_id: int,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Backward-compatible contract for payment-service.
    Returns real storage usage (GCS + DB) from user_files and the plan's
    storage_limit_gb from monthly_plans / subscription_plans.
    """
    from app.services.db import get_db_connection, get_payment_db_connection, is_db_available, is_payment_db_available

    actor_user_id = _resolve_user_id(x_user_id, authorization)
    logger.info(
        "[Route:user_usage_and_plan] actor=%s target=%s",
        actor_user_id, user_id,
    )

    from app.services.db import (
        get_db_connection, get_payment_db_connection, get_draft_db_connection,
        is_db_available, is_payment_db_available, is_draft_db_available,
    )

    # user_id column is character varying in all DBs — cast once to avoid type mismatch
    user_id_str = str(user_id)

    # ── 1a. Document DB: user_files (all services share this table) ──────────
    documents_used: int = 0
    doc_storage_bytes: int = 0
    zero_size_files: list = []
    if is_db_available():
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COUNT(*)                                        AS documents_used,
                        COALESCE(SUM(size), 0)::bigint                  AS storage_used_bytes,
                        JSON_AGG(
                            JSON_BUILD_OBJECT('id', id::text, 'gcs_path', gcs_path)
                        ) FILTER (
                            WHERE (size IS NULL OR size = 0) AND gcs_path IS NOT NULL
                        )                                               AS zero_size_files
                    FROM user_files
                    WHERE user_id = %s
                      AND (is_folder IS NULL OR is_folder = FALSE)
                    """,
                    (user_id_str,),
                )
                row = cur.fetchone() or {}
            documents_used    = int(row.get("documents_used", 0) or 0)
            doc_storage_bytes = int(row.get("storage_used_bytes", 0) or 0)
            zero_size_files   = row.get("zero_size_files") or []
        except Exception as exc:
            logger.warning("[Route:user_usage_and_plan] doc-db query failed: %s", exc)

    # ── 1a-fallback: fetch real sizes from GCS for rows stored as size=0 ──
    if is_db_available() and zero_size_files:
        try:
            from app.services.adapters.gcs import _get_gcs_client
            from app.core.config import get_settings as _gs
            _settings = _gs()
            _bucket_name = _settings.gcs_input_bucket_name or _settings.gcs_bucket_name or "fileinputbucket"
            _client = _get_gcs_client()
            _bucket = _client.bucket(_bucket_name)
            repaired_bytes = 0
            with get_db_connection() as conn, conn.cursor() as cur:
                for zf in zero_size_files[:30]:  # cap to avoid long response times
                    gcs_path = (zf.get("gcs_path") or "").strip()
                    file_id  = zf.get("id")
                    if not gcs_path or not file_id:
                        continue
                    # Strip gs://bucket/ prefix if present
                    if gcs_path.startswith("gs://"):
                        gcs_path = "/".join(gcs_path.split("/")[3:])
                    try:
                        blob = _bucket.blob(gcs_path)
                        blob.reload()
                        real_size = blob.size or 0
                        if real_size > 0:
                            repaired_bytes += real_size
                            cur.execute(
                                "UPDATE user_files SET size = %s WHERE id = %s::uuid AND size = 0",
                                (real_size, file_id),
                            )
                    except Exception:
                        pass  # object may not exist in this bucket
                conn.commit()
            if repaired_bytes > 0:
                doc_storage_bytes += repaired_bytes
                logger.info(
                    "[Route:user_usage_and_plan] repaired %d zero-size rows → +%d bytes for user %s",
                    len(zero_size_files), repaired_bytes, user_id,
                )
        except Exception as exc:
            logger.warning("[Route:user_usage_and_plan] GCS size repair failed: %s", exc)

    # ── 1b. Draft DB: generated_documents (agent-draft-service output files) ──
    draft_storage_bytes: int = 0
    if is_draft_db_available():
        try:
            with get_draft_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(gd.file_size), 0)::bigint AS draft_bytes
                    FROM generated_documents gd
                    JOIN user_drafts ud ON ud.draft_id = gd.draft_id
                    WHERE ud.user_id = %s
                      AND gd.file_size IS NOT NULL
                    """,
                    (user_id_str,),
                )
                row = cur.fetchone() or {}
            draft_storage_bytes = int(row.get("draft_bytes", 0) or 0)
        except Exception as exc:
            logger.warning("[Route:user_usage_and_plan] draft-db query failed: %s", exc)

    storage_used_bytes = doc_storage_bytes + draft_storage_bytes
    storage_used_gb = storage_used_bytes / (1024 ** 3)

    # ── 2. Payment DB: resolve active plan + storage_limit_gb ─────────────────
    storage_limit_gb: float = 0.0
    plan_name = "Unlimited"
    if is_payment_db_available():
        try:
            with get_payment_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COALESCE(mp.name, sp.name, 'Unknown')      AS plan_name,
                        COALESCE(
                            mp.storage_limit_gb,
                            sp.storage_limit_gb,
                            0
                        )::numeric                                  AS storage_limit_gb
                    FROM user_subscriptions us
                    LEFT JOIN monthly_plans      mp ON mp.id = us.monthly_plan_id AND mp.is_active = TRUE
                    LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
                    WHERE us.user_id = %s
                      AND LOWER(COALESCE(us.status, 'active')) = 'active'
                      AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
                      AND (mp.id IS NOT NULL OR sp.id IS NOT NULL)
                    ORDER BY us.updated_at DESC NULLS LAST
                    LIMIT 1
                    """,
                    (user_id_str,),
                )
                row = cur.fetchone() or {}
            storage_limit_gb = float(row.get("storage_limit_gb", 0) or 0)
            plan_name         = row.get("plan_name", "Unlimited") or "Unlimited"
        except Exception as exc:
            logger.warning("[Route:user_usage_and_plan] payment-db query failed: %s", exc)

    usage = {
        "user_id":                   user_id,
        "tokens_used":               0,
        "documents_used":            documents_used,
        "ai_analysis_used":          0,
        "storage_used_gb":           round(storage_used_gb, 6),
        "storage_used_bytes":        storage_used_bytes,
        "storage_breakdown": {
            "documents_bytes":       doc_storage_bytes,
            "documents_gb":          round(doc_storage_bytes / (1024 ** 3), 6),
            "draft_documents_bytes": draft_storage_bytes,
            "draft_documents_gb":    round(draft_storage_bytes / (1024 ** 3), 6),
        },
        "carry_over_tokens":         0,
    }
    plan = {
        "name":                    plan_name,
        "type":                    "firm",
        "token_limit":             999999999,
        "document_limit":          999999,
        "ai_analysis_limit":       999999,
        "storage_limit_gb":        storage_limit_gb,
        "token_renew_interval_hours": 24,
    }

    logger.info(
        "[Route:user_usage_and_plan] user=%s docs=%d storage_used_gb=%.4f storage_limit_gb=%.3f",
        user_id, documents_used, storage_used_gb, storage_limit_gb,
    )
    return {"success": True, "data": {"usage": usage, "plan": plan, "timeLeft": 0}}


@router.get("/queue/status")
async def get_queue_status(
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Return current document processing queue depth and worker stats."""
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return {
        "success": True,
        "queue": get_folder_service().get_queue_status(),
    }


@router.get("/status/{file_id}")
async def get_file_processing_status(
    file_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Per-file processing status (parity with legacy document-service GET /files/status/:file_id).

    The analysis UI polls this for progress; document preview also depends on a successful status
    lookup for the same file id in user_files.
    """
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    payload = _get_file_processing_status_payload(file_id, user_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Document not found")
    logger.info(
        "[Route:file_status] file_id=%s user_id=%s status=%s progress=%s",
        file_id,
        user_id,
        payload.get("status"),
        payload.get("processing_progress"),
    )
    return payload


@router.post("/upload-for-processing")
async def upload_for_processing(
    files: list[UploadFile] = File(...),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    llm_config = await run_in_threadpool(
        get_llm_chat_config, user_id=user_id, plan_limit_mode="summarization"
    )
    # Keep temp folder style aligned with document-service uploadForProcessing flow.
    folder_name = f"temp-{uuid.uuid4().hex[:12]}"
    logger.info(
        "[Route:upload_for_processing] status=received user_id=%s folder=%s files=%s",
        user_id,
        folder_name,
        len(files),
    )
    # Storage quota check: sum total bytes of all files first
    total_new_bytes = 0
    files_data = []
    for upload in files:
        file_bytes = await upload.read()
        total_new_bytes += len(file_bytes)
        files_data.append((upload, file_bytes))

    storage_check = await run_in_threadpool(assert_storage_allowed, user_id, total_new_bytes)
    if not storage_check.get("ok"):
        raise HTTPException(status_code=507, detail=storage_check)

    for upload, file_bytes in files_data:
        check = assert_upload_allowed(
            user_id,
            llm_config,
            files_count=len(files),
            size_bytes=len(file_bytes),
            buffer=file_bytes,
            mimetype=upload.content_type,
            originalname=upload.filename,
        )
        if not check.get("ok"):
            raise HTTPException(status_code=429, detail=check)
    # All GCS uploads run concurrently in the threadpool — never serially on the
    # event loop, which would freeze every other request (incl. status polling)
    # for the duration of a multi-file upload.
    documents: list[DocumentReference] = await asyncio.gather(*[
        run_in_threadpool(
            _upload_to_gcs_and_build_document,
            user_id,
            folder_name,
            filename=upload.filename,
            mimetype=upload.content_type,
            file_bytes=file_bytes,
        )
        for upload, file_bytes in files_data
    ])
    return await run_in_threadpool(
        enqueue_case_documents,
        user_id=user_id,
        folder_name=folder_name,
        documents=[document.model_dump(mode="json") for document in documents],
    )


@router.post("/{folder_name}/upload")
async def upload_documents_to_folder(
    folder_name: str,
    files: list[UploadFile] = File(...),
    process: str = Form(default="true"),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    llm_config = await run_in_threadpool(
        get_llm_chat_config, user_id=user_id, plan_limit_mode="summarization"
    )
    logger.info(
        "[Route:upload_documents_to_folder] status=received user_id=%s folder=%s files=%s",
        user_id,
        folder_name,
        len(files),
    )
    # Storage quota check
    total_new_bytes = 0
    files_data = []
    for upload in files:
        file_bytes = await upload.read()
        total_new_bytes += len(file_bytes)
        files_data.append((upload, file_bytes))

    storage_check = await run_in_threadpool(assert_storage_allowed, user_id, total_new_bytes)
    if not storage_check.get("ok"):
        raise HTTPException(status_code=507, detail=storage_check)

    for upload, file_bytes in files_data:
        check = assert_upload_allowed(
            user_id,
            llm_config,
            files_count=len(files),
            size_bytes=len(file_bytes),
            buffer=file_bytes,
            mimetype=upload.content_type,
            originalname=upload.filename,
        )
        if not check.get("ok"):
            raise HTTPException(status_code=429, detail=check)
    # Concurrent threadpool GCS uploads — see upload_for_processing for rationale.
    documents: list[DocumentReference] = await asyncio.gather(*[
        run_in_threadpool(
            _upload_to_gcs_and_build_document,
            user_id,
            folder_name,
            filename=upload.filename,
            mimetype=upload.content_type,
            file_bytes=file_bytes,
        )
        for upload, file_bytes in files_data
    ])
    # process=false → Case Storage upload: keep the file, skip OCR/chunking/embeddings.
    if str(process).strip().lower() in {"false", "0", "no"}:
        return await run_in_threadpool(
            store_case_documents,
            user_id=user_id,
            folder_name=folder_name,
            documents=[document.model_dump(mode="json") for document in documents],
        )
    return await run_in_threadpool(
        enqueue_case_documents,
        user_id=user_id,
        folder_name=folder_name,
        documents=[document.model_dump(mode="json") for document in documents],
    )


@router.post("/{folder_name}/google-drive/import")
def import_google_drive_documents(
    folder_name: str,
    request: DriveImportRequest,
    x_google_access_token: str | None = Header(default=None, alias="X-Google-Access-Token"),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    llm_config = get_llm_chat_config(user_id=user_id, plan_limit_mode="summarization")
    file_ids = [item.strip() for item in (request.file_ids or []) if item.strip()]
    if not file_ids:
        raise HTTPException(status_code=400, detail="file_ids is required")
    if not x_google_access_token:
        raise HTTPException(status_code=401, detail="X-Google-Access-Token header is required")

    logger.info(
        "[Route:import_google_drive_documents] status=received user_id=%s folder=%s files=%d",
        user_id,
        folder_name,
        len(file_ids),
    )

    documents: list[DocumentReference] = []
    failed: list[dict[str, str]] = []
    for file_id in file_ids:
        try:
            data, filename, mime_type = google_drive_tool.download_file_bytes(
                x_google_access_token, file_id
            )
            # Storage quota check (per file, after download so we know the real size)
            storage_check = assert_storage_allowed(user_id, len(data))
            if not storage_check.get("ok"):
                raise HTTPException(
                    status_code=507,
                    detail=storage_check.get("message", "Storage limit exceeded. Delete files or upgrade your plan."),
                )
            check = assert_upload_allowed(
                user_id,
                llm_config,
                files_count=len(file_ids),
                size_bytes=len(data),
                buffer=data,
                mimetype=mime_type,
                originalname=filename,
            )
            if not check.get("ok"):
                failed.append({"file_id": file_id, "error": check.get("message", "Upload restricted by policy")})
                continue
            documents.append(
                _upload_drive_bytes_and_build_document(
                    user_id=user_id,
                    folder_name=folder_name,
                    filename=filename,
                    mime_type=mime_type,
                    data=data,
                    source_file_id=file_id,
                )
            )
        except Exception as exc:
            logger.exception(
                "[Route:import_google_drive_documents] status=file_failed folder=%s file_id=%s error=%s",
                folder_name,
                file_id,
                exc,
            )
            failed.append({"file_id": file_id, "error": str(exc)})

    if not documents:
        raise HTTPException(
            status_code=502,
            detail={"message": "Failed to import files from Google Drive", "failed": failed},
        )

    if not request.process:
        # Case Storage import: plain storage rows, no processing pipeline.
        queue_result = store_case_documents(
            user_id=user_id,
            folder_name=folder_name,
            documents=[document.model_dump(mode="json") for document in documents],
        )
    else:
        queue_result = enqueue_case_documents(
            user_id=user_id,
            folder_name=folder_name,
            documents=[document.model_dump(mode="json") for document in documents],
        )
    queue_result["google_drive"] = {
        "requested_count": len(file_ids),
        "imported_count": len(documents),
        "failed_count": len(failed),
        "failed": failed,
    }
    return queue_result


@router.post("/{folder_name}/clean-chunks")
def clean_case_chunk_text(
    folder_name: str,
    llm: bool = Query(default=True, description="Use LLM reconstruction for chunks still fragmented after the deterministic pass."),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Re-clean the text of a case's ALREADY-stored chunks IN PLACE (no PDF re-OCR,
    no re-embedding; embeddings and chat history are kept).

    Two passes per chunk: a free deterministic OCR-artefact repair, then — when
    `llm=true` (default) and the chunk still looks fragmented — an LLM
    reconstruction pass that repairs arbitrary fragments (names/places, "p .a .",
    "18 %") a dictionary cannot. Run once per case after the OCR-cleanup work.
    Pass `?llm=false` for the deterministic-only (free) pass.
    """
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    return get_folder_service().clean_existing_chunk_text(user_id, folder_name, use_llm=llm)


def _build_signed_upload(user_id: str, folder_name: str, request: GenerateUploadUrlRequest, llm_config: dict[str, Any] | None = None) -> dict[str, Any]:
    safe_name = (request.filename or f"upload-{uuid.uuid4().hex[:8]}").replace("\\", "_").replace("/", "_")
    object_path = str(PurePosixPath(user_id) / "documents" / folder_name / f"{uuid.uuid4().hex[:10]}_{safe_name}")
    signed_url = gcs.signed_upload_url(
        destination_path=object_path,
        content_type=request.mimetype or "application/octet-stream",
        bucket_type="input",
    )
    if llm_config is None:
        llm_config = get_llm_chat_config(user_id=user_id, plan_limit_mode="summarization")
    settings = get_settings()
    bucket_name = settings.gcs_input_bucket_name or settings.gcs_bucket_name or "fileinputbucket"
    return {
        "success": True,
        "signedUrl": signed_url,
        "gcsPath": f"gs://{bucket_name}/{object_path}",
        "filename": safe_name,
        "maxAllowedSizeMb": get_request_upload_ceiling_mb(llm_config),
        "planLimits": {
            "max_document_size_mb": llm_config.get("max_document_size_mb") or 0,
            "max_document_pages": llm_config.get("max_document_pages") or 0,
            "max_file_upload_per_day": llm_config.get("max_file_upload_per_day") or 0,
            "max_upload_files": llm_config.get("max_upload_files") or 0,
            "plan_name": llm_config.get("_plan_name"),
        },
    }


@router.post("/{folder_name}/generate-upload-url")
def generate_upload_url_for_folder(
    folder_name: str,
    request: GenerateUploadUrlRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    try:
        llm_config = get_llm_chat_config(user_id=user_id, plan_limit_mode="summarization")
        # File-level checks (size, pages, daily limit)
        check = assert_upload_allowed(
            user_id,
            llm_config,
            files_count=1,
            size_bytes=request.size or 0,
            mimetype=request.mimetype,
            originalname=request.filename,
        )
        if not check.get("ok"):
            raise HTTPException(status_code=429, detail=check)
        # Plan-level storage quota check
        storage_check = assert_storage_allowed(user_id, size_bytes=request.size or 0)
        if not storage_check.get("ok"):
            raise HTTPException(status_code=429, detail=storage_check)
        return _build_signed_upload(user_id, folder_name, request, llm_config)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[Route:generate_upload_url] folder=%s error=%s", folder_name, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{folder_name}/draft/export-docx")
async def export_edited_draft_docx(
    folder_name: str,
    request: DraftExportDocxRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Render EDITED draft markdown (from Draft Studio's editor) into a court-styled .docx
    and return a signed download URL. Same pipeline as the live draft's DOCX export, but
    driven by the user's edited markdown so the download always reflects their changes."""
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    md = (request.markdown or "").strip()
    if not md:
        raise HTTPException(status_code=400, detail="markdown is required")
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        from app.services.docx_export import markdown_to_court_docx
        docx_bytes = await loop.run_in_executor(
            None, lambda: markdown_to_court_docx(md, title=(request.title or "Draft"), typography=None)
        )
        safe_name = (re.sub(r"[^A-Za-z0-9._-]+", "_", request.filename or folder_name or "draft").strip("_") or "draft")[:60]
        safe_name = re.sub(r"\.docx?$", "", safe_name, flags=re.IGNORECASE)
        dest = f"{user_id}/drafts/{safe_name}_{uuid.uuid4().hex[:12]}.docx"
        uri = await loop.run_in_executor(
            None,
            lambda: gcs.upload_bytes(
                docx_bytes, dest,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                bucket_type="output",
            ),
        )
        url = await loop.run_in_executor(None, lambda: gcs.signed_read_url(uri, expiration_minutes=1440))
        return {"download_url": url, "filename": f"{safe_name}.docx"}
    except Exception as exc:
        logger.exception("[Route:export_edited_draft_docx] folder=%s error=%s", folder_name, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{folder_name}/draft/update")
async def update_draft_message(
    folder_name: str,
    request: DraftUpdateRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Persist an edited draft (MARKDOWN) back onto its saved chat row, so history reopens
    the edited version. Targets the newest row for this session."""
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    if not (request.session_id or "").strip():
        raise HTTPException(status_code=400, detail="session_id is required")
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        updated = await loop.run_in_executor(
            None,
            lambda: get_folder_service().update_latest_chat_answer(
                user_id=user_id, folder_name=folder_name,
                session_id=request.session_id, answer=request.markdown or "",
            ),
        )
        return {"updated": updated}
    except Exception as exc:
        logger.exception("[Route:update_draft_message] folder=%s error=%s", folder_name, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{folder_name}/complete-upload")
def complete_upload_for_folder(
    folder_name: str,
    request: CompleteUploadRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    try:
        llm_config = get_llm_chat_config(user_id=user_id, plan_limit_mode="summarization")
        # For PDFs, download from GCS so we can enforce the page-count limit.
        name = (request.filename or "").lower()
        mime = (request.mimetype or "").lower()
        is_pdf = mime == "application/pdf" or name.endswith(".pdf")
        pdf_buffer: bytes | None = None
        if is_pdf and request.gcsPath:
            try:
                pdf_buffer = gcs.download_bytes(request.gcsPath)
            except Exception as dl_exc:
                logger.warning("[Route:complete_upload] PDF download for page check failed: %s", dl_exc)
        check = assert_upload_allowed(
            user_id,
            llm_config,
            files_count=1,
            size_bytes=request.size or 0,
            mimetype=request.mimetype,
            originalname=request.filename,
            buffer=pdf_buffer,
        )
        if not check.get("ok"):
            raise HTTPException(status_code=429, detail=check)
        # Plan-level storage quota check (at completion, file is already in GCS)
        storage_check = assert_storage_allowed(user_id, size_bytes=request.size or 0)
        if not storage_check.get("ok"):
            raise HTTPException(status_code=429, detail=storage_check)
        # ── Resolve real file size from GCS when request.size is missing/zero ──
        declared_size = request.size or 0
        real_size = declared_size
        if declared_size == 0 and request.gcsPath:
            try:
                from app.services.adapters.gcs import _get_gcs_client
                from app.core.config import get_settings as _gs
                _s = _gs()
                _bn = _s.gcs_input_bucket_name or _s.gcs_bucket_name or "fileinputbucket"
                _gcs_path = request.gcsPath
                if _gcs_path.startswith("gs://"):
                    _gcs_path = "/".join(_gcs_path.split("/")[3:])
                _blob = _get_gcs_client().bucket(_bn).blob(_gcs_path)
                _blob.reload()
                real_size = _blob.size or 0
                logger.info(
                    "[Route:complete_upload] resolved real_size=%d bytes from GCS for %s",
                    real_size, request.filename,
                )
            except Exception as _size_exc:
                logger.debug("[Route:complete_upload] GCS size lookup failed: %s", _size_exc)

        document_payload = DocumentReference(
            document_name=request.filename or f"upload-{uuid.uuid4().hex[:8]}",
            mime_type=request.mimetype or "application/octet-stream",
            document_uri=request.gcsPath,
            metadata={
                "size": real_size,
                "original_name": request.filename or "",
                "gcs_path": request.gcsPath,
            },
        ).model_dump(mode="json")
        if not request.process:
            return store_case_documents(
                user_id=user_id,
                folder_name=folder_name,
                documents=[document_payload],
            )
        payload = enqueue_case_documents(
            user_id=user_id,
            folder_name=folder_name,
            documents=[document_payload],
        )
        return {
            "success": True,
            "message": "Upload completed and document queued for processing.",
            "folderName": folder_name,
            "document": payload,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[Route:complete_upload] folder=%s error=%s", folder_name, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/generate-upload-url")
def generate_upload_url_default(
    request: GenerateUploadUrlRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    default_folder = f"case_{uuid.uuid4().hex[:8]}"
    try:
        payload = _build_signed_upload(user_id, default_folder, request)
        payload["folderName"] = default_folder
        return payload
    except Exception as exc:
        logger.exception("[Route:generate_upload_url_default] error=%s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/complete-upload")
def complete_upload_default(
    request: CompleteUploadRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    folder_name = f"case_{uuid.uuid4().hex[:8]}"
    try:
        return complete_upload_for_folder(folder_name, request, x_user_id=x_user_id, authorization=authorization)
    except Exception as exc:
        logger.exception("[Route:complete_upload_default] error=%s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Case Storage: external editor documents (Google Docs / Zoho Writer) ─────
# Implemented natively (no drafting-service/zoho-service dependency): Google via
# per-user OAuth tokens held by authservice, Zoho via the Office Integrator API
# against DOCX files in our own GCS bucket. See services/adapters/external_editors.py.
from app.services.adapters import external_editors

GOOGLE_DOC_MIMETYPE = external_editors.GOOGLE_DOC_MIMETYPE
ZOHO_DOC_MIMETYPE = external_editors.DOCX_MIMETYPE


class CreateStorageDocumentRequest(BaseModel):
    provider: str  # 'google' | 'zoho'
    title: str


@router.post("/{folder_name}/create-document")
def create_storage_document(
    folder_name: str,
    request: CreateStorageDocumentRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    provider = (request.provider or "").strip().lower()
    title = (request.title or "").strip()
    if provider not in {"google", "zoho"}:
        raise HTTPException(status_code=400, detail="provider must be 'google' or 'zoho'")
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    service = get_folder_service()

    if provider == "google":
        try:
            created = external_editors.create_google_doc(user_id, title)
        except PermissionError:
            raise HTTPException(
                status_code=409,
                detail={"code": "GOOGLE_NOT_CONNECTED", "message": "Google Drive is not connected."},
            ) from None
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Google Docs creation failed: {exc}") from exc
        google_file_id = created["google_file_id"]
        result = service.create_external_document(
            user_id=user_id,
            folder_name=folder_name,
            provider="google",
            external_id=str(google_file_id),
            title=title,
            mimetype=GOOGLE_DOC_MIMETYPE,
            extra_metadata={"google_file_id": str(google_file_id)},
        )
        return {**result, "provider": "google"}

    # zoho: blank DOCX in OUR bucket; editing sessions run against a signed URL of it.
    file_name = title if title.lower().endswith(".docx") else f"{title}.docx"
    try:
        docx_bytes = external_editors.build_blank_docx()
        storage_key = service._build_file_storage_key(str(user_id), folder_name, file_name)
        gs_uri = gcs.upload_bytes(docx_bytes, storage_key, content_type=ZOHO_DOC_MIMETYPE)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not create blank document: {exc}") from exc
    result = service.create_external_document(
        user_id=user_id,
        folder_name=folder_name,
        provider="zoho",
        external_id="",  # identity is the file row itself; sessions use gcs_path
        title=file_name,
        mimetype=ZOHO_DOC_MIMETYPE,
        gcs_path=gs_uri,
        size=len(docx_bytes),
    )
    return {**result, "provider": "zoho"}


@router.post("/file/{file_id}/editor-session")
def get_editor_session(
    file_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        record = get_folder_service().get_external_document(file_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    metadata = record.get("metadata") or {}
    provider = (metadata.get("provider") or "").lower()

    if provider == "google":
        google_file_id = metadata.get("google_file_id") or metadata.get("external_id")
        if not google_file_id:
            raise HTTPException(status_code=500, detail="Missing Google file id on document")
        return {
            "success": True,
            "provider": "google",
            "iframeUrl": f"https://docs.google.com/document/d/{google_file_id}/edit?embedded=true",
        }

    if provider == "zoho":
        gcs_path = record.get("gcs_path") or ""
        if not gcs_path.startswith("gs://"):
            raise HTTPException(status_code=500, detail="Zoho document has no storage object")
        try:
            signed_url = gcs.signed_read_url(gcs_path, expiration_minutes=120)
            save_url = (
                f"{external_editors.public_base_url()}/api/files/storage/zoho-save-callback"
                f"?fileId={record['id']}"
            )
            session = external_editors.create_zoho_writer_session(
                signed_url=signed_url,
                file_name=record.get("name") or "document.docx",
                file_id=record["id"],
                save_callback_url=save_url,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Zoho session failed: {exc}") from exc
        return {"success": True, "provider": "zoho", **session}

    raise HTTPException(status_code=400, detail=f"Unknown provider '{provider}'")


@router.post("/storage/zoho-save-callback")
async def zoho_save_callback(request: Request, fileId: str = Query(...)) -> dict:
    """Public endpoint Zoho's servers POST the saved DOCX to (multipart).

    Auth model mirrors zoho-service's public save-callback: the unguessable file
    UUID scopes the write, and bytes only ever overwrite that row's own object.
    """
    try:
        record = get_folder_service().get_external_document_by_id(fileId)
    except ValueError:
        return {"status": "received", "error": "document not found"}
    gcs_path = (record.get("gcs_path") or "")
    if not gcs_path.startswith("gs://"):
        return {"status": "received", "error": "document has no storage object"}

    form = await request.form()
    file_bytes = b""
    for value in form.values():
        if hasattr(value, "read"):
            file_bytes = await value.read()
            break
    if not file_bytes:
        return {"status": "received", "warning": "empty file"}

    destination = gcs_path.split("/", 3)[3]  # strip gs://bucket/
    await run_in_threadpool(
        gcs.upload_bytes, file_bytes, destination, ZOHO_DOC_MIMETYPE
    )
    await run_in_threadpool(
        get_folder_service().update_external_document_content, fileId, len(file_bytes)
    )
    logger.info("[Route:zoho_save_callback] fileId=%s bytes=%d saved", fileId, len(file_bytes))
    return {"status": "saved", "bytes": len(file_bytes)}


@router.post("/file/{file_id}/chat-source")
def prepare_chat_source(
    file_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    """Return a chattable file id for an editor-backed document: exports the
    CURRENT Google Doc as PDF / extracts the Zoho DOCX text into a hidden
    snapshot row, refreshed on every call so answers reflect the latest edits."""
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        return get_folder_service().prepare_chat_snapshot(file_id, user_id)
    except PermissionError:
        raise HTTPException(
            status_code=409,
            detail={"code": "GOOGLE_NOT_CONNECTED", "message": "Google Drive is not connected."},
        ) from None
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("[Route:prepare_chat_source] file=%s error=%s", file_id, exc)
        raise HTTPException(status_code=502, detail=f"Could not prepare document for chat: {exc}") from exc


@router.get("/storage/google-auth-status")
def get_google_auth_status(
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return external_editors.google_drive_status(user_id, authorization)


class RenameStorageFolderRequest(BaseModel):
    folderId: str
    newName: str


@router.post("/storage/rename-folder")
def rename_storage_folder(
    request: RenameStorageFolderRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        return get_folder_service().rename_storage_folder(user_id, request.folderId, request.newName)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("[Route:rename_storage_folder] error=%s", exc)
        raise HTTPException(status_code=500, detail="Failed to rename folder") from exc


@router.post("/create-folder")
def create_folder(
    request: CreateFolderRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    return create_case_folder(user_id, request.folderName, request.parentPath)


@router.post("/create")
def create_case(
    request: dict[str, Any] = Body(...),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    try:
        return create_case_with_folder(user_id, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("[Route:create_case] user_id=%s error=%s", user_id, exc)
        raise HTTPException(status_code=500, detail=f"Case creation failed: {exc}") from exc


@router.get("/folders")
def list_folders(
    scope: str = Query(default="cases"),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    logger.info("[Route:list_folders] status=received user_id=%s scope=%s", user_id, scope)
    return list_case_folders(user_id, scope="storage" if scope == "storage" else "cases")


@router.get("/cases")
def list_cases(
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    logger.info("[Route:list_cases] status=received user_id=%s", user_id)
    return list_cases_tool(user_id)


@router.get("/cases/{case_id}")
def get_case(
    case_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    try:
        return get_case_detail(case_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/cases/{case_id}")
def update_case(
    case_id: str,
    request: dict[str, Any] = Body(...),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    try:
        return update_case_tool(case_id, user_id, request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/cases/{case_id}")
def delete_case(
    case_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    return delete_case_tool(case_id, user_id)


@router.delete("/{file_id}")
def delete_file(
    file_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    """Delete a single file by its DB UUID — removes DB rows, chunks, vectors, and GCS object."""
    user_id = _resolve_user_id(x_user_id, authorization)
    logger.info("[Route:delete_file] file_id=%s user_id=%s", file_id, user_id)
    try:
        return get_folder_service().delete_file(file_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{folder_name}/files")
def get_documents_in_folder(
    folder_name: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    logger.info("[Route:get_documents_in_folder] status=received user_id=%s folder=%s", user_id, folder_name)
    return list_documents_in_case_folder(folder_name, user_id)


@router.get("/{folder_name}/status")
def get_folder_status(
    folder_name: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    try:
        return get_case_processing_status(folder_name, user_id=user_id)
    except ValueError:
        return {
            "folderName": folder_name,
            "case_id": folder_name,
            "job_id": None,
            "status": "queued",
            "progress": 0.0,
            "total_documents": 0,
            "processed_documents": 0,
            "failed_documents": 0,
            "documents": [],
        }
    except Exception:
        return {
            "folderName": folder_name,
            "case_id": folder_name,
            "job_id": None,
            "status": "queued",
            "progress": 0.0,
            "total_documents": 0,
            "processed_documents": 0,
            "failed_documents": 0,
            "documents": [],
        }


@router.post("/{folder_name}/extract-case-fields")
def extract_case_fields(folder_name: str) -> dict:
    try:
        return extract_case_fields_from_case_folder(folder_name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{folder_name}/chronology")
def get_folder_chronology(folder_name: str) -> dict:
    try:
        return get_case_chronology(folder_name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{folder_name}/learning/init")
def init_learning_session(
    folder_name: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    session_id = str(payload.get("sessionId") or payload.get("session_id") or uuid.uuid4())
    adversarial_mode = bool(payload.get("adversarial_mode") or payload.get("adversarialMode") or False)
    document_context = str(payload.get("documentContext") or payload.get("document_context") or "").strip()
    if not document_context:
        document_context = build_learning_folder_document_context(
            get_folder_service(), folder_name, user_id
        ).strip()
    if not document_context:
        raise HTTPException(
            status_code=400,
            detail="No processed documents with text are available for Learning Mode in this folder.",
        )
    state = LearningAgentController.init_session(
        user_id=user_id,
        folder_name=folder_name,
        session_id=session_id,
        document_context=document_context,
        learning_mode_active=True,
        adversarial_mode=adversarial_mode,
    )
    return {
        "success": True,
        "sessionId": session_id,
        "turnCount": state.turn_count,
        "turnThreshold": LearningAgentController.TURN_THRESHOLD,
        "knowledgeLevel": state.knowledge_level,
        "adversarialMode": state.adversarial_mode,
        "learningModeActive": state.learning_mode_active,
    }


@router.get("/{folder_name}/learning/session/{session_id}")
def get_learning_session_state(
    folder_name: str,
    session_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    snap = LearningAgentController.get_session_snapshot(
        user_id=user_id,
        folder_name=folder_name,
        session_id=session_id,
    )
    if snap is None:
        raise HTTPException(status_code=404, detail="Learning session not found or expired.")
    return {"success": True, "session": snap}


@router.post("/{folder_name}/learning/questions/answer")
def submit_learning_question_answer(
    folder_name: str,
    body: LearningQuestionAnswerPayload,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    sid = (body.session_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id is required")
    result = LearningAgentController.record_mcq_answer(
        user_id=user_id,
        folder_name=folder_name,
        session_id=sid,
        question_id=body.question_id or "",
        selected_answer=body.selected_answer or "",
        time_taken=body.time_taken,
    )
    return {"success": True, **result}


@router.post("/{folder_name}/learning/questions/generate")
def generate_learning_question(
    folder_name: str,
    body: LearningQuestionGeneratePayload,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """On-demand MCQ from indexed chunks (uses learning_mode_agent LLM routing)."""
    from app.services.adapters.document_ai import _generate_text
    from app.services.learning_document_retrieval import format_chunks_for_prompt, get_relevant_chunks
    from app.services.learning_question_validator import validate_question

    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    folder_service = get_folder_service()
    docs_result = folder_service.get_documents_in_folder(folder_name, user_id)
    records = docs_result.get("documents") or docs_result.get("files") or []
    fids = [str(d.get("id")) for d in records if d.get("id")]
    fids = [x for x in fids if x][:48]
    if not fids:
        raise HTTPException(status_code=400, detail="No documents available for this folder.")
    concept_q = (body.concept or "key facts in the record").strip()
    chunks = get_relevant_chunks(
        user_id=user_id,
        case_id=folder_name,
        query=concept_q,
        file_ids=fids,
        top_k=5,
        include_surrounding_chunks=True,
        similarity_floor=0.35,
    )
    excerpt = format_chunks_for_prompt(chunks, max_chars=10000)
    if not excerpt.strip():
        raise HTTPException(status_code=400, detail="No indexed chunks returned for this query.")
    llm_config = get_llm_chat_config(
        user_id=user_id,
        force_refresh=False,
        plan_limit_mode="summarization",
    )
    prompt = (
        "You create ONE document-grounded multiple-choice verification question.\n"
        f"Target concept/topic: {concept_q}\n"
        f"Requested difficulty: {body.difficulty}\n"
        f"Question style: {body.question_type}\n"
        "Return ONLY JSON with this exact shape (no markdown):\n"
        '{"question_text":"...","options":[{"id":"A","text":"..."},'
        '{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],'
        '"correct_answer":"B","explanations":{"A":"...","B":"...","C":"...","D":"..."},'
        f'"difficulty":"{body.difficulty}","concept":"{concept_q[:80]}",'
        '"page_reference":0,"question_type":"synthesis","grounding_ids":["source_a","source_b"]}\n'
        "=== CASE EXCERPTS ===\n"
        f"{excerpt}\n"
    )
    try:
        raw = _generate_text(
            prompt,
            for_summary=True,
            agent_name="learning_mode_agent",
            user_id=user_id,
            summarization_llm_config=llm_config,
        )
    except Exception as exc:
        logger.exception("[learning/questions/generate] LLM failed folder=%s", folder_name)
        raise HTTPException(status_code=502, detail="Unable to generate a question right now.") from exc
    payload, ok = LearningAgentController.parse_model_json_with_status(raw or "")
    if not ok:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON for question generation.")
    pq = payload.get("popup_question") if isinstance(payload.get("popup_question"), dict) else payload
    if not isinstance(pq, dict):
        raise HTTPException(status_code=502, detail="Generated payload missing question fields.")
    merged = dict(LearningAgentController.fallback_payload())
    merged["popup_question"] = pq
    merged = LearningAgentController.normalize_payload(merged)
    pq2 = merged.get("popup_question")
    if not isinstance(pq2, dict):
        v = validate_question(pq)
        raise HTTPException(
            status_code=422,
            detail={"message": "Question failed validation", "errors": v.get("errors"), "raw": pq},
        )
    sid_gen = (body.session_id or "").strip()
    if sid_gen:
        LearningAgentController.register_popup_question(
            user_id=user_id,
            folder_name=folder_name,
            session_id=sid_gen,
            popup=pq2,
        )
    return {
        "success": True,
        "question_data": sanitize_public_popup(pq2),
        "question_private_note": "Answers are evaluated with POST /api/files/{folder}/learning/questions/answer when session_id was provided.",
    }


@router.post("/{folder_name}/learning/analyze-relationships")
def analyze_learning_relationships(
    folder_name: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Deep grounding map for learning mode:
    conflicting facts, key dates, statutory requirements.
    """
    from app.services.learning_document_retrieval import analyze_relationships, get_relevant_chunks

    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    folder_service = get_folder_service()
    docs_result = folder_service.get_documents_in_folder(folder_name, user_id)
    records = docs_result.get("documents") or docs_result.get("files") or []
    fids = [str(d.get("id")) for d in records if d.get("id")]
    fids = [x for x in fids if x][:64]
    if not fids:
        raise HTTPException(status_code=400, detail="No documents available for this folder.")

    query = str(payload.get("query") or payload.get("focus") or "identify contradictions and statutory requirements").strip()
    chunks = get_relevant_chunks(
        user_id=user_id,
        case_id=folder_name,
        query=query,
        file_ids=fids,
        top_k=12,
        include_surrounding_chunks=True,
        similarity_floor=0.2,
    )
    if not chunks:
        raise HTTPException(status_code=404, detail="No indexed chunks found for relationship analysis.")
    rel = analyze_relationships(chunks, max_pairs=16)
    return {
        "success": True,
        "folder_name": folder_name,
        "query": query,
        "grounding": rel,
        "source_count": len(chunks),
    }


@router.post("/{folder_name}/learning/draft-bridge")
def learning_draft_bridge(
    folder_name: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Bridge drafting -> learning:
    detect weak/missing legal points in draft section and suggest quick verification loop.
    """
    from app.services.learning_document_retrieval import analyze_relationships, get_relevant_chunks

    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    draft_text = str(payload.get("draft_text") or payload.get("draftText") or "").strip()
    section_name = str(payload.get("section_name") or payload.get("sectionName") or "Grounds").strip()
    if not draft_text:
        raise HTTPException(status_code=400, detail="draft_text is required")

    folder_service = get_folder_service()
    docs_result = folder_service.get_documents_in_folder(folder_name, user_id)
    records = docs_result.get("documents") or docs_result.get("files") or []
    fids = [str(d.get("id")) for d in records if d.get("id")]
    fids = [x for x in fids if x][:48]
    if not fids:
        return {"success": True, "trigger_learning_popup": False, "message": "No processed documents yet."}

    chunks = get_relevant_chunks(
        user_id=user_id,
        case_id=folder_name,
        query="jurisdiction limitation maintainability contradiction grounds",
        file_ids=fids,
        top_k=8,
        include_surrounding_chunks=True,
        similarity_floor=0.25,
    )
    rel = analyze_relationships(chunks, max_pairs=8)
    draft_l = draft_text.lower()
    missing_jurisdiction = "jurisdiction" not in draft_l and any(
        "jurisdiction" in str(item.get("requirement") or "").lower()
        for item in rel.get("statutory_requirements") or []
    )
    weak_signal = missing_jurisdiction or len(rel.get("conflicting_facts") or []) > 0
    message = ""
    if missing_jurisdiction:
        message = (
            f"I see you're drafting the '{section_name}' section. Based on case files, "
            "you may have missed a jurisdiction point. Want a quick 2-question verification loop?"
        )
    elif weak_signal:
        message = (
            f"I see a potential contradiction relevant to '{section_name}'. "
            "Want a quick verification loop before finalizing this argument?"
        )
    return {
        "success": True,
        "trigger_learning_popup": weak_signal,
        "message": message,
        "grounding_preview": {
            "conflicts": rel.get("conflicting_facts", [])[:2],
            "requirements": rel.get("statutory_requirements", [])[:5],
        },
    }


@router.post("/{folder_name}/intelligent-chat")
def intelligent_chat(
    folder_name: str,
    request: FolderChatRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    if bool(getattr(request, "learning_mode", False)):
        session_id = str(request.session_id or uuid.uuid4())
        document_context = str(getattr(request, "document_context", "") or "").strip()
        if not document_context:
            document_context = build_learning_folder_document_context(
                get_folder_service(), folder_name, user_id
            ).strip()
        if not document_context:
            raise HTTPException(
                status_code=400,
                detail="No processed documents with text are available for Learning Mode in this folder.",
            )
        if LearningAgentController.get_state(
            user_id=user_id,
            folder_name=folder_name,
            session_id=session_id,
        ) is None:
            LearningAgentController.init_session(
                user_id=user_id,
                folder_name=folder_name,
                session_id=session_id,
                document_context=document_context,
                learning_mode_active=True,
                adversarial_mode=bool(getattr(request, "adversarial_mode", False)),
            )
        state_meta = LearningAgentController.processMessage(
            sessionId=session_id,
            userMessage=(request.question or ""),
            userId=user_id,
            folderName=folder_name,
        )
        return {
            "success": True,
            "learningMode": True,
            "sessionId": session_id,
            "meta": state_meta,
            "message": "Use /intelligent-chat/stream for full Socratic guided response events.",
        }
    q = (request.question or "").strip()
    sid = (request.secret_id or "").strip()
    if not q and not sid:
        raise HTTPException(status_code=400, detail="question or secret_id is required")

    uid_int = _user_id_as_int(user_id)
    cap_est = estimate_streaming_token_request(q, has_secret_prompt=bool(sid))
    cap_enf = enforce_limits(uid_int, {"tokens": cap_est["estimated_total_tokens"]})
    logger.info(
        "[FolderChat TOKEN CAP] Enforcement result userId=%s folder=%s requestedTokens=%s allowed=%s message=%s",
        uid_int,
        folder_name,
        cap_est["estimated_total_tokens"],
        cap_enf.get("allowed"),
        cap_enf.get("message"),
    )
    if not cap_enf.get("allowed"):
        raise HTTPException(
            status_code=403,
            detail=f"{cap_enf.get('message', '')} {cap_enf.get('details', '')}".strip(),
        )

    logger.info(
        "[Route:intelligent_chat] status=received folder=%s session_id=%s",
        folder_name,
        request.session_id,
    )
    try:
        result = answer_case_folder_chat(
            user_id=user_id,
            folder_name=folder_name,
            request=request,
            authorization=authorization,
        )
        requested_model = (request.llm_name or "").strip()
        if requested_model.lower() in {"", "gemini", "claude", "deepseek", "kimi", "default"}:
            requested_model = ""
        model_name = str(
            resolve_secret_prompt_llm_name(request.secret_id)
            or requested_model
            or (get_llm_chat_config(user_id=user_id, force_refresh=False) or {}).get("llm_model")
            or "unknown"
        )
        answer_text = str(result.get("answer") or "")
        request_id = uuid.uuid4().hex[:12]
        log_llm_usage(
            user_id=uid_int,
            model_name=model_name,
            input_tokens=estimate_tokens_from_text(q),
            output_tokens=estimate_tokens_from_text(answer_text),
            endpoint="/api/files/{folder}/intelligent-chat",
            request_id=request_id,
            session_id=str(result.get("session_id") or request.session_id or ""),
        )
        return result
    except ValueError as exc:
        logger.exception("[Route:intelligent_chat] folder=%s validation_error=%s", folder_name, exc)
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("[Route:intelligent_chat] folder=%s unexpected_error=%s", folder_name, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# Strong references to detached streaming producers. asyncio holds only WEAK references
# to tasks, so a task nobody keeps can be garbage-collected mid-flight — which would
# silently kill exactly the background generation this set exists to protect.
_BACKGROUND_STREAM_TASKS: set[asyncio.Task] = set()


@router.post("/{folder_name}/intelligent-chat/stream")
async def intelligent_chat_stream(
    folder_name: str,
    request: FolderChatRequest,
    fastapi_request: Request,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    """
    SSE endpoint that the frontend useIntelligentFolderChat hook calls.
    Emits: metadata → chunk (one per answer segment) → done (with citations) | error
    """
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    logger.info(
        "[Route:intelligent_chat_stream] status=received folder=%s session_id=%s user_id=%s",
        folder_name,
        request.session_id,
        user_id,
    )

    async def _event_generator() -> AsyncGenerator[str, None]:
        def _sse(payload: dict) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        import asyncio
        from app.services.adapters.document_ai import (
            _call_gemini_for_qa,
            gemini_stream_config_for_folder_chat,
            stream_config_for_folder_chat,
            claude_stream_generator,
            claude_draft_stream_generator,
            deepseek_stream_generator,
            kimi_stream_generator,
            normalize_markdown_render_output,
        )
        from app.services.prompt_orchestration import (
            PERMANENT_SYSTEM_PROMPT,
            format_instruction_for_query,
        )
        from app.services.clarification import (
            CLARIFICATION_PROTOCOL,
            clarification_to_markdown,
            parse_clarification,
        )

        async def _run_blocking(func, *, timeout_s: float, timeout_message: str):
            try:
                return await asyncio.wait_for(
                    loop.run_in_executor(None, func),
                    timeout=timeout_s,
                )
            except asyncio.TimeoutError as exc:
                logger.warning(
                    "[Route:intelligent_chat_stream] folder=%s timeout=%ss step=%s",
                    folder_name,
                    timeout_s,
                    timeout_message,
                )
                raise TimeoutError(timeout_message) from exc

        async def _draft_run_blocking(func, *, timeout_s: float, timeout_message: str):
            # Same as _run_blocking, but BINDS the request's token-usage session inside the
            # executor thread. The draft pipeline runs every model call here; without the
            # bind those calls (on pool threads) miss the accumulator and only log per-call.
            # Binding makes them aggregate, so we can report the draft's per-model token burn.
            def _wrapped():
                bind_token_usage_session(usage_session_key)
                try:
                    return func()
                finally:
                    unbind_token_usage_session()
            try:
                return await asyncio.wait_for(
                    loop.run_in_executor(None, _wrapped),
                    timeout=timeout_s,
                )
            except asyncio.TimeoutError as exc:
                logger.warning(
                    "[Route:intelligent_chat_stream] folder=%s timeout=%ss step=%s",
                    folder_name, timeout_s, timeout_message,
                )
                raise TimeoutError(timeout_message) from exc

        def _truncate_prompt(text: str, *, max_chars: int, label: str) -> str:
            raw = text or ""
            if len(raw) <= max_chars:
                return raw
            logger.warning(
                "[Route:intelligent_chat_stream] truncating %s from %s to %s chars to keep model context safe",
                label,
                len(raw),
                max_chars,
            )
            return raw[:max_chars]

        # Emit immediately so the frontend does not look stuck while we gather profile/config context.
        yield _sse({"type": "status", "status": "initializing", "message": "Preparing legal assistant context..."})
        yield _sse({"type": "thinking", "text": "Loading legal prompt and profile context...\n"})

        loop = asyncio.get_running_loop()
        usage_session_key = begin_token_usage_session()
        chat_request = request
        llm_config = getattr(fastapi_request.state, "llm_chat_config", None) or get_llm_chat_config(
            user_id=user_id,
            force_refresh=False,
            plan_limit_mode="summarization",
        )
        llm_config = merge_folder_chat_request_llm_overrides(llm_config, chat_request)
        try:
            user_profile = await _run_blocking(
                lambda: fetch_full_profile(user_id, authorization),
                timeout_s=3.0,
                timeout_message="profile_fetch",
            )
        except Exception:
            logger.warning(
                "[Route:intelligent_chat_stream] folder=%s user_id=%s profile fetch timed out, using empty profile",
                folder_name,
                user_id,
            )
            user_profile = {}
        system_instruction = build_document_qa_system_prompt(user_profile)
        logger.info(
            "[Route:intelligent_chat_stream] system_prompt_chars=%s user_id=%s folder=%s",
            len(system_instruction),
            user_id,
            folder_name,
        )
        try:
            query_text, display_question = resolve_query_and_display(
                question=chat_request.question,
                secret_id=chat_request.secret_id,
                prompt_label=chat_request.prompt_label,
                authorization=authorization,
            )
        except ValueError as exc:
            yield _sse({"type": "error", "message": str(exc)})
            return
        if not query_text:
            yield _sse({"type": "error", "message": "Please enter a question."})
            return
        requested_model_name = (chat_request.llm_name or "").strip()
        # The UI may send a bare provider label instead of a concrete model id.
        # Map "deepseek"/"claude" to their configured model so the request actually
        # routes to that provider; "gemini"/"default"/"" fall back to the agent's
        # own model (Gemini). Without this, "deepseek" was blanked and free-text
        # questions silently fell back to the Gemini QA agent.
        _provider_label = requested_model_name.lower()
        if _provider_label in {"", "gemini", "default"}:
            requested_model_name = ""
        elif _provider_label == "deepseek":
            requested_model_name = get_settings().deepseek_model
        elif _provider_label == "claude":
            requested_model_name = get_settings().claude_model
        elif _provider_label == "kimi":
            requested_model_name = get_settings().kimi_model
        selected_model_name = resolve_secret_prompt_llm_name(chat_request.secret_id) or requested_model_name or None
        # ── Admin-panel model control ────────────────────────────────────────────────
        # When the user did NOT explicitly pick a model in chat (no secret-prompt model, no dropdown),
        # use the model configured in the LLM Management → Summarization Chat panel
        # (summarization_chat_config.llm_model). That table IS live-synced to this service's DB, unlike
        # the agent_prompts row the model previously resolved from (a separate super-admin store the
        # panel never writes to — model changes there never reached us). Passing it as
        # selected_model_name flows it through as model_name_override everywhere, so it wins over the
        # stale agent_prompts row and an admin's panel choice takes effect with NO DB edits.
        # Precedence kept: secret-prompt model > in-chat dropdown > LLM Management panel > agent_prompts.
        _panel_model = str((llm_config or {}).get("llm_model") or "").strip()
        _model_source = "in_chat" if selected_model_name else None
        if not selected_model_name and _panel_model:
            selected_model_name = _panel_model
            _model_source = "llm_management_panel(summarization_chat_config)"
        logger.info(
            "[Route:intelligent_chat_stream] model_resolution folder=%s secret_id=%s model=%s source=%s",
            folder_name,
            (chat_request.secret_id or "").strip() or None,
            selected_model_name,
            _model_source or "agent_prompts_fallback",
        )

        folder_service = get_folder_service()
        learning_pedagogy_directive = ""
        learning_chunk_addon = ""
        learning_grounding_chunks: list[dict[str, Any]] = []
        # Number of RAG passages actually fed to the model this request (for the
        # final token-usage table). None until a retrieval path runs.
        _rag_chunks_used: int | None = None

        learning_mode = bool(getattr(chat_request, "learning_mode", False))
        research_mode = bool(getattr(chat_request, "research_mode", False))
        if learning_mode and research_mode:
            yield _sse({"type": "error", "message": "Choose either Learning Mode or Research Mode, not both."})
            return
        # Deep Research is a bounded agentic loop (plan → web-search rounds → synthesize) with
        # a hard rupee budget. It supersedes the single-pass Research and Learning modes.
        deep_research = bool(getattr(chat_request, "deep_research", False))
        if deep_research:
            research_mode = False
            learning_mode = False
        learning_agent_name = "learning_mode_agent" if learning_mode else None
        learning_state = None
        if learning_mode:
            session_id_for_learning = str(chat_request.session_id or uuid.uuid4())
            document_context = str(getattr(chat_request, "document_context", "") or "").strip()
            if not document_context:
                try:
                    built_ctx = await _run_blocking(
                        lambda: build_learning_folder_document_context(
                            folder_service, folder_name, user_id
                        ),
                        timeout_s=90.0,
                        timeout_message="learning_document_context",
                    )
                except Exception as exc:
                    logger.warning(
                        "[Route:intelligent_chat_stream] learning_document_context build failed folder=%s user_id=%s error=%s",
                        folder_name,
                        user_id,
                        exc,
                    )
                    built_ctx = ""
                document_context = str(built_ctx or "").strip()
            if not document_context:
                yield _sse(
                    {
                        "type": "error",
                        "message": "Add processed documents to this case before using Learning Mode.",
                    }
                )
                return
            existing_state = LearningAgentController.get_state(
                user_id=user_id,
                folder_name=folder_name,
                session_id=session_id_for_learning,
            )
            if existing_state is None or existing_state.document_context.strip() != document_context:
                LearningAgentController.init_session(
                    user_id=user_id,
                    folder_name=folder_name,
                    session_id=session_id_for_learning,
                    document_context=document_context,
                    learning_mode_active=True,
                    adversarial_mode=bool(getattr(chat_request, "adversarial_mode", False)),
                )
            chat_request = chat_request.model_copy(update={"session_id": session_id_for_learning})
            learning_state = LearningAgentController.begin_turn(
                user_id=user_id,
                folder_name=folder_name,
                session_id=session_id_for_learning,
                user_text=query_text,
            )
            try:
                from app.services.question_strategy import should_ask_question

                _decision = should_ask_question(
                    LearningAgentController.strategy_context_for_state(learning_state, query_text)
                )
                learning_pedagogy_directive = LearningAgentController.build_pedagogy_directive(_decision)
                if bool(getattr(chat_request, "adversarial_mode", False)):
                    learning_pedagogy_directive = (
                        f"{learning_pedagogy_directive} ; adversarial_mode=true ; "
                        "force_multi_select=true ; include_popup_mcq=true ; suggested_question_type='synthesis'"
                    )
            except Exception as strat_exc:
                logger.warning(
                    "[Route:intelligent_chat_stream] learning pedagogy directive skipped folder=%s err=%s",
                    folder_name,
                    strat_exc,
                )

        uid_int = _user_id_as_int(user_id)
        has_secret_id = bool((chat_request.secret_id or "").strip())
        if deep_research:
            cap_est = _estimate_deep_research_token_request(
                query_text,
                llm_config=llm_config,
                max_rounds=getattr(get_settings(), "deep_research_max_rounds", 4),
            )
        else:
            cap_est = estimate_streaming_token_request(
                query_text,
                has_secret_prompt=has_secret_id,
            )
        cap_enf = enforce_limits(uid_int, {"tokens": cap_est["estimated_total_tokens"]})
        logger.info(
            "[STREAMING TOKEN CAP] Dataflow start userId=%s folder=%s hasSecretId=%s estimate=%s",
            uid_int,
            folder_name,
            has_secret_id,
            cap_est,
        )
        logger.info(
            "[STREAMING TOKEN CAP] Enforcement result userId=%s folder=%s requestedTokens=%s "
            "allowed=%s remainingTokens=%s message=%s capStatus=%s",
            uid_int,
            folder_name,
            cap_est["estimated_total_tokens"],
            cap_enf.get("allowed"),
            cap_enf.get("remainingTokens"),
            cap_enf.get("message"),
            cap_enf.get("capStatus"),
        )
        if not cap_enf.get("allowed"):
            logger.warning(
                "[STREAMING TOKEN CAP] Request blocked before folder processing userId=%s folder=%s",
                uid_int,
                folder_name,
            )
            yield _sse(
                {
                    "type": "error",
                    "message": cap_enf.get("message")
                    or "Your token quota has been exceeded. Please talk to your firm admin.",
                    "details": cap_enf.get("details") or "",
                }
            )
            return

        # Conversation continuity: include last N Q/A pairs (case-wise) when configured.
        effective_query_text = query_text
        try:
            effective_query_text = folder_service._build_query_with_recent_history(  # noqa: SLF001
                user_id=user_id,
                folder_name=folder_name,
                session_id=chat_request.session_id,
                query_text=query_text,
                max_history=int(llm_config.get("max_conversation_history") or 0),
            )
        except Exception:
            effective_query_text = query_text

        # Free-tier Gemma: cap the system prompt + conversation history + question at
        # gemma_history_system_max_chars (~5K tokens) so document chunks always get their full ~9K
        # budget and total input stays ~14K. If the history block is too long, drop the OLDEST
        # turns — the "Current question:" tail is always preserved. (Only trims for a Gemma chat;
        # other models keep full history.)
        try:
            from app.services.adapters.document_ai import _is_gemma_model as _is_gemma_hist
            _eff_settings = get_settings()
            # Resolve the effective chat model (selected override, else the admin grounded model).
            _hist_model = selected_model_name
            if not _hist_model:
                try:
                    from app.services.agent_config_service import get_agent_config as _gac_hist
                    _hist_model = (_gac_hist("grounded_retrieval_agent").model_name or "").strip()
                except Exception:
                    _hist_model = ""
            if (not learning_mode) and _is_gemma_hist(_hist_model) and effective_query_text:
                _hist_cap = int(getattr(_eff_settings, "gemma_history_system_max_chars", 20000) or 20000)
                # system prompt is built below (build_document_qa_system_prompt ~3.2K chars); reserve for it
                _room = max(2000, _hist_cap - 3200)
                if len(effective_query_text) > _room:
                    _marker = "Current question:\n"
                    _mi = effective_query_text.rfind(_marker)
                    if _mi != -1:
                        _q_tail = effective_query_text[_mi:]
                        _hist_room = max(0, _room - len(_q_tail))
                        _hist_head = effective_query_text[:_mi]
                        if _hist_room < len(_hist_head):
                            _hist_head = _hist_head[-_hist_room:] if _hist_room > 0 else ""
                        effective_query_text = _hist_head + _q_tail
                    else:
                        effective_query_text = effective_query_text[-_room:]
                    logger.info(
                        "[Route:intelligent_chat_stream] gemma history+system clamp folder=%s -> %d chars",
                        folder_name, len(effective_query_text),
                    )
        except Exception:
            pass

        # ── Step 1: emit status so the frontend shows "Analyzing..." ──
        yield _sse({"type": "status", "status": "analyzing", "message": "Analyzing query intent..."})
        yield _sse({"type": "thinking", "text": "Understanding your question and selecting the best answer path...\n"})

        # ── Step 2: direct streaming generation ──
        # NOTE: the old "vector path" pre-attempt was removed deliberately. It ran
        # a full non-stream RAG+LLM call under a 3s timeout that always expired;
        # the abandoned executor thread then finished minutes later and saved a
        # DUPLICATE chat row under a NEW session (with the resolved prompt body
        # leaked as the question) — doubling LLM cost per message and splitting
        # chat history into one-off sessions in the sidebar.
        vector_error: str | None = None
        if learning_mode:
            yield _sse(
                {
                    "type": "status",
                    "status": "learning_mode",
                    "message": "Learning Mode active: teaching from case materials per your configured system prompt.",
                }
            )
            yield _sse(
                {
                    "type": "thinking",
                    "text": "Using Learning Mode: case-grounded teaching (system prompt from configuration)...\n",
                }
            )
        # The vector 'fast path' (answer_case_folder_chat) is GONE, not merely skipped: it ran a
        # FULL non-stream generation that could not finish within vector_timeout_s for a thinking
        # model, so it always timed out — and because a worker thread cannot be cancelled, the
        # discarded generation kept running to completion, costing a SECOND model call per answer
        # (wasted tokens + rate-limit pressure). The DB+Gemini path below does the same focused
        # retrieval and streams the answer, so this was redundant; it always fell through anyway.
        yield _sse({"type": "thinking", "text": "Retrieving the most relevant passages...\n"})

        yield _sse(
            {
                "type": "status",
                "status": "fallback",
                "message": "Using direct generation for faster response...",
            }
        )

        # ── Step 4: DB + Gemini fallback ──
        yield _sse({"type": "status", "status": "searching", "message": "Searching documents..."})
        yield _sse({"type": "thinking", "text": "Reading available document text from this case...\n"})

        try:
            # Fetch all documents for this folder (DB path)
            docs_result = await _run_blocking(
                lambda: folder_service.get_documents_in_folder(folder_name, user_id),
                timeout_s=10.0,
                timeout_message="folder_documents_fetch",
            )
            documents = docs_result.get("documents") or docs_result.get("files") or []

            # Build list of {name, text} for Gemini
            eligible_docs = [
                d
                for d in documents
                if d.get("full_text_content") or d.get("summary")
            ]
            # Draft-from-template must see ALL supporting documents (the fact inventory is
            # built once over the whole set) — an 8-doc cap silently drops evidence and
            # forces later sections to blank/hallucinate. Give drafts the same generous cap
            # as learning mode.
            _draft_req = bool(getattr(chat_request, "draft_mode", False))
            default_cap = 24 if (learning_mode or _draft_req) else 8
            max_context_documents = max(1, int(llm_config.get("max_context_documents") or default_cap))
            if learning_mode or _draft_req:
                max_context_documents = min(len(eligible_docs), max(max_context_documents, 24))
            elif research_mode:
                max_context_documents = min(len(eligible_docs), max(max_context_documents, 12))
            doc_texts = [
                {
                    "name": d.get("name") or d.get("originalname") or "document",
                    "text": d.get("full_text_content") or d.get("summary") or "",
                    "file_id": d.get("id"),
                }
                for d in eligible_docs
            ][:max_context_documents]

            if not doc_texts:
                # No text available at all
                if vector_error and "not found" in vector_error.lower():
                    msg = (
                        "This case's documents are not yet indexed for chat. "
                        "Please upload and process the documents first, then try again."
                    )
                else:
                    msg = "No document text is available for this case yet. Please wait for processing to complete."
                yield _sse({"type": "error", "message": msg})
                return

            if learning_mode and learning_state is not None and doc_texts:
                try:
                    from app.services.learning_document_retrieval import format_chunks_for_prompt, get_relevant_chunks

                    fids = [str(d.get("file_id")) for d in doc_texts if d.get("file_id")]
                    fids = [x for x in fids if x][:48]
                    if fids:

                        def _fetch_learning_chunks():
                            return get_relevant_chunks(
                                user_id=user_id,
                                case_id=folder_name,
                                query=query_text,
                                file_ids=fids,
                                top_k=5,
                                include_surrounding_chunks=True,
                                similarity_floor=0.45,
                            )

                        chs = await _run_blocking(
                            _fetch_learning_chunks,
                            timeout_s=15.0,
                            timeout_message="learning_chunk_retrieval",
                        )
                        if chs:
                            learning_grounding_chunks = chs
                            _rag_chunks_used = len(chs)
                            learning_chunk_addon = format_chunks_for_prompt(chs, max_chars=14000)
                except Exception as chunk_exc:
                    logger.warning(
                        "[Route:intelligent_chat_stream] learning chunk retrieval failed folder=%s err=%s",
                        folder_name,
                        chunk_exc,
                    )

            # ── Normal chat: DYNAMIC context per question. ──
            # Comprehensive / summary asks ("summarize the case", "list all events", "detailed
            # overview") keep the FULL document(s) so the answer can cover the whole case.
            # Specific questions use focused semantic chunks (~6K tokens) for speed + cost.
            # On retrieval failure we keep the full documents (safe fallback).
            # Comprehensive/detailed asks keep full context AND get a forceful long-form prompt +
            # higher temperature below; specific asks stay focused/terse. Deep/extreme asks are a
            # strict escalation that ALSO triggers the multi-pass report generator. Computed once.
            is_deep = bool(not learning_mode and doc_texts and _is_deep_query(query_text))
            # Draft-from-template: explicit flag + an uploaded template (attached to the model as a
            # file). Treated like comprehensive for context sizing + temperature so the case's
            # supporting documents are fed as grounding evidence for filling the template.
            is_draft = bool(
                not learning_mode
                and getattr(chat_request, "draft_mode", False)
                and getattr(chat_request, "template_gcs_path", None)
            )
            is_comprehensive = (
                bool(not learning_mode and doc_texts and _is_comprehensive_query(query_text))
                or is_deep
                or is_draft
            )
            # Which model will actually ANSWER this chat? Draft uses a dedicated big-context engine
            # (gemini/claude), so only a Gemma *chat* model needs the free-tier input cap. Resolve
            # cheaply — get_agent_config is cached and reused when the model is resolved for real
            # below. A free-tier Gemma can't take the full-document dump a comprehensive/deep ask
            # normally keeps (60K–130K tokens >> its 16K input-tokens/min quota → guaranteed 429),
            # so for Gemma we send the most-relevant passages within a bounded budget instead.
            _effective_chat_model = selected_model_name or ""
            if not _effective_chat_model and not is_draft:
                try:
                    from app.services.agent_config_service import get_agent_config as _get_agent_cfg
                    _effective_chat_model = (
                        _get_agent_cfg(learning_agent_name or "grounded_retrieval_agent").model_name or ""
                    ).strip()
                except Exception:
                    _effective_chat_model = ""
            try:
                from app.services.adapters.document_ai import _is_gemma_model as _is_gemma
                _gemma_capped_chat = (not is_draft) and _is_gemma(_effective_chat_model)
            except Exception:
                _gemma_capped_chat = False
            # Set when a FIXED chunk count is used for Gemma (predictable, no dynamic sizing) — the
            # dynamic context clamp is then skipped (fixed count + history cap already bound input).
            _gemma_fixed_active = False
            if is_comprehensive and not _gemma_capped_chat:
                logger.info(
                    "[Route:intelligent_chat_stream] comprehensive query folder=%s — keeping full-document context",
                    folder_name,
                )
                yield _sse({"type": "thinking", "text": "Comprehensive request — reading the full case for a complete answer...\n"})
            elif not learning_mode and doc_texts:
                if _gemma_capped_chat and is_comprehensive:
                    logger.info(
                        "[Route:intelligent_chat_stream] comprehensive query folder=%s on Gemma — using focused "
                        "retrieval within the free-tier input budget (full dump would exceed 16K tokens/min)",
                        folder_name,
                    )
                    yield _sse({"type": "thinking", "text": "Broad request on a free-tier model — retrieving the most relevant passages to stay within the per-minute limit...\n"})
                # A broad ask on a capped Gemma pulls MORE passages into a bigger (but still
                # free-tier-safe) budget so the answer draws on the whole case, not just the top few
                # chunks; a normal narrow ask keeps the tight focused slice.
                _broad_gemma = _gemma_capped_chat and is_comprehensive
                # GEMMA ONLY: a fixed chunk count gives predictable input (no dynamic char sizing).
                # Other models never reach here for comprehensive (they keep full-document context),
                # and a narrow non-gemma ask keeps the dynamic char-budget slice below.
                _fixed_chunks = 0
                try:
                    from app.core.config import get_settings as _fs_settings
                    _fs = _fs_settings()
                    _gemma_cap_chars = int(getattr(_fs, "gemma_max_context_chars", 40000) or 40000)
                    if _broad_gemma:
                        _fixed_chunks = int(getattr(_fs, "gemma_chat_chunk_count", 0) or 0)
                except Exception:
                    _gemma_cap_chars = 40000
                if _fixed_chunks > 0:
                    # Feed exactly _fixed_chunks passages (top by relevance). Retrieval ceiling is 48.
                    _focus_top_k = min(48, _fixed_chunks)
                    _focus_budget = 10 ** 9  # count controls the feed, not chars
                else:
                    _focus_top_k = 30 if _broad_gemma else 12
                    # Leave ~4K chars of headroom under the cap for the system prompt + question.
                    _focus_budget = max(24000, _gemma_cap_chars - 4000) if _broad_gemma else 24000
                try:
                    from app.services.learning_document_retrieval import get_relevant_chunks

                    _fids = [str(d.get("file_id")) for d in doc_texts if d.get("file_id")]
                    _fids = [x for x in _fids if x][:48]
                    if _fids:
                        def _fetch_chat_chunks():
                            return get_relevant_chunks(
                                user_id=user_id,
                                case_id=folder_name,
                                query=query_text,
                                file_ids=_fids,
                                top_k=_focus_top_k,
                                include_surrounding_chunks=True,
                                similarity_floor=0.40,
                            )

                        _chat_chunks = await _run_blocking(
                            _fetch_chat_chunks,
                            timeout_s=15.0,
                            timeout_message="chat_chunk_retrieval",
                        )
                        if _chat_chunks:
                            # Regroup relevant chunks into {name, text, file_id} per document so
                            # downstream context-building + citations keep working — most-relevant
                            # first, capped to a focused budget.
                            _by_file: dict = {}
                            _budget, _used, _added = _focus_budget, 0, 0
                            for _ch in _chat_chunks:
                                _content = str(_ch.get("content") or "").strip()
                                if not _content:
                                    continue
                                if _fixed_chunks > 0:
                                    # Fixed count (Gemma): stop after N chunks, ignore char budget.
                                    if _added >= _fixed_chunks:
                                        break
                                elif _used + len(_content) > _budget:
                                    break
                                _meta = _ch.get("metadata") or {}
                                _fid = str(_meta.get("file_id") or "")
                                _name = str(_meta.get("document_name") or "document")
                                _page = _ch.get("page_number")
                                _page_bit = f"[p.{_page}] " if _page is not None else ""
                                _entry = _by_file.setdefault(_fid, {"name": _name, "text": "", "file_id": _fid or None})
                                _entry["text"] += f"{_page_bit}{_content}\n\n"
                                _used += len(_content)
                                _added += 1
                            _focused = [v for v in _by_file.values() if v["text"].strip()]
                            if _focused:
                                doc_texts = _focused
                                _rag_chunks_used = _added
                                if _fixed_chunks > 0:
                                    _gemma_fixed_active = True
                                logger.info(
                                    "[Route:intelligent_chat_stream] focused retrieval folder=%s fed_chunks=%s docs=%s chars=%s "
                                    "mode=%s (replaced full-document context)",
                                    folder_name, _added, len(_focused), _used,
                                    ("fixed=%d" % _fixed_chunks) if _fixed_chunks > 0 else "char_budget",
                                )
                                yield _sse({"type": "thinking", "text": f"Found {len(_chat_chunks)} relevant passage(s); answering from those.\n"})
                except Exception as _chunk_exc:
                    logger.warning(
                        "[Route:intelligent_chat_stream] chat chunk retrieval failed folder=%s err=%s — using full documents",
                        folder_name,
                        _chunk_exc,
                    )

            yield _sse({"type": "status", "status": "researching" if research_mode else "generating", "message": "Researching with Gemini and live Google Search..." if research_mode else "Generating answer from documents..."})
            yield _sse({"type": "thinking", "text": (f"Loaded {len(doc_texts)} document(s). Searching the live web and cross-checking sources...\n" if research_mode else f"Loaded {len(doc_texts)} document(s). Generating answer now...\n")})

            non_stream_timeout_s = min(
                600.0,
                max(
                    60.0,
                    30.0
                    + (len(doc_texts) * 8.0)
                    + (float(llm_config.get("max_summarization_output_tokens") or llm_config.get("max_output_tokens") or 65536) / 200.0),
                ),
            )
            # Free-tier gemma is a slow, throttled thinking model: a SINGLE non-stream call
            # measured 51-88s just to return 200 OK (see the Green_Eye comprehensive run — the
            # deep call was killed at 88s while the very next call succeeded in 51s). The generic
            # formula above ties the timeout to the OUTPUT budget (10K/200=50s -> ~88s total),
            # which has nothing to do with how slow the free tier actually is, so it prematurely
            # kills calls that would have succeeded. Give gemma a generous floor so one honest
            # call has room to finish instead of timing out and stacking a second concurrent call.
            if _gemma_capped_chat:
                non_stream_timeout_s = min(
                    600.0,
                    max(non_stream_timeout_s, float(getattr(get_settings(), "gemma_non_stream_timeout_s", 220.0))),
                )

            # Real-time streaming: emit chunk events as text is generated.
            answer_parts: list[str] = []
            source_names: list[str] = [str(d.get("name") or "document").strip() for d in doc_texts if d.get("name")]
            citations_payload: list[dict[str, Any]] = []
            streamed = False
            # Per-chunk SSE pacing for _yield_text_as_streaming_chunks. Every streaming branch below
            # (gemini / claude / deepseek / the non-stream fallbacks) reads this, so it must be bound
            # before the try — an unbound name here fails the whole chat with "not defined".
            stream_delay_ms = get_streaming_delay_ms(llm_config)
            # Will be set to the resolved model from agent_prompts (used for token usage logging)
            actual_model_name: str = str((llm_config or {}).get("llm_model") or "unknown")
            stream_usage: dict[str, Any] | None = None
            try:
                from google import genai  # type: ignore

                settings = get_settings()
                if settings.gemini_api_key or deep_research:
                    context_parts = []
                    running_chars = 0
                    # Dynamically size the document context to the question: a greeting loads
                    # almost nothing, a narrow ask gets a focused slice, and comprehensive/deep asks
                    # get the whole case (gemma-4 input limit ~262K tokens). Scales cost + latency to
                    # what the question actually needs instead of a fixed tier.
                    char_limit = _doc_context_char_budget(
                        query_text,
                        learning_mode=learning_mode,
                        # Drafting needs maximal grounding (missing evidence => wrong "[NOT FOUND]"),
                        # so give draft the full-document budget like deep, not the comprehensive tier.
                        is_deep=(is_deep or is_draft),
                        is_comprehensive=is_comprehensive,
                        # Hard-caps the budget for a free-tier Gemma chat (input-TPM safety); draft
                        # passes no model here (uses a big-context engine) so it keeps the full tier.
                        model_name=(None if is_draft else _effective_chat_model),
                    )
                    # Free-tier Gemma safety: the 16K/min limit is on TOTAL input — the system
                    # prompt + conversation history (both inside effective_query_text) + question +
                    # doc context. History is VARIABLE (grows with the chat), so a fixed context cap
                    # can still blow the limit once retrieval fills it. Dynamically reserve room for
                    # the measured system prompt + history + question and give the rest to context,
                    # keeping TOTAL input under ~85% of the TPM budget no matter how long the chat is.
                    # Skipped when a FIXED Gemma chunk count is active — the fixed count + the ~5K
                    # history/system cap already bound total input, so no dynamic trimming is needed
                    # (keeps the chunk count predictable, as requested).
                    if _gemma_capped_chat and not is_draft and not _gemma_fixed_active:
                        _tpm = int(getattr(settings, "gemma_free_tier_input_tpm", 16000) or 16000)
                        _target_input_tok = int(_tpm * 0.85) if _tpm > 0 else 13600
                        _overhead_chars = len(system_instruction or "") + len(effective_query_text or "") + 800
                        _ctx_room_tok = max(2000, _target_input_tok - (_overhead_chars // 4))
                        _dyn_cap = _ctx_room_tok * 4
                        if _dyn_cap < char_limit:
                            logger.info(
                                "[Route:intelligent_chat_stream] gemma dynamic context clamp %d->%d chars "
                                "(reserved ~%d tok for system+history+question)",
                                char_limit, _dyn_cap, _overhead_chars // 4,
                            )
                            char_limit = _dyn_cap
                    for doc in doc_texts:
                        name = doc.get("name", "document")
                        text = (doc.get("text") or "").strip()
                        if not text:
                            continue
                        block = f"[Document: {name}]\n{text}"
                        if running_chars + len(block) > char_limit:
                            block = block[: max(0, char_limit - running_chars)]
                            if block:
                                context_parts.append(block)
                            break
                        context_parts.append(block)
                        running_chars += len(block)

                    context = "\n\n---\n\n".join(context_parts)

                    # ── Deep Research short-circuit ──────────────────────────────────────────────
                    # Hand off to the bounded agentic loop: it runs plan → web-search rounds →
                    # synthesize under a hard rupee budget and streams the SAME SSE shapes
                    # (status/thinking/chunk/done). We generate/keep a stable session_id and,
                    # after the stream, persist the Q&A to folder_chats so it shows in history and
                    # the browser keeps this chat (instead of opening a fresh one).
                    if deep_research:
                        from app.services.deep_research import run_deep_research
                        _dr_raw_session_id = str((chat_request.session_id or "").strip())
                        try:
                            _dr_session_id = str(uuid.UUID(_dr_raw_session_id))
                        except (ValueError, TypeError, AttributeError):
                            _dr_session_id = str(uuid.uuid4())
                        _dr_sec = (chat_request.secret_id or "").strip() or None
                        _dr_q = str(getattr(chat_request, "question", "") or effective_query_text or "").strip()
                        _dr_request_id = uuid.uuid4().hex[:12]
                        _dr_state = {"answer_length": 0}

                        async def _dr_persist(_answer: str, _citations: list) -> None:
                            _a = str(_answer or "").strip()
                            if not _a:
                                return
                            _dr_state["answer_length"] = len(_a)
                            _persisted_citations = _deep_research_persistence_citations(_citations)

                            def _save() -> bool:
                                return folder_service._save_folder_chat_to_db(  # noqa: SLF001
                                    user_id=user_id,
                                    folder_name=folder_name,
                                    question=_dr_q,
                                    answer=_a,
                                    session_id=_dr_session_id,
                                    citations=_persisted_citations,
                                    used_secret_prompt=bool(_dr_sec),
                                    prompt_label=(chat_request.prompt_label or "").strip() or None,
                                    secret_id=_dr_sec,
                                    raise_on_error=True,
                                )

                            try:
                                _saved = await _run_blocking(
                                    _save,
                                    timeout_s=20.0,
                                    timeout_message="deep_research_persist",
                                )
                                if _saved is not True:
                                    raise RuntimeError("deep_research_persist_unsuccessful")
                            except Exception as _dr_persist_exc:
                                logger.exception(
                                    "[Route:intelligent_chat_stream] deep_research persist failed folder=%s err=%s",
                                    folder_name, _dr_persist_exc,
                                )
                                raise

                        # Use the CLEAN current question (_dr_q), NOT effective_query_text.
                        # effective_query_text prepends the entire prior Q/A of this session
                        # (folder_service._build_query_with_recent_history) — feeding that as the
                        # research question makes the plan/search/synthesis steps research the OLD
                        # topic and regurgitate it, so a follow-up like "this day in the history"
                        # comes back as a report on the previous case. The web grounding is driven
                        # by the question text, so it must be exactly what the user just asked. (The
                        # case document is still supplied separately as document_context background.)
                        try:
                            async for _dr_evt in run_deep_research(
                                question=_dr_q,
                                document_context=context,
                                session_id=_dr_session_id,
                                llm_config=llm_config,
                                on_result=_dr_persist,
                            ):
                                yield _dr_evt
                        finally:
                            # Deep returns before the shared accounting block below, so it must
                            # always flush its accumulator (success, error, or client disconnect).
                            _dr_model = str(
                                getattr(get_settings(), "deep_research_synthesis_model", "")
                                or "deep-research"
                            )
                            _dr_usage = flush_aggregated_token_usage_table(
                                usage_session_key,
                                endpoint="/api/files/{folder}/intelligent-chat/stream",
                                user_id=uid_int,
                                session_id=_dr_session_id,
                                request_id=_dr_request_id,
                                model_name=_dr_model,
                                answer_length=_dr_state["answer_length"],
                                routing="deep_research",
                                # Deep Research DOES consume the retrieved case context (it is
                                # passed as document_context); reporting 0 made it look as though
                                # the uploaded files never reached the run.
                                retrieved_chunks=_rag_chunks_used,
                            )
                            if _dr_usage:
                                try:
                                    await _run_blocking(
                                        lambda: log_llm_usage(
                                            user_id=uid_int,
                                            model_name=_dr_model,
                                            input_tokens=_dr_usage.get("inputTokens") or 0,
                                            output_tokens=_dr_usage.get("outputTokens") or 0,
                                            endpoint="/api/files/{folder}/intelligent-chat/stream",
                                            request_id=_dr_request_id,
                                            session_id=_dr_session_id,
                                        ),
                                        timeout_s=8.0,
                                        timeout_message="deep_research_usage_log",
                                    )
                                except Exception as _dr_usage_exc:
                                    logger.warning("Deep Research usage log failed: %s", _dr_usage_exc)
                        return

                    # ── Draft-from-template setup ────────────────────────────────────────────────
                    # A dedicated draft model (settings.draft_model_name, e.g. gemini-3.1-pro-preview)
                    # reads the uploaded template PDF DIRECTLY and reproduces all pages with clean
                    # formatting. gemma cannot accept PDF Parts (verified: 500) and truncates long
                    # templates, so when the draft model is gemma / blank we fall back to injecting the
                    # template as extracted TEXT. Blocking download+extract run in the executor so the
                    # SSE event loop is never blocked.
                    template_text = ""
                    _draft_template_bytes = None
                    _draft_template_layout = {}
                    # Draft engine: honour the frontend selector (chat_request.draft_model) when it is
                    # one of the allowed engines; otherwise fall back to the .env default. Only these
                    # are permitted so an arbitrary model string can't be injected via the request.
                    _draft_model_name = ""
                    _analysis_model = "gemini-3.1-pro-preview"
                    if is_draft:
                        _req_draft_model = (getattr(chat_request, "draft_model", None) or "").strip()
                        _draft_model_name = (
                            _req_draft_model if _req_draft_model in _DRAFT_ALLOWED_MODELS
                            else (settings.draft_model_name or "").strip()
                        )
                        # Stage-A structure model selector (frontend dropdown). Same allowlist
                        # plus gemini flash; anything else → the reliable pro default.
                        _req_structure_model = (getattr(chat_request, "analysis_model", None) or "").strip()
                        _analysis_model = (
                            _req_structure_model if _req_structure_model in _STRUCTURE_ALLOWED_MODELS
                            else "gemini-3.1-pro-preview"
                        )
                    _tmpl_uri = str(getattr(chat_request, "template_gcs_path", "") or "") if is_draft else ""
                    _tmpl_mime = (getattr(chat_request, "template_mimetype", None) or "") if is_draft else ""
                    _tmpl_is_pdf = _tmpl_mime.lower() == "application/pdf" or _tmpl_uri.lower().endswith(".pdf")
                    # Attach the template as a native PDF Part only for a PDF template on a non-gemma model.
                    _draft_attach_pdf = bool(
                        _draft_model_name and not _draft_model_name.lower().startswith("gemma") and _tmpl_is_pdf
                    )
                    if is_draft and _tmpl_uri:
                        try:
                            yield _sse({"type": "thinking", "text": "Reading the uploaded template...\n"})
                            _draft_template_bytes = await loop.run_in_executor(
                                None, lambda: gcs.download_bytes(_tmpl_uri)
                            )
                            # Always extract the template TEXT (cheap) — even when we ALSO attach the PDF —
                            # so we can parse its explicit section skeleton (structure-first drafting). When
                            # the PDF is attached, this text feeds ONLY the skeleton, not a second full copy.
                            template_text = await loop.run_in_executor(
                                None,
                                lambda: _extract_template_text_sync(
                                    _draft_template_bytes, _tmpl_mime or None, _tmpl_uri.rsplit("/", 1)[-1]
                                ),
                            )
                            try:
                                from app.services.template_layout import extract_template_layout as _extract_template_layout
                                _draft_template_layout = await loop.run_in_executor(
                                    None,
                                    lambda: _extract_template_layout(
                                        _draft_template_bytes or b"",
                                        mime_type=_tmpl_mime or None,
                                        filename=_tmpl_uri.rsplit("/", 1)[-1],
                                    ),
                                )
                            except Exception as _layout_exc:
                                logger.warning(
                                    "[Route:intelligent_chat_stream] folder=%s draft template layout extraction failed: %s",
                                    folder_name, _layout_exc,
                                )
                                _draft_template_layout = {}
                            logger.info(
                                "[Route:intelligent_chat_stream] folder=%s draft model=%s attach_pdf=%s "
                                "template_bytes=%d template_text_chars=%d template_layout_lines=%d",
                                folder_name, _draft_model_name or "(admin)", _draft_attach_pdf,
                                len(_draft_template_bytes or b""), len(template_text),
                                len((_draft_template_layout or {}).get("lines") or []),
                            )
                        except Exception as _tmpl_exc:
                            logger.warning(
                                "[Route:intelligent_chat_stream] folder=%s draft template read failed: %s",
                                folder_name, _tmpl_exc,
                            )
                            template_text = ""
                            _draft_template_bytes = None
                            _draft_template_layout = {}
                            _draft_attach_pdf = False
                    if learning_mode and learning_state is not None:
                        _lr_core = LearningAgentController.learning_system_prompt(
                            turn_count=learning_state.turn_count,
                            knowledge_level=learning_state.knowledge_level,
                            context_page=getattr(chat_request, "context_page", None),
                            context_selection=getattr(chat_request, "context_selection", None),
                            document_context=learning_state.document_context,
                            server_pedagogy_directive=learning_pedagogy_directive,
                        )
                        learning_instruction = (
                            f"{_lr_core}\n\n=== RETRIEVED EXCERPTS (vector-ranked, case-grounded) ===\n{learning_chunk_addon}"
                            if learning_chunk_addon
                            else _lr_core
                        )
                        # Native system_instruction comes from agent_prompts (learning_mode_agent) via stream_cfg;
                        # do not duplicate the profile QA prompt here.
                        prompt = (
                            f"LEARNING RUNTIME (JSON + session rules):\n{learning_instruction}\n\n"
                            "Your mission, teaching approach, and court-readiness goals are defined in the model "
                            "system instructions (from agent configuration). "
                            "All feedback, content_hint, and question must still be derived ONLY from === CASE MATERIALS === "
                            "below and the DOCUMENT CONTEXT block above (same case). "
                            "=== USER INPUT === is only the learner's latest turn for tone and continuity—do not treat "
                            "unsupported user statements as facts about the case. "
                            "If the materials are insufficient for a safe hint, set content_hint to \"\" and ask one "
                            "narrow document-grounded question.\n\n"
                            f"=== CASE MATERIALS ===\n{context}\n\n"
                            f"=== USER INPUT ===\n{effective_query_text}\n\n"
                            "=== JSON OUTPUT ==="
                        )
                    elif is_draft:
                        # Draft-from-template. When the draft model can read the PDF (Pro models), the
                        # template rides along as a PDF Part (see the streaming call) and we reference it;
                        # otherwise it is injected here as extracted TEXT. Either way the model uses the
                        # template as a FORMAT/STRUCTURE reference and drafts a COMPLETE document of the same
                        # type and comparable LENGTH, grounding every fact ONLY in the supporting documents.
                        # NOTE: this single-call branch is the current live path; the multi-stage pipeline
                        # (analyze -> fact inventory -> per-section draft -> audit) is the planned successor.
                        if _draft_attach_pdf and _draft_template_bytes:
                            _tmpl_section = (
                                "The TEMPLATE is ATTACHED to this message as a PDF. Study it ONLY as your "
                                "FORMAT & STRUCTURE REFERENCE — learn from it the document type, the set and "
                                "order of clauses, the headings, the professional drafting style/tone, and the "
                                "layout (recitals, signature/witness blocks, schedules). Do NOT copy its blanks "
                                "or boilerplate placeholder text; draft fresh, real clauses in this style.\n\n"
                            )
                        else:
                            _tmpl_block = (template_text or "").strip() or (
                                "[The uploaded template could not be read. Ask the user to re-upload it as a "
                                "text-based PDF or .docx.]"
                            )
                            _tmpl_section = (
                                "=== TEMPLATE (FORMAT & STRUCTURE REFERENCE ONLY) ===\n"
                                "Use this ONLY to learn the document type, clause set/order, headings, style "
                                "and layout. Do NOT copy its blanks or boilerplate wording — draft fresh, real "
                                f"clauses in this style.\n{_tmpl_block}\n\n"
                            )
                        # Structure-first drafting: hand the model the template's OWN section skeleton so the
                        # draft expands every section in order (a completeness/ordering contract), rather than
                        # loosely imitating the layout. The model still has the full template too.
                        _draft_skeleton = _extract_template_skeleton(template_text)
                        if _draft_skeleton:
                            _skeleton_block = (
                                "═══ TEMPLATE SKELETON (the template's OWN sections, in order) ═══\n"
                                "Your draft MUST contain EVERY section below, in THIS order, each expanded into "
                                "properly drafted clause(s) — not the bare label. Do not skip, merge, or reorder "
                                "them. Place the ADDITIONAL STANDARD CLAUSES (section 3) AFTER these:\n"
                                + "\n".join(f"  • {s}" for s in _draft_skeleton)
                                + "\n\n"
                            )
                        else:
                            _skeleton_block = ""
                        prompt = (
                            f"SYSTEM INSTRUCTION:\n{system_instruction}\n\n"
                            "You are a SENIOR LEGAL DRAFTING ATTORNEY — an expert agreement / deed / pleading "
                            "drafter in Indian practice. You are given a TEMPLATE and the case's SUPPORTING "
                            "DOCUMENTS. Use the TEMPLATE ONLY as a FORMAT & STRUCTURE REFERENCE — it shows you the "
                            "document type, the clauses such a document contains, their order, the headings, the "
                            "professional drafting style, and the layout. Then DRAFT A FRESH, COMPLETE, "
                            "EXECUTION-READY document of that type — composing the actual legal language YOURSELF "
                            "and drawing every party-specific fact from the SUPPORTING DOCUMENTS.\n\n"
                            "THIS IS INTELLIGENT EXPERT DRAFTING, NOT FILLING BLANKS. Do NOT merely copy the "
                            "template and drop values into its gaps. Do NOT reproduce its placeholder text, blanks, "
                            "or boilerplate wording verbatim. Write proper, self-composed operative clauses in "
                            "clean professional legal prose, the way a senior advocate drafting from scratch (with "
                            "this template as a style guide) would — with correct paragraphing, sensible clause "
                            "wording, and sound legal judgement.\n\n"
                            "═══ 1. INTELLIGENT DRAFTING (compose; do not fill-in-the-blank) ═══\n"
                            "- Follow the template's STRUCTURE and clause set, but COMPOSE the content yourself in "
                            "clean, professional legal prose. Where the template shows a blank or a generic "
                            "placeholder, WRITE THE REAL, properly-worded clause — never echo the placeholder.\n"
                            "- Produce a COMPLETE document of this type: every section such a document needs "
                            "(title, parties, recitals/WHEREAS, definitions, operative clauses, schedules/"
                            "annexures, testimonium and signature/witness blocks), in a sensible professional order "
                            "guided by the template.\n"
                            "- LENGTH & COMPLETENESS CONTRACT (critical — do NOT violate): your draft MUST be as "
                            "long and as complete as the source template. EVERY section, clause, sub-clause, "
                            "recital, proviso, schedule and annexure that the template contains MUST appear in your "
                            "draft — EXPANDED into full professional legal prose, NEVER compressed, summarized, "
                            "sampled, or dropped. A ~20-page template MUST produce a comparably long (~15-20+ page) "
                            "draft matching its section count and depth; a short template stays short. Do NOT "
                            "conclude, sign off, or write the closing sections until EVERY template section has been "
                            "fully drafted. If you feel 'done' while any template section is still undrafted, you "
                            "are NOT done — keep writing section after section until all are complete.\n"
                            "- Be SELF-AWARE: detect the document type and jurisdiction, and draft what a competent "
                            "such document requires — choosing, ordering and wording clauses appropriately, and "
                            "adapting to the facts (a franchise, partnership, sale deed or will each get their own "
                            "proper clauses, not a rent agreement's).\n\n"
                            "═══ 2. TWO-TIER CONTENT (facts vs. standard terms) ═══\n"
                            "As you compose each clause, classify EVERY value you write into ONE tier and handle "
                            "it accordingly:\n"
                            "• TIER A — PARTY-SPECIFIC FACTS (identity & money belonging to THESE parties): names, "
                            "parentage, ages, addresses, Aadhaar / PAN / ID numbers, the specific rent / price / "
                            "deposit amounts, dates, property description, bank name / account number / IFSC / UPI "
                            "ID, cheque or registration numbers.\n"
                            "  → Fill ONLY from the supporting documents. NEVER invent or guess a party-specific "
                            "fact. If a Tier-A value is genuinely absent from the documents, insert EXACTLY this "
                            "RED PLACEHOLDER in the body, unchanged: "
                            '<span style="color:red;font-weight:bold;">[________ FIELD NAME ________]</span> — where '
                            "FIELD NAME is a short CAPS label of what the user must fill, e.g. "
                            '<span style="color:red;font-weight:bold;">[________ ACCOUNT NUMBER ________]</span>. '
                            "Use this SAME red span for EVERY missing field (bank name, account number, IFSC, UPI "
                            "ID, payment mode, dates, amounts) so they ALL render red and consistent — NEVER a plain "
                            "'[BANK NAME]' bracket and NEVER a bare underscore blank. Put nothing else inside it — no "
                            "guess, no 'e.g.'. EXCEPTION: fields the template leaves blank at execution (signatures, "
                            "thumb impressions, notary/seal, witness signatures, stamp/registration number) stay as "
                            "ordinary blanks, not red. Also record each red placeholder in ITEMS REQUIRING "
                            "COMPLETION (section 6) so nothing is missed.\n"
                            "• TIER B — STANDARD CONTRACT TERMS (conventional, NOT identity/money-specific): notice "
                            "period for inspection/entry, renewal duration and renewal-notice period, rent grace "
                            "period, late-payment interest rate, lock-in period, refund window, and similar "
                            "boilerplate values.\n"
                            "  → An expert drafter does NOT leave these blank. Supply the STANDARD, market-"
                            "conventional value for Indian practice, phrased in the template's own style (typical "
                            "defaults: inspection/entry notice = 24 hours; renewal notice = 30 days before expiry; "
                            "late-payment interest ≈ 18% p.a.; deposit-refund window = 30 days; lock-in = 6 "
                            "months). MARK every value YOU supply (not taken from the documents) by appending "
                            "' [standard — verify]' the FIRST time it appears. Do NOT tag Tier-A values that came "
                            "from the documents.\n\n"
                            "═══ 3. PROFESSIONAL COMPLETION (make it a proper agreement) ═══\n"
                            "- After drafting the clauses the template shows, ADD any STANDARD PROTECTIVE CLAUSES "
                            "that a competent agreement OF THIS SAME TYPE should contain but the template omits — "
                            "and ONLY clauses appropriate to THIS detected document type (never import clauses from "
                            "a different kind of document). Continue the numbering, group them under a bold heading "
                            "'ADDITIONAL STANDARD CLAUSES', and mark each with ' [standard — verify]'. Decide the "
                            "right set from the document type you detect — do NOT hardcode. (For a residential "
                            "tenancy this typically means late-payment interest, alterations/fixtures, pets & "
                            "nuisance, visitors/guests, quiet enjoyment, and notice for termination.)\n"
                            "- Keep the settled legal meaning of standard clauses intact — draft them in their "
                            "conventional protective form; do not water them down.\n\n"
                            "═══ 4. JURISDICTION / LEGAL ADVISORY ═══\n"
                            "- If the facts reveal a jurisdiction-specific concern about the INSTRUMENT itself, "
                            "note it in DRAFTING & LEGAL NOTES (section 6) — do NOT silently change the instrument. "
                            "Example: residential letting of a property in Maharashtra is conventionally executed "
                            "as a 'Leave and License Agreement' under the Maharashtra Rent Control Act, 1999, "
                            "rather than a generic 'Rent Agreement'. State such points as advisory notes for the "
                            "attorney, never as unilateral changes.\n"
                            "- Keep the document's TITLE and instrument name EXACTLY as the template's (do not "
                            "prefix, rename, or blend instrument types in the title or body). Raise any instrument-"
                            "type concern ONLY in DRAFTING & LEGAL NOTES.\n\n"
                            "═══ 5. FORMATTING & PARAGRAPHING (court/registrar-ready) ═══\n"
                            "- Bold section headings on their OWN line (NOT '#'/'##'). Each numbered clause STARTS "
                            "ON ITS OWN NEW LINE with its own heading. The operative-words line (e.g. 'NOW THIS "
                            "AGREEMENT WITNESSETH AS FOLLOWS:') MUST be on its own line, then a BLANK line, then "
                            "'**1. TERM:**' on the next line. NEVER fuse a heading or preamble with the next clause "
                            "on one line (NOT '...WITNESSETH AS FOLLOWS:1. TERM:').\n"
                            "- PARAGRAPHING (important): write recitals/WHEREAS clauses and each operative clause as "
                            "PROPER paragraphs of flowing legal prose. START a new paragraph for each distinct "
                            "clause or point and END that paragraph when the point is complete; separate EVERY "
                            "clause, recital and block with a BLANK line. Do NOT run several clauses together into "
                            "one block, and do NOT fragment a single clause into many stubby one-line pieces. "
                            "Sub-points take indented (a)/(b)/(c) or (i)/(ii)/(iii) numbering, each on its own "
                            "line. Aim for the rhythm of a professionally typed agreement, not a bulleted list.\n"
                            "- SIDE-BY-SIDE COLUMNS → Markdown TABLE. When the template lays content out in columns "
                            "— signature blocks (LANDLORD | TENANT, LESSOR | LESSEE, FRANCHISOR | FRANCHISEE, PARTY "
                            "1 | PARTY 2), witness blocks (Witness 1 | Witness 2), or any multi-column arrangement "
                            "— reproduce it as a Markdown table with ONE COLUMN PER template column so the columns "
                            "stay aligned. NEVER flatten columns into a run-on line. Example:\n"
                            "  | LANDLORD / LESSOR | TENANT / LESSEE |\n"
                            "  |---|---|\n"
                            "  | Signature: __________ | Signature: __________ |\n"
                            "  | Name: Ramesh K. Desai | Name: Priya S. Malhotra |\n"
                            "  | Date: 01/07/2025 | Date: 01/07/2025 |\n"
                            "- Put each labelled field on its OWN line (Signature / Name / Date are separate lines) "
                            "and separate distinct blocks with a blank line. Reproduce existing tables / schedules "
                            "/ inventories (e.g. an ANNEXURE inventory) as Markdown tables with the template's "
                            "exact columns. Centre only what the template centres (its title / cause title); keep "
                            "body clauses left-aligned. Math in plain Unicode (no LaTeX).\n"
                            "- The AGREEMENT BODY must contain ONLY the clean legal document — no source tags, no "
                            "'[source: ...]', no analysis prose. It must read like a finished, signable agreement.\n\n"
                            "═══ 6. CLOSING SECTIONS (after the agreement, clearly separated) ═══\n"
                            "After the signature/witness block, output a line containing only '---', then these "
                            "two sections, each under a bold heading:\n"
                            "- '**ITEMS REQUIRING COMPLETION**' — a short numbered list of every Tier-A blank you "
                            "left (what to fill and where). If none, write 'None — all required facts were found "
                            "in the case file.'\n"
                            "- '**DRAFTING & LEGAL NOTES**' — brief bullets: the standard values/clauses you "
                            "supplied ('[standard — verify]'), any jurisdiction/instrument advisory from section "
                            "4, and a one-line reminder that a qualified advocate must review the draft before "
                            "execution.\n\n"
                            "COURT-PLEADING CONVENTIONS — apply ONLY IF this template is itself a court pleading "
                            "(plaint / petition / application) and already contains these sections; SKIP ENTIRELY "
                            "for agreements, deeds, wills and other non-litigation documents:\n"
                            "- Each material fact in its own numbered paragraph; complete cause-of-action, "
                            "jurisdiction, valuation & court-fee and limitation paragraphs; PRAYER reliefs as "
                            "lettered clauses (a),(b),(c); reproduce the VERIFICATION, affidavit, Section 12A "
                            "mediation and Section 65B BSA blocks that are present in the template.\n\n"
                            f"{_skeleton_block}"
                            f"{_tmpl_section}"
                            f"=== SUPPORTING DOCUMENTS ===\n{context}\n\n"
                            f"=== USER INSTRUCTION ===\n{query_text}\n\n"
                            "=== COMPLETED DRAFT ==="
                        )
                    elif research_mode:
                        # Current date anchors the report (in-force provision checks, renumbering
                        # flags IPC/CrPC/Evidence Act -> BNS/BNSS/BSA, and the closing line).
                        _rs_now = datetime.now()
                        _rs_today = f"{_rs_now.day} {_rs_now:%B %Y}"
                        prompt = (
                            f"You are Jurinex Research Agent, an expert legal and factual researcher for legal professionals practising in India. Today's date is {_rs_today}. You have live Google Search and the supplied PRIVATE CASE DOCUMENTS. Produce a rigorous, decision-useful research report in ONE pass.\n\n"
                            "RESEARCH CONDUCT\n"
                            "1. Use Google Search for anything current or externally verifiable; use the case documents only as private context. Run as many searches as needed to cover the question properly — do not answer material legal points from memory alone.\n"
                            "2. SOURCE PRIORITY (highest first): (a) Supreme Court and High Court judgments (indiankanoon.org, official court sites, eCourts) and bare acts/amendments (India Code, egazette.gov.in); (b) government publications, regulators, Law Commission, PIB; (c) reputed legal reporting (SCC Online, LiveLaw, Bar & Bench); (d) general news/commentary only as a last resort.\n"
                            "3. Never treat a search snippet alone as conclusive — rely only on what the opened source actually states.\n"
                            "4. PRIVACY: Never place names of private individuals or private entities from the case documents into search queries. Search by statute, section, court, and generic fact pattern instead.\n\n"
                            "ACCURACY & CITATIONS\n"
                            "5. Never invent a source, URL, quotation, citation, date, section number, holding, or case fact. Every legal proposition must be traceable to either the case documents or a source you actually retrieved. If a point cannot be verified, omit it or expressly mark it \"(unverified)\".\n"
                            "6. Cite every judgment with: full case name, citation or case number, court, year, and whether it is binding or persuasive for the relevant jurisdiction. Where the matter is contested, label authorities by the side they favour and cover BOTH sides — authorities supporting the petitioner/applicant AND adverse authorities the respondent may rely on, with a one-line distinction for each adverse authority only if the case documents support it.\n"
                            f"7. For every statutory provision, confirm it is in force as of {_rs_today}; where renumbered (IPC/CrPC/Evidence Act -> BNS/BNSS/BSA), give both old and new section numbers.\n"
                            "8. Clearly distinguish document-supported claims from web-supported claims — never blend them silently. Where useful, tag the basis inline, e.g. \"(per case documents)\" or a linked web source.\n"
                            "9. If reliable sources conflict, present both sides with sources; do not resolve the conflict by assumption.\n\n"
                            "OUTPUT FORMAT\n"
                            "10. No memo header of any kind — no \"TO:/FROM:/RE:\", no banner, no addressee. Start directly with a Markdown heading (##) naming the topic, followed by a 3-6 sentence direct answer stating the bottom line and how strong the position is.\n"
                            "11. Then detailed sections under ## headings adapted to the question — typically: Governing Law; Judicial Authorities (both sides where contested); Application to the Present Facts; Risks & Counter-Arguments; Practical Next Steps.\n"
                            "12. Be detailed and complete, but every paragraph must earn its place — no filler, no repetition, no generic disclaimers.\n"
                            "13. LINKS: Never paste a bare or raw URL anywhere. Every material current claim carries an inline Markdown link with a readable label — [source name or page title](url) — URL only inside the parentheses. Use ONLY URLs actually returned by your searches; never construct or guess a URL.\n"
                            f"14. End with a \"## Sources\" section: a Markdown bullet list of the most important sources, each exactly - [source name or page title](url), so every link is clickable. Then one final italic line: *Research current as of {_rs_today}.*\n"
                            "15. If the question cannot be answered reliably from the documents and search results, say exactly what is missing and what the user should provide or check — do not pad.\n\n"
                            f"=== PRIVATE CASE DOCUMENTS ===\n{context}\n\n"
                            f"=== RESEARCH QUESTION ===\n{effective_query_text}\n\n"
                            "=== RESEARCH REPORT ==="
                        )
                    elif is_deep:
                        # Deep/extreme asks (e.g. multi-section court-ready briefs): ONE single
                        # streaming call with the FULL document and a no-ceiling, follow-the-user's-
                        # structure prompt. This replaces the old per-section multi-pass — splitting
                        # the report into grouped passes fragmented the context (per-group RAG snippets
                        # instead of the whole case) and the output, making answers SHORTER, slower,
                        # and more hallucination-prone. The user's own prompt carries the structure,
                        # so we just tell the model to follow it exactly and exhaustively. Small
                        # models (gemma-4) tend to emit an end-of-turn EARLY on long structured asks
                        # (finish_reason=STOP well before the token limit) — e.g. 17 of 22 points. We
                        # counter that with an explicit completion contract anchored to the user's own
                        # number of requested points.
                        _deep_n_points = len(_find_numbered_headings(query_text))
                        if _deep_n_points >= 4:
                            _deep_completion_clause = (
                                f"COMPLETION CONTRACT: the user's request contains {_deep_n_points} numbered "
                                f"points/sections. Your output MUST contain ALL {_deep_n_points} of them, "
                                f"numbered 1 to {_deep_n_points}, each with its own bold heading. After you "
                                "finish one point, IMMEDIATELY begin the next. Do NOT write any closing "
                                "remarks, overall summary, or sign-off until the FINAL numbered point is "
                                f"complete. If you feel you are 'done' before point {_deep_n_points}, you are "
                                "NOT — keep writing until every numbered point exists.\n\n"
                            )
                        else:
                            _deep_completion_clause = (
                                "COMPLETION CONTRACT: write EVERY section the user requested, in order. Do "
                                "NOT conclude, summarise, or stop until all requested sections are written.\n\n"
                            )
                        prompt = (
                            f"SYSTEM INSTRUCTION:\n{system_instruction}\n\n"
                            "The user has requested an EXHAUSTIVE, deeply detailed report. Produce the "
                            "COMPLETE report in this single response.\n\n"
                            + _deep_completion_clause +
                            "FOLLOW THE USER'S REQUESTED STRUCTURE EXACTLY AND COMPLETELY: reproduce every "
                            "section, heading, table, column, row count, and word limit they specify, in the "
                            "order they specify. Do NOT drop, merge, summarise, or shorten any requested "
                            "section. Be maximally thorough — cover every relevant fact, date, party, figure, "
                            "argument, exhibit, and quotation the documents support. There is NO upper length "
                            "limit; write as long as the material requires (a full multi-page report). Keep "
                            "writing section after section — do NOT wind down or conclude until the last "
                            "requested point is finished.\n\n"
                            "GROUNDING (this is a legal RAG task — accuracy is critical): ground every factual "
                            "statement ONLY in the documents below and add a page reference like [p.N]. Write "
                            "'Not found in uploaded file' wherever the documents do not support a point. Do NOT "
                            "invent facts, outcomes, case law, or numbers, and do NOT use outside knowledge. "
                            "Treat allegations as allegations unless an exhibit or order proves them. If "
                            "something is unclear, say 'Unclear from uploaded file.'\n\n"
                            "FORMATTING: begin each section with a bold heading on its own line (for example "
                            "'**1. Document Classification and Reliability**'). Do NOT use '#', '##', or '###' "
                            "heading marks — they render as literal text. Write ALL math in plain text/Unicode "
                            "(use ×, ÷, >, ≥, ≤, %), NEVER LaTeX or $...$. Use Markdown tables for any tabular "
                            "or itemised data.\n\n"
                            f"=== DOCUMENTS ===\n{context}\n\n"
                            # RAW query_text, NOT effective_query_text: the latter prepends prior
                            # conversation turns (e.g. an earlier 17-section benchmark), whose
                            # structure the model then follows instead of THIS request's points.
                            f"=== USER REQUEST ===\n{query_text}\n\n"
                            "=== FULL REPORT ==="
                        )
                    elif is_comprehensive:
                        # Forceful long-form prompt: a small model treats a bare "summary" ask as
                        # license to be brief. Give it an explicit structure + length floor and tell
                        # it not to compress, so it produces a full multi-section case analysis.
                        prompt = (
                            f"SYSTEM INSTRUCTION:\n{system_instruction}\n\n"
                            "The user has asked for a COMPREHENSIVE, DETAILED answer. Produce an exhaustive, "
                            "well-structured, long-form response grounded ONLY in the legal documents below. "
                            "Do NOT compress, abbreviate, or omit relevant detail — this is a full case "
                            "analysis, not a short summary.\n\n"
                            "FORMATTING: structure the answer with bold section titles, each on its OWN line "
                            "(for example: **Background and Material Facts**). Do NOT use '#', '##', or '###' "
                            "heading marks — they are not rendered and show up as literal '##' text. "
                            "Cover every part the documents support:\n"
                            "- Parties and their roles\n"
                            "- Background and material facts\n"
                            "- Full chronology of events and dates (render as a Markdown table)\n"
                            "- Issues / questions for determination\n"
                            "- Each side's arguments and contentions\n"
                            "- Evidence, documents, and authorities relied on\n"
                            "- Findings, reasoning, and analysis\n"
                            "- Holding / decision / order, with any reliefs, directions, or costs\n"
                            "- Current status / next steps, if stated\n\n"
                            "Use Markdown tables for any list of events, dates, parties, or itemised data. "
                            "LENGTH: write an EXHAUSTIVE response of AT LEAST 3,500-4,500 words "
                            "(≈4,000-5,000 tokens) when the documents contain enough material. Each section "
                            "above must be SEVERAL fully-developed paragraphs of prose — never a single line or "
                            "a bare bullet. Explain every fact, date, party, argument, and finding in depth and "
                            "quote or reference the record. Do NOT stop early, do NOT compress, and do NOT end "
                            "with a short conclusion until every section is covered thoroughly. Be shorter ONLY "
                            "if the documents genuinely lack content. Stay accurate and grounded; if something is "
                            "not in the documents, say so rather than inventing it.\n\n"
                            f"=== DOCUMENTS ===\n{context}\n\n"
                            f"=== QUESTION ===\n{effective_query_text}\n\n"
                            "=== DETAILED ANSWER ==="
                        )
                    else:
                        # Prompt Orchestration Layer:
                        #   Layer 1 (permanent system prompt) → SYSTEM INSTRUCTION block.
                        #   Layer 3 (dynamic format instruction) → detected from the
                        #     user's actual query and appended as the OUTPUT CONTRACT.
                        #   The user's wording (effective_query_text) is never modified.
                        orchestrated_format = format_instruction_for_query(effective_query_text)
                        system_block = f"SYSTEM INSTRUCTION:\n{PERMANENT_SYSTEM_PROMPT}"
                        if system_instruction:
                            system_block = f"{system_block}\n\n{system_instruction}"
                        prompt = (
                            # system_block (not system_instruction) — it prepends PERMANENT_SYSTEM_PROMPT,
                            # which interpolating system_instruction alone would silently drop.
                            f"{system_block}\n\n"
                            "Answer the user's question based ONLY on the following legal documents. "
                            # Deliberately NOT "be concise": length is matched to the ask, because a
                            # blanket concision instruction caps the detailed/comprehensive tier.
                            "Match the length and depth to what the user actually asked for: when they request "
                            "a detailed, comprehensive, full, or in-depth summary/answer, produce a thorough, "
                            "well-structured, multi-section response that covers all relevant material from the "
                            "documents; when they ask something narrow, keep it focused. Always stay accurate and "
                            "grounded. If the answer is not in the documents, say so clearly.\n\n"
                            f"=== DOCUMENTS ===\n{context}\n\n"
                            f"=== QUESTION ===\n{effective_query_text}\n\n"
                            "=== OUTPUT CONTRACT — OVERRIDES ALL PRIOR INSTRUCTIONS ===\n"
                            f"{orchestrated_format}\n\n"
                            f"{CLARIFICATION_PROTOCOL}\n\n"
                            "=== ANSWER ==="
                        )
                    prompt = _truncate_prompt(prompt, max_chars=char_limit + 60_000, label="model_prompt")
                    # Resolve provider + model + config from agent_prompts (or summarization fallback).
                    # MUST stay unconditional: the draft branch below only assigns stream_provider when
                    # `is_draft and _draft_model_name`, so without this a normal chat reaches the
                    # `elif stream_provider == ...` dispatch with the name unbound — which raises
                    # UnboundLocalError inside the streaming try, gets swallowed as "streaming
                    # unavailable", and silently degrades every answer to the non-stream fallback.
                    stream_provider, resolved_model_name, stream_cfg = stream_config_for_folder_chat(
                        for_summary=True,
                        summarization_llm_config=llm_config,
                        agent_name=learning_agent_name,
                        model_name_override=selected_model_name,
                    )
                    # Store for token-usage logging below
                    actual_model_name = resolved_model_name

                    if research_mode:
                        resolved_model_name = str(getattr(settings, "research_model_name", "") or "").strip() or "gemini-3.6-flash"
                        actual_model_name = resolved_model_name
                        stream_provider = "gemini"
                        from google.genai import types as _research_types
                        _research_max = int((llm_config or {}).get("max_summarization_output_tokens") or (llm_config or {}).get("max_output_tokens") or 32768)
                        _research_cfg_kwargs = dict(
                            temperature=0.2,
                            max_output_tokens=min(_research_max, 65536),
                            tools=[_research_types.Tool(google_search=_research_types.GoogleSearch())],
                        )
                        # gemini-3.6-flash is a thinking model — run Research at "high" thinking for
                        # the deepest reasoning (valid Gemini levels: low|medium|high; "minimal" is
                        # Gemma-only and 400s on Gemini). Attached defensively so an older SDK without
                        # ThinkingConfig/thinking_level simply runs without it.
                        try:
                            _research_cfg_kwargs["thinking_config"] = _research_types.ThinkingConfig(thinking_level="high")
                        except Exception:
                            pass
                        stream_cfg = _research_types.GenerateContentConfig(**_research_cfg_kwargs)

                    # Draft-from-template: force the selected draft engine (frontend dropdown, else the
                    # .env default) instead of the admin-selected chat model. Both Gemini-3.x and Claude
                    # read the template PDF directly and reproduce all pages. Route by provider:
                    #   • claude-*  → Claude path; the PDF rides as a document block (see the claude
                    #     branch below), which uses the dedicated claude_draft_stream_generator.
                    #   • else (gemini-3.x) → Gemini path with a precise temperature + full output budget.
                    if is_draft and _draft_model_name:
                        resolved_model_name = _draft_model_name
                        actual_model_name = _draft_model_name
                        if _draft_model_name.lower().startswith("claude"):
                            stream_provider = "claude"
                            stream_cfg = ({}, {})  # Claude draft uses the dedicated generator; kwargs unused
                        else:
                            from google.genai import types as _draft_types
                            stream_provider = "gemini"
                            _draft_cfg_kwargs: dict[str, Any] = dict(
                                temperature=0.2,
                                max_output_tokens=int(getattr(settings, "draft_max_output_tokens", 0) or 65536),
                            )
                            # Gemma-4 is a thinking model whose thinking + answer SHARE the output budget
                            # and defaults to HEAVY thinking → slow drafts with most tokens burned on
                            # hidden reasoning. Force minimal thinking for a gemma draft engine here too
                            # (the section pipeline already does this via _build_gemini_config; this covers
                            # the single-call draft path). Other gemini models don't accept thinking_level,
                            # so apply it ONLY for gemma.
                            try:
                                from app.services.adapters.document_ai import _is_gemma_model as _dm_is_gemma
                                if _dm_is_gemma(_draft_model_name):
                                    _dlvl = str(getattr(settings, "gemma_thinking_level", "minimal") or "minimal").strip().lower()
                                    if _dlvl in ("minimal", "high"):
                                        _draft_cfg_kwargs["thinking_config"] = _draft_types.ThinkingConfig(thinking_level=_dlvl)
                            except Exception:
                                pass
                            stream_cfg = _draft_types.GenerateContentConfig(**_draft_cfg_kwargs)

                    # ── DRAFT PIPELINE (4-stage: analyze → fact inventory → per-section draft → audit) ──
                    # Structure-first successor to the single-call draft; scales to long templates without
                    # the single-call output-token ceiling and preserves the template's own section order.
                    # On ANY failure we fall through to the single-call draft (the `prompt` built above) so
                    # the user always gets a draft. Progress streams live; the finished document streams once
                    # at the end (buffered internally through audit+repair — never appended twice).
                    _draft_pipeline_done = False
                    _draft_typography = None
                    _draft_tiptap_json = None
                    _draft_tiptap_sections = None
                    _draft_legal_section_doc = None
                    if is_draft and (template_text or "").strip():
                        _fi_key = _draft_factinv_key(folder_name, user_id, doc_texts)
                        _pipe_final = None
                        # RAG: the pipeline retrieves top-chunks from THIS case's vector store
                        # (per-facet for the fact matrix, per-section for drafting) instead of
                        # dumping the whole corpus. Build a retrieve callback scoped to the
                        # supporting file_ids; disable via llm_config draft_use_rag=false.
                        _draft_retrieve = None
                        try:
                            _use_rag = bool(llm_config.get("draft_use_rag", True))
                        except Exception:
                            _use_rag = True
                        _rag_fids = [str(d.get("file_id")) for d in doc_texts if d.get("file_id")]
                        _rag_fids = [x for x in _rag_fids if x][:64]
                        if _use_rag and _rag_fids:
                            from app.services.learning_document_retrieval import get_relevant_chunks as _grc_draft

                            def _draft_rerank_chunks(_query: str, _chunks: list[dict], _k: int) -> list[dict]:
                                # Dependency-free rerank + diversity for drafting. The DB already does
                                # hybrid vector/full-text RRF; this second pass makes the final prompt
                                # less redundant: 5 best relevant chunks, 2 corroborating chunks from
                                # different documents where possible, and 1 neighbour context chunk.
                                _limit = 8 if (_k or 0) >= 20 else max(1, min(_k or 8, 12))
                                _tokens = {
                                    t for t in re.findall(r"[A-Za-z0-9]{3,}", (_query or "").lower())
                                    if t not in {"the", "and", "for", "with", "this", "that", "section", "exact"}
                                }

                                def _score(_ch: dict) -> float:
                                    _text = str(_ch.get("content") or "").lower()
                                    _sim = float(_ch.get("similarity_score") or 0.0)
                                    _overlap = sum(1 for t in _tokens if t in _text)
                                    return (_sim * 3.0) + min(_overlap, 12)

                                _ranked = sorted(_chunks or [], key=_score, reverse=True)
                                _selected: list[dict] = []
                                _seen_ids: set[str] = set()

                                def _add(_ch: dict) -> bool:
                                    _cid = str(_ch.get("chunk_id") or _ch.get("source_id") or id(_ch))
                                    if _cid in _seen_ids:
                                        return False
                                    _seen_ids.add(_cid)
                                    _selected.append(_ch)
                                    return True

                                _primary = [c for c in _ranked if not ((c.get("metadata") or {}).get("neighbor"))]
                                for _ch in _primary:
                                    if len(_selected) >= min(5, _limit):
                                        break
                                    _add(_ch)

                                _used_docs = {str((c.get("metadata") or {}).get("document_name") or "") for c in _selected}
                                _corroborating = 0
                                for _ch in _primary:
                                    if len(_selected) >= _limit or _corroborating >= 2:
                                        break
                                    _doc = str((_ch.get("metadata") or {}).get("document_name") or "")
                                    if _doc and _doc not in _used_docs and _add(_ch):
                                        _used_docs.add(_doc)
                                        _corroborating += 1

                                for _ch in _ranked:
                                    if len(_selected) >= _limit:
                                        break
                                    if (_ch.get("metadata") or {}).get("neighbor") and _add(_ch):
                                        break

                                for _ch in _ranked:
                                    if len(_selected) >= _limit:
                                        break
                                    _add(_ch)
                                return _selected[:_limit]

                            def _draft_retrieve(_q: str, _k: int):
                                try:
                                    _raw = _grc_draft(
                                        user_id=user_id,
                                        case_id=folder_name,
                                        query=_q,
                                        file_ids=_rag_fids,
                                        top_k=_k,
                                        include_surrounding_chunks=True,
                                        # 0.30 was below the semantic similarity floor (~0.333),
                                        # so it could not filter weak semantic hits. 0.42 screens
                                        # obvious misses while retrieve_learning_chunk_hits still
                                        # falls back to top rows if everything is below floor.
                                        similarity_floor=0.42,
                                    ) or []
                                except Exception as _rex:
                                    logger.warning("[Route:intelligent_chat_stream] draft RAG retrieval error: %s", _rex)
                                    return []
                                _raw = _draft_rerank_chunks(_q, _raw, _k or 8)
                                _norm = []
                                for _ch in _raw:
                                    _m = _ch.get("metadata") or {}
                                    _norm.append({
                                        "text": str(_ch.get("content") or "").strip(),
                                        "name": str(_m.get("document_name") or "document"),
                                        "page": _ch.get("page_number"),
                                        "score": float(_ch.get("similarity_score") or 0.0),
                                        "neighbor": bool(_m.get("neighbor")),
                                    })
                                return _norm
                        # Guardian model for the audit + repair passes (Stage D grounding/format
                        # audit + section repair, Stage E slot recovery). This is the model that
                        # CHECKS the draft, and it is billed on every draft — so it is explicitly
                        # selectable rather than silently forced.
                        #   1) frontend guardian dropdown (chat_request.guardian_model)
                        #   2) DRAFT_GUARDIAN_MODEL in .env
                        #   3) auto: Opus when an Anthropic key exists, else gemini-3.1-pro
                        # Same allowlist as the structure model, so an arbitrary model string
                        # cannot be injected through the request.
                        # Guardian is OPT-IN. It is OFF by default (DRAFT_GUARDIAN_ENABLED=false): the
                        # Stage D/E audit passes burned the guardian model's tokens for little gain, so
                        # drafts now skip them unless an admin turns it back on. The frontend guardian
                        # dropdown can ALSO force it off per-draft with a "disabled"/"none"/"off" value.
                        _draft_engine_lc = (resolved_model_name or "").lower()
                        _req_guardian = (getattr(chat_request, "guardian_model", None) or "").strip()
                        _env_guardian = (getattr(settings, "draft_guardian_model", "") or "").strip()
                        # Guardian is OFF by default. It runs only when explicitly turned on:
                        #   • the dropdown picks an allowed guardian model → runs (per-draft opt-in), OR
                        #   • the master switch DRAFT_GUARDIAN_ENABLED=true → auto/env resolves the model.
                        # Force-OFF when the dropdown sends a disable sentinel, or when nothing is chosen
                        # AND the master switch is off. So "Disabled"/"Auto(off)" skip; picking a model runs.
                        _explicit_off = _req_guardian.lower() in {"disabled", "disable", "none", "off", "no", "skip"}
                        _explicit_model = _req_guardian in _GUARDIAN_ALLOWED_MODELS
                        _guardian_disabled = _explicit_off or (
                            not _explicit_model and not bool(getattr(settings, "draft_guardian_enabled", False))
                        )
                        if _guardian_disabled:
                            _guardian_model = None
                            _guardian_src = "disabled"
                            logger.info(
                                "[Route:intelligent_chat_stream] folder=%s draft GUARDIAN DISABLED — "
                                "Stage D/E audit skipped (no guardian tokens). engine=%s structure=%s",
                                folder_name, resolved_model_name, _analysis_model,
                            )
                        else:
                            if _req_guardian in _GUARDIAN_ALLOWED_MODELS:
                                _guardian_model = _req_guardian
                                _guardian_src = "request"
                            elif _env_guardian in _GUARDIAN_ALLOWED_MODELS:
                                _guardian_model = _env_guardian
                                _guardian_src = "env"
                            elif _draft_engine_lc.startswith("claude-opus"):
                                _guardian_model = resolved_model_name
                                _guardian_src = "auto(engine-is-opus)"
                            elif getattr(settings, "anthropic_api_key", "") or getattr(settings, "ANTHROPIC_API_KEY", ""):
                                _guardian_model = "claude-opus-4-8"
                                _guardian_src = "auto(anthropic-key)"
                            else:
                                _guardian_model = "gemini-3.1-pro-preview"
                                _guardian_src = "auto(no-anthropic-key)"
                            logger.info(
                                "[Route:intelligent_chat_stream] folder=%s draft engine=%s structure=%s "
                                "guardian(audit)=%s via=%s",
                                folder_name, resolved_model_name, _analysis_model,
                                _guardian_model, _guardian_src,
                            )
                        # Mark where this draft's token entries begin so we can report the
                        # per-model burn for JUST this draft after the pipeline finishes.
                        _draft_usage_start = usage_entry_count(usage_session_key)
                        # Stable short id for THIS draft — shown in the per-draft token table
                        # and surfaced to the client so a draft's cost can be correlated.
                        _draft_id = f"drf_{uuid.uuid4().hex[:12]}"
                        try:
                            from app.services import template_drafting as _tpl
                            async for _pkind, _pdata in _tpl.run_template_drafting_pipeline(
                                template_text=template_text,
                                template_layout=_draft_template_layout,
                                doc_texts=doc_texts,
                                query_text=query_text,
                                draft_engine=resolved_model_name,
                                analysis_model=_analysis_model,
                                user_id=user_id,
                                run_blocking=_draft_run_blocking,
                                doc_title=None,
                                cached_fact_inventory=_DRAFT_FACTINV_CACHE.get(_fi_key),
                                enable_audit=not _guardian_disabled,
                                retrieve_fn=_draft_retrieve,
                                audit_model=_guardian_model,
                            ):
                                if _pkind == "progress":
                                    yield _sse(_pdata)
                                elif _pkind == "outline":
                                    yield _sse({"type": "draft_outline", **_pdata})
                                elif _pkind == "section":
                                    # Per-section content for a section-by-section draft UI.
                                    yield _sse({"type": "draft_section", **_pdata})
                                elif _pkind == "final":
                                    _pipe_final = _pdata
                        except Exception as _pipe_exc:
                            logger.warning(
                                "[Route:intelligent_chat_stream] folder=%s draft pipeline failed (%s); "
                                "falling back to single-call draft", folder_name, _pipe_exc,
                            )
                            _pipe_final = None
                        # NOTE: the per-draft token table is logged LATER (after the whole
                        # draft finishes, incl. the single-call fallback below when the
                        # pipeline fails) so it captures the FULL cost, not just the part
                        # that ran before a failure. `_draft_usage_start` marks the slice.
                        _draft_model_for_log = resolved_model_name
                        if _pipe_final and (_pipe_final.get("answer") or "").strip():
                            _final_md = _pipe_final["answer"]
                            _draft_typography = _pipe_final.get("typography")
                            _draft_tiptap_json = _pipe_final.get("tiptap_json")
                            _draft_tiptap_sections = _pipe_final.get("tiptap_sections")
                            _draft_legal_section_doc = _pipe_final.get("legal_section_doc")
                            if _pipe_final.get("fact_inventory"):
                                _draft_factinv_cache_put(_fi_key, _pipe_final["fact_inventory"])
                            answer_parts.append(_final_md)
                            streamed = True
                            _draft_pipeline_done = True
                            async for _sl in _yield_text_as_streaming_chunks(
                                _sse, _final_md, delay_ms=stream_delay_ms
                            ):
                                yield _sl

                    if _draft_pipeline_done:
                        pass  # draft already produced + streamed by the 4-stage pipeline above
                    elif stream_provider == "claude":
                        # ── Claude streaming path (true SSE via thread + queue) ────────
                        claude_gen_kwargs, claude_llm_params = stream_cfg
                        _SENTINEL = object()
                        chunk_queue: asyncio.Queue = asyncio.Queue()
                        claude_stream_error: list[str] = []

                        def _run_claude_stream():
                            # Bind the request's token-usage session inside the executor thread —
                            # see _run_kimi_stream below for why.
                            bind_token_usage_session(usage_session_key)
                            try:
                                # Draft mode on a Claude engine: attach the template PDF as a document
                                # block via the dedicated generator (Claude reads PDFs natively).
                                if is_draft and _draft_attach_pdf and _draft_template_bytes:
                                    _claude_gen = claude_draft_stream_generator(
                                        prompt,
                                        model_name=resolved_model_name,
                                        pdf_bytes=_draft_template_bytes,
                                        pdf_mime=(_tmpl_mime or "application/pdf"),
                                        max_tokens=int(getattr(settings, "draft_max_output_tokens", 0) or 32000),
                                    )
                                else:
                                    _claude_gen = claude_stream_generator(
                                        prompt,
                                        model_name=resolved_model_name,
                                        gen_kwargs=claude_gen_kwargs,
                                        llm_params=claude_llm_params,
                                    )
                                for chunk_text in _claude_gen:
                                    loop.call_soon_threadsafe(chunk_queue.put_nowait, chunk_text)
                            except Exception as exc:
                                claude_stream_error.append(str(exc))
                            finally:
                                unbind_token_usage_session()
                                loop.call_soon_threadsafe(chunk_queue.put_nowait, _SENTINEL)

                        stream_future = loop.run_in_executor(None, _run_claude_stream)
                        while True:
                            chunk_text = await chunk_queue.get()
                            if chunk_text is _SENTINEL:
                                break
                            if not chunk_text:
                                continue
                            streamed = True
                            answer_parts.append(chunk_text)
                            async for sse_line in _yield_text_as_streaming_chunks(
                                _sse, chunk_text, delay_ms=stream_delay_ms
                            ):
                                yield sse_line
                        try:
                            await stream_future
                        except Exception as exc:
                            claude_stream_error.append(str(exc))
                        if claude_stream_error:
                            raise RuntimeError(f"claude_stream_failed: {claude_stream_error[0]}")
                    elif stream_provider == "deepseek":
                        # ── DeepSeek streaming path (thread + queue, same as Claude) ──
                        deepseek_gen_kwargs, deepseek_llm_params = stream_cfg
                        _SENTINEL_DS = object()
                        ds_chunk_queue: asyncio.Queue = asyncio.Queue()
                        deepseek_stream_error: list[str] = []

                        def _run_deepseek_stream():
                            # Bind the request's token-usage session inside the executor thread —
                            # see _run_kimi_stream below for why.
                            bind_token_usage_session(usage_session_key)
                            try:
                                for chunk_text in deepseek_stream_generator(
                                    prompt,
                                    model_name=resolved_model_name,
                                    gen_kwargs=deepseek_gen_kwargs,
                                    llm_params=deepseek_llm_params,
                                ):
                                    loop.call_soon_threadsafe(ds_chunk_queue.put_nowait, chunk_text)
                            except Exception as exc:
                                deepseek_stream_error.append(str(exc))
                            finally:
                                unbind_token_usage_session()
                                loop.call_soon_threadsafe(ds_chunk_queue.put_nowait, _SENTINEL_DS)

                        ds_stream_future = loop.run_in_executor(None, _run_deepseek_stream)
                        while True:
                            chunk_text = await ds_chunk_queue.get()
                            if chunk_text is _SENTINEL_DS:
                                break
                            if not chunk_text:
                                continue
                            streamed = True
                            answer_parts.append(chunk_text)
                            async for sse_line in _yield_text_as_streaming_chunks(
                                _sse, chunk_text, delay_ms=stream_delay_ms
                            ):
                                yield sse_line
                        try:
                            await ds_stream_future
                        except Exception as exc:
                            deepseek_stream_error.append(str(exc))
                        if deepseek_stream_error:
                            raise RuntimeError(f"deepseek_stream_failed: {deepseek_stream_error[0]}")
                    elif stream_provider == "kimi":
                        # ── Kimi streaming path (thread + queue, same as DeepSeek) ────
                        kimi_gen_kwargs, kimi_llm_params = stream_cfg
                        _SENTINEL_KM = object()
                        km_chunk_queue: asyncio.Queue = asyncio.Queue()
                        kimi_stream_error: list[str] = []

                        def _run_kimi_stream():
                            # The token-usage accumulator is THREAD-LOCAL, and this generator runs
                            # on an executor thread — without binding the request's session here the
                            # usage never joins the final aggregated table (no User ID / Session ID /
                            # LLM Calls / Retrieved Chunks rows), it just logs a bare per-call table.
                            # Same reasoning as _draft_run_blocking above.
                            bind_token_usage_session(usage_session_key)
                            try:
                                for event in kimi_stream_generator(
                                    prompt,
                                    model_name=resolved_model_name,
                                    gen_kwargs=kimi_gen_kwargs,
                                    llm_params=kimi_llm_params,
                                ):
                                    loop.call_soon_threadsafe(km_chunk_queue.put_nowait, event)
                            except Exception as exc:
                                kimi_stream_error.append(str(exc))
                            finally:
                                unbind_token_usage_session()
                                loop.call_soon_threadsafe(km_chunk_queue.put_nowait, _SENTINEL_KM)

                        km_stream_future = loop.run_in_executor(None, _run_kimi_stream)
                        while True:
                            event = await km_chunk_queue.get()
                            if event is _SENTINEL_KM:
                                break
                            # New shape: {"type": "thinking"|"chunk", "text": "..."}.
                            # Plain strings are treated as answer chunks for safety.
                            if isinstance(event, dict):
                                ev_type = str(event.get("type") or "chunk")
                                text = event.get("text") or ""
                                if not text:
                                    continue
                                if ev_type == "thinking":
                                    # Live CoT — keep the UI moving; do NOT add to answer_parts.
                                    streamed = True
                                    yield _sse({"type": "thinking", "text": text})
                                    continue
                                chunk_text = text
                            else:
                                chunk_text = event
                            if not chunk_text:
                                continue
                            streamed = True
                            answer_parts.append(chunk_text)
                            async for sse_line in _yield_text_as_streaming_chunks(
                                _sse, chunk_text, delay_ms=stream_delay_ms
                            ):
                                yield sse_line
                        try:
                            await km_stream_future
                        except Exception as exc:
                            kimi_stream_error.append(str(exc))
                        if kimi_stream_error:
                            raise RuntimeError(f"kimi_stream_failed: {kimi_stream_error[0]}")
                    else:
                        # ── Gemini streaming path ─────────────────────────────────────
                        gemini_config = stream_cfg
                        # Admin-panel temperature control for PAID (non-Gemma) models: apply the
                        # temperature from the LLM Management → Summarization Chat panel
                        # (summarization_chat_config.model_temperature), which is synced, instead of the
                        # unsynced agent_prompts temp — matching "gemini → paid + admin config". Gemma
                        # keeps its hardcoded temperature (set in _build_gemini_config), so it is NOT
                        # touched here (guarded by `not _gemma_capped_chat`).
                        if not is_draft and not _gemma_capped_chat:
                            _panel_temp = (llm_config or {}).get("model_temperature")
                            if _panel_temp is not None:
                                try:
                                    _pt = float(_panel_temp)
                                    if isinstance(gemini_config, dict):
                                        gemini_config["temperature"] = _pt
                                    else:
                                        gemini_config.temperature = _pt
                                    logger.info(
                                        "[Route:intelligent_chat_stream] non-gemma temperature from LLM Management panel -> %.2f",
                                        _pt,
                                    )
                                except Exception:
                                    pass
                        # Comprehensive asks: OPTIONALLY nudge temperature up so the model writes a
                        # fuller, less terse answer. The agent_prompts row uses a low temp (~0.3-0.7)
                        # tuned for precise specific-question answers, which suppresses long-form output.
                        # Gemma supports up to 2.0; 1.0 gives markedly fuller output while the
                        # "grounded ONLY in the documents / do not invent" prompt keeps it accurate.
                        # GATED behind COMPREHENSIVE_TEMP_NUDGE (default False) so the admin-configured
                        # temperature is honored verbatim by default — per the contract "model +
                        # temperature come from admin config; only thinking is hardcoded minimal". This
                        # object is shared with the non-stream deep fallback (files.py ~_ns_cfg), so
                        # leaving it unmutated means the admin temp reaches BOTH paths.
                        # (Draft mode keeps its own precise temperature — do not nudge it.)
                        if is_comprehensive and not is_draft and bool(getattr(settings, "comprehensive_temp_nudge", False)):
                            try:
                                _nudged = None
                                if isinstance(gemini_config, dict):
                                    if float(gemini_config.get("temperature") or 0.0) < 1.0:
                                        gemini_config["temperature"] = 1.0
                                        _nudged = 1.0
                                else:
                                    _cur_temp = getattr(gemini_config, "temperature", None)
                                    if _cur_temp is None or float(_cur_temp) < 1.0:
                                        gemini_config.temperature = 1.0
                                        _nudged = 1.0
                                if _nudged is not None:
                                    logger.info(
                                        "[Route:intelligent_chat_stream] comprehensive temperature nudged -> %.2f "
                                        "(used for streaming AND the non-stream deep fallback)", _nudged,
                                    )
                            except Exception:
                                pass
                        # Gemma models must use the dedicated Gemma key (consistent with
                        # document_ai._gemini_client); other gemini models use GEMINI_API_KEY.
                        _stream_tail = (resolved_model_name or "").split("/")[-1].lower()
                        _stream_key = (
                            (settings.gemma_api_key or "").strip()
                            if _stream_tail.startswith("gemma") and (settings.gemma_api_key or "").strip()
                            else settings.gemini_api_key
                        )
                        client = genai.Client(api_key=_stream_key)
                        # Deep/extreme asks use this SAME single streaming call — the full document +
                        # the no-ceiling, follow-the-user's-structure prompt built above. The earlier
                        # per-section multi-pass was removed: splitting the report into grouped passes
                        # fed each pass only per-group RAG snippets (not the whole case), which made
                        # deep answers SHORTER, slower (5+ throttle-prone calls), and more
                        # hallucination-prone than one call over the complete document.
                        # Draft mode: a PDF-capable draft model (e.g. gemini-3.1-pro-preview) reads the
                        # uploaded template PDF directly for full-fidelity reproduction, so attach it as
                        # a file Part alongside the grounding prompt. gemma / non-PDF templates instead
                        # carry the template as TEXT inside `prompt` (built above), so contents=prompt.
                        # `contents` wants list[PartUnionDict]; list is invariant, so a bare list[Part]
                        # is rejected by the type checker even though the SDK accepts it. Import hoisted so
                        # the annotation resolves — a local annotation is never evaluated at runtime, so
                        # this adds no cost on the non-draft path.
                        from google.genai import types as _gtypes
                        _draft_contents: list[_gtypes.PartUnionDict] | None = None
                        if is_draft and _draft_attach_pdf and _draft_template_bytes:
                            _draft_contents = [
                                _gtypes.Part.from_bytes(data=_draft_template_bytes, mime_type="application/pdf"),
                                _gtypes.Part.from_text(text=prompt),
                            ]
                        # Free-tier Gemma: skip the streaming attempt entirely and use the single
                        # non-stream call below. Streaming + the non-stream fallback each send the
                        # full ~13K input (~26K/min → 429s the 16K/min budget); one non-stream send
                        # fits. Raising drops into the `except` → the deep non-stream fallback, which
                        # runs the SAME prompt with the 20K budget + temperature nudge. Trade-off: no
                        # token-by-token streaming. Disable via GEMMA_DISABLE_STREAMING=false.
                        if not is_draft:
                            _gemma_skip = False
                            try:
                                from app.services.adapters.document_ai import _is_gemma_model as _is_gemma_skip_fn
                                _gemma_skip = _is_gemma_skip_fn(resolved_model_name) and bool(
                                    getattr(settings, "gemma_disable_streaming", True)
                                )
                            except Exception:
                                _gemma_skip = False
                            if _gemma_skip:
                                logger.info(
                                    "[Route:intelligent_chat_stream] gemma streaming disabled — single "
                                    "non-stream call (avoids the stream+fallback double-send that 429s "
                                    "the free-tier 16K/min input budget)"
                                )
                                raise RuntimeError("gemma_stream_disabled")
                        # Pace the STREAMING gemma call too (the retry wrapper only paces the
                        # non-stream path). Runs in the executor so the blocking sleep never stalls
                        # the event loop; feeds the same rolling RPM + input-TPM window.
                        try:
                            from app.services.adapters.document_ai import (
                                _is_gemma_model as _is_gemma_stream,
                                _estimate_input_tokens as _est_tokens_stream,
                                _pace_gemma_call as _pace_stream,
                            )
                            if _is_gemma_stream(resolved_model_name):
                                _pre_contents = _draft_contents if _draft_contents is not None else prompt
                                _pre_est = _est_tokens_stream(_pre_contents)
                                await loop.run_in_executor(
                                    None,
                                    lambda: _pace_stream(resolved_model_name, est_input_tokens=_pre_est),
                                )
                        except Exception:
                            pass
                        stream_iter = client.models.generate_content_stream(
                            model=resolved_model_name,
                            contents=(_draft_contents if _draft_contents is not None else prompt),
                            config=gemini_config,
                        )
                        # Generous limits: short per-chunk timeouts were stopping the stream mid-answer
                        # when the model paused between chunks, producing truncated UI responses.
                        # Comprehensive/deep asks send a huge prompt (full doc + structure), so the
                        # model needs much longer to emit the FIRST token. Give it room before falling
                        # back to non-stream — a premature fallback both loses streaming AND (for deep)
                        # routes through a path that truncates the prompt.
                        if is_comprehensive:
                            first_chunk_timeout_s = min(360.0, max(180.0, non_stream_timeout_s))
                        else:
                            first_chunk_timeout_s = min(180.0, max(90.0, non_stream_timeout_s / 2.0))
                        # Gemma with minimal thinking emits its first token in ~1-2s when healthy; a
                        # long silence means the free-tier input-TPM quota is SATURATED and the
                        # request is being throttled (it keeps hanging, it does not recover). Cap the
                        # first-chunk wait so a throttled Gemma call falls back in ~45s instead of
                        # freezing the UI for 3 minutes.
                        try:
                            from app.services.adapters.document_ai import _is_gemma_model as _is_gemma_to
                            if _is_gemma_to(resolved_model_name):
                                first_chunk_timeout_s = min(first_chunk_timeout_s, 45.0)
                        except Exception:
                            pass
                        next_chunk_timeout_s = 600.0
                        agg_full = ""
                        # _got_content tracks ANY streamed content (gemma-4's thought parts count too),
                        # so the long first-chunk timeout only applies until the model STARTS emitting,
                        # not between later chunks. `streamed` (which gates the non-stream fallback) is
                        # still set only when real ANSWER text flows.
                        _got_content = False
                        # Stream diagnostics: how many type=chunk events actually left this loop, and
                        # when. "Answer appears all at once" has three different causes that look
                        # identical in the UI — the provider emitted ONE big delta, the stream never
                        # produced answer text (so the non-stream fallback replayed it whole), or the
                        # deltas were real but arrived faster than a repaint. These numbers separate them.
                        _dbg_chunks = 0
                        _dbg_chars = 0
                        _dbg_t0 = time.monotonic()
                        _dbg_t_first: float | None = None
                        while True:
                            chunk_timeout_s = first_chunk_timeout_s if not _got_content else next_chunk_timeout_s
                            try:
                                chunk = await asyncio.wait_for(
                                    loop.run_in_executor(None, lambda it=stream_iter: next(it, None)),
                                    timeout=chunk_timeout_s,
                                )
                            except asyncio.TimeoutError:
                                if streamed:
                                    logger.warning(
                                        "[Route:intelligent_chat_stream] folder=%s gemini stream stalled after partial output; finalizing partial answer",
                                        folder_name,
                                    )
                                    break
                                raise TimeoutError("gemini_stream_first_chunk_timeout")
                            if chunk is None:
                                break
                            _um = getattr(chunk, "usage_metadata", None)
                            if _um is not None:
                                prompt_tokens = int(getattr(_um, "prompt_token_count", 0) or 0)
                                completion_tokens = int(getattr(_um, "candidates_token_count", 0) or 0)
                                total_tokens = int(getattr(_um, "total_token_count", 0) or 0)
                                if not total_tokens and (prompt_tokens or completion_tokens):
                                    total_tokens = prompt_tokens + completion_tokens
                                stream_usage = {
                                    "provider": "gemini",
                                    "model": resolved_model_name,
                                    "inputTokens": prompt_tokens,
                                    "outputTokens": completion_tokens,
                                    "totalTokens": total_tokens,
                                }
                            piece, thought_piece = _gemini_chunk_parts(chunk)
                            # gemma-4 streams its reasoning as thought parts (chunk.text excludes
                            # them). Surface them LIVE as "thinking" so the UI shows activity during a
                            # long thinking phase instead of freezing — and so the loop never skips
                            # every chunk and silently falls back to a non-stream dump.
                            if thought_piece:
                                _got_content = True
                                yield _sse({"type": "thinking", "text": thought_piece})
                            if not piece:
                                continue
                            _got_content = True
                            if not agg_full:
                                delta = piece
                                agg_full = piece
                            elif piece.startswith(agg_full):
                                delta = piece[len(agg_full):]
                                agg_full = piece
                            else:
                                delta = piece
                                agg_full = agg_full + piece
                            if not delta:
                                continue
                            streamed = True
                            if _dbg_t_first is None:
                                _dbg_t_first = time.monotonic() - _dbg_t0
                            _dbg_chunks += 1
                            _dbg_chars += len(delta)
                            answer_parts.append(delta)
                            yield _sse({"type": "chunk", "text": delta})
                        logger.info(
                            "[Route:intelligent_chat_stream] STREAM-STATS folder=%s model=%s streamed=%s "
                            "chunks=%d chars=%d avg_delta=%.0f first_token=%s total=%.2fs",
                            folder_name, resolved_model_name, streamed, _dbg_chunks, _dbg_chars,
                            (_dbg_chars / _dbg_chunks) if _dbg_chunks else 0,
                            ("%.2fs" % _dbg_t_first) if _dbg_t_first is not None else "never",
                            time.monotonic() - _dbg_t0,
                        )
                    if streamed:
                        yield _sse({"type": "thinking", "text": "Finalizing response and citations...\n"})
            except Exception as stream_exc:
                logger.info(
                    "[Route:intelligent_chat_stream] folder=%s streaming unavailable, using non-stream fallback: %s",
                    folder_name,
                    stream_exc,
                )
                yield _sse({"type": "thinking", "text": "Live stream unavailable, sending complete response...\n"})

            if not streamed:
                logger.info(
                    "[Route:intelligent_chat_stream] folder=%s using non-stream Gemini fallback timeout=%ss doc_count=%s max_output_tokens=%s",
                    folder_name,
                    non_stream_timeout_s,
                    len(doc_texts),
                    llm_config.get("max_summarization_output_tokens") or llm_config.get("max_output_tokens") or 65536,
                )
                non_stream_system_instruction = system_instruction
                if learning_mode and learning_state is not None:
                    # DB agent prompt is applied as native system_instruction by _generate_text;
                    # pass only the runtime JSON/grounding block as the user-prompt prefix.
                    _lr_core_ns = LearningAgentController.learning_system_prompt(
                        turn_count=learning_state.turn_count,
                        knowledge_level=learning_state.knowledge_level,
                        context_page=getattr(chat_request, "context_page", None),
                        context_selection=getattr(chat_request, "context_selection", None),
                        document_context=learning_state.document_context,
                        server_pedagogy_directive=learning_pedagogy_directive,
                    )
                    non_stream_system_instruction = (
                        f"{_lr_core_ns}\n\n=== RETRIEVED EXCERPTS (vector-ranked, case-grounded) ===\n{learning_chunk_addon}"
                        if learning_chunk_addon
                        else _lr_core_ns
                    )
                # The model was already resolved for the streaming attempt — reuse it. (Re-resolving
                # here via stream_config_for_folder_chat just re-ran _generation_config and logged the
                # agent's raw temperature=0.70, which looked like the generation temp but was a
                # discarded lookup. The real generation config, _ns_cfg below, carries the nudged 1.0.)
                _reused_model = locals().get("resolved_model_name")
                if _reused_model:
                    actual_model_name = _reused_model

                # ── Comprehensive/deep fallback: run the FULL prompt non-stream ──────────
                # The generic QA path below truncates the user prompt to 12K chars and uses a
                # summary template — fatal for a long, structured deep ask (it drops the later
                # numbered points and ignores the completion contract). For comprehensive/deep
                # gemini asks, run the SAME `prompt` (full doc + structure) non-stream instead.
                # These were assigned inside the streaming try above; on an early failure they may
                # be unbound, so read them defensively (locals().get never raises for unbound names).
                _ns_provider = locals().get("stream_provider")
                _ns_model = locals().get("resolved_model_name")
                _ns_cfg = locals().get("gemini_config")
                _ns_client = locals().get("client")
                _ns_prompt = locals().get("prompt")
                # Draft mode: reuse the same [template PDF Part, prompt] contents built for streaming so
                # the non-stream fallback also drafts from the attached template (not text-only). When no
                # PDF Part was attached (gemma / text templates), `_ns_draft` is None and we send the
                # prompt, which already carries the template text.
                _ns_draft = locals().get("_draft_contents")
                _deep_fallback_done = False
                # Model the generic-QA path below runs on. Normally the admin-selected model; a failed
                # free-tier gemma deep call retargets this at its fallback (see the except handler).
                _qa_model_override = selected_model_name
                if (
                    is_comprehensive and not learning_mode and _ns_provider == "gemini"
                    and _ns_model and _ns_cfg is not None and _ns_client is not None and _ns_prompt
                ):
                    try:
                        from app.services.adapters.document_ai import _gemini_generate_content_retrying
                        _ns_resp = await _run_blocking(
                            lambda: _gemini_generate_content_retrying(
                                _ns_client,
                                model=_ns_model,
                                contents=(_ns_draft if _ns_draft is not None else _ns_prompt),
                                config=_ns_cfg,
                            ),
                            timeout_s=non_stream_timeout_s,
                            timeout_message="gemini_non_stream_deep",
                        )
                        _ns_text = (getattr(_ns_resp, "text", "") or "").strip()
                        if _ns_text:
                            _ns_um = getattr(_ns_resp, "usage_metadata", None)
                            if _ns_um is not None:
                                _p = int(getattr(_ns_um, "prompt_token_count", 0) or 0)
                                _c = int(getattr(_ns_um, "candidates_token_count", 0) or 0)
                                stream_usage = {
                                    "provider": "gemini",
                                    "model": _ns_model,
                                    "inputTokens": _p,
                                    "outputTokens": _c,
                                    "totalTokens": int(getattr(_ns_um, "total_token_count", 0) or 0) or (_p + _c),
                                }
                            answer_parts = [_ns_text]
                            async for sse_line in _yield_text_as_streaming_chunks(
                                _sse, _ns_text, delay_ms=stream_delay_ms
                            ):
                                yield sse_line
                            yield _sse({"type": "thinking", "text": "Response generated. Preparing final metadata...\n"})
                            _deep_fallback_done = True
                    except Exception as _ns_deep_exc:
                        # Free-tier Gemma input-tokens-per-minute quota is unrecoverable by retrying
                        # (see GemmaInputTPMExceeded) — surface a clear, actionable message instead
                        # of falling through to the generic QA path (which would 429 the same way,
                        # then hang until the step timeout and show "Something went wrong").
                        try:
                            from app.services.adapters.document_ai import GemmaInputTPMExceeded as _TPMExc
                        except Exception:
                            _TPMExc = ()  # type: ignore[assignment]
                        _is_tpm_exc = bool(_TPMExc) and isinstance(_ns_deep_exc, _TPMExc)
                        if _gemma_capped_chat or _is_tpm_exc:
                            # Retry a failed free-tier gemma deep call on its fallback chain
                            # (26b -> 31b -> flash-lite), reusing the drafting pipeline's chain so both
                            # share one definition. _call_gemini_for_qa resolves the API key per model
                            # (_gemini_api_key_for_model), so the paid backstop uses GEMINI_API_KEY.
                            #
                            # BUT never chain a SECOND gemma call after a timeout or a TPM breach: the
                            # deep call runs via run_in_executor, so a timed-out thread is NOT cancelled
                            # and still holds part of the free 16K/min input budget, and a TPM breach
                            # means that budget is already gone. Another gemma call would stack on the
                            # same pool and 429. The paid backstop draws on a different key/quota, so it
                            # is safe in both cases — drop the gemma hops and jump straight to it.
                            from app.services.template_drafting import _reliable_alt_chain as _alt_chain
                            from app.services.adapters.document_ai import _is_gemma_model as _is_gemma
                            _fb_chain = _alt_chain(_ns_model or selected_model_name or "")
                            _skip_gemma_hops = _is_tpm_exc or isinstance(_ns_deep_exc, TimeoutError)
                            if _skip_gemma_hops:
                                _fb_chain = [m for m in _fb_chain if not _is_gemma(m)]
                            if _fb_chain:
                                _qa_model_override = _fb_chain[0]
                                logger.warning(
                                    "[Route:intelligent_chat_stream] folder=%s gemma deep fallback failed (%s) — retrying generic QA on %s (skip_gemma_hops=%s)",
                                    folder_name,
                                    _ns_deep_exc,
                                    _qa_model_override,
                                    _skip_gemma_hops,
                                )
                            else:
                                logger.warning(
                                    "[Route:intelligent_chat_stream] folder=%s gemma deep fallback failed (%s) — no usable fallback, clean message",
                                    folder_name,
                                    _ns_deep_exc,
                                )
                                yield _sse({
                                    "type": "error",
                                    "message": _GEMMA_INPUT_TPM_USER_MESSAGE if _is_tpm_exc else _GEMMA_SLOW_TIMEOUT_USER_MESSAGE,
                                })
                                return
                        else:
                            logger.warning(
                                "[Route:intelligent_chat_stream] folder=%s deep non-stream fallback failed (%s) — using generic QA",
                                folder_name,
                                _ns_deep_exc,
                            )

                if not _deep_fallback_done:
                    # Run via the SESSION-BINDING wrapper so the fallback model's REAL token
                    # usage is accumulated into the request's token session (instead of being
                    # logged immediately and lost, which forced a bogus "estimated" record with
                    # input≈2 tokens derived from the short query text). _qa_fallback_ran then
                    # suppresses the estimate below since we now have the real numbers.
                    _qa_fallback_ran = True
                    # Comprehensive/deep asks that land HERE (streaming + deep fallback failed, e.g.
                    # under a 503 / saturated free tier) must NOT be answered with the terse "summary"
                    # template — that is what made a "detailed summary" come back as ~1 page. Use a
                    # non-summary intent (so for_summary=False keeps the full output budget) and force
                    # an exhaustive, multi-section answer. Narrow asks keep the concise summary.
                    _qa_intent = "detailed" if is_comprehensive else "summary"
                    _qa_extra = (
                        "Write a THOROUGH, exhaustive, multi-section answer covering ALL material "
                        "facts, issues, dates, parties, amounts, and reasoning from the record — do "
                        "not condense into a brief summary. When a chronology/timeline is asked for, "
                        "include a detailed Markdown table (Date | Event | Reference). Favor "
                        "completeness over brevity."
                    ) if is_comprehensive else None
                    qa_result = await _draft_run_blocking(
                        lambda: _call_gemini_for_qa(
                            _truncate_prompt(effective_query_text, max_chars=12000, label="non_stream_query"),
                            doc_texts,
                            query_intent=_qa_intent,
                            output_format="structured",
                            extra_instructions=_qa_extra,
                            system_instruction=_truncate_prompt(
                                non_stream_system_instruction,
                                max_chars=64000,
                                label="non_stream_system_instruction",
                            ),
                            summarization_llm_config=llm_config,
                            agent_name=learning_agent_name,
                            model_name_override=_qa_model_override,
                        ),
                        timeout_s=non_stream_timeout_s,
                        timeout_message="gemini_non_stream_generation",
                    )
                    answer = (qa_result.get("answer") or "").strip()
                    if not answer:
                        yield _sse({"type": "error", "message": "Could not generate an answer. Please try rephrasing your question."})
                        return
                    source_docs = qa_result.get("source_documents", "")
                    if source_docs:
                        source_names = [item.strip() for item in source_docs.split(",") if item.strip()]
                    answer_parts = [answer]
                    async for sse_line in _yield_text_as_streaming_chunks(
                        _sse, answer, delay_ms=stream_delay_ms
                    ):
                        yield sse_line
                    yield _sse({"type": "thinking", "text": "Response generated. Preparing final metadata...\n"})

            raw_answer = normalize_markdown_render_output("".join(answer_parts))
            if not raw_answer:
                yield _sse({"type": "error", "message": "Could not generate an answer. Please try rephrasing your question."})
                return
            learning_payload = None
            learning_popup_public = None
            clarification_payload = None
            if learning_mode:
                learning_payload, json_ok, _tag_extra = parse_learning_model_output(raw_answer)
                if not json_ok:
                    logger.warning(
                        "[Route:intelligent_chat_stream] learning mode JSON parse failed (first pass) folder=%s session=%s raw=%s",
                        folder_name,
                        chat_request.session_id,
                        raw_answer[:1200],
                    )
                    repair_instruction = (
                        "Your previous response was not valid JSON. Respond again using only the exact JSON schema."
                    )
                    retry_prompt = (
                        "LEARNING MODE JSON REPAIR:\n"
                        + repair_instruction
                        + "\n\nOriginal user query:\n"
                        + effective_query_text
                    )
                    try:
                        _lr_rep = LearningAgentController.learning_system_prompt(
                            turn_count=learning_state.turn_count if learning_state else 1,
                            knowledge_level=learning_state.knowledge_level if learning_state else "novice",
                            context_page=getattr(chat_request, "context_page", None),
                            context_selection=getattr(chat_request, "context_selection", None),
                            document_context=(learning_state.document_context if learning_state else ""),
                            server_pedagogy_directive=learning_pedagogy_directive,
                        )
                        repair_runtime = (
                            f"{_lr_rep}\n\n=== RETRIEVED EXCERPTS (vector-ranked, case-grounded) ===\n{learning_chunk_addon}"
                            if learning_chunk_addon
                            else _lr_rep
                        )
                        repair_result = await _run_blocking(
                            lambda: _call_gemini_for_qa(
                                retry_prompt,
                                doc_texts[:5],
                                query_intent="summary",
                                output_format="structured",
                                system_instruction=repair_runtime,
                                summarization_llm_config=llm_config,
                                agent_name=learning_agent_name,
                                model_name_override=selected_model_name,
                            ),
                            timeout_s=45.0,
                            timeout_message="learning_json_repair",
                        )
                        repaired_raw = str(repair_result.get("answer") or "").strip()
                        if repaired_raw:
                            learning_payload, json_ok, _tag_extra2 = parse_learning_model_output(repaired_raw)
                    except Exception as repair_exc:
                        logger.warning(
                            "[Route:intelligent_chat_stream] learning mode JSON repair failed folder=%s session=%s err=%s",
                            folder_name,
                            chat_request.session_id,
                            repair_exc,
                        )
                    if not json_ok:
                        learning_payload = LearningAgentController.fallback_payload()
                        learning_payload["feedback"] = (
                            "I had trouble formatting the learning response, but I can still guide you."
                        )
                if learning_payload is not None and doc_texts:
                    try:
                        from app.services.agent_config_service import get_agent_config

                        lcfg = get_agent_config("learning_mode_agent")
                        lparams = dict(lcfg.llm_parameters or {})
                        corr = LearningAgentController.resolve_correction_agent_name(lparams)
                        if corr:
                            excerpt = _learning_case_excerpt_for_remediation(doc_texts)
                            _lr_rem = LearningAgentController.learning_system_prompt(
                                turn_count=learning_state.turn_count if learning_state else 1,
                                knowledge_level=learning_state.knowledge_level if learning_state else "novice",
                                context_page=getattr(chat_request, "context_page", None),
                                context_selection=getattr(chat_request, "context_selection", None),
                                document_context=(learning_state.document_context if learning_state else ""),
                                server_pedagogy_directive=learning_pedagogy_directive,
                            )
                            runtime_txt = (
                                f"{_lr_rem}\n\n=== RETRIEVED EXCERPTS (vector-ranked, case-grounded) ===\n{learning_chunk_addon}"
                                if learning_chunk_addon
                                else _lr_rem
                            )
                            learning_payload = await _run_blocking(
                                lambda: LearningAgentController.maybe_run_remediation(
                                    primary_payload=learning_payload,
                                    learning_primary_llm_parameters=lparams,
                                    correction_agent_name=corr,
                                    user_text=effective_query_text,
                                    case_excerpt=excerpt,
                                    learning_runtime_contract_text=runtime_txt,
                                    user_id=user_id,
                                    summarization_llm_config=llm_config,
                                ),
                                timeout_s=90.0,
                                timeout_message="learning_remediation",
                            )
                    except Exception as rem_exc:
                        logger.warning(
                            "[Route:intelligent_chat_stream] learning remediation failed folder=%s err=%s",
                            folder_name,
                            rem_exc,
                        )
                pq_fb = learning_payload.get("popup_question") if isinstance(learning_payload, dict) else None
                if isinstance(learning_payload, dict) and not learning_payload.get("citations") and learning_grounding_chunks:
                    learning_payload["citations"] = _build_learning_citations_from_chunks(learning_grounding_chunks)
                if isinstance(pq_fb, dict) and pq_fb:
                    LearningAgentController.register_popup_question(
                        user_id=user_id,
                        folder_name=folder_name,
                        session_id=chat_request.session_id,
                        popup=pq_fb,
                    )
                    learning_popup_public = sanitize_public_popup(pq_fb)
                answer = LearningAgentController.to_display_text(learning_payload)
            else:
                answer = raw_answer
                if (chat_request.secret_id or "").strip():
                    answer = post_process_secret_prompt_response(answer)
                # Ambiguous-question protocol: the model may have replied with a
                # clarification JSON instead of an answer. Ship the structured form on
                # `done.clarification` (interactive option card) and keep a readable
                # markdown rendering as the stored answer so history/replay stay sane.
                if not is_draft:
                    clarification_payload = parse_clarification(answer)
                    if clarification_payload:
                        answer = clarification_to_markdown(clarification_payload)
                if research_mode and answer:
                    # Research mode's "## Sources" links are Gemini grounding-redirect
                    # wrappers, not real publisher URLs — they can be dead/expired. Resolve
                    # them to their real destination now (while freshly valid) so the
                    # frontend's final rendered answer (it prefers this `done.answer` over
                    # the raw streamed text) has working links, and drop any that don't
                    # resolve rather than ship a dead "click here".
                    try:
                        yield _sse({"type": "thinking", "text": "Verifying source links...\n"})
                        from app.services.grounding_links import resolve_grounding_links
                        answer, _ = await resolve_grounding_links(answer)
                    except Exception as _link_exc:
                        logger.warning(
                            "[Route:intelligent_chat_stream] grounding link resolution failed folder=%s err=%s",
                            folder_name, _link_exc,
                        )

            # Try to create a session entry in the folder service
            session_id = chat_request.session_id or ""
            try:
                session_id = await loop.run_in_executor(
                    None,
                    lambda: folder_service._get_or_create_session(
                        user_id, folder_name, chat_request.session_id, display_question
                    ).id,
                )

                def _append_user_msg():
                    sess = folder_service._sessions.get(folder_name, {}).get(session_id)
                    if sess is not None:
                        folder_service._append_message(sess, "user", display_question)

                def _append_assistant_msg():
                    sess = folder_service._sessions.get(folder_name, {}).get(session_id)
                    if sess is not None:
                        folder_service._append_message(sess, "assistant", answer)

                await loop.run_in_executor(None, _append_user_msg)
                await loop.run_in_executor(None, _append_assistant_msg)
                sec_id = (chat_request.secret_id or "").strip() or None

                # Build stable citations payload for persistence + UI.
                source_by_name: dict[str, dict[str, Any]] = {}
                for d in doc_texts:
                    nm = str(d.get("name") or "").strip()
                    if not nm:
                        continue
                    source_by_name[nm.lower()] = {
                        "document_name": nm,
                        "filename": nm,
                        "file_id": str(d.get("file_id")) if d.get("file_id") else None,
                        "document_id": str(d.get("file_id")) if d.get("file_id") else None,
                    }
                ordered_names = [s for s in source_names if s]
                seen_keys: set[str] = set()
                for nm in ordered_names:
                    key = nm.strip().lower()
                    if not key or key in seen_keys:
                        continue
                    seen_keys.add(key)
                    base = source_by_name.get(key, {"document_name": nm, "filename": nm})
                    citations_payload.append(base)

                def _persist_stream_chat() -> None:
                    folder_service._save_folder_chat_to_db(
                        user_id=user_id,
                        folder_name=folder_name,
                        question=display_question,
                        answer=answer,
                        session_id=session_id,
                        citations=citations_payload,
                        used_secret_prompt=bool(sec_id),
                        # Custom prompts have no secret_id but still carry a label —
                        # store it so history shows the name, not the prompt body.
                        prompt_label=(
                            display_question
                            if sec_id
                            else ((chat_request.prompt_label or "").strip() or None)
                        ),
                        secret_id=sec_id,
                    )

                await loop.run_in_executor(None, _persist_stream_chat)
            except Exception:
                pass  # session bookkeeping is non-critical

            yield _sse({
                "type": "metadata",
                "session_id": session_id,
                "method": ("template_draft" if is_draft else "gemini_research" if research_mode else "gemini_direct"),
                "routing_decision": "google_search_grounded" if research_mode else "db_text_fallback",
                "prompt_label": (
                    display_question
                    if (chat_request.secret_id or "").strip()
                    else ((chat_request.prompt_label or "").strip() or None)
                ),
                "used_secret_prompt": bool((chat_request.secret_id or "").strip()),
                "turn_count": learning_state.turn_count if learning_state else None,
                "turn_threshold": LearningAgentController.TURN_THRESHOLD if learning_mode else None,
            })
            request_id = uuid.uuid4().hex[:12]
            input_tokens = (
                int(stream_usage.get("inputTokens") or 0)
                if stream_usage
                else estimate_tokens_from_text(query_text)
            )
            output_tokens = (
                int(stream_usage.get("outputTokens") or 0)
                if stream_usage
                else estimate_tokens_from_text(answer)
            )
            if stream_usage and input_tokens <= 0:
                input_tokens = estimate_tokens_from_text(query_text)
            if stream_usage and output_tokens <= 0:
                output_tokens = estimate_tokens_from_text(answer)
            if stream_usage:
                record_token_usage(
                    context="gemini_direct_stream",
                    usage=stream_usage,
                    provider=stream_usage.get("provider"),
                    model_name=actual_model_name,
                )
            elif not streamed and not locals().get("_qa_fallback_ran"):
                # Only estimate when NOTHING recorded real usage. When the non-stream QA
                # fallback ran, its real token usage was already accumulated into the session
                # (session-bound), so a rough estimate here would double-count and misreport.
                record_token_usage(
                    context="gemini_direct_estimated",
                    usage={
                        "provider": "estimated",
                        "model": actual_model_name,
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "totalTokens": input_tokens + output_tokens,
                    },
                    provider="estimated",
                    model_name=actual_model_name,
                )
            # Per-draft, per-model token burn — logged HERE (after the whole draft,
            # including any single-call fallback) so it reflects the COMPLETE cost of the
            # draft, not just the part before a pipeline failure. Only fires for drafts.
            _ds_start = locals().get("_draft_usage_start")
            if bool(locals().get("is_draft")) and _ds_start is not None:
                try:
                    log_draft_token_usage(
                        usage_session_key, _ds_start,
                        draft_id=locals().get("_draft_id"),
                        draft_model=locals().get("_draft_model_for_log") or actual_model_name,
                        session_id=session_id or "",
                        user_id=uid_int,
                        request_id=request_id,
                        answer_length=len(answer or ""),
                    )
                except Exception as _tok_exc:
                    logger.debug("[Route:intelligent_chat_stream] draft token log skipped: %s", _tok_exc)
            # Report the provider that ACTUALLY answered. This was hardcoded to
            # "gemini_direct", which mislabelled every Claude/DeepSeek/Kimi request.
            _routing_label = f"{str(locals().get('stream_provider') or 'gemini')}_direct"
            usage_totals = flush_aggregated_token_usage_table(
                usage_session_key,
                endpoint="/api/files/{folder}/intelligent-chat/stream",
                user_id=uid_int,
                session_id=session_id or "",
                request_id=request_id,
                model_name=actual_model_name,
                answer_length=len(answer or ""),
                routing=_routing_label,
                retrieved_chunks=_rag_chunks_used,
            ) or {
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "totalTokens": input_tokens + output_tokens,
            }
            # Bill the model that ACTUALLY answered. When an admin-selected model is
            # unavailable (e.g. gemini-3-pro → 404) the adapter retries with the agent
            # default, and logging the requested name charged the user for a model that
            # never ran. Fall back to the requested name only if nothing was recorded.
            _billed_model = str(usage_totals.get("primaryModel") or "").strip() or actual_model_name
            if _billed_model != actual_model_name:
                logger.info(
                    "[Route:intelligent_chat_stream] billing model=%s (requested=%s was unavailable)",
                    _billed_model,
                    actual_model_name,
                )
            log_llm_usage(
                user_id=uid_int,
                model_name=_billed_model,
                input_tokens=usage_totals.get("inputTokens") or 0,
                output_tokens=usage_totals.get("outputTokens") or 0,
                endpoint="/api/files/{folder}/intelligent-chat/stream",
                request_id=request_id,
                session_id=session_id or "",
            )
            # Draft-from-template: render the finished draft into a downloadable, court-styled DOCX
            # (Times New Roman, A4, 1" margins, 1.5 spacing) and return a signed download URL — a
            # Markdown chat bubble cannot be filed. Failure is non-fatal (the streamed draft still shows).
            _draft_download_url = None
            _draft_filename = None
            if is_draft and (answer or "").strip():
                try:
                    import re as _re_docx
                    from app.services.docx_export import markdown_to_court_docx
                    # Typography captured by the drafting pipeline's Stage-A structural analysis
                    # (base font / title alignment from the template); None on the single-call path.
                    _typo = locals().get("_draft_typography")
                    _docx_bytes = await loop.run_in_executor(
                        None, lambda: markdown_to_court_docx(
                            answer, title=(display_question or "Draft"), typography=_typo
                        )
                    )
                    _safe_name = (_re_docx.sub(r"[^A-Za-z0-9._-]+", "_", folder_name or "draft").strip("_") or "draft")[:60]
                    _docx_dest = f"{user_id}/drafts/{_safe_name}_{request_id}.docx"
                    _docx_uri = await loop.run_in_executor(
                        None,
                        lambda: gcs.upload_bytes(
                            _docx_bytes,
                            _docx_dest,
                            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            bucket_type="output",
                        ),
                    )
                    _draft_download_url = await loop.run_in_executor(
                        None, lambda: gcs.signed_read_url(_docx_uri, expiration_minutes=1440)
                    )
                    _draft_filename = f"{_safe_name}_draft.docx"
                    logger.info(
                        "[Route:intelligent_chat_stream] folder=%s draft DOCX exported bytes=%d uri=%s",
                        folder_name, len(_docx_bytes), _docx_uri,
                    )
                except Exception as _docx_exc:
                    logger.warning(
                        "[Route:intelligent_chat_stream] folder=%s draft DOCX export failed: %s",
                        folder_name, _docx_exc,
                    )
            if is_draft and (answer or "").strip() and locals().get("_draft_tiptap_json") is None:
                try:
                    from app.services.tiptap_render import markdown_to_tiptap_content
                    _draft_tiptap_json = {"type": "doc", "content": markdown_to_tiptap_content(answer)}
                    _draft_tiptap_sections = []
                    _draft_legal_section_doc = None
                except Exception as _tiptap_exc:
                    logger.debug("[Route:intelligent_chat_stream] fallback TipTap render skipped: %s", _tiptap_exc)

            yield _sse({
                "type": "done",
                "session_id": session_id,
                "method": ("template_draft" if is_draft else "gemini_direct"),
                "routing_decision": "db_text_fallback",
                "answer": answer,
                "learning_mode": learning_mode,
                "learning_payload": learning_payload,
                "learning_popup_question": learning_popup_public if learning_mode else None,
                "clarification": clarification_payload,
                "turn_count": learning_state.turn_count if learning_state else None,
                "turn_threshold": LearningAgentController.TURN_THRESHOLD if learning_mode else None,
                "citations": citations_payload,
                "used_chunk_ids": [],
                "prompt_label": (
                    display_question
                    if (chat_request.secret_id or "").strip()
                    else ((chat_request.prompt_label or "").strip() or None)
                ),
                "used_secret_prompt": bool((chat_request.secret_id or "").strip()),
                "draft_download_url": _draft_download_url,
                "draft_filename": _draft_filename,
                "draft_tiptap_json": locals().get("_draft_tiptap_json"),
                "draft_tiptap_sections": locals().get("_draft_tiptap_sections"),
                "draft_legal_section_doc": locals().get("_draft_legal_section_doc"),
            })

        except Exception as exc:
            logger.exception("[Route:intelligent_chat_stream] folder=%s DB-Gemini fallback failed: %s", folder_name, exc)
            yield _sse({"type": "error", "message": str(exc)})

    # ── Detached producer: keep generating after the client disconnects ───────────
    # A StreamingResponse generator is CLOSED the instant the client goes away, raising
    # GeneratorExit at whatever `yield` it is sitting on. Everything AFTER the streaming
    # loop — creating the chat session and writing the Q&A to folder_chats (see
    # `_persist_stream_chat` above) — would then never run, so a BRAND-NEW chat that the
    # user navigated away from mid-stream vanished from history completely.
    #
    # Running `_event_generator()` as a DETACHED task that drains into a queue decouples
    # producing from delivering: the client leaving closes only the forwarder below,
    # while the producer runs to completion and persists the chat exactly as if the user
    # had stayed. Reconnecting/reopening the case then shows the finished answer.
    stream_queue: asyncio.Queue = asyncio.Queue()
    _STREAM_EOF = object()

    async def _produce_events() -> None:
        try:
            async for line in _event_generator():
                stream_queue.put_nowait(line)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "[Route:intelligent_chat_stream] background producer failed folder=%s: %s",
                folder_name,
                exc,
            )
        finally:
            stream_queue.put_nowait(_STREAM_EOF)

    producer = asyncio.create_task(_produce_events())
    _BACKGROUND_STREAM_TASKS.add(producer)
    producer.add_done_callback(_BACKGROUND_STREAM_TASKS.discard)

    async def _forward_events() -> AsyncGenerator[str, None]:
        try:
            while True:
                item = await stream_queue.get()
                if item is _STREAM_EOF:
                    break
                yield item
        except (GeneratorExit, asyncio.CancelledError):
            # Client navigated away. Deliberately do NOT cancel `producer` — letting it
            # finish is the entire point, so the session and answer still reach the DB.
            logger.info(
                "[Route:intelligent_chat_stream] client disconnected folder=%s — generation "
                "continues in the background and will be saved to chat history",
                folder_name,
            )
            raise

    return StreamingResponse(
        _forward_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



@router.get("/{folder_name}/sessions")
def list_sessions(folder_name: str) -> list[dict]:
    return [item.model_dump(mode="json") for item in get_folder_service().list_sessions(folder_name)]


@router.get("/{folder_name}/chats")
def list_folder_chats(
    folder_name: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    chats: list[dict[str, Any]] = []

    # Primary source: persisted folder_chats rows so refresh survives app reloads.
    if is_db_available():
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                # One row per session: the session's FIRST chat provides the title,
                # while chat_count/last_activity aggregate the whole session so the
                # sidebar can group and sort conversations by recency.
                user_filter = "AND user_id::text = %s" if user_id else ""
                params = [folder_name, user_id] if user_id else [folder_name]
                cur.execute(
                    f"""
                    SELECT * FROM (
                        SELECT
                            id,
                            question,
                            answer,
                            session_id,
                            citations,
                            used_chunk_ids,
                            used_secret_prompt,
                            prompt_label,
                            secret_id,
                            created_at,
                            COUNT(*) OVER (PARTITION BY session_id) AS chat_count,
                            MAX(created_at) OVER (PARTITION BY session_id) AS last_activity,
                            ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at ASC) AS rn
                        FROM folder_chats
                        WHERE folder_name = %s
                          {user_filter}
                          AND session_id IS NOT NULL
                    ) sessions_first
                    WHERE rn = 1
                    ORDER BY last_activity DESC
                    """,
                    params,
                )
                rows = list(cur.fetchall())

            for row in rows:
                citations = row.get("citations")
                used_chunk_ids = row.get("used_chunk_ids")
                chats.append(
                    {
                        "id": str(row.get("session_id") or row.get("id")),
                        "chat_id": str(row.get("id")),
                        "session_id": str(row.get("session_id")) if row.get("session_id") else None,
                        "question": row.get("question") or row.get("prompt_label") or "Untitled",
                        "title": row.get("question") or row.get("prompt_label") or "Untitled",
                        "answer": row.get("answer") or "",
                        "response": row.get("answer") or "",
                        "message": row.get("answer") or "",
                        "citations": citations if isinstance(citations, list) else [],
                        "used_chunk_ids": [str(item) for item in (used_chunk_ids or [])],
                        "used_secret_prompt": _text_flag(row.get("used_secret_prompt")),
                        "prompt_label": row.get("prompt_label"),
                        "secret_id": str(row.get("secret_id")) if row.get("secret_id") else None,
                        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                        "updated_at": row.get("last_activity").isoformat() if row.get("last_activity") else None,
                        "chat_count": int(row.get("chat_count") or 1),
                    }
                )
            return {"chats": chats}
        except Exception as exc:
            logger.exception(
                "[Route:list_folder_chats] DB read failed folder=%s user_id=%s error=%s",
                folder_name,
                user_id,
                exc,
            )

    # Fallback: in-memory sessions.
    sessions = get_folder_service().list_sessions(folder_name)
    for session in sessions:
        assistant_messages = [message for message in session.messages if message.role == "assistant"]
        user_messages = [message for message in session.messages if message.role == "user"]
        latest_assistant = assistant_messages[-1] if assistant_messages else None
        latest_user = user_messages[-1] if user_messages else None
        chats.append(
            {
                "id": session.id,
                "session_id": session.id,
                "question": latest_user.content if latest_user else session.title,
                "answer": latest_assistant.content if latest_assistant else "",
                "response": latest_assistant.content if latest_assistant else "",
                "message": latest_assistant.content if latest_assistant else "",
                "created_at": session.created_at,
                "updated_at": session.updated_at,
                "messages": [message.model_dump(mode="json") for message in session.messages],
            }
        )
    return {"chats": chats}


@router.get("/{folder_name}/sessions/{session_id}")
def get_session(
    folder_name: str, 
    session_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    
    # Build chat_history in consistent {question, answer} format.
    # DB is preferred (authoritative, survives restarts). In-memory is a fallback
    # for sessions created in the current server process that haven't been persisted yet.

    # 1. Try DB first (always returns chatHistory format)
    if is_db_available():
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        id, question, answer, citations, used_chunk_ids,
                        used_secret_prompt, prompt_label, secret_id, created_at
                    FROM folder_chats
                    WHERE folder_name = %s AND session_id::text = %s
                    ORDER BY created_at ASC
                    """,
                    [folder_name, session_id],
                )
                rows = list(cur.fetchall())

            if rows:
                chat_history = []
                for row in rows:
                    chat_history.append({
                        "id": str(row.get("id")),
                        "question": row.get("question"),
                        "answer": row.get("answer"),
                        "citations": row.get("citations") if isinstance(row.get("citations"), list) else [],
                        "used_chunk_ids": [str(c) for c in (row.get("used_chunk_ids") or [])],
                        "used_secret_prompt": _text_flag(row.get("used_secret_prompt")),
                        "prompt_label": row.get("prompt_label"),
                        "secret_id": str(row.get("secret_id")) if row.get("secret_id") else None,
                        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                    })
                return {
                    "id": session_id,
                    "folderName": folder_name,
                    "chatHistory": chat_history,
                    "messages": chat_history,
                }
        except Exception as exc:
            logger.exception("Failed to fetch session from DB: %s", exc)

    # 2. Fallback: convert in-memory session (role/content pairs) to chatHistory format
    try:
        session = get_folder_service().get_session(folder_name, session_id)
        messages = session.messages if session.messages else []
        chat_history = []
        i = 0
        while i < len(messages):
            if messages[i].role == "user":
                user_msg = messages[i]
                ai_msg = messages[i + 1] if i + 1 < len(messages) and messages[i + 1].role == "assistant" else None
                chat_history.append({
                    "id": user_msg.id,
                    "question": user_msg.content,
                    "answer": ai_msg.content if ai_msg else "",
                    "citations": [],
                    "used_chunk_ids": [],
                    "prompt_label": None,
                    "created_at": user_msg.created_at.isoformat() if hasattr(user_msg.created_at, "isoformat") else str(user_msg.created_at),
                })
                i += 2 if ai_msg else 1
            else:
                i += 1
        if chat_history:
            return {
                "id": session_id,
                "folderName": folder_name,
                "chatHistory": chat_history,
                "messages": chat_history,
            }
    except Exception:
        pass

    raise HTTPException(status_code=404, detail=f"Session {session_id} not found")


@router.post("/{folder_name}/sessions/{session_id}/continue")
def continue_session(
    folder_name: str,
    session_id: str,
    request: FolderChatRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    try:
        continued_request = request.model_copy(update={"session_id": session_id})
        return answer_case_folder_chat(
            user_id=user_id,
            folder_name=folder_name,
            request=continued_request,
            authorization=authorization,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{folder_name}/sessions/{session_id}")
def delete_session(folder_name: str, session_id: str) -> dict:
    try:
        return get_folder_service().delete_session(folder_name, session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{folder_name}/chat/{session_id}")
def delete_single_folder_chat(folder_name: str, session_id: str) -> dict:
    try:
        return get_folder_service().delete_session(folder_name, session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{folder_name}/chats")
def delete_all_folder_chats(folder_name: str) -> dict:
    return get_folder_service().delete_all_sessions(folder_name)


# ── Merged Q&A export ─────────────────────────────────────────────────────────

class MergedDocxSection(BaseModel):
    question: str
    answer: str
    source: str | None = None
    origin_label: str | None = None


class MergedDocxRequest(BaseModel):
    title: str = "Merged Legal Analysis"
    sections: list[MergedDocxSection]
    include_questions: bool = True


@router.post("/export/merged-docx")
def export_merged_docx(request: MergedDocxRequest):
    """Assemble selected Q&A answers into a single downloadable .docx."""
    from fastapi.responses import Response as FastAPIResponse

    from app.services.merged_docx_service import build_merged_docx

    if not request.sections:
        raise HTTPException(status_code=400, detail="Select at least one answer to export.")
    if len(request.sections) > 200:
        raise HTTPException(status_code=400, detail="Too many sections (max 200).")
    try:
        data = build_merged_docx(
            request.title,
            [section.model_dump() for section in request.sections],
            include_questions=request.include_questions,
        )
    except Exception as exc:
        logger.exception("[Route:export_merged_docx] build failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to build the document.") from exc
    safe_title = re.sub(r"[^\w\- ]+", "", request.title).strip().replace(" ", "_") or "Merged_Legal_Analysis"
    return FastAPIResponse(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.docx"'},
    )


@router.post("/export/merged-pdf")
def export_merged_pdf(request: MergedDocxRequest):
    """Assemble selected Q&A answers into a single downloadable .pdf."""
    from fastapi.responses import Response as FastAPIResponse

    from app.services import branding_pdf_service
    from app.services.merged_pdf_service import (
        MERGED_PDF_PRINT_PROFILE,
        build_merged_html,
        build_merged_pdf,
    )

    if not request.sections:
        raise HTTPException(status_code=400, detail="Select at least one answer to export.")
    if len(request.sections) > 200:
        raise HTTPException(status_code=400, detail="Too many sections (max 200).")
    sections = [section.model_dump() for section in request.sections]

    # Prefer Chromium: it shapes complex scripts (Marathi/Hindi Devanagari) that
    # reportlab's Helvetica cannot render. reportlab remains the fallback.
    data = None
    if branding_pdf_service.is_pdf_renderer_available():
        try:
            html = build_merged_html(
                request.title, sections, include_questions=request.include_questions
            )
            data = branding_pdf_service.html_to_pdf(html, MERGED_PDF_PRINT_PROFILE)
        except Exception as exc:
            logger.warning("[Route:export_merged_pdf] chromium render failed, falling back to reportlab: %s", exc)
    if data is None:
        try:
            data = build_merged_pdf(
                request.title, sections, include_questions=request.include_questions
            )
        except Exception as exc:
            logger.exception("[Route:export_merged_pdf] build failed: %s", exc)
            raise HTTPException(status_code=500, detail="Failed to build the document.") from exc
    safe_title = re.sub(r"[^\w\- ]+", "", request.title).strip().replace(" ", "_") or "Merged_Legal_Analysis"
    return FastAPIResponse(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )
