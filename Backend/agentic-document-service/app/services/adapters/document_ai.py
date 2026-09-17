from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Any

from app.schemas.contracts import DocumentReference, DocumentType
from app.services.llm_chat_config import get_summarization_chat_config, resolve_model_name
from app.services.prompt_orchestration import (
    PERMANENT_SYSTEM_PROMPT,
    ResponseIntent,
    detect_response_format,
    format_instruction_for_query,
    is_custom_template_question as _is_custom_template_question_orch,
)
from app.services.chronology.pack import pack_for_extraction
from app.services.chronology.prompt import CHRONOLOGY_EXTRACTION_BLOCK
from app.services.token_usage_log import log_token_usage_table

logger = logging.getLogger("agentic_document_service.document_ai")
DEFAULT_MAX_OUTPUT_TOKENS = 65536
DEEPSEEK_MAX_OUTPUT_TOKENS = 384000
# Anthropic Messages API rejects max_tokens above the model's real output ceiling.
CLAUDE_MAX_OUTPUT_TOKENS = 64000
# Minimum output budget for DeepSeek so multi-section / 4000-word legal analyses
# never truncate even when an agent_prompts row sets a small max_output_tokens.
_DEEPSEEK_MIN_OUTPUT_TOKENS = 16384
# Kimi (Moonshot) output budget. kimi-k3 carries a 1M-token context and the others
# 256K, but the answer itself never needs more than this; the floor mirrors DeepSeek
# so long legal analyses are not truncated by a small agent_prompts value.
KIMI_MAX_OUTPUT_TOKENS = 98304
_KIMI_MIN_OUTPUT_TOKENS = 16384
# Moonshot REJECTS any other temperature outright (400 "invalid temperature: only X
# is allowed for this model"), and which value is legal depends on thinking mode:
#   thinking on (the default — kimi-k3 is thinking-ONLY) → temperature must be 1.0
#   thinking explicitly disabled                         → temperature must be 0.6
# Both verified live against api.moonshot.ai for k3 / k2.6 / k2.7-code(-highspeed).
# This is why the admin panel's temperature CANNOT be forwarded to a Kimi model.
_KIMI_THINKING_TEMPERATURE = 1.0
_KIMI_NON_THINKING_TEMPERATURE = 0.6
# Tabular requests use a low temperature so the model emits consistent, valid GFM
# pipe-table syntax (deterministic formatting beats creative prose for tables).
_TABULAR_TEMPERATURE = 0.2

# Monolithic system prompts removed — replaced by the Prompt Orchestration Layer
# (app.services.prompt_orchestration): PERMANENT_SYSTEM_PROMPT (Layer 1) +
# detect_response_format (Layer 2) + build_format_instruction (Layer 3).
# Provider-specific JSON / structured-schema contracts are kept below.



_JSON_RENDERING_CONTRACT = """
OUTPUT RENDERING CONTRACT:
- Return valid JSON only, matching the requested structure. Do not add explanations before or after the JSON.
- When a JSON string value contains comparative, chronological, evidentiary, financial, or otherwise tabular data, represent it as a GitHub-Flavored Markdown table inside that string value.
- Every Markdown table inside a JSON string value MUST include a header row and a valid separator row (e.g. | Date | Event | Source |\\n|---|---|---|).
- Keep every table row on one physical line inside the JSON string; replace cell-internal newlines with spaces.
- Also use bold, italic, and bullet lists inside JSON string values to preserve rich structure from source documents.
- Do not emit HTML tables anywhere in the JSON.
""".strip()
_gemini_extract_unavailable_logged = False
_gemini_qa_unavailable_logged = False
_SPEAKER_LINE_RE = re.compile(r"\[\s*Speaker\s+([^\]]+?)\s*\]\s*:\s*(.+)", re.IGNORECASE)

# Internal agent names used for document AI operations
_AGENT_EXTRACTION = "form_population_agent"
# llm_params marker: send max_output_tokens as-is, without the llm_max_tokens registry clamp.
_NO_OUTPUT_TOKEN_CLAMP = "_skip_output_token_clamp"
_INTAKE_THINKING_LEVELS = ("minimal", "low", "medium", "high")


def _intake_extraction_settings(fallback_model: str) -> tuple[str, str]:
    """Model and thinking level for form_population_agent (intake auto-fill + chronology).

    INTAKE_EXTRACTION_MODEL wins over the agent_prompts row; an empty value keeps the row's
    model (or ADK_MODEL). An unknown INTAKE_EXTRACTION_THINKING_LEVEL falls back to "medium".
    """
    from app.core.config import get_settings

    settings = get_settings()
    model = str(getattr(settings, "intake_extraction_model", "") or "").strip() or fallback_model
    level = str(getattr(settings, "intake_extraction_thinking_level", "") or "").strip().lower()
    if level not in _INTAKE_THINKING_LEVELS:
        if level:
            logger.warning(
                "[DocumentAI] INTAKE_EXTRACTION_THINKING_LEVEL=%r is not one of %s; using medium",
                level,
                "|".join(_INTAKE_THINKING_LEVELS),
            )
        level = "medium"
    return model, level
_AGENT_QA = "grounded_retrieval_agent"

# Public name for routes that must use the same agent as document Q&A (folder chat SSE, etc.).
GROUNDED_RETRIEVAL_AGENT_NAME = _AGENT_QA

_EXTRACTION_PROMPT = """You are an expert legal document analyst specialised in Indian court documents. Extract ALL case information from the document using semantic understanding and intelligent field matching.

INSTRUCTIONS:
1. Read the entire document carefully and understand the context
2. Look for fields even if they are written with different names, synonyms, or abbreviations
3. Use semantic understanding to match field names - for example:
   - "Case Title" could be: "Title", "Subject Matter", "Matter Title", "Case Name", "Cause Title", "Petition Title"
   - "Case Number" could be: "Case No.", "Suit No.", "Petition No.", "Application No.", "Writ Petition No.", "Criminal Case No."
   - "Court" could be: "Court Name", "Forum", "Adjudicating Forum", "Court of", "Before", "Hon'ble Court"
   - "Jurisdiction" could be: "Jurisdiction", "Adjudicating Authority", "Territorial Jurisdiction", "Jurisdictional Area"
   - "Petitioner" could be: "Petitioner", "Plaintiff", "Applicant", "Appellant", "Complainant", "Party"
   - "Respondent" could be: "Respondent", "Defendant", "Opposite Party", "Opponent", "Accused"
   - "Filing Date" could be: "Date of Filing", "Date Filed", "Filed On", "Instituted On", "Registration Date"
   - "Hearing Date" could be: "Next Date", "Next Date of Hearing", "Date of Hearing", "Listed On", "Posted On"
   - "Judge" could be: "Judge", "Hon'ble Justice", "Hon'ble Judge", "Bench", "Presiding Officer"

4. Extract ALL available information - be thorough and comprehensive
5. For dropdown fields (caseType, jurisdiction, courtName, etc.), extract the EXACT value even if written differently
6. For dates, convert to YYYY-MM-DD format
7. For monetary values, extract numeric value only (remove currency symbols, commas)
8. For arrays (petitioners, respondents, judges), extract ALL entries

⚠️  CRITICAL — DO NOT EXTRACT LABELS AS NAMES:
Indian court documents use structural label headings like "PETITIONER", "RESPONDENT", "PLAINTIFF",
"DEFENDANT", "APPELLANT", "COMPLAINANT", "APPLICANT", "ACCUSED", "OPPOSITE PARTY" as column/section
headers — these are NOT the actual party names.
Rules:
  a. NEVER use a bare label word ("PETITIONER", "RESPONDENT", etc.) as a fullName or in caseTitle.
  b. The ACTUAL name appears immediately after the label (on the same line or next line).
     Example in document:  "PETITIONER : Rajesh Kumar Sharma"  → fullName = "Rajesh Kumar Sharma"
     Example in document:  "PETITIONER\nRajesh Kumar Sharma"   → fullName = "Rajesh Kumar Sharma"
  c. If a document title heading reads "PETITIONER vs State of Maharashtra" that means the actual
     petitioner name was not captured yet — look elsewhere in the document for the real name and use it.
  d. "The State" must always be combined: "The State of Maharashtra", "State of Maharashtra & Others", etc.
  e. For caseTitle NEVER generate "PETITIONER vs X" — always replace label words with the real person/entity name.

EXTRACT THE FOLLOWING FIELDS:
{
  "caseTitle": "ACTUAL party names in 'Petitioner Full Name vs Respondent Full Name' format — never use label words like PETITIONER/RESPONDENT as names",
  "caseNumber": "Case number (Case No., Suit No., Petition No., WP No., Criminal Case No.)",
  "casePrefix": "Case prefix like WP, CR, WP(C), SLP, etc.",
  "caseYear": "Year from case number or filing date (YYYY format)",
  "caseType": "Type of case (Civil, Criminal, Writ, Arbitration, etc.)",
  "caseNature": "Case nature (Civil, Criminal, Constitutional/Writ, Arbitration, Commercial, etc.)",
  "subType": "Subtype or category of the case",
  "courtName": "Full court name",
  "courtLevel": "Court level (High Court, District Court, Supreme Court, etc.)",
  "benchDivision": "Bench or division name (e.g., Aurangabad Bench, Principal Bench, Mumbai Bench)",
  "jurisdiction": "Jurisdiction or Adjudicating Authority (territorial area)",
  "state": "State name if mentioned",
  "filingDate": "Filing date in YYYY-MM-DD format",
  "judges": ["Array of judge names"],
  "courtRoom": "Court room number if mentioned",
  "petitioners": [{"fullName": "Petitioner/Plaintiff name (REQUIRED)", "role": "Individual/Company/Government", "advocateName": "Advocate name", "barRegistration": "", "contact": ""}],
  "respondents": [{"fullName": "Respondent/Defendant name (REQUIRED)", "role": "Individual/Company/Government", "advocateName": "Advocate name", "barRegistration": "", "contact": ""}],
  "categoryType": "Category type if mentioned",
  "primaryCategory": "Primary category",
  "subCategory": "Sub category",
  "complexity": "Complexity level (Simple, Medium, Complex)",
  "monetaryValue": "Monetary value (numeric only)",
  "priorityLevel": "Priority level (Low, Medium, High)",
  "currentStatus": "Current status (Active, Pending, Closed, Disposed, etc.)",
  "nextHearingDate": "Next hearing date in YYYY-MM-DD format",
  "documentType": "Type of document (Petition, Affidavit, Notice, Order, etc.)",
  "filedBy": "Who filed the case (Plaintiff, Defendant, Both, or advocate name)"
}

Return ONLY valid JSON without markdown formatting. If a field is not found, use null or empty string.

=== DOCUMENT CONTENT ===
"""

# Form fields + grounded events in one form_population_agent call (one document input bill).
_EXTRACTION_PROMPT = (
    _EXTRACTION_PROMPT.replace(
        "Return ONLY valid JSON without markdown formatting. If a field is not found, use null or empty string.",
        CHRONOLOGY_EXTRACTION_BLOCK
        + "\n\nReturn ONLY valid JSON without markdown formatting. If a field is not found, use null or empty string.",
        1,
    )
)


@dataclass(slots=True)
class ExtractionResult:
    text: str
    entities: dict[str, Any]
    confidence_by_field: dict[str, float]
    quality_score: float


# ── Provider detection ────────────────────────────────────────────────────────

def _model_tail_lower(model_name: str) -> str:
    """Last path segment, lowercased (handles anthropic/claude-4-6, models/claude-*, etc.)."""
    s = (model_name or "").strip()
    if not s:
        return ""
    if "/" in s:
        s = s.split("/")[-1].strip()
    return s.lower()


def _detect_provider(model_name: str) -> str:
    """
    Detect the LLM provider from the model name string (from agent_prompts → llm_models.name).
    Returns 'gemini', 'claude', 'deepseek', or 'kimi'.
    Uses the last path segment so DB values like 'anthropic/claude-sonnet-4-20250514' route to Claude.
    Default is 'gemini' for unknown names.
    """
    tail = _model_tail_lower(model_name)
    if tail.startswith("claude"):
        return "claude"
    if tail.startswith("deepseek"):
        return "deepseek"
    # Moonshot publishes these as 'kimi-k3' / 'kimi-k2.6' / 'kimi-k2.7-code[-highspeed]';
    # 'moonshot-' is the legacy prefix for the same OpenAI-compatible endpoint.
    if tail.startswith("kimi") or tail.startswith("moonshot"):
        return "kimi"
    return "gemini"


def _anthropic_messages_model_id(model_name: str) -> str:
    """Anthropic Messages API expects 'claude-...' without vendor or URI prefix."""
    s = (model_name or "").strip()
    if not s:
        return s
    if "/" in s:
        return s.split("/")[-1].strip()
    return s


def _deepseek_model_id(model_name: str) -> str:
    """Return the bare model id expected by DeepSeek API (strip any vendor/ prefix)."""
    s = (model_name or "").strip()
    if not s:
        return s
    if "/" in s:
        return s.split("/")[-1].strip()
    return s


def _kimi_model_id(model_name: str) -> str:
    """Return the bare model id expected by the Moonshot API (strip any vendor/ prefix)."""
    s = (model_name or "").strip()
    if not s:
        return s
    if "/" in s:
        s = s.split("/")[-1].strip()
    # A bare provider label ("kimi") is not a model id — resolve it to the configured default.
    if s.lower() == "kimi":
        from app.core.config import get_settings

        return str(get_settings().kimi_model or "kimi-k2.6").strip()
    return s


def _kimi_temperature(*, thinking_on: bool) -> float:
    """
    The ONLY temperature Moonshot accepts for the current Kimi models, per mode.

    Anything else is a hard 400 ("invalid temperature: only X is allowed for this
    model"), so a caller's temperature — including the admin panel's — is ignored
    here by design rather than passed through and failing the request.

    Moonshot likewise fixes top_p (0.95), n (1) and both penalties (0.0); this
    adapter simply never sends them, which is why they need no special handling.
    """
    return _KIMI_THINKING_TEMPERATURE if thinking_on else _KIMI_NON_THINKING_TEMPERATURE


# Per Moonshot's docs, only K2.6 can switch thinking OFF outright. K3 "always reasons"
# and is tuned with reasoning_effort instead; the K2.7 Code models always think and
# always preserve their reasoning. Measured minimum reasoning tokens on the same
# ~200-word question confirms which lever actually works for each family:
#   k2.6  thinking=disabled  ->     1     (effort=low alone gives 487 — much worse)
#   k3    reasoning_effort=low ->  14     (vs 1,427 at the "max" default)
#   k2.7-code            low ->  242
#   k2.7-code-highspeed  low ->  435
_KIMI_NO_THINKING_OFF_PREFIXES = ('kimi-k3', 'kimi-k2.7', 'moonshot-k3', 'moonshot-k2.7')
# Used when the caller wants minimal thinking on a model that cannot turn it off.
_KIMI_MIN_EFFORT = 'low'


def _kimi_supports_thinking_off(api_model: str) -> bool:
    """True when `thinking: {"type": "disabled"}` is a valid request for this model."""
    tail = _model_tail_lower(api_model)
    return not tail.startswith(_KIMI_NO_THINKING_OFF_PREFIXES)


# ── Prompt-cache reporting ────────────────────────────────────────────────────
# Moonshot caches prompts automatically — there is no parameter to enable it and no
# cache id to manage. The docs claim a 256-token minimum prefix; measured on this
# account a 26-token prompt cached at 100% on an identical repeat, so size is not the
# real constraint — a byte-identical request is. A cold call omits the
# `cached_tokens` field entirely; a warm one reports it BOTH at usage.cached_tokens
# and usage.prompt_tokens_details.cached_tokens (verified live, stream + non-stream).
#
# USD per 1M INPUT tokens as (cache miss, cache hit). Used only to show what caching
# saved on input — output rates are deliberately not guessed here.
_KIMI_INPUT_RATES: dict[str, tuple[float, float]] = {
    "kimi-k3":     (3.00, 0.30),
    "kimi-k2.7":   (0.95, 0.19),
    "kimi-k2.6":   (0.95, 0.16),
    "kimi-k2.5":   (0.60, 0.10),
}


def _cached_input_tokens(usage: Any) -> int:
    """Cached (discounted) input tokens from an OpenAI-compatible usage object/dict."""
    if usage is None:
        return 0

    def _get(obj: Any, key: str) -> Any:
        if isinstance(obj, dict):
            return obj.get(key)
        return getattr(obj, key, None)

    details = _get(usage, "prompt_tokens_details")
    for candidate in (_get(details, "cached_tokens") if details is not None else None,
                      _get(usage, "cached_tokens"),
                      _get(usage, "cache_read_input_tokens")):  # Anthropic spelling
        try:
            n = int(candidate or 0)
        except (TypeError, ValueError):
            continue
        if n > 0:
            return n
    return 0


def _kimi_cache_saving_usd(api_model: str, cached_tokens: int) -> float | None:
    """USD saved on input by the cache hit, or None when the model has no known rate."""
    if cached_tokens <= 0:
        return None
    tail = _model_tail_lower(api_model)
    best: tuple[float, float] | None = None
    best_len = -1
    for prefix, rates in _KIMI_INPUT_RATES.items():
        if tail.startswith(prefix) and len(prefix) > best_len:
            best, best_len = rates, len(prefix)
    if best is None:
        return None
    miss_rate, hit_rate = best
    return cached_tokens * (miss_rate - hit_rate) / 1_000_000.0


def _log_kimi_cache(api_model: str, usage: Any, *, phase: str) -> int:
    """Emit one console line showing whether Moonshot's prompt cache hit, and return cached tokens."""
    try:
        cached = _cached_input_tokens(usage)
        prompt_tokens = 0
        if usage is not None:
            raw = usage.get("prompt_tokens") if isinstance(usage, dict) else getattr(usage, "prompt_tokens", 0)
            prompt_tokens = int(raw or 0)
        if prompt_tokens <= 0:
            return cached
        pct = (cached / prompt_tokens * 100.0) if prompt_tokens else 0.0
        saved = _kimi_cache_saving_usd(api_model, cached)
        saved_txt = f"  saved≈${saved:.4f}" if saved else ""
        if cached > 0:
            logger.info(
                "[DocumentAI] ⚡ Kimi cache HIT   %s  cached=%s/%s input tokens (%.0f%%)  billed_full=%s%s",
                api_model, f"{cached:,}", f"{prompt_tokens:,}", pct,
                f"{prompt_tokens - cached:,}", saved_txt,
            )
        else:
            logger.info(
                "[DocumentAI] ○ Kimi cache MISS  %s  cached=0/%s input tokens (0%%)  "
                "(cold prompt, or the tail differs from anything cached)",
                api_model, f"{prompt_tokens:,}",
            )
        return cached
    except Exception as exc:  # never let cache reporting break a response
        logger.debug("[DocumentAI] kimi cache log skipped (%s): %s", phase, exc)
        return 0


# ── API clients ───────────────────────────────────────────────────────────────

def _is_gemma_model(model_name: str | None) -> bool:
    """True when the model id (after any vendor/ prefix) is a Gemma model."""
    return _model_tail_lower(model_name or "").startswith("gemma")


def _gemini_api_key_for_model(model_name: str | None) -> str:
    """
    Pick the API key for a google.genai call.

    Gemma models use the dedicated GEMMA_API_KEY when configured; everything else
    (Gemini) uses GEMINI_API_KEY. Gemma falls back to GEMINI_API_KEY when its own
    key is blank, so a single key can still serve both.
    """
    from app.core.config import get_settings

    settings = get_settings()
    if _is_gemma_model(model_name):
        gemma_key = str(getattr(settings, "gemma_api_key", "") or "").strip()
        if gemma_key:
            return gemma_key
    return str(settings.gemini_api_key or "").strip()


def _gemini_client(model_name: str | None = None):
    """Return a configured google.genai Client, or None if unavailable.

    For Gemma models, authenticates with GEMMA_API_KEY when set (falls back to
    GEMINI_API_KEY). Provider selection itself stays driven by the DB model name.
    """
    try:
        from google import genai  # type: ignore

        api_key = _gemini_api_key_for_model(model_name)
        if not api_key:
            return None
        return genai.Client(api_key=api_key)
    except Exception:
        return None


def _api_key_label_for_model(model_name: str | None, provider: str) -> str:
    """Human-readable label of which credential a call uses (for logs/debugging)."""
    if provider == "claude":
        return "ANTHROPIC_API_KEY"
    if provider == "deepseek":
        return "DEEPSEEK_API_KEY"
    if provider == "kimi":
        return "KIMI_API_KEY"
    if _is_gemma_model(model_name):
        from app.core.config import get_settings

        has_gemma = bool(str(getattr(get_settings(), "gemma_api_key", "") or "").strip())
        return "GEMMA_API_KEY" if has_gemma else "GEMINI_API_KEY (gemma fallback)"
    return "GEMINI_API_KEY"


def _anthropic_client():
    """Return a configured anthropic.Anthropic client, or None if unavailable."""
    try:
        import anthropic as _anthropic  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().anthropic_api_key
        if not api_key:
            logger.warning("[DocumentAI] ANTHROPIC_API_KEY is not set — Claude calls will fail")
            return None
        return _anthropic.Anthropic(api_key=api_key)
    except ImportError:
        logger.warning("[DocumentAI] anthropic package not installed — run: pip install anthropic>=0.40.0")
        return None
    except Exception as exc:
        logger.warning("[DocumentAI] Anthropic client init failed: %s", exc)
        return None


def _deepseek_client():
    """Return an OpenAI-compatible client configured for DeepSeek API, or None if unavailable."""
    try:
        import openai  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().deepseek_api_key
        if not api_key:
            logger.warning("[DocumentAI] DEEPSEEK_API_KEY is not set — DeepSeek calls will fail")
            return None
        return openai.OpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com",
            timeout=600.0,
            max_retries=2,
        )
    except ImportError:
        logger.warning("[DocumentAI] openai package not installed — run: pip install openai")
        return None
    except Exception as exc:
        logger.warning("[DocumentAI] DeepSeek client init failed: %s", exc)
        return None


def _kimi_client():
    """Return an OpenAI-compatible client configured for Moonshot (Kimi), or None."""
    try:
        import openai  # type: ignore
        from app.core.config import get_settings

        settings = get_settings()
        api_key = str(getattr(settings, "kimi_api_key", "") or "").strip()
        if not api_key:
            logger.warning("[DocumentAI] KIMI_API_KEY is not set — Kimi calls will fail")
            return None
        base_url = str(getattr(settings, "kimi_base_url", "") or "").strip() or "https://api.moonshot.ai/v1"
        return openai.OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=600.0,
            max_retries=2,
        )
    except ImportError:
        logger.warning("[DocumentAI] openai package not installed — run: pip install openai")
        return None
    except Exception as exc:
        logger.warning("[DocumentAI] Kimi client init failed: %s", exc)
        return None


def _deepseek_expects_json(prompt: str, llm_params: dict) -> bool:
    if llm_params.get("structured_outputs_enabled"):
        return True
    prompt_lower = str(prompt or "").lower()
    # Only trigger JSON mode when the FORMATTING INSTRUCTIONS explicitly request JSON output.
    # Check for the critical output formatting block injected by secret_prompt_display /
    # addSecretPromptJsonFormatting — not just any occurrence of "```json" in document content.
    json_instruction_markers = (
        "response must be valid json",
        "return valid json",
        "output must be valid json",
        "absolute requirement: your response must be valid json",
        "critical output formatting requirements",
    )
    return any(marker in prompt_lower for marker in json_instruction_markers)


_DEEPSEEK_JSON_MODE_SUFFIX = (
    "\n\n"
    "IMPORTANT (DeepSeek JSON mode): respond with raw JSON only — no markdown wrapper. "
    "Use Markdown formatting (tables, bold, lists) inside JSON string values where the data is structured or tabular."
)


def _deepseek_output_contract(prompt: str, llm_params: dict) -> str:
    if _deepseek_expects_json(prompt, llm_params):
        return _JSON_RENDERING_CONTRACT + _DEEPSEEK_JSON_MODE_SUFFIX
    # Markdown (non-JSON, non-tabular) mode: use the Prompt Orchestration Layer's
    # permanent system prompt. The intent-specific dynamic format instruction is
    # appended to the user prompt by the route / QA assembler, so the system
    # message only carries the provider-agnostic role + markdown + OCR rules.
    return PERMANENT_SYSTEM_PROMPT


_DEEPSEEK_USER_ENFORCEMENT = (
    "Follow the OUTPUT CONTRACT above exactly. Output PURE GitHub-Flavored Markdown — "
    "NEVER any HTML tag (no <br>, <table>, <b>, <p>). Use markdown headings (#, ##, ###), "
    "never bold-only headings. If the user asked for ALL points or a specific number, "
    "output EVERY one — do not stop early or merge items. "
    "CRITICAL: Output ONLY the final answer. Do NOT include your reasoning, planning, "
    "or meta-commentary. NEVER begin with phrases like 'We need to…', 'Let me…', "
    "'We already have…', 'The user…', or '<think>'. Start directly with the answer content. "
    "Begin the answer now."
)


# Used when the CALLER already assembled a complete prompt with its own system
# instruction AND an authoritative "=== OUTPUT CONTRACT ===" (the intelligent-chat
# route does this). Unlike _DEEPSEEK_USER_ENFORCEMENT this stays FORMAT-NEUTRAL: it
# does NOT dictate a heading style, because the embedded OUTPUT CONTRACT already
# specifies the correct one per intent (e.g. bold headings in comprehensive mode).
# Imposing "use ## / never bold" here contradicted the prompt and made DeepSeek
# ignore the requested format — the exact opposite of Gemini, which sees no such
# wrapper. Keeps only the provider-agnostic guarantees (no HTML, no reasoning,
# completeness) so DeepSeek follows the prompt instead of fighting it.
_DEEPSEEK_LIGHT_ENFORCEMENT = (
    "Follow the message below EXACTLY, including its '=== OUTPUT CONTRACT ===' and every "
    "formatting rule it states — use the heading style IT specifies, do not substitute your "
    "own. Output PURE GitHub-Flavored Markdown; never emit an HTML tag (no <br>, <table>, "
    "<b>, <p>). If the user asked for ALL points or a specific number, output EVERY one — do "
    "not stop early or merge items. "
    "CRITICAL: Output ONLY the final answer. Do NOT include your reasoning, planning, or "
    "meta-commentary. NEVER begin with 'We need to…', 'Let me…', 'We already have…', "
    "'The user…', or '<think>'. Begin directly with the answer content."
)


# Markers that prove the caller already built a full system+contract prompt. When
# present, _deepseek_messages must NOT re-inject PERMANENT_SYSTEM_PROMPT or the
# heading-dictating enforcement (both would fight the embedded OUTPUT CONTRACT).
_PREASSEMBLED_PROMPT_MARKERS = ("=== OUTPUT CONTRACT", "SYSTEM INSTRUCTION:")


def _prompt_is_preassembled(prompt: str) -> bool:
    """True when `prompt` already embeds a system instruction and/or an OUTPUT
    CONTRACT (the intelligent-chat route assembles this). Such prompts are
    authoritative — the DeepSeek adapter defers to them rather than wrapping them
    in its own (potentially contradictory) system prompt + heading enforcement."""
    p = str(prompt or "")
    return any(marker in p for marker in _PREASSEMBLED_PROMPT_MARKERS)


# JSON-first contract: for tabular/chronology/matrix answers DeepSeek emits a
# validated JSON object (not markdown). The backend then renders it deterministically
# into clean GFM, so the frontend never sees raw/broken markdown, `**`, or `<br>`.
_STRUCTURED_SYSTEM_PROMPT = """
You are a meticulous legal archivist. Analyse the provided case materials and return a STRUCTURED JSON object ONLY.

OUTPUT RULES:
- Respond with a SINGLE valid JSON object. No markdown, no prose, no code fences, no HTML.
- Use this exact schema (use an empty array [] or empty string "" when you have no data; never invent facts):

{
  "title": "Short title of the analysis",
  "summary": "2-4 sentence plain-text overview",
  "timeline": [
    {
      "date": "DD-MMM-YYYY or 'Not Mentioned'",
      "event": "One factual sentence, past tense",
      "parties": ["Full Name (Role)"],
      "place": "Location or 'Not Mentioned'",
      "evidence": "Document/exhibit reference or ''"
    }
  ],
  "legal_provisions": ["Section 31 of the Maharashtra Stamp Act"],
  "reliefs": ["Relief sought"]
}

CONSTRAINTS:
- Every value must be PLAIN TEXT. Never put markdown (**, *, _, <br>) inside any value.
- 'timeline' MUST be in strict chronological order, earliest first.
- Reconstruct OCR-split words/numbers in every value: 'Con stitution'->'Constitution', '201 6'->'2016', 'Aur ang abad'->'Aurangabad'.
- Facts only — no interpretation. Do not invent dates, names, or holdings.
- Be exhaustive: include every legally significant event in 'timeline'.
""".strip()


# Date separators allow '-', '/', OR space — so "15 Mar 2021" (DeepSeek's "tabular"
# answer format) is recognised, not just "15-Mar-2021". Optional Before/After/
# Between/By prefix covers "Before 21 Aug 2024" rows. Only a numbered line that
# STARTS with a real date converts, so ordinary numbered lists are left intact.
_CHRONOLOGY_LINE_RE = re.compile(
    r"^\s*(?P<serial>\d{1,4})\s*\.?\s+"
    r"(?P<date>"
    r"(?:(?:Before|After|Between|By|Circa)\s+)?"
    r"(?:"
    r"(?:\d{1,2}\s*[-/ ]\s*[A-Za-z]{3,12}\s*[-/ ]\s*\d(?:\s*\d){1,3})|"
    r"(?:\d{1,2}\s*[-/ ]\s*\d{1,2}\s*[-/ ]\s*\d(?:\s*\d){1,3})|"
    r"(?:[A-Za-z]{3,12}\s+\d{1,2},\s*\d(?:\s*\d){1,3})"
    r")|"
    r"(?:Not\s+Mention(?:ed)?(?:\s*\([^)]+\))?)"
    r")"
    r"\s+(?P<particulars>.+?)\s*$",
    re.IGNORECASE,
)
_LOOSE_TABLE_HEADER_RE = re.compile(r"^\s*S\.?\s*No\.?\s+Date\s+Particulars?\s*$", re.IGNORECASE)
_LOOSE_TABLE_RULE_RE = re.compile(r"^\s*[-_=]{8,}\s*$")


# ── OCR / PDF artefact normalisation ──────────────────────────────────────────
# Centralised helpers so the same deterministic cleanup runs on document input
# (before the model sees it) and on model output (before it reaches the frontend).
# No scattered ad-hoc regex — all OCR repair lives here.

def _merge_split_numbers(text: str) -> str:
    """
    Join PDF-fragmented numbers: "201 6" → "2016", "100 72" → "10072".

    Conservative: a 2–4 digit group, a single space, then a 1–2 digit group, and
    only when the merged value is ≤ 6 digits. A literal pipe between cells (" | ")
    blocks the match, so adjacent table columns are never accidentally merged.
    """
    return re.sub(
        r"\b(\d{2,4})\s(\d{1,2})\b",
        lambda m: (m.group(1) + m.group(2)) if len(m.group(1) + m.group(2)) <= 6 else m.group(0),
        str(text or ""),
    )


# Known multi-fragment legal/place terms that PDF extraction commonly splits.
# Applied as whole-token, case-insensitive joins ONLY — never alters valid text.
# Extend this tuple as new fragmented terms are observed in the corpus.
_OCR_PHRASE_FIXES: tuple[tuple["re.Pattern[str]", str], ...] = tuple(
    (
        re.compile(r"\b" + r"\s+".join(re.escape(part) for part in fragments) + r"\b", re.IGNORECASE),
        replacement,
    )
    for fragments, replacement in (
        (("Con", "stitution"), "Constitution"),
        (("Aur", "ang", "abad"), "Aurangabad"),
        (("Mah", "arashtra"), "Maharashtra"),
        (("Stamp", "Du", "ty"), "Stamp Duty"),
        (("Infra", "structure"), "Infrastructure"),
        (("Reg", "ist", "rar"), "Registrar"),
        (("Cor", "poration"), "Corporation"),
        (("Munic", "ipal"), "Municipal"),
        (("Jal", "ga", "on"), "Jalgaon"),
        (("Nas", "ik"), "Nashik"),
        (("Nag", "pur"), "Nagpur"),
        (("Anand", "w", "ade"), "Anandwade"),
        (("At", "mar", "am"), "Atmaram"),
        (("On", "kar"), "Onkar"),
        (("K", "ark", "hana"), "Karkhana"),
        (("Sak", "har"), "Sakhar"),
        (("Jud", "ic", "ature"), "Judicature"),
        (("Amb", "adas"), "Ambadas"),
        (("Sug", "nv"), "Sugnv"),
        (("Jad", "hav"), "Jadhav"),
        (("Bab", "ura", "o"), "Baburao"),
        (("D", "adas", "a", "heb"), "Dadasaheb"),
        (("Bot", "re"), "Botre"),
        (("Nil", "anga"), "Nilanga"),
        (("Under", "lying"), "Underlying"),
        (("Pro", "ceeding"), "Proceeding"),
        (("initially", "ref"), "initially ref"),
        (("courtre", "jected"), "court rejected"),
        (("re", "jected"), "rejected"),
        (("den", "ying"), "denying"),
        (("strong", "ly"), "strongly"),
        (("su", "o", "mot", "u"), "suo motu"),  # two-word term — handled here, not the single-word rejoiner
    )
)


# Curated set of common legal words used by the dictionary-backed rejoiner below.
# A space-separated run of letter fragments is rejoined ONLY when the joined form
# (lowercased) is in this set — so legitimate two-word phrases ("High Court",
# "New York") are never merged, but PDF-split words ("com pliance", "Def endant")
# are repaired. Extend freely; only single words here (multi-word terms above).
_LEGAL_WORD_SET: frozenset[str] = frozenset(
    w.lower()
    for w in (
        # Parties / roles
        "Petitioner", "Respondent", "Plaintiff", "Defendant", "Appellant", "Applicant",
        "Accused", "Complainant", "Opposite", "Parties", "Party", "Counsel", "Advocate",
        "Petitioners", "Respondents", "Plaintiffs", "Defendants", "Appellants", "Applicants",
        # Courts / places
        "Court", "Tribunal", "Bench", "Jurisdiction", "Nilanga", "Aurangabad", "Mumbai",
        "Pune", "Nashik", "Nagpur", "Jalgaon", "Latur", "Osmanabad", "Solapur", "Dharashiv",
        "Karkhana", "Sakhar", "Anandwade", "Atmaram", "Onkar", "Judicature", "Ambadas", "Sugnv", "Jadhav", "Baburao", "Dadasaheb", "Botre", "Nilanga", "Underlying", "Proceeding", "Initially", "Refused", "Rejected", "Denying", "Strongly", "Issued", "Notice",
        # Documents / procedure
        "Suit", "Suits", "Petition", "Petitions", "Application", "Applications", "Notice",
        "Order", "Orders", "Judgment", "Judgments", "Decree", "Decrees", "Filing", "Filed",
        "Exhibit", "Exhibits", "Annexure", "Annexures", "Affidavit", "Affidavits", "Summons",
        "Plaint", "Written", "Statement", "Reply", "Rejoinder", "Undertaking", "Hamipatra",
        # Substantive legal terms
        "Compliance", "Repayment", "Recover", "Recovery", "Principal", "Interest", "Amount",
        "Debt", "Loan", "Defendant", "Execution", "Defence", "Defense", "Challenge",
        "Limitation", "Constitutional", "Constitution", "Provisional", "Unconditional",
        "Conditional", "Injunction", "Stay", "Quash", "Impugned", "Impugn", "Maintainable",
        "Maintainability", "Jurisdictional", "Territorial", "Pecuniary", "Subject",
        "Cause", "Action", "Relief", "Reliefs", "Prayer", "Prayers", "Ground", "Grounds",
        "Issue", "Issues", "Fact", "Facts", "Evidence", "Evidentiary", "Exhibit", "Document",
        "Documents", "Statutory", "Statute", "Statutes", "Section", "Sections", "Article",
        "Articles", "Rule", "Rules", "Regulation", "Regulations", "Act", "Acts", "Code",
        "Citation", "Citations", "Precedent", "Precedents", "Ratio", "Decidendi", "Obiter",
        "Dictum", "Hearing", "Proceedings", "Proceeding", "Trial", "Appeal", "Appeals",
        "Revision", "Review", "Reference", "Transfer", "Withdrawal", "Withdraw", "Deposit",
        "Summary", "Suit", "Suits", "Recovery", "Handloan", "Hand", "NEFT", "Transaction", "Transactions",
        "Agreement", "Contract", "Contracts", "Breach", "Performance", "Specific",
        "Damages", "Compensation", "Indemnity", "Guarantee", "Guarantor", "Surety",
        "Mortgage", "Pledge", "Lease", "Tenancy", "Tenant", "Landlord", "Ownership",
        "Possession", "Title", "Property", "Properties", "Movable", "Immovable",
        # Verbs / common words that get split
        "Because", "Therefore", "However", "Further", "Against", "Between", "Through",
        "Without", "Within", "About", "Before", "After", "During", "While", "Being",
        "Having", "Thereof", "Herein", "Hereunder", "Therein", "Thereunder", "Hereby",
        "Hereto", "Thereby", "Thereafter", "Hereafter", "Whereby", "Wherein", "Whereof",
        # Stamp-duty / conveyancing vocabulary commonly split by OCR
        "Stamp", "Stamps", "Deed", "Deeds", "Conveyance", "Accountant", "Collector",
        "Debts", "Tenants", "Allottee", "Allottees", "Annul", "Annulment", "Merger",
        "Remedy", "Remedies", "Adjudication", "Intimation", "Undervaluation", "Inspects",
        "Inspect", "Inspection", "Citations", "JLN", "Colly", "Auction", "Receiver",
        "Recovery", "Registration", "Valuation", "Stamped", "Engrossed", "Endorsement",
        # Common procedural verbs / terms frequently split by OCR
        "Seeking", "Seek", "Seeks", "Denying", "Deny", "Denied", "Denies", "Rejected",
        "Reject", "Rejects", "Refused", "Refuse", "Refuses", "Strongly", "Depositing",
        "Deposited", "Deposits", "Contested", "Contest", "Contesting", "Granted",
        "Granting", "Grant", "Grants", "Alleging", "Allege", "Alleged", "Alleges",
        "Defaulted", "Defaulting", "Default", "Defaults", "Returnable", "Permission",
        "Permitted", "Permitting", "Permit", "Sham", "Sugarcane", "Abide", "Security",
        "Safeguards", "Disposal", "Pending", "Suitable", "Terms", "Filed", "Moved",
    )
)


# Recurring case-party / person names that PDF extraction splits (e.g.
# "Krish n aji" -> "Krishnaji"). Proper names are unbounded by nature — seed with
# observed names and extend this tuple as new ones appear in the corpus.
_PROPER_NAME_SET: frozenset[str] = frozenset(
    n.lower()
    for n in (
        "Krishnaji", "Atmaram", "Onkar", "Suraj", "Sanghi", "Rajmudra", "Sandeep",
        "Sanjay", "Chaudhari", "Sharma", "Kulkarni", "Deshmukh", "Patil", "Joshi",
        "Bhosale", "Pawar", "Gaikwad", "Jadhav", "Shinde", "More", "Kale", "Sawant",
        "Mane", "Salunke", "Thorat", "Wagh", "Nikam", "Borse", "Ingle", "Shaikh",
    )
)

# The rejoiner accepts a word if its joined form is a known legal word OR name.
_REJOIN_WORD_SET: frozenset[str] = _LEGAL_WORD_SET | _PROPER_NAME_SET

_LEGAL_WORD_BOUNDARY_RE = re.compile(r"(?<!\w)([A-Za-z]+(?:\s+[A-Za-z]+){0,19})(?!\w)")


def _rejoin_split_words(text: str) -> str:
    """
    Rejoin PDF-extraction split words using a dictionary: a run of 2–5 alphabetic
    fragments separated by single spaces is rejoined ONLY when the joined form is
    a known legal word. Safe — never merges legitimate multi-word phrases.

    Example: "com pliance" -> "compliance", "Def endant" -> "Defendant",
             "Aur ang abad" -> "Aurangabad", "rep ayment" -> "repayment".
    """
    if not text:
        return text

    def _try_rejoin(match: re.Match) -> str:
        phrase = match.group(1)
        # Only consider runs that actually contain an internal space (i.e. 2+ fragments).
        if " " not in phrase:
            return phrase
        parts = phrase.split(" ")
        out: list[str] = []
        i = 0
        n = len(parts)
        # Scan the whole run and greedily merge any 2–5 ADJACENT fragments whose
        # join is a known legal word — so a split word anywhere in the run is
        # repaired ("The St amps were" -> "The Stamps were"), not just at the start.
        while i < n:
            merged: str | None = None
            for span in (5, 4, 3, 2):
                if i + span <= n:
                    cand = "".join(parts[i : i + span])
                    if cand.lower() in _REJOIN_WORD_SET:
                        merged = (
                            cand[:1].upper() + cand[1:] if parts[i][:1].isupper() else cand
                        )
                        i += span
                        break
            if merged is not None:
                out.append(merged)
            else:
                out.append(parts[i])
                i += 1
        return " ".join(out)

    return _LEGAL_WORD_BOUNDARY_RE.sub(_try_rejoin, str(text))


def normalize_ocr_artifacts(text: str) -> str:
    """
    Repair deterministic OCR/PDF extraction artefacts without touching valid text.

    Safe passes:
      1. merge space-split numbers (length-bounded)
      2. join a curated dictionary of known fragmented legal/place terms
      3. tighten spaced dates: "04 / 04 / 2024" -> "04/04/2024"
      4. rejoin split words via the dictionary-backed rejoiner
    Anything not matched is left as-is, so legitimate legal phrasing is never modified.
    """
    if not text:
        return text
    result = _merge_split_numbers(str(text))
    for pattern, replacement in _OCR_PHRASE_FIXES:
        result = pattern.sub(replacement, result)
    # Tighten spaced dates (DD / MM / YYYY or DD - MM - YYYY) -> DD/MM/YYYY.
    result = re.sub(
        r"\b(\d{1,2})\s*([/\-])\s*(\d{1,2})\s*([/\-])\s*(\d{2,4}(?:\s+\d)?)\b",
        lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}{m.group(4)}{m.group(5).replace(' ', '')}",
        result,
    )
    # Fix common merged words
    result = re.sub(r"\bwithdrawalcanbe\b", "withdrawal can be", result, flags=re.IGNORECASE)
    result = re.sub(r"\bissuednotice\b", "issued notice", result, flags=re.IGNORECASE)
    result = re.sub(r"\binitiallyrefused\b", "initially refused", result, flags=re.IGNORECASE)
    result = re.sub(r"\binitiallyref\s+used\b", "initially refused", result, flags=re.IGNORECASE)
    result = re.sub(r"\bcourtre\s+jected\b", "court rejected", result, flags=re.IGNORECASE)
    result = re.sub(r"\bArticle\s+227filed\b", "Article 227 filed", result, flags=re.IGNORECASE)
    result = re.sub(r"\bdefendon\b", "defend on", result, flags=re.IGNORECASE)
    result = re.sub(r"(\d{1,2})\s*\)se\s+eking", r"\1) seeking", result, flags=re.IGNORECASE)

    result = _rejoin_split_words(result)
    return result


# ── HTML stripping (enforce pure Markdown output) ─────────────────────────────

_HTML_BR_RE = re.compile(r"<\s*br\s*/?\s*>", re.IGNORECASE)


def preprocess_latex(text: str) -> str:
    """
    Convert LaTeX delimiters from \\( ... \\) and \\[ ... \\] to $ ... $ and $$ ... $$.
    This ensures compatibility with remark-math and other markdown math plugins.
    """
    if not text:
        return text
    # Block math: \[ ... \] -> $$ ... $$
    text = re.sub(r"\\\[([\s\S]*?)\\\]", r"$$\1$$", text)
    # Inline math: \( ... \) -> $ ... $
    text = re.sub(r"\\\(([\s\S]*?)\\\)", r"$\1$", text)
    return text


def _strip_html_breaks(text: str) -> str:
    """
    Remove HTML <br> tags so output is pure GitHub-Flavored Markdown.

    Inside a GFM table row (line starting with '|') a newline is illegal, so a
    <br> collapses to a single space. Outside tables it becomes a real newline
    (Markdown line break). Never leaves an HTML tag behind.
    """
    out_lines: list[str] = []
    for line in str(text or "").split("\n"):
        if line.lstrip().startswith("|"):
            collapsed = _HTML_BR_RE.sub(" ", line)
            collapsed = re.sub(r"[ \t]{2,}", " ", collapsed)
            out_lines.append(collapsed)
        else:
            out_lines.append(_HTML_BR_RE.sub("\n", line))
    return "\n".join(out_lines)


# ── Chain-of-thought / reasoning stripping ────────────────────────────────────
# DeepSeek (and other reasoning models) sometimes write their internal planning
# into the answer ("We need to produce a case summary… We already have a
# conversation history…") or wrap it in <think>/<thinking> tags. ChatGPT/Claude
# hide this — so we strip it before the answer reaches the user.

_THINK_TAG_RE = re.compile(r"<\s*think(?:ing)?\s*>[\s\S]*?<\s*/\s*think(?:ing)?\s*>", re.IGNORECASE)
_OPEN_THINK_RE = re.compile(r"<\s*think(?:ing)?\s*>[\s\S]*$", re.IGNORECASE)

# A paragraph is treated as model reasoning ONLY when it opens with explicit
# planning / meta-commentary cues. These phrasings do not occur at the start of a
# real legal answer, so genuine content is never removed.
_REASONING_CUE_RE = re.compile(
    r"^\s*(?:"
    r"we\s+need\s+to|we\s+already\s+have|we\s+also\s+have|we\s+have\s+a\s+conversation|"
    r"we\s+should|we\s+must|we\s+can\s+(?:now|produce)|we\s+will\s+(?:now|produce)|"
    r"let\s+me\b|let'?s\b|i\s+need\s+to|i\s+will\b|i'?ll\b|i\s+should\b|"
    r"to\s+(?:produce|answer|begin|summari[sz]e)\b|the\s+user('?s)?\b|the\s+task\b|"
    r"first,?\s+i\b|okay\b|alright\b|here'?s\s+my\s+plan|my\s+plan\b|"
    r"thinking:|reasoning:|analysis:\s*$|let\s+us\s+(?:produce|begin)"
    r")",
    re.IGNORECASE,
)
_STRUCTURE_RE = re.compile(r"(?m)^\s*(?:#{1,6}\s|\|)")


def _strip_model_reasoning(text: str) -> str:
    """
    Remove a model's chain-of-thought so only the final answer remains.

    1. Delete <think>…</think> / <thinking>…</thinking> blocks (closed or trailing-open).
    2. If the answer has real structure later (a markdown heading or a table, or the
       canonical comprehensive-summary opening line), drop leading paragraphs that
       begin with explicit reasoning/planning cues. Conservative: when there is no
       structured content to anchor on, nothing is stripped.
    """
    s = _THINK_TAG_RE.sub("", str(text or ""))
    s = _OPEN_THINK_RE.sub("", s).lstrip()
    if not s:
        return s

    has_structure = bool(_STRUCTURE_RE.search(s)) or "Based on a meticulous analysis" in s
    if not has_structure:
        return s.strip()

    paragraphs = re.split(r"\n\s*\n", s)
    while paragraphs:
        head = paragraphs[0].lstrip()
        # Stop as soon as we reach real content (heading/table) or a non-reasoning para.
        if head.startswith("#") or head.startswith("|") or "Based on a meticulous analysis" in head:
            break
        if _REASONING_CUE_RE.match(head):
            paragraphs.pop(0)
            continue
        break
    return "\n\n".join(paragraphs).strip()


# ── Tabular-request detection (streaming policy) ──────────────────────────────

# Tabular output is produced ONLY when the user explicitly asks for a table OR
# the request is for time-based / chronological data (naturally tabular).
# Word-boundary matched so "table" does NOT fire inside "suitable"/"comfortable".
#
# IMPORTANT: This MUST stay narrow. When it matches, DeepSeek is switched into the
# rigid structured-JSON timeline schema, which DISCARDS the user's own prompt
# format. So only match requests that are genuinely a date/time table — never
# generic analysis words like "grounds", "reasons", "points", which the user may
# want rendered in their own point-wise format.
_TABULAR_REQUEST_RE = re.compile(
    r"\b("
    r"tabular|tables?|"                       # explicit: "tabular", "table", "tables"
    r"timeline|chronolog\w*|"                 # time-based: timeline, chronology/chronological
    r"factual\s+matrix|evidence\s+matrix|"    # named legal matrices
    r"date[\s-]?wise|sequence\s+of\s+events|list\s+of\s+dates"  # explicit time sequences
    r")\b",
    re.IGNORECASE,
)


# Isolate the user's actual question from the assembled prompt so tabular
# detection ignores the injected format-reminder / system text (which itself
# mentions "table", "timeline", etc. and would otherwise always match).
_QUESTION_SECTION_RE = re.compile(
    r"===\s*(?:QUESTION|USER\s+INPUT)\s*===\s*(.*?)(?:\n===|\Z)",
    re.IGNORECASE | re.DOTALL,
)


# Signals that the user has supplied their OWN detailed multi-section analysis
# template (e.g. a 14-section "LegalSynth-Analyzer" case-summary prompt). When
# these are present we must NOT collapse the answer into the rigid 5-field
# structured-JSON timeline schema — the model must follow the user's template
# in plain markdown mode instead.
# Custom-template detection now lives in the Prompt Orchestration layer
# (app.services.prompt_orchestration) so intent detection and tabular detection
# share one source of truth. Kept as a thin alias for the existing call sites.
_is_custom_template_question = _is_custom_template_question_orch


def _extract_user_question(prompt: str) -> str:
    match = _QUESTION_SECTION_RE.search(str(prompt or ""))
    return match.group(1).strip() if match else ""


def _is_tabular_request(prompt: str, llm_params: dict) -> bool:
    """
    True when the USER asked for a table/timeline/matrix AND has NOT supplied
    their own multi-section analysis template.

    Detection runs only against the user's question (extracted from the assembled
    prompt), never the injected formatting instructions — otherwise the reminder
    text mentioning "table"/"timeline" would force every call into JSON mode.

    CRITICAL: when the user provides a detailed custom template (e.g. a 14-section
    case-analysis prompt that merely says "give dates chronologically" / "use
    tabular format where possible"), we must return False. Otherwise the rigid
    structured-JSON timeline schema would replace the user's template and only
    title/summary/timeline/legal_provisions/reliefs would be emitted.
    """
    if _deepseek_expects_json(prompt, llm_params):
        return False
    question = _extract_user_question(prompt)
    if not question:
        return False  # cannot isolate the ask → default to prose markdown (safe)
    if _is_custom_template_question(question):
        return False  # honour the user's own template in markdown mode
    return bool(_TABULAR_REQUEST_RE.search(question))


def _clean_chronology_date(value: str) -> str:
    cleaned = re.sub(r"\s*([-/])\s*", r"-", str(value or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(
        r"\b(\d{2,3})\s+(\d{1,2})\b",
        lambda m: (m.group(1) + m.group(2)) if len(m.group(1) + m.group(2)) <= 4 else m.group(0),
        cleaned,
    )
    return cleaned


def _escape_markdown_table_cell(value: str) -> str:
    # GFM cells cannot contain line breaks or HTML — collapse any <br> to a space
    # and keep the whole cell on a single physical line.
    cell = re.sub(r"<\s*br\s*/?\s*>?", " ", str(value or ""), flags=re.IGNORECASE)
    cell = re.sub(r"\s+", " ", cell).strip()
    return cell.replace("|", r"\|")


def _convert_numbered_chronology_to_markdown_table(text: str) -> str:
    """
    DeepSeek can still emit timeline rows as "11. 26 - Mar - 2011 ...".
    Convert only date-led numbered chronology blocks, leaving ordinary numbered
    legal analysis untouched.
    """
    value = str(text or "")
    if re.search(r"^\s*\|.+\|\s*$", value, flags=re.MULTILINE):
        return value

    lines = value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: list[str] = []
    pending_rows: list[tuple[str, str, str]] = []

    def flush_pending() -> None:
        nonlocal pending_rows
        if len(pending_rows) >= 2:
            if out and out[-1].strip():
                out.append("")
            out.append("| S.No | Date | Particulars |")
            out.append("|---|---|---|")
            for serial, date, particulars in pending_rows:
                out.append(
                    f"| {_escape_markdown_table_cell(serial + '.')} | "
                    f"{_escape_markdown_table_cell(date)} | "
                    f"{_escape_markdown_table_cell(particulars)} |"
                )
            out.append("")
        else:
            for serial, date, particulars in pending_rows:
                out.append(f"{serial}. {date} {particulars}".rstrip())
        pending_rows = []

    for line in lines:
        if _LOOSE_TABLE_HEADER_RE.match(line) or _LOOSE_TABLE_RULE_RE.match(line):
            continue
        match = _CHRONOLOGY_LINE_RE.match(line)
        if match:
            pending_rows.append(
                (
                    match.group("serial").strip(),
                    _clean_chronology_date(match.group("date")),
                    match.group("particulars").strip(),
                )
            )
            continue
        if not line.strip():
            # DeepSeek separates each numbered row with a BLANK line — don't let
            # that flush the run; keep accumulating so the rows form ONE table.
            if pending_rows:
                continue
            out.append(line)
            continue
        if pending_rows:
            serial, date, particulars = pending_rows[-1]
            # Keep the cell single-line (GFM has no in-cell line breaks); join with a space.
            pending_rows[-1] = (serial, date, f"{particulars} {line.strip()}")
            continue
        flush_pending()
        out.append(line)

    flush_pending()
    return "\n".join(out).strip()


def _deepseek_messages(
    prompt: str,
    llm_params: dict,
    *,
    structured: bool = False,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    sys_instr = str(llm_params.get("system_instructions") or "").strip()
    expects_json = _deepseek_expects_json(prompt, llm_params)
    # When the caller already assembled a full system + OUTPUT CONTRACT prompt (the
    # intelligent-chat route), do NOT re-inject PERMANENT_SYSTEM_PROMPT or the
    # heading-dictating enforcement — both fight the embedded contract and make
    # DeepSeek ignore the requested format (Gemini sees no such wrapper and obeys).
    pre_assembled = not structured and not expects_json and _prompt_is_preassembled(prompt)

    # Structured (tabular) requests use the JSON schema contract; a pre-assembled
    # prompt carries its own system instruction, so we add nothing extra; everything
    # else uses the existing markdown contract. Default stays markdown for back-compat.
    if structured:
        rendering_contract = _STRUCTURED_SYSTEM_PROMPT
    elif pre_assembled:
        rendering_contract = ""  # prompt already embeds its own system prompt + contract
    else:
        rendering_contract = _deepseek_output_contract(prompt, llm_params)
    combined_system = "\n\n".join(part for part in (sys_instr, rendering_contract) if part)
    if combined_system:
        messages.append({"role": "system", "content": combined_system})

    if structured:
        user_content = (
            "Return the analysis as a single valid JSON object following the schema in the system message. "
            "JSON only — no markdown, no prose, no code fences, NO INTERNAL MONOLOGUE.\n\n"
            f"{prompt}"
        )
    elif pre_assembled:
        # Format-neutral enforcement: defer to the prompt's own OUTPUT CONTRACT for
        # heading style / structure, keep only no-HTML / no-reasoning / completeness.
        user_content = f"{_DEEPSEEK_LIGHT_ENFORCEMENT}\n\n{prompt}"
    elif not expects_json:
        # FIX 2: repeat the critical formatting constraint in the user turn so DeepSeek
        # cannot "forget" it when the document context is long (prompt leak prevention).
        user_content = (
            f"{_DEEPSEEK_USER_ENFORCEMENT}\n\n"
            "CRITICAL: DO NOT output any internal reasoning, plan, or meta-commentary. "
            "Output ONLY the final legal analysis. Begin immediately with the answer.\n\n"
            f"{prompt}"
        )
    else:
        user_content = (
            "Return valid JSON only. NO INTERNAL MONOLOGUE. NO PROSE.\n\n"
            f"{prompt}"
        )
    messages.append({"role": "user", "content": user_content})
    return messages


_BANNER_BOX_CHARS = "┌┐└┘├┤┬┴┼│"


def _strip_ascii_banner_lines(text: str) -> str:
    """
    Remove decorative ASCII banner blocks (e.g. the "LEXIS LEGAL FINDING" box
    some legacy preset templates instruct the model to draw). Drops every line
    containing box-drawing characters and standalone ─ divider lines; real
    content never uses these characters.
    """
    raw = str(text or "")
    if not any(ch in raw for ch in _BANNER_BOX_CHARS) and "─" not in raw:
        return raw
    kept = []
    for line in raw.splitlines():
        if any(ch in line for ch in _BANNER_BOX_CHARS):
            continue
        if line.strip() and not line.strip().strip("─ "):
            continue  # pure ─ divider line
        kept.append(line)
    return "\n".join(kept)


def normalize_markdown_render_output(text: str) -> str:
    """
    Post-process raw model output into clean, valid GitHub-Flavored Markdown.

    Pipeline (order matters):
      1. strip a single outer ```markdown fence (inner code blocks preserved)
      2. remove ASCII banner boxes (legacy preset templates draw them)
      3. repair deterministic OCR artefacts (split numbers + known terms)
      4. preprocess LaTeX delimiters (round-bracket -> $, square-bracket -> $$)
      5. strip HTML <br> tags (to space inside table rows, newline elsewhere)
      6. convert numbered date chronologies into GFM pipe tables
      7. collapse 3+ consecutive newlines down to a single blank line
    Never emits HTML. Safe to call on any provider's output.
    """
    cleaned = str(text or "").strip()
    match = re.fullmatch(r"```(?:markdown|md)?\s*\n([\s\S]*?)\n```", cleaned, flags=re.IGNORECASE)
    unfenced = match.group(1).strip() if match else cleaned

    # Strip chain-of-thought / <think> blocks BEFORE any other processing so the
    # reasoning never reaches the user (ChatGPT/Claude-style clean output).
    unfenced = _strip_model_reasoning(unfenced)

    unfenced = _strip_ascii_banner_lines(unfenced)
    unfenced = normalize_ocr_artifacts(unfenced)
    unfenced = preprocess_latex(unfenced)
    unfenced = _strip_html_breaks(unfenced)

    converted = _convert_numbered_chronology_to_markdown_table(unfenced)
    converted = re.sub(r"\n{3,}", "\n\n", converted)
    return converted.strip()


# ── JSON-first renderer layer ─────────────────────────────────────────────────
# Pipeline:  raw LLM output → repair_json() → validate_structured_payload()
#            → structured_json_to_markdown() → clean GFM for the existing frontend.
# Guarantees valid tables and never leaks malformed JSON or HTML to React.

_JSON_OBJECT_RE = re.compile(r"\{[\s\S]*\}")


def repair_json(raw: Any) -> dict | None:
    """
    Best-effort parse of a model's JSON output, repairing common defects.

    Handles: code fences, leading/trailing prose, smart quotes, trailing commas,
    and unbalanced closing braces/brackets. Returns a dict, or None if the text
    cannot be salvaged into a JSON object (caller falls back to markdown).
    """
    if isinstance(raw, dict):
        return raw
    s = str(raw or "").strip()
    if not s:
        return None

    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```$", "", s).strip()

    match = _JSON_OBJECT_RE.search(s)
    if match:
        s = match.group(0)

    try:
        return json.loads(s)
    except Exception:
        pass

    repaired = (
        s.replace("“", '"').replace("”", '"')
         .replace("‘", "'").replace("’", "'")
    )
    repaired = re.sub(r",\s*([}\]])", r"\1", repaired)  # trailing commas
    open_braces = repaired.count("{") - repaired.count("}")
    if open_braces > 0:
        repaired += "}" * open_braces
    open_brackets = repaired.count("[") - repaired.count("]")
    if open_brackets > 0:
        repaired += "]" * open_brackets

    try:
        return json.loads(repaired)
    except Exception:
        return None


def _as_str(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    return str(value)


def _as_str_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [t for t in (_as_str(v).strip() for v in value) if t]
    single = _as_str(value).strip()
    return [single] if single else []


def validate_structured_payload(data: Any) -> dict:
    """
    Coerce arbitrary parsed JSON into the canonical legal-analysis schema with
    safe defaults. Never raises — missing/wrong-typed fields degrade gracefully.
    """
    data = data if isinstance(data, dict) else {}

    timeline: list[dict] = []
    raw_timeline = data.get("timeline")
    if isinstance(raw_timeline, list):
        for item in raw_timeline:
            if not isinstance(item, dict):
                continue
            timeline.append(
                {
                    "date": _as_str(item.get("date")).strip() or "Not Mentioned",
                    "event": _as_str(item.get("event")).strip(),
                    "parties": _as_str_list(item.get("parties")),
                    "place": _as_str(item.get("place")).strip() or "Not Mentioned",
                    "evidence": _as_str(item.get("evidence")).strip(),
                }
            )

    return {
        "title": _as_str(data.get("title")).strip(),
        "summary": _as_str(data.get("summary")).strip(),
        "timeline": timeline,
        "legal_provisions": _as_str_list(data.get("legal_provisions")),
        "reliefs": _as_str_list(data.get("reliefs")),
    }


def structured_json_to_markdown(payload: Any) -> str:
    """
    Render a validated structured payload into clean GitHub-Flavored Markdown.

    The timeline becomes a real multi-column table (Date/Event/Parties/Place/
    Evidence) — no `**Parties:**` labels, no `<br>`, no HTML. Optional columns
    are included only when at least one row has data for them.
    """
    payload = validate_structured_payload(payload)
    parts: list[str] = []

    if payload["title"]:
        parts.append(f"## {payload['title']}")
    if payload["summary"]:
        parts.append(payload["summary"])

    timeline = payload["timeline"]
    if timeline:
        show_parties = any(row["parties"] for row in timeline)
        show_place = any(row["place"] and row["place"] != "Not Mentioned" for row in timeline)
        show_evidence = any(row["evidence"] for row in timeline)

        columns = ["S.No", "Date", "Event"]
        if show_parties:
            columns.append("Parties")
        if show_place:
            columns.append("Place")
        if show_evidence:
            columns.append("Evidence")

        table_lines = [
            "| " + " | ".join(columns) + " |",
            "| " + " | ".join(["---"] * len(columns)) + " |",
        ]
        for idx, row in enumerate(timeline, start=1):
            cells = [
                f"{idx}.",
                _escape_markdown_table_cell(row["date"]),
                _escape_markdown_table_cell(row["event"]),
            ]
            if show_parties:
                cells.append(_escape_markdown_table_cell(", ".join(row["parties"]) or "Not Mentioned"))
            if show_place:
                cells.append(_escape_markdown_table_cell(row["place"]))
            if show_evidence:
                cells.append(_escape_markdown_table_cell(row["evidence"] or "—"))
            table_lines.append("| " + " | ".join(cells) + " |")

        if parts:
            parts.append("")
        parts.append("\n".join(table_lines))

    if payload["legal_provisions"]:
        parts.append("")
        parts.append("## Legal Provisions")
        parts.extend(f"- {item}" for item in payload["legal_provisions"])

    if payload["reliefs"]:
        parts.append("")
        parts.append("## Reliefs Sought")
        parts.extend(f"- {item}" for item in payload["reliefs"])

    return "\n".join(parts).strip()


def _render_structured_response(raw_text: str) -> str | None:
    """
    Full renderer: repair → validate → convert structured JSON to clean GFM.

    Returns rendered markdown, or None when the payload has no usable structure
    (the caller then falls back to normalize_markdown_render_output on raw text).
    """
    payload = repair_json(raw_text)
    if not isinstance(payload, dict):
        return None
    validated = validate_structured_payload(payload)
    if not (validated["timeline"] or validated["summary"] or validated["title"]):
        return None
    return structured_json_to_markdown(validated)


def _max_tokens_from_summarization_config(config: dict, *, for_summary: bool) -> int:
    """Compute effective max_output_tokens from a merged summarization_chat_config dict."""
    max_tokens = int(
        config.get("max_summarization_output_tokens") if for_summary
        else (config.get("max_output_tokens") or 0)
    )
    max_cap = max(1, int(config.get("max_output_tokens_cap") or DEFAULT_MAX_OUTPUT_TOKENS))
    min_tokens = max(1, int(config.get("min_output_tokens") or 1))
    if max_tokens <= 0:
        max_tokens = DEFAULT_MAX_OUTPUT_TOKENS
    return max(min_tokens, min(max_tokens, max_cap))


def _int_or_default(value: Any, default: int) -> int:
    try:
        n = int(value)
        return n if n > 0 else default
    except (TypeError, ValueError):
        return default


def _max_tokens_from_agent_prompt(cfg: Any, llm_params: dict, *, for_summary: bool) -> int:
    """
    Resolve max_output_tokens strictly from agent_prompts row data.
    Priority:
      1) llm_parameters.max_summarization_output_tokens (summary calls only)
      2) llm_parameters.max_output_tokens
      3) llm_parameters.max_tokens
      4) service default (65536)
    """
    default_tokens = DEFAULT_MAX_OUTPUT_TOKENS
    cap = _int_or_default(llm_params.get("max_output_tokens_cap"), DEFAULT_MAX_OUTPUT_TOKENS)
    min_tokens = _int_or_default(llm_params.get("min_output_tokens"), 1)
    if min_tokens > cap:
        min_tokens, cap = cap, min_tokens

    candidates: list[Any] = []
    if for_summary:
        candidates.append(llm_params.get("max_summarization_output_tokens"))
    candidates.extend(
        [
            llm_params.get("max_output_tokens"),
            llm_params.get("max_tokens"),
        ]
    )
    resolved = default_tokens
    for value in candidates:
        n = _int_or_default(value, 0)
        if n > 0:
            resolved = n
            break
    return max(min_tokens, min(resolved, cap))


def _describe_agent_prompts_origin(cfg: Any) -> str:
    """Log line: whether the agent row was loaded from public.agent_prompts."""
    if getattr(cfg, "source", None) == "db" and getattr(cfg, "db_id", None) is not None:
        return (
            f"from_db table=agent_prompts row_id={cfg.db_id} "
            f"agent_type={getattr(cfg, 'agent_type', '') or 'n/a'}"
        )
    if getattr(cfg, "source", None) == "db":
        return "from_db table=agent_prompts (row_id missing)"
    return "not_from_db (no agent_prompts row; using settings.adk_model + defaults)"


def _describe_summarization_token_origin(token_cfg: dict, *, caller_supplied: bool) -> str:
    """Log line: where token limits dict came from (DB vs fallback vs caller merge)."""
    scope = (token_cfg or {}).get("summarization_config_scope")
    cid = (token_cfg or {}).get("config_id")
    if caller_supplied:
        if scope in ("user_merged", "global"):
            return (
                f"from_db table=summarization_chat_config (request merge) "
                f"scope={scope} config_id={cid}"
            )
        if scope in ("fallback_no_db", "fallback_error"):
            return f"not_from_db scope={scope} (request merge)"
        return "caller_merge (effective limits; may include DB + request overrides)"
    if scope in ("fallback_no_db", "fallback_error"):
        return f"not_from_db scope={scope}"
    if scope in ("user_merged", "global"):
        return f"from_db table=summarization_chat_config scope={scope} config_id={cid}"
    return f"from_db table=summarization_chat_config config_id={cid} scope={scope or 'n/a'}"


def _describe_summarization_full_origin(config: dict, *, caller_supplied: bool) -> str:
    """Log line: origin of summarization dict when it drives model + temperature + tokens (no-agent path)."""
    scope = (config or {}).get("summarization_config_scope")
    cid = (config or {}).get("config_id")
    if caller_supplied:
        if scope in ("user_merged", "global"):
            return (
                f"from_db table=summarization_chat_config (request merge) "
                f"scope={scope} config_id={cid}"
            )
        if scope in ("fallback_no_db", "fallback_error"):
            return f"not_from_db scope={scope} (request merge)"
        return "caller_merge (model/temp/tokens; may include DB + overrides)"
    if scope in ("fallback_no_db", "fallback_error"):
        return f"not_from_db scope={scope}"
    return f"from_db table=summarization_chat_config scope={scope or 'n/a'} config_id={cid}"


def _generation_config(
    *,
    for_summary: bool = False,
    agent_name: str | None = None,
    user_id: str | int | None = None,
    summarization_llm_config: dict | None = None,
    model_name_override: str | None = None,
) -> tuple[str, dict, dict]:
    """
    Build (model_name, gen_kwargs, llm_params) for a Gemini call.

    When `agent_name` is set:
      - Model, temperature, and llm_parameters (tools, thinking, etc.) come from agent_prompts
        (or agent defaults when no DB row).
      - max_output_tokens comes from agent_prompts.llm_parameters (with safe defaults).
      - prompt from agent_prompts.prompt is injected as system_instructions unless
        llm_parameters.system_instructions is explicitly set.

    When `agent_name` is None (no agent context):
      - Model, temperature, and max_output_tokens all come from summarization_chat_config.

    Returns three values:
      model_name  — string model id
      gen_kwargs  — core generation params (temperature, max_output_tokens)
      llm_params  — full llm_parameters blob from DB (tool flags, thinking, etc.)
    """
    if agent_name:
        try:
            from app.services.agent_config_service import get_agent_config

            cfg = get_agent_config(agent_name)
            llm_params = dict(cfg.llm_parameters or {})
            # Always honor agent_prompts.prompt as system instruction when llm_parameters does not override it.
            if not str(llm_params.get("system_instructions") or "").strip():
                prompt_text = str(getattr(cfg, "prompt", "") or "").strip()
                if prompt_text:
                    llm_params["system_instructions"] = prompt_text

            max_tokens = _max_tokens_from_agent_prompt(cfg, llm_params, for_summary=for_summary)
            gen_kwargs: dict = {
                "temperature": float(cfg.temperature),
                "max_output_tokens": max_tokens,
            }
            config_model = str(cfg.model_name)
            # Intake auto-fill + chronology: model and thinking level come from .env
            # (INTAKE_EXTRACTION_MODEL / INTAKE_EXTRACTION_THINKING_LEVEL) and win over any
            # agent_prompts row. The call always gets the full output budget with no clamp from
            # public.llm_max_tokens: a 4,000-token registry cap let thinking use the whole
            # budget, the model returned nothing, and the chronology came out empty.
            if agent_name == _AGENT_EXTRACTION:
                config_model, level = _intake_extraction_settings(config_model)
                llm_params["thinking_level"] = level
                llm_params["thinking_mode"] = False
                llm_params[_NO_OUTPUT_TOKEN_CLAMP] = True
                max_tokens = DEFAULT_MAX_OUTPUT_TOKENS
                gen_kwargs["max_output_tokens"] = max_tokens
            logger.info(
                "[DocumentAI] generation_config  agent_prompts=%s  tokens=from_agent_prompts  "
                "agent=%s  model=%s  temperature=%.2f  max_output_tokens=%s  "
                "thinking_level=%s  url_context=%s  grounding_search=%s  code_execution=%s",
                _describe_agent_prompts_origin(cfg),
                agent_name,
                config_model,
                gen_kwargs["temperature"],
                max_tokens,
                llm_params.get("thinking_level") or "—",
                llm_params.get("url_context", False),
                llm_params.get("grounding_google_search", False),
                llm_params.get("code_execution", False),
            )
            from app.services.llm_models_catalog import normalize_model_alias, resolve_chat_llm_model

            raw_model = str(model_name_override or config_model).strip()
            resolved_model_name = resolve_chat_llm_model(
                normalize_model_alias(raw_model),
                normalize_model_alias(config_model),
            )
            return resolved_model_name, gen_kwargs, llm_params
        except Exception as exc:
            logger.warning(
                "[DocumentAI] agent_config_service failed for agent=%s: %s "
                "— falling back to summarization_chat_config",
                agent_name,
                exc,
            )

    # ── Fallback: summarization_chat_config (no agent_name or agent load error) ──
    config = summarization_llm_config or get_summarization_chat_config(user_id=user_id)
    from app.services.llm_models_catalog import normalize_model_alias, resolve_chat_llm_model

    model_name = resolve_model_name(config, for_summary=for_summary) or "gemini-2.0-flash"
    model_name = resolve_chat_llm_model(
        normalize_model_alias(str(model_name_override or model_name).strip()),
        normalize_model_alias(model_name),
    )
    max_tokens = _max_tokens_from_summarization_config(config, for_summary=for_summary)
    temperature = float(config.get("model_temperature") or 0.7)
    temperature = min(
        max(temperature, float(config.get("temperature_min") or 0.0)),
        float(config.get("temperature_max") or 2.0),
    )
    logger.info(
        "[DocumentAI] generation_config  summarization_full=%s  agent=%s  "
        "model=%s  temperature=%.2f  max_output_tokens=%d",
        _describe_summarization_full_origin(
            config,
            caller_supplied=summarization_llm_config is not None,
        ),
        agent_name or "N/A",
        model_name,
        temperature,
        max_tokens,
    )
    return model_name, {"temperature": temperature, "max_output_tokens": max_tokens}, {}


# ── Thinking level → token budget ─────────────────────────────────────────────

_THINKING_BUDGET_GEMINI = {"low": 512,   "medium": 1024,  "high": 1200}
_THINKING_BUDGET_CLAUDE = {"low": 1024,  "medium": 1100,  "high": 1200}
# Providers reject out-of-range budgets with 400 INVALID_ARGUMENT, which kills
# the whole request (Gemini 2.5: 128–32768; Anthropic: >= 1024).
_THINKING_BUDGET_RANGE = {"gemini": (128, 32768), "claude": (1024, 32000)}

# Hard ceiling on thinking tokens. Thinking is billed as output, and the higher
# tiers (previously 8192/16384) dominated the cost of an answer without a
# matching quality gain on these tasks. Applies to admin-configured budgets too,
# so no single model config can blow past it. Override with THINKING_BUDGET_CEILING.
_THINKING_BUDGET_CEILING_DEFAULT = 1200


def _thinking_budget_ceiling() -> int:
    raw = str(os.environ.get("THINKING_BUDGET_CEILING", "")).strip()
    if raw:
        try:
            value = int(raw)
            if value > 0:
                return value
        except ValueError:
            pass
    return _THINKING_BUDGET_CEILING_DEFAULT


def _resolve_thinking_budget(llm_params: dict, provider: str) -> int:
    budget_map = _THINKING_BUDGET_GEMINI if provider == "gemini" else _THINKING_BUDGET_CLAUDE
    lo, hi = _THINKING_BUDGET_RANGE.get(provider, (128, 32768))
    # Never clamp below the provider's own minimum — Anthropic 400s under 1024.
    hi = min(hi, max(lo, _thinking_budget_ceiling()))
    raw = llm_params.get("thinking_budget")
    # NOTE: bool is a subclass of int — an admin-UI toggle stored as
    # thinking_budget=true must not become budget_tokens=1 (Gemini 400s on it).
    if raw is not None and not isinstance(raw, bool) and isinstance(raw, (int, float)) and float(raw) > 0:
        return max(lo, min(hi, int(raw)))
    level = str(llm_params.get("thinking_level") or "low").lower()
    return max(lo, min(hi, budget_map.get(level, list(budget_map.values())[0])))


def _gemini_model_supports_thinking_config(model_name: str | None) -> bool:
    """
    Native Gemini ThinkingConfig is only accepted on certain models; others return 400
    INVALID_ARGUMENT ("thinking is not supported by this model"), e.g. gemini-2.0-flash.
    """
    raw = (model_name or "").strip().lower()
    if not raw:
        return False
    m = raw.rsplit("/", 1)[-1]
    if "gemini-2.0" in m or "gemini-1." in m or "gemini-1-" in m:
        return False
    if "2.5" in m or "2-5" in m:
        return True
    if "gemini-3" in m:
        return True
    return False


# In-memory cache of the admin-editable per-model output-token registry
# (public.llm_max_tokens, edited via LLM Management → LLM Max Tokens). Refreshed lazily every
# _MAX_TOKENS_REGISTRY_TTL seconds so a config build isn't a DB hit on every request.
_MAX_TOKENS_REGISTRY: dict[str, int] = {}
_MAX_TOKENS_REGISTRY_TS: float = 0.0
_MAX_TOKENS_REGISTRY_TTL_DEFAULT: float = 10.0


def _load_max_tokens_registry() -> dict[str, int]:
    """Return {model_name_lower: max_output_tokens} from public.llm_max_tokens.

    Admin-editable (LLM Management → LLM Max Tokens) and synced to this service's DB. Cached for
    settings.max_tokens_registry_cache_seconds (default 10s) so edits propagate almost immediately;
    set that knob to 0 to read the DB on every call (no cache). On any error / DB-unavailable, returns
    the last good cache (possibly empty) so the caller falls back to the hardcoded ceilings — a
    registry read must never break generation."""
    global _MAX_TOKENS_REGISTRY, _MAX_TOKENS_REGISTRY_TS
    now = time.time()
    try:
        from app.core.config import get_settings as _gs
        ttl = float(getattr(_gs(), "max_tokens_registry_cache_seconds", _MAX_TOKENS_REGISTRY_TTL_DEFAULT))
    except Exception:
        ttl = _MAX_TOKENS_REGISTRY_TTL_DEFAULT
    if ttl > 0 and _MAX_TOKENS_REGISTRY_TS and (now - _MAX_TOKENS_REGISTRY_TS) < ttl:
        return _MAX_TOKENS_REGISTRY
    try:
        from app.services.db import get_db_connection, is_db_available
        if not is_db_available():
            return _MAX_TOKENS_REGISTRY
        reg: dict[str, int] = {}
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT model_name, max_output_tokens FROM public.llm_max_tokens")
            for row in cur.fetchall():
                d = dict(row) if hasattr(row, "keys") else {"model_name": row[0], "max_output_tokens": row[1]}
                mn = str(d.get("model_name") or "").strip().lower()
                mt = d.get("max_output_tokens")
                if mn and mt:
                    try:
                        reg[mn] = int(mt)
                    except (TypeError, ValueError):
                        continue
        _MAX_TOKENS_REGISTRY = reg
        _MAX_TOKENS_REGISTRY_TS = now
        return reg
    except Exception as exc:  # noqa: BLE001 — never let a registry read break generation
        logger.info("[DocumentAI] llm_max_tokens registry load failed (%s); using hardcoded ceilings", exc)
        return _MAX_TOKENS_REGISTRY


def _model_max_output_tokens(model_name: str | None) -> int | None:
    """Per-model output-token ceiling used to clamp the requested max_output_tokens.

    Source of truth (per admin directive):
      • GEMMA → HARDCODED 32768 (free-tier managed model; NOT admin-editable via the registry).
      • Every other model → the admin DB registry public.llm_max_tokens (LLM Management →
        LLM Max Tokens), matched by exact model_name. Models NOT in the registry fall back to the
        known hardcoded ceilings (gemini-2.5/3 → 65536, gemini-2.0/1.5 → 8192, else None/no clamp)
        so nothing breaks for an unlisted model.

    Requesting MORE than a model's real limit is invalid: the Gemini API may silently fall back to a
    low default (≈8192) and truncate answers — so we always clamp the request to this ceiling."""
    m = (model_name or "").strip().lower().rsplit("/", 1)[-1]
    if not m:
        return None
    if m.startswith("gemma"):
        return 32768
    # Admin registry wins for all non-gemma models.
    reg = _load_max_tokens_registry()
    if m in reg:
        return reg[m]
    # Fallback for a model not present in the registry.
    if "2.5" in m or "2-5" in m or "gemini-3" in m:
        return 65536
    if "gemini-2.0" in m or "gemini-1.5" in m or "gemini-1-5" in m:
        return 8192
    return None


# ── Gemini config builder ─────────────────────────────────────────────────────

def _build_gemini_config(
    gen_kwargs: dict,
    llm_params: dict,
    *,
    model_name: str | None = None,
    gemma_chat_budget: bool = False,
):
    """
    Build a GenerateContentConfig from gen_kwargs + every flag in llm_parameters.

    Handled flags:
      url_context              bool  — model fetches URLs in the prompt
      grounding_google_search  bool  — live Google Search grounding
      code_execution           bool  — model can execute Python
      thinking_mode            bool  — extended thinking (Gemini 2.5+)
      thinking_level           str   — "low" | "medium" | "high" (maps to token budget)
      thinking_budget          int   — explicit budget_tokens (overrides thinking_level)
      media_resolution         str   — "low" | "medium" | "high" | "default"
      system_instructions      str   — prepended system instruction text
      structured_outputs_enabled bool — forces JSON response
      structured_outputs_config  dict — JSON schema for the response
      function_calling_enabled   bool — enable function calling
      function_calling_config    dict — {mode: "AUTO"|"ANY"|"NONE", allowed_function_names: [...]}

    Falls back to a plain dict when google-genai types are unavailable.
    """
    try:
        from google.genai import types  # type: ignore

        config_kwargs = dict(gen_kwargs)
        tools: list = []
        active_flags: list[str] = []

        # ── Clamp max_output_tokens to the model's real ceiling ──────────────
        # Requesting above a model's limit (e.g. 65536 on gemma-4, whose limit is 32768) is
        # invalid and can make the API fall back to a low default. Always ask for the real max.
        # Intake extraction opts out (see _intake_extraction_settings): its budget is sent as-is.
        _mot = config_kwargs.get("max_output_tokens")
        _lim = None if llm_params.get(_NO_OUTPUT_TOKEN_CLAMP) else _model_max_output_tokens(model_name)
        if _mot and _lim and int(_mot) > _lim:
            config_kwargs["max_output_tokens"] = _lim
            active_flags.append(f"max_output_tokens_clamped({_mot}->{_lim})")

        # ── Gemma: thinking level (ALL calls) + chat output budget (CHAT only) ───
        # Gemma-4 is a thinking model whose thinking + answer SHARE max_output_tokens, and it
        # REJECTS numeric thinking_budget — only thinking_level "minimal" | "high" (400 otherwise,
        # verified live). "minimal" emits ZERO thinking tokens so the whole output budget becomes
        # the answer (never cut by thinking) AND it is ~2x faster.
        # thinking_level is applied to EVERY Gemma call (chat, non-stream fallback, draft) so nothing
        # silently reverts to Gemma's slower default thinking — driven by GEMMA_THINKING_LEVEL.
        # The output-token CAP stays CHAT-only (gemma_chat_budget): the draft pipeline passes a large
        # explicit budget and must keep it so sections aren't truncated.
        if _is_gemma_model(model_name):
            from app.core.config import get_settings as _gemma_settings
            _gs = _gemma_settings()
            _lvl = str(getattr(_gs, "gemma_thinking_level", "minimal") or "minimal").strip().lower()
            if _lvl in ("minimal", "high"):
                try:
                    config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=_lvl)
                    active_flags.append(f"gemma_thinking_level={_lvl}")
                except Exception as _tl_exc:
                    logger.info("[DocumentAI] gemma thinking_level=%s not applied: %s", _lvl, _tl_exc)
            # Gemma (free tier) uses a FIXED, hardcoded temperature on EVERY Gemma call — the admin
            # agent_prompts temperature is honored only for paid Gemini models. Applied to ALL gemma
            # calls (NOT just gemma_chat_budget), so it also covers the narrow-question path
            # (_generate_text / _call_gemini_for_qa at line ~1536, gemma_chat_budget=False) — that was
            # the gap: narrow chats used the admin temp while only comprehensive got the override. A
            # low temp also suits grounded drafting. The main chat-draft path builds its OWN config in
            # files.py (temp 0.2, bypassing this function), so it's unaffected; Gemini models never
            # enter this `if _is_gemma_model(...)` block, so they keep the admin temperature.
            _gemma_temp = getattr(_gs, "gemma_chat_temperature", None)
            if _gemma_temp is not None:
                config_kwargs["temperature"] = float(_gemma_temp)
                active_flags.append(f"gemma_temperature={float(_gemma_temp):.2f}")
            if gemma_chat_budget:
                _gemma_out = int(getattr(_gs, "gemma_chat_max_output_tokens", 0) or 0)
                if _gemma_out > 0:
                    _cur = int(config_kwargs.get("max_output_tokens") or 0)
                    if _cur <= 0 or _gemma_out < _cur:
                        config_kwargs["max_output_tokens"] = _gemma_out
                        active_flags.append(f"gemma_output_budget={_gemma_out}")

        # ── Tools ────────────────────────────────────────────────────────────
        if llm_params.get("url_context"):
            tools.append(types.Tool(url_context=types.UrlContext()))
            active_flags.append("url_context")

        if llm_params.get("grounding_google_search"):
            tools.append(types.Tool(google_search=types.GoogleSearch()))
            active_flags.append("grounding_google_search")

        if llm_params.get("code_execution"):
            tools.append(types.Tool(code_execution=types.ToolCodeExecution()))
            active_flags.append("code_execution")

        if tools:
            config_kwargs["tools"] = tools

        # ── Thinking (Gemini 2.5 numeric budget; Gemini 3.x thinking_level) ──
        # Gemini 3 Flash thinks at its default (medium) unless thinking_level is sent.
        # gemini-3.7-flash accepts only low|medium|high — "minimal" is a 400.
        if _gemini_model_supports_thinking_config(model_name) and not _is_gemma_model(model_name):
            raw_name = (model_name or "").strip().lower().rsplit("/", 1)[-1]
            level = str(llm_params.get("thinking_level") or "").strip().lower()
            if "gemini-3.7" in raw_name and level == "minimal":
                level = "low"
            gemini3_levels = ("low", "medium", "high")
            allowed = gemini3_levels if "gemini-3.7" in raw_name else ("minimal",) + gemini3_levels
            if "gemini-3" in raw_name and level in allowed:
                try:
                    config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=level)
                    active_flags.append(f"thinking_level={level}")
                except Exception as _tl_exc:
                    logger.info(
                        "[DocumentAI] gemini thinking_level=%s not applied: %s",
                        level,
                        _tl_exc,
                    )
            elif llm_params.get("thinking_mode"):
                budget = _resolve_thinking_budget(llm_params, "gemini")
                config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=budget)
                active_flags.append(f"thinking(budget={budget})")
        elif llm_params.get("thinking_mode"):
            logger.info(
                "[DocumentAI] thinking_mode set in llm_parameters but model=%s "
                "does not support Gemini ThinkingConfig — omitting",
                model_name or "(unknown)",
            )

        # ── Media resolution ─────────────────────────────────────────────────
        media_res = str(llm_params.get("media_resolution") or "default").lower()
        if media_res not in ("default", "", "none"):
            _res_map = {
                "low":    "MEDIA_RESOLUTION_LOW",
                "medium": "MEDIA_RESOLUTION_MEDIUM",
                "high":   "MEDIA_RESOLUTION_HIGH",
            }
            if media_res in _res_map:
                try:
                    config_kwargs["media_resolution"] = getattr(
                        types.MediaResolution, _res_map[media_res]
                    )
                    active_flags.append(f"media_resolution={media_res}")
                except AttributeError:
                    config_kwargs["media_resolution"] = media_res

        # ── System instructions ──────────────────────────────────────────────
        sys_instr = str(llm_params.get("system_instructions") or "").strip()
        if sys_instr:
            config_kwargs["system_instruction"] = sys_instr
            active_flags.append("system_instructions")

        # ── Structured outputs ───────────────────────────────────────────────
        if llm_params.get("structured_outputs_enabled"):
            config_kwargs["response_mime_type"] = "application/json"
            schema = llm_params.get("structured_outputs_config")
            if isinstance(schema, dict) and schema:
                config_kwargs["response_schema"] = schema
            active_flags.append("structured_outputs")

        # ── Function calling ─────────────────────────────────────────────────
        if llm_params.get("function_calling_enabled"):
            fc_raw = llm_params.get("function_calling_config") or {}
            mode_str = str(fc_raw.get("mode") or "AUTO").upper()
            try:
                mode = getattr(types.FunctionCallingConfig.Mode, mode_str,
                               types.FunctionCallingConfig.Mode.AUTO)
            except AttributeError:
                mode = mode_str
            fc_cfg = types.FunctionCallingConfig(mode=mode)
            allowed = fc_raw.get("allowed_function_names")
            if allowed:
                fc_cfg = types.FunctionCallingConfig(
                    mode=mode, allowed_function_names=list(allowed)
                )
            config_kwargs["tool_config"] = types.ToolConfig(
                function_calling_config=fc_cfg
            )
            active_flags.append(f"function_calling(mode={mode_str})")

        if active_flags:
            logger.info("[DocumentAI] Gemini flags active: %s", ", ".join(active_flags))

        return types.GenerateContentConfig(**config_kwargs)

    except Exception as exc:
        logger.debug("[DocumentAI] GenerateContentConfig build failed (%s) — using plain dict", exc)
        return gen_kwargs


def gemini_stream_config_for_folder_chat(
    *,
    for_summary: bool = True,
    user_id: str | int | None = None,
    summarization_llm_config: dict | None = None,
    agent_name: str | None = None,
) -> tuple[str, Any] | None:
    """
    Model + Gemini config for folder intelligent-chat SSE streaming.

    Uses the same agent_prompts resolution as _generate_text for grounded retrieval.
    Returns None when the resolved model is not Gemini (caller should use the non-stream path).
    """
    model_name, gen_kwargs, llm_params = _generation_config(
        for_summary=for_summary,
        agent_name=agent_name or GROUNDED_RETRIEVAL_AGENT_NAME,
        user_id=user_id,
        summarization_llm_config=summarization_llm_config,
    )
    if _detect_provider(model_name) != "gemini":
        return None
    return model_name, _build_gemini_config(
        gen_kwargs, llm_params, model_name=model_name, gemma_chat_budget=True
    )


def stream_config_for_folder_chat(
    *,
    for_summary: bool = True,
    user_id: str | int | None = None,
    summarization_llm_config: dict | None = None,
    agent_name: str | None = None,
    model_name_override: str | None = None,
) -> tuple[str, str, Any]:
    """
    Unified streaming config for folder intelligent-chat SSE.

    Returns (provider, model_name, config) where:
      provider   — "gemini", "claude", "deepseek" or "kimi"
      model_name — resolved model string from agent_prompts (or summarization_chat_config fallback)
      config     — for gemini: GenerateContentConfig object
                   for claude / deepseek / kimi: (gen_kwargs dict, llm_params dict) tuple

    Always uses agent_prompts for model + all llm_parameters when agent_name is given.
    Falls back to summarization_chat_config only when agent_name is None or DB lookup fails.
    """
    model_name, gen_kwargs, llm_params = _generation_config(
        for_summary=for_summary,
        agent_name=agent_name or GROUNDED_RETRIEVAL_AGENT_NAME,
        user_id=user_id,
        summarization_llm_config=summarization_llm_config,
        model_name_override=model_name_override,
    )
    provider = _detect_provider(model_name)
    if provider == "claude":
        return "claude", model_name, (gen_kwargs, llm_params)
    if provider == "deepseek":
        return "deepseek", model_name, (gen_kwargs, llm_params)
    if provider == "kimi":
        return "kimi", model_name, (gen_kwargs, llm_params)
    return "gemini", model_name, _build_gemini_config(
        gen_kwargs, llm_params, model_name=model_name, gemma_chat_budget=True
    )


def claude_stream_generator(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
):
    """
    Yield text chunks from Claude streaming API using all agent llm_parameters flags.

    Handled flags: thinking_mode, thinking_level, thinking_budget, system_instructions,
    max_output_tokens (→ max_tokens).
    """
    from typing import Iterator  # local import to avoid circular issues

    client = _anthropic_client()
    if client is None:
        logger.warning("[DocumentAI] Claude stream skipped — Anthropic client unavailable")
        return

    max_tokens = min(
        CLAUDE_MAX_OUTPUT_TOKENS,
        int(gen_kwargs.get("max_output_tokens") or DEFAULT_MAX_OUTPUT_TOKENS),
    )
    temperature = float(gen_kwargs.get("temperature") or 1.0)
    api_model = _anthropic_messages_model_id(model_name)

    create_kwargs: dict = {
        "model": api_model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }

    sys_instr = str(llm_params.get("system_instructions") or "").strip()
    if sys_instr:
        create_kwargs["system"] = sys_instr

    thinking_on = bool(llm_params.get("thinking_mode"))
    if thinking_on:
        create_kwargs["thinking"] = _claude_thinking_config(api_model, llm_params)
        temperature = 1.0

    # Only send `temperature` where the model accepts it AND thinking is off. Opus 4.6+,
    # Sonnet 5 and Fable 5 REJECT `temperature` outright (400) — sending it unconditionally
    # here 400'd every Opus/Sonnet-5 draft and silently dropped it to the gemma fallback.
    if not thinking_on and _claude_accepts_temperature(api_model):
        create_kwargs["temperature"] = temperature

    logger.info(
        "[DocumentAI] ▶ Claude stream  model_id=%s (raw=%s)  temperature=%s  max_tokens=%d  thinking=%s",
        api_model, model_name, create_kwargs.get("temperature", "unset"), max_tokens,
        (create_kwargs.get("thinking") or {}).get("type", "off"),
    )

    with client.messages.stream(**create_kwargs) as stream:
        for text_chunk in stream.text_stream:
            yield text_chunk
        final_msg = stream.get_final_message()
        usage = getattr(final_msg, "usage", None)
        input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
        log_token_usage_table(
            context="claude_stream",
            usage={
                "provider": "claude",
                "model": api_model,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "totalTokens": input_tokens + output_tokens,
            },
            provider="claude",
            model_name=api_model,
        )


def claude_draft_stream_generator(
    prompt: str,
    *,
    model_name: str,
    pdf_bytes: bytes | None = None,
    pdf_mime: str = "application/pdf",
    max_tokens: int = 32000,
):
    """Stream a court-ready draft from Claude, attaching the uploaded template as a PDF
    document block (Claude reads PDFs natively — verified live).

    Used for draft-from-template when the selected draft engine is a Claude model
    (claude-opus-4-8 / claude-sonnet-5). Enables ADAPTIVE THINKING ({"type":"adaptive"},
    the modern 4.6+ form — the deprecated budget_tokens form 400s on these models): the
    model reasons about document type, structure, clause selection and grounding before
    it writes, which is exactly the drafting "self-intelligence" this feature needs.
    `text_stream` yields only the answer text (not thinking deltas), so the streamed draft
    stays clean; thinking trades a little first-token latency for a much better draft
    (aligned with "relevance/quality over cost"). temperature is left unset (required when
    thinking is on; setting it 400s anyway).
    """
    import base64 as _b64

    client = _anthropic_client()
    if client is None:
        logger.warning("[DocumentAI] Claude draft stream skipped — Anthropic client unavailable")
        return

    api_model = _anthropic_messages_model_id(model_name)
    content: list = []
    if pdf_bytes:
        content.append({
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": pdf_mime or "application/pdf",
                "data": _b64.standard_b64encode(pdf_bytes).decode("ascii"),
            },
        })
    content.append({"type": "text", "text": prompt})

    create_kwargs = {
        "model": api_model,
        "max_tokens": max(1024, min(int(max_tokens or 32000), 64000)),
        "messages": [{"role": "user", "content": content}],
        "thinking": {"type": "adaptive"},
    }
    logger.info(
        "[DocumentAI] ▶ Claude DRAFT stream  model_id=%s (raw=%s)  max_tokens=%d  pdf_bytes=%d",
        api_model, model_name, create_kwargs["max_tokens"], len(pdf_bytes or b""),
    )
    with client.messages.stream(**create_kwargs) as stream:
        for text_chunk in stream.text_stream:
            yield text_chunk
        final_msg = stream.get_final_message()
        usage = getattr(final_msg, "usage", None)
        input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
        log_token_usage_table(
            context="claude_draft_stream",
            usage={
                "provider": "claude",
                "model": api_model,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "totalTokens": input_tokens + output_tokens,
            },
            provider="claude",
            model_name=api_model,
        )


# ── Claude (Anthropic) generation ─────────────────────────────────────────────

def _claude_accepts_temperature(api_model: str) -> bool:
    """Modern Claude models (Opus 4.6+, Sonnet 5/4.6, Fable/Mythos 5) reject the
    `temperature` parameter outright (400 'temperature is deprecated for this model').
    Older models still accept it. Default True so unknown/older ids keep working."""
    m = (api_model or "").lower()
    for tag in ("opus-4-8", "opus-4-7", "opus-4-6", "sonnet-5", "sonnet-4-6",
                "fable-5", "mythos-5", "mythos-preview"):
        if tag in m:
            return False
    return True


def _claude_thinking_config(api_model: str, llm_params: dict) -> dict:
    """Correct extended-thinking config per model generation. Claude 4.6+ (Opus 4.6/4.7/4.8,
    Sonnet 4.6/5, Fable/Mythos 5) use {"type":"adaptive"} — the OLD {"type":"enabled",
    "budget_tokens":N} form is REJECTED with a 400 on Opus 4.7/4.8, Sonnet 5 and Fable 5,
    which silently sank Claude drafts into the gemma fallback. Older models keep the budget
    form. (The 4.6+ set is the same one that rejects `temperature`.)"""
    if not _claude_accepts_temperature(api_model):
        return {"type": "adaptive"}
    return {"type": "enabled", "budget_tokens": _resolve_thinking_budget(llm_params, "claude")}


def _generate_text_claude(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
) -> str:
    """
    Call the Anthropic Messages API with all applicable llm_parameters flags.

    Handled flags:
      thinking_mode       bool  — Claude extended thinking
      thinking_level      str   — "low"|"medium"|"high" → budget_tokens
      thinking_budget     int   — explicit budget_tokens (overrides thinking_level)
      system_instructions str   — system prompt prepended to the conversation
      max_output_tokens   int   — mapped to Anthropic's max_tokens

    Note: when thinking_mode=true, temperature is forced to 1.0 (Anthropic requirement).
    """
    client = _anthropic_client()
    if client is None:
        logger.warning("[DocumentAI] Claude call skipped — Anthropic client unavailable")
        return ""

    # Never fall back to a tiny 8192 — that truncates multi-point legal answers.
    max_tokens = min(
        CLAUDE_MAX_OUTPUT_TOKENS,
        int(gen_kwargs.get("max_output_tokens") or DEFAULT_MAX_OUTPUT_TOKENS),
    )
    temperature = float(gen_kwargs.get("temperature") or 1.0)

    api_model = _anthropic_messages_model_id(model_name)
    create_kwargs: dict = {
        "model": api_model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }

    active_flags: list[str] = []

    # ── System instructions ──────────────────────────────────────────────────
    sys_instr = str(llm_params.get("system_instructions") or "").strip()
    if sys_instr:
        create_kwargs["system"] = sys_instr
        active_flags.append("system_instructions")

    # ── Extended thinking ────────────────────────────────────────────────────
    thinking_on = bool(llm_params.get("thinking_mode"))
    if thinking_on:
        create_kwargs["thinking"] = _claude_thinking_config(api_model, llm_params)
        # Anthropic requires temperature unset (=1) when extended thinking is on
        temperature = 1.0
        active_flags.append(f"thinking({create_kwargs['thinking'].get('type')})")

    # Temperature: modern Claude models (Opus 4.6+, Sonnet 5, Fable 5) reject `temperature`
    # entirely, and it must be unset when extended thinking is on. Only send it where the
    # model accepts it and thinking is off.
    if not thinking_on and _claude_accepts_temperature(api_model):
        create_kwargs["temperature"] = temperature

    if active_flags:
        logger.info("[DocumentAI] Claude flags active: %s", ", ".join(active_flags))

    # The Anthropic SDK REFUSES a non-streaming request whose max_tokens is large enough
    # that it estimates the response could take >10 minutes ("Streaming is required for
    # operations that may take longer than 10 minutes"). The drafting pipeline stages use
    # 16K–32K max_tokens, which trips this — so stream and collect the final message for
    # any high-max_tokens call. Streaming + get_final_message returns the identical Message
    # (same .content / .usage), just without the timeout guard.
    use_stream = max_tokens > 8000

    logger.info(
        "[DocumentAI] ▶ Claude generate  model_id=%s (raw=%s)  temperature=%.2f  max_tokens=%d  stream=%s",
        api_model,
        model_name,
        temperature,
        max_tokens,
        use_stream,
    )

    if use_stream:
        with client.messages.stream(**create_kwargs) as stream:
            response = stream.get_final_message()
    else:
        response = client.messages.create(**create_kwargs)

    usage = getattr(response, "usage", None)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    # RECORD, don't just print. This path is what every non-streaming Claude agent uses —
    # including the draft guardian (grounding/format audit, section repair, slot recovery).
    # It used to emit a bare logger.info, so its tokens never reached the per-request
    # accumulator: the guardian's Opus calls were invisible to the DRAFT COMPLETE cost table
    # and their (real, billed) cost was silently omitted from the end-to-end total.
    log_token_usage_table(
        context="claude_generate",
        usage={
            "provider": "claude",
            "model": api_model,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": input_tokens + output_tokens,
        },
        provider="claude",
        model_name=api_model,
    )

    # Extract text from content blocks (thinking blocks are skipped)
    for block in response.content:
        if getattr(block, "type", None) == "text":
            return (block.text or "").strip()
    return ""


# ── DeepSeek (OpenAI-compatible) generation ──────────────────────────────────

def _generate_text_deepseek(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
) -> str:
    """
    Call the DeepSeek chat completions API (OpenAI-compatible).

    Supported llm_parameters flags:
      system_instructions str  — system prompt
      max_output_tokens   int  — mapped to max_tokens
      thinking_mode       bool — enables DeepSeek reasoning (reasoning_effort=high)
    """
    client = _deepseek_client()
    if client is None:
        logger.warning("[DocumentAI] DeepSeek call skipped — client unavailable")
        return ""

    # DeepSeek supports a very large output budget; cap at the provider maximum but
    # never fall back to a tiny value (that truncates multi-point legal answers).
    max_tokens = min(
        8000,
        max(_DEEPSEEK_MIN_OUTPUT_TOKENS, int(gen_kwargs.get("max_output_tokens") or DEFAULT_MAX_OUTPUT_TOKENS)),
    )
    temperature = 0.3
    api_model = "deepseek-v4-flash"

    # Markdown mode for everything (incl. tabular). JSON mode proved fragile —
    # response_format=json_object could return empty completions ("Could not
    # generate an answer"). normalize_markdown_render_output cleans the output.
    messages = _deepseek_messages(prompt, llm_params)
    # Low temperature for tabular output → consistent, valid GFM pipe-table syntax.
    if _is_tabular_request(prompt, llm_params):
        temperature = min(temperature, _TABULAR_TEMPERATURE)

    create_kwargs: dict = {
        "model": api_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if _deepseek_expects_json(prompt, llm_params):
        create_kwargs["response_format"] = {"type": "json_object"}

    logger.info(
        "[DocumentAI] ▶ DeepSeek generate  model_id=%s (raw=%s)  temperature=%.2f  max_tokens=%d",
        api_model, model_name, temperature, max_tokens,
    )

    try:
        response = client.chat.completions.create(**create_kwargs)
    except Exception as exc:
        logger.exception(
            "[DocumentAI] DeepSeek generate failed model=%s error=%s",
            api_model,
            exc,
        )
        raise
    usage = getattr(response, "usage", None)
    input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    total_tokens = int(getattr(usage, "total_tokens", 0) or 0) or (input_tokens + output_tokens)
    # Record (not just print) — same accumulator bug as the non-streaming Claude path.
    log_token_usage_table(
        context="deepseek_generate",
        usage={
            "provider": "deepseek",
            "model": api_model,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
        },
        provider="deepseek",
        model_name=api_model,
    )
    content = (response.choices[0].message.content or "") if response.choices else ""
    return normalize_markdown_render_output(content)


def deepseek_stream_generator(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
):
    """
    Yield text chunks from the DeepSeek streaming API (OpenAI-compatible SSE).

    Supported flags: system_instructions, max_output_tokens, thinking_mode.
    """
    client = _deepseek_client()
    if client is None:
        logger.warning("[DocumentAI] DeepSeek stream skipped — client unavailable")
        return

    max_tokens = min(
        DEEPSEEK_MAX_OUTPUT_TOKENS,
        max(_DEEPSEEK_MIN_OUTPUT_TOKENS, int(gen_kwargs.get("max_output_tokens") or DEFAULT_MAX_OUTPUT_TOKENS)),
    )
    temperature = float(gen_kwargs.get("temperature") or 1.0)
    api_model = _deepseek_model_id(model_name)

    # Tabular / chronology / matrix answers are BUFFERED (not token-streamed) so a
    # partially-streamed pipe table never flashes as invalid Markdown mid-flight.
    # We deliberately do NOT use JSON mode here: response_format=json_object proved
    # fragile (empty completions when combined with reasoning), which surfaced as
    # "Could not generate an answer". The markdown path + normalize_markdown_render_output
    # (chronology→table + OCR cleanup) reliably produces clean tables instead.
    tabular = _is_tabular_request(prompt, llm_params)
    messages = _deepseek_messages(prompt, llm_params)
    # Low temperature for tabular output → consistent, valid GFM pipe-table syntax.
    if tabular:
        temperature = min(temperature, _TABULAR_TEMPERATURE)

    create_kwargs: dict = {
        "model": api_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if _deepseek_expects_json(prompt, llm_params):
        create_kwargs["response_format"] = {"type": "json_object"}

    if llm_params.get("thinking_mode"):
        create_kwargs["reasoning_effort"] = "high"
        create_kwargs["extra_body"] = {"thinking": {"type": "enabled"}}
    else:
        create_kwargs["extra_body"] = {"thinking": {"type": "disabled"}}

    logger.info(
        "[DocumentAI] ▶ DeepSeek stream  model_id=%s (raw=%s)  temperature=%.2f  max_tokens=%d  tabular=%s",
        api_model, model_name, temperature, max_tokens, tabular,
    )

    try:
        stream = client.chat.completions.create(**create_kwargs)
    except Exception as exc:
        logger.exception(
            "[DocumentAI] DeepSeek stream failed model=%s error=%s",
            api_model,
            exc,
        )
        raise
    final_usage: dict[str, int] | None = None
    buffer_parts: list[str] = []
    
    # Reasoning/Thinking block suppression logic
    full_response = ""

    for chunk in stream:
        usage = getattr(chunk, "usage", None)
        if usage is not None:
            prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
            completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            total_tokens = int(getattr(usage, "total_tokens", 0) or 0)
            if not total_tokens and (prompt_tokens or completion_tokens):
                total_tokens = prompt_tokens + completion_tokens
            final_usage = {
                "inputTokens": prompt_tokens,
                "outputTokens": completion_tokens,
                "totalTokens": total_tokens,
            }

        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if not delta:
            continue

        # 1. Handle DeepSeek reasoning_content field entirely
        reasoning = getattr(delta, "reasoning_content", None)
        if reasoning:
            continue

        content = delta.content or ""
        if not content:
            continue

        full_response += content

        # Detect <think> block start or continuation
        if "<think>" in full_response and "</think>" not in full_response:
            # Still inside think block — send nothing
            continue

        # Detect <think> block just closed
        if "<think>" in full_response and "</think>" in full_response:
            # Extract only what comes AFTER </think>
            parts = full_response.split("</think>")
            after_think = "</think>".join(parts[1:])
            # Yield any content that arrived AFTER </think> in this same chunk
            # but only if it's not already in buffer_parts (for tabular)
            # Actually, simpler: replace full_response with the clean portion
            # and if we just transitioned, we might need to yield the 'after_think' part.
            full_response = after_think
            if after_think.strip():
                if tabular:
                    buffer_parts.append(after_think)
                else:
                    yield after_think
            continue

        # Send current clean content (only if thinking never started or is done)
        if "<think>" not in full_response:
            if tabular:
                buffer_parts.append(content)
            else:
                yield content
            # Clear small pieces if no thinking started to keep memory low
            full_response = ""

    # Emit the complete, cleaned answer as a single chunk for tabular output.
    if tabular and buffer_parts:
        raw = "".join(buffer_parts)
        yield normalize_markdown_render_output(raw)

    if final_usage:
        log_token_usage_table(
            context="deepseek_stream",
            usage={"provider": "deepseek", "model": api_model, **final_usage},
            provider="deepseek",
            model_name=api_model,
        )


# ── Kimi / Moonshot (OpenAI-compatible) generation ───────────────────────────
#
# Kimi is a reasoning model family exposed over the same OpenAI-compatible shape as
# DeepSeek, so the DeepSeek prompt-shaping helpers (`_deepseek_messages`,
# `_deepseek_expects_json`, `_deepseek_output_contract`) are reused verbatim rather
# than duplicated — they encode "reasoning model + Markdown/JSON contract", not
# anything DeepSeek-specific. Two things genuinely differ and are handled here:
#   1. temperature is FIXED by the provider (see `_kimi_temperature`), so neither the
#      caller's value nor the tabular low-temperature trick can be applied.
#   2. reasoning arrives as a separate `reasoning_content` field and must never be
#      shown to the user (the stream loop below drops it, as the DeepSeek one does).

def _kimi_is_k3(api_model: str) -> bool:
    """True for kimi-k3 / moonshot-k3 (reasoning_effort only; no thinking{} body)."""
    return _model_tail_lower(api_model).startswith(("kimi-k3", "moonshot-k3"))


def _kimi_thinking_settings() -> tuple[bool, int, str]:
    """
    Read the Kimi thinking policy from .env on EVERY call (no import-time snapshot),
    so changing KIMI_THINKING_* takes effect on the next request.

    Returns (thinking_enabled, budget_tokens, reasoning_effort).

    Moonshot API levels (no "medium"):
      kimi-k3  → reasoning_effort: low | high | max
      kimi-k2.6 → thinking.type enabled|disabled (+ optional budget_tokens)
    "medium" is accepted as an alias for "high".
    """
    from app.core.config import get_settings

    s = get_settings()
    enabled = bool(getattr(s, "kimi_thinking_enabled", True))
    try:
        budget = int(getattr(s, "kimi_thinking_budget_tokens", 0) or 0)
    except (TypeError, ValueError):
        budget = 0
    budget = max(0, budget)
    effort = str(getattr(s, "kimi_reasoning_effort", "") or "").strip().lower()
    # API has no "medium"; map to high (middle of low / high / max).
    if effort == "medium":
        effort = "high"
    if effort not in {"low", "high", "max"}:
        effort = ""
    return enabled, budget, effort


def _kimi_apply_thinking(
    create_kwargs: dict,
    *,
    thinking_on: bool,
    budget: int,
    effort: str,
    api_model: str,
    force_thinking: bool = False,
) -> dict:
    """
    Apply the right thinking lever for THIS model, plus the one temperature that mode allows.

    Per Moonshot docs (platform.kimi.ai/docs/guide/use-thinking-models):
      • kimi-k3     → no thinking{}; top-level reasoning_effort low|high|max
      • kimi-k2.6   → thinking.enabled|disabled (+ optional budget_tokens hint)
      • kimi-k2.7*  → always thinks; thinking:disabled errors

    `force_thinking` is the retry path for a model that rejected thinking:disabled.
    """
    wants_minimal = not thinking_on
    can_disable = _kimi_supports_thinking_off(api_model) and not force_thinking
    is_k3 = _kimi_is_k3(api_model)

    if wants_minimal and can_disable:
        # Moonshot only allows temperature 0.6 alongside an explicit thinking:disabled,
        # so these two MUST be sent together — see `_kimi_temperature`.
        create_kwargs["temperature"] = _kimi_temperature(thinking_on=False)
        create_kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
        create_kwargs.pop("reasoning_effort", None)
        return create_kwargs

    # Thinking is on — either by request, or because this model cannot switch it off.
    create_kwargs["temperature"] = _kimi_temperature(thinking_on=True)

    # Default effort: low when caller wants minimal; high (= medium) when thinking on.
    resolved_effort = effort or (_KIMI_MIN_EFFORT if wants_minimal else "high")

    if is_k3:
        # K3 rejects / ignores the K2.x thinking{} body — effort is the only lever.
        create_kwargs.pop("extra_body", None)
        create_kwargs["reasoning_effort"] = resolved_effort
        return create_kwargs

    thinking: dict[str, Any] = {"type": "enabled"}
    if budget > 0:
        # NOTE: Moonshot treats budget_tokens as a HINT, not a hard cap (measured:
        # 860-2,065 reasoning tokens whether set to 500 or 2,000).
        thinking["budget_tokens"] = budget
    create_kwargs["extra_body"] = {"thinking": thinking}

    # reasoning_effort is K3-only per docs; do not send it for K2.6 / K2.7.
    create_kwargs.pop("reasoning_effort", None)
    if not can_disable and wants_minimal and resolved_effort:
        # K2.7-code can't disable thinking; still try effort if the API ever accepts it.
        create_kwargs["reasoning_effort"] = resolved_effort
    return create_kwargs


def _kimi_rejects_thinking_off(exc: BaseException) -> bool:
    """
    True when the model refuses thinking:disabled — e.g. kimi-k2.7-code returns
    "invalid thinking: only type=enabled is allowed for this mode". Those models can
    still be made cheap via budget_tokens, so the caller retries instead of failing.
    """
    msg = str(exc).lower()
    return "thinking" in msg and ("only type=enabled" in msg or "invalid thinking" in msg)


def _kimi_create_kwargs(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
) -> tuple[dict, str, bool, float]:
    """
    Build the shared chat.completions kwargs for both the blocking and streaming paths.

    NOTE: thinking is driven by .env (KIMI_THINKING_*), NOT by the agent_prompts
    `thinking_mode` flag — on Kimi that flag only inflated billed output tokens.
    """
    max_tokens = min(
        KIMI_MAX_OUTPUT_TOKENS,
        max(_KIMI_MIN_OUTPUT_TOKENS, int(gen_kwargs.get("max_output_tokens") or DEFAULT_MAX_OUTPUT_TOKENS)),
    )
    api_model = _kimi_model_id(model_name)
    thinking_on, budget, effort = _kimi_thinking_settings()

    create_kwargs: dict = {
        "model": api_model,
        "messages": _deepseek_messages(prompt, llm_params),
        "max_tokens": max_tokens,
    }
    if _deepseek_expects_json(prompt, llm_params):
        create_kwargs["response_format"] = {"type": "json_object"}
    _kimi_apply_thinking(
        create_kwargs,
        thinking_on=thinking_on,
        budget=budget,
        effort=effort,
        api_model=api_model,
    )
    return create_kwargs, api_model, thinking_on, float(create_kwargs["temperature"])


def _generate_text_kimi(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
) -> str:
    """
    Call the Moonshot (Kimi) chat completions API.

    Supported llm_parameters flags:
      system_instructions str  — system prompt
      max_output_tokens   int  — mapped to max_tokens
      thinking_mode       bool — keeps Kimi's reasoning pass on (default: off)
    """
    client = _kimi_client()
    if client is None:
        logger.warning("[DocumentAI] Kimi call skipped — client unavailable")
        return ""

    create_kwargs, api_model, thinking_on, temperature = _kimi_create_kwargs(
        prompt, model_name=model_name, gen_kwargs=gen_kwargs, llm_params=llm_params
    )

    _, _budget, _effort = _kimi_thinking_settings()
    logger.info(
        "[DocumentAI] ▶ Kimi generate  model_id=%s (raw=%s)  temperature=%.2f  max_tokens=%d  thinking=%s  budget_tokens=%s",
        api_model, model_name, temperature, create_kwargs["max_tokens"], thinking_on, _budget or "—",
    )

    try:
        response = client.chat.completions.create(**create_kwargs)
    except Exception as exc:
        if not thinking_on and _kimi_rejects_thinking_off(exc):
            # This model cannot run without thinking — keep it cheap via budget_tokens.
            logger.info(
                "[DocumentAI] %s refuses thinking:disabled — retrying with budget_tokens=%s",
                api_model, _budget or "—",
            )
            _kimi_apply_thinking(
                create_kwargs,
                thinking_on=True,
                budget=_budget,
                effort=_effort or _KIMI_MIN_EFFORT,
                api_model=api_model,
                force_thinking=True,
            )
            response = client.chat.completions.create(**create_kwargs)
        else:
            logger.exception("[DocumentAI] Kimi generate failed model=%s error=%s", api_model, exc)
            raise

    usage = getattr(response, "usage", None)
    input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    total_tokens = int(getattr(usage, "total_tokens", 0) or 0) or (input_tokens + output_tokens)
    cached_tokens = _log_kimi_cache(api_model, usage, phase="generate")
    log_token_usage_table(
        context="kimi_generate",
        usage={
            "provider": "kimi",
            "model": api_model,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
            "cachedTokens": cached_tokens,
        },
        provider="kimi",
        model_name=api_model,
    )
    content = (response.choices[0].message.content or "") if response.choices else ""
    return normalize_markdown_render_output(content)


def kimi_stream_generator(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
):
    """
    Yield stream events from the Moonshot (Kimi) streaming API.

    Yields dicts:
      {"type": "thinking", "text": "..."}  — live reasoning_content (and <think> blocks)
      {"type": "chunk", "text": "..."}     — final answer tokens

    The route maps these to SSE `thinking` / `chunk` so the UI updates during the
    long CoT phase instead of freezing on a static "Thinking..." label.
    """
    client = _kimi_client()
    if client is None:
        logger.warning("[DocumentAI] Kimi stream skipped — client unavailable")
        return

    create_kwargs, api_model, thinking_on, temperature = _kimi_create_kwargs(
        prompt, model_name=model_name, gen_kwargs=gen_kwargs, llm_params=llm_params
    )
    create_kwargs["stream"] = True
    create_kwargs["stream_options"] = {"include_usage": True}

    # Tabular / chronology / matrix answers CAN be buffered (not token-streamed) so a
    # partially-streamed pipe table never flashes as invalid Markdown mid-flight — but
    # buffering means the user sees nothing at all until generation ends (measured: 66s
    # of dead air, then the whole table at once). Streaming is therefore the default and
    # KIMI_STREAM_TABULAR=false restores the buffered behaviour.
    # NOTE: unlike DeepSeek we canNOT drop the temperature for tabular output —
    # Moonshot rejects every value except the mandated one.
    from app.core.config import get_settings as _kimi_settings

    _ks = _kimi_settings()
    tabular = _is_tabular_request(prompt, llm_params) and not bool(
        getattr(_ks, "kimi_stream_tabular", True)
    )
    stream_reasoning = bool(getattr(_ks, "kimi_stream_reasoning", True))

    _, _budget, _effort = _kimi_thinking_settings()
    logger.info(
        "[DocumentAI] ▶ Kimi stream  model_id=%s (raw=%s)  temperature=%.2f  max_tokens=%d  "
        "thinking=%s  budget_tokens=%s  effort=%s  stream_reasoning=%s  buffered=%s",
        api_model, model_name, temperature, create_kwargs["max_tokens"], thinking_on,
        (_budget or "—") if thinking_on else "—", _effort or "—", stream_reasoning, tabular,
    )

    try:
        stream = client.chat.completions.create(**create_kwargs)
    except Exception as exc:
        if not thinking_on and _kimi_rejects_thinking_off(exc):
            # This model cannot run without thinking — keep it cheap via budget_tokens.
            logger.info(
                "[DocumentAI] %s refuses thinking:disabled — retrying with budget_tokens=%s",
                api_model, _budget or "—",
            )
            _kimi_apply_thinking(
                create_kwargs,
                thinking_on=True,
                budget=_budget,
                effort=_effort or _KIMI_MIN_EFFORT,
                api_model=api_model,
                force_thinking=True,
            )
            stream = client.chat.completions.create(**create_kwargs)
        else:
            logger.exception("[DocumentAI] Kimi stream failed model=%s error=%s", api_model, exc)
            raise

    final_usage: dict[str, int] | None = None
    final_usage_raw: Any = None
    buffer_parts: list[str] = []
    full_response = ""
    # Accumulator for incomplete <think>… content so we can stream it as thinking.
    think_open_buf = ""

    for chunk in stream:
        usage = getattr(chunk, "usage", None)
        if usage is not None:
            prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
            completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            total_tokens = int(getattr(usage, "total_tokens", 0) or 0)
            if not total_tokens and (prompt_tokens or completion_tokens):
                total_tokens = prompt_tokens + completion_tokens
            final_usage_raw = usage
            final_usage = {
                "inputTokens": prompt_tokens,
                "outputTokens": completion_tokens,
                "totalTokens": total_tokens,
                "cachedTokens": _cached_input_tokens(usage),
            }

        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if not delta:
            continue

        # Native Moonshot CoT field — stream live as thinking so the UI engages.
        reasoning = getattr(delta, "reasoning_content", None)
        if reasoning:
            if stream_reasoning:
                yield {"type": "thinking", "text": reasoning}
            continue

        content = delta.content or ""
        if not content:
            continue

        full_response += content

        # Some Kimi builds inline the reasoning as a <think>…</think> block in `content`.
        if "<think>" in full_response and "</think>" not in full_response:
            if stream_reasoning:
                # Stream only the newly arrived portion inside the think block.
                if think_open_buf:
                    # full_response grew by `content`; emit content (minus any leading <think>)
                    piece = content
                    if piece.startswith("<think>"):
                        piece = piece[len("<think>"):]
                    elif "<think>" in piece:
                        piece = piece.split("<think>", 1)[1]
                    if piece:
                        yield {"type": "thinking", "text": piece}
                else:
                    after_open = full_response.split("<think>", 1)[1]
                    if after_open:
                        yield {"type": "thinking", "text": after_open}
                think_open_buf = full_response
            continue
        if "<think>" in full_response and "</think>" in full_response:
            before_close, after_think = full_response.split("</think>", 1)
            if stream_reasoning:
                # Emit any think-tail not already streamed (content after last yield up to </think>).
                inside = before_close.split("<think>", 1)[-1]
                already = think_open_buf.split("<think>", 1)[-1] if think_open_buf else ""
                if inside.startswith(already):
                    tail = inside[len(already):]
                    if tail:
                        yield {"type": "thinking", "text": tail}
            think_open_buf = ""
            full_response = after_think
            if after_think.strip():
                if tabular:
                    buffer_parts.append(after_think)
                else:
                    yield {"type": "chunk", "text": after_think}
            continue

        if "<think>" not in full_response:
            if tabular:
                buffer_parts.append(content)
            else:
                yield {"type": "chunk", "text": content}
            full_response = ""

    if tabular and buffer_parts:
        yield {"type": "chunk", "text": normalize_markdown_render_output("".join(buffer_parts))}

    if final_usage:
        _log_kimi_cache(api_model, final_usage_raw, phase="stream")
        log_token_usage_table(
            context="kimi_stream",
            usage={"provider": "kimi", "model": api_model, **final_usage},
            provider="kimi",
            model_name=api_model,
        )


# ── Unified text generation (routes Gemini ↔ Claude) ─────────────────────────

def _is_transient_gemini_error(exc: BaseException) -> bool:
    """Retryable Gemini/Gemma error. Two families are safe to retry:
    - 500 INTERNAL / 503 UNAVAILABLE / OVERLOADED — Gemma intermittently returns these and the
      very next call succeeds (verified in prod logs).
    - 429 RESOURCE_EXHAUSTED — the PAID tier caps Gemma at a low input-TPM (e.g. gemma-4-31b =
      16,000 input tokens/min); a burst of section drafts trips it, but Google returns a
      `retryDelay` and the request succeeds once the per-minute window refills. (This was NOT
      retried before — the old note "Gemma free tier is TPM unlimited" only held on the free
      tier.) 429 retries MUST honour the server's retryDelay — see `_gemini_retry_delay`."""
    msg = str(exc).upper()
    return any(tok in msg for tok in (
        "500", "INTERNAL", "503", "UNAVAILABLE", "OVERLOADED", "DEADLINE EXCEEDED",
        "429", "RESOURCE_EXHAUSTED", "QUOTA",
    ))


_RETRY_DELAY_RES = (
    re.compile(r"retry in\s+([0-9]+(?:\.[0-9]+)?)\s*s", re.IGNORECASE),
    re.compile(r"retryDelay['\"]?\s*[:=]\s*['\"]?([0-9]+(?:\.[0-9]+)?)\s*s", re.IGNORECASE),
)


def _gemini_retry_delay(exc: BaseException, fallback: float, *, cap: float = 60.0) -> float:
    """Seconds to wait before retrying a rate-limited (429) call. Prefers the server's own
    `retryDelay` ("Please retry in 17.78s" / "retryDelay: 17s"), +1s cushion, capped; falls
    back to the caller's backoff when the message has no delay."""
    msg = str(exc)
    for rx in _RETRY_DELAY_RES:
        m = rx.search(msg)
        if m:
            try:
                return min(cap, float(m.group(1)) + 1.0)
            except ValueError:
                pass
    return fallback


class GemmaInputTPMExceeded(RuntimeError):
    """Free-tier Gemma input-tokens-per-minute quota is exhausted and could not be satisfied in
    time (a single request larger than the per-minute budget, or the window stayed full through a
    retry). Raised so the caller can surface a plain-language message instead of hanging on retries
    or bubbling a raw 429. Enable billing / raise GEMMA_FREE_TIER_INPUT_TPM to lift the ceiling."""


def _estimate_input_tokens(contents: Any) -> int:
    """Rough input-token estimate (~4 chars/token) for a google.genai `contents` value — a plain
    prompt string or a list of Parts. Used only for client-side rate pacing, so an approximation
    is fine; non-text Parts (an attached PDF) count as a coarse floor."""
    try:
        if isinstance(contents, str):
            n = len(contents)
        elif isinstance(contents, (list, tuple)):
            n = 0
            for part in contents:
                t = getattr(part, "text", None)
                n += len(t) if isinstance(t, str) else 2000
        else:
            t = getattr(contents, "text", None)
            n = len(t) if isinstance(t, str) else 0
        return max(1, n // 4)
    except Exception:
        return 0


def _gemma_input_tpm_budget() -> int:
    """Client-side per-minute input-token budget for Gemma, at 90% of the configured tier limit
    (10% headroom). 0 disables token pacing."""
    try:
        from app.core.config import get_settings
        tpm = int(getattr(get_settings(), "gemma_free_tier_input_tpm", 0) or 0)
    except Exception:
        tpm = 0
    return int(tpm * 0.9) if tpm > 0 else 0


def _is_input_tpm_quota_error(exc: BaseException) -> bool:
    """True when a 429 specifically names the per-minute INPUT-token quota (not RPM/RPD). These
    can't be waited out by pacing alone when a single request exceeds the minute budget."""
    m = str(exc)
    if "RESOURCE_EXHAUSTED" not in m and "429" not in m:
        return False
    low = m.lower()
    return "input_token" in low or "inputtokenspermodel" in low


_GEMMA_PACE_LOCK = threading.Lock()
_gemma_last_request_ts = 0.0
# Rolling 60s window of (monotonic_ts, est_input_tokens) for Gemma input-TPM pacing.
_gemma_token_window: list[tuple[float, int]] = []


def _pace_gemma_call(model_name: str | None, *, est_input_tokens: int = 0) -> None:
    """Enforce free-tier-safe pacing between successive Gemma requests — GLOBAL across threads and
    INCLUDING retries. Two limits are enforced together:
      • RPM  — a minimum wall-clock interval between calls (GEMMA_MIN_CALL_INTERVAL_S, default 9s
        ≈ 6-7 RPM; free AI Studio keys allow ~15-30 RPM and the endpoint 500s under rapid fire).
      • input-TPM — free keys cap Gemma at ~16,000 INPUT tokens/min per model. When the caller
        passes an estimate, a rolling 60s window holds the request until sending it would stay
        under GEMMA_FREE_TIER_INPUT_TPM (90% of, for headroom). A single request larger than the
        whole budget can't be satisfied by waiting, so it is let through to 429 + fail-fast rather
        than sleeping pointlessly.
    Sleeping under the lock is deliberate — it serialises concurrent gemma callers so both limits
    hold even when sections draft in parallel. Only ever runs in executor threads (never on the
    event loop). Non-gemma models pass straight through."""
    global _gemma_last_request_ts
    if not _is_gemma_model(model_name):
        return
    try:
        from app.core.config import get_settings
        _s = get_settings()
        interval = float(getattr(_s, "gemma_min_call_interval_s", 9.0) or 0.0)
        max_pace_wait = float(getattr(_s, "gemma_max_pace_wait_s", 15.0) or 0.0)
    except Exception:
        interval = 9.0
        max_pace_wait = 15.0
    tpm_budget = _gemma_input_tpm_budget()
    with _GEMMA_PACE_LOCK:
        now = time.monotonic()
        # ── input-TPM: wait until the rolling 60s window has room for this request ──
        if tpm_budget > 0 and est_input_tokens > 0:
            # Drop entries older than 60s.
            _gemma_token_window[:] = [(ts, tok) for (ts, tok) in _gemma_token_window if now - ts < 60.0]
            used = sum(tok for _, tok in _gemma_token_window)
            if est_input_tokens <= tpm_budget and used + est_input_tokens > tpm_budget:
                need_free = used + est_input_tokens - tpm_budget
                freed = 0.0
                wait_tpm = 0.0
                for ts, tok in sorted(_gemma_token_window):  # oldest first
                    freed += tok
                    if freed >= need_free:
                        wait_tpm = max(0.0, ts + 60.0 - now)
                        break
                wait_tpm = min(wait_tpm, 60.0)
                # Cap the block: when the window is saturated (heavy back-to-back use), sleeping the
                # full ~50s inside a request just blows the step timeout. Wait at most
                # gemma_max_pace_wait_s, then proceed — a fast 429 + fail-fast message beats a long
                # hang that times out anyway.
                if max_pace_wait > 0 and wait_tpm > max_pace_wait:
                    logger.info(
                        "[DocumentAI] input-TPM needs %.1fs but capped to %.1fs — proceeding "
                        "(quota saturated; may 429 → fail-fast)", wait_tpm, max_pace_wait,
                    )
                    wait_tpm = max_pace_wait
                if wait_tpm > 0:
                    logger.info(
                        "[DocumentAI] pacing gemma %.1fs for input-TPM (window=%d + req=%d > budget=%d)",
                        wait_tpm, used, est_input_tokens, tpm_budget,
                    )
                    time.sleep(wait_tpm)
                    now = time.monotonic()
                    _gemma_token_window[:] = [(ts, tok) for (ts, tok) in _gemma_token_window if now - ts < 60.0]
            elif est_input_tokens > tpm_budget:
                logger.warning(
                    "[DocumentAI] gemma request est %d input tokens exceeds the whole per-minute "
                    "budget (%d) — will 429; reduce context or raise GEMMA_FREE_TIER_INPUT_TPM",
                    est_input_tokens, tpm_budget,
                )
            _gemma_token_window.append((now, est_input_tokens))
        # ── RPM: minimum interval between calls ──
        if interval > 0:
            wait = _gemma_last_request_ts + interval - now
            if wait > 0:
                logger.info("[DocumentAI] pacing gemma request %.1fs (free-tier RPM guard)", wait)
                time.sleep(wait)
                now = time.monotonic()
        _gemma_last_request_ts = now


def _gemini_generate_content_retrying(client, *, model, contents, config, retries: int = 4, base_delay: float = 2.0):
    """`client.models.generate_content` with automatic retry on transient errors. Turns Gemma's
    intermittent 500s AND paid-tier 429 rate limits into successful calls. On a 429 it waits the
    server-provided `retryDelay` (the per-minute quota refills); on a 5xx it backs off 2s/4s/8s
    (gemma calls are additionally paced to GEMMA_MIN_CALL_INTERVAL_S apart — see
    `_pace_gemma_call` — so a retry burst can never hammer the 15 RPM free-tier window).
    Input-token-TPM 429s (free-tier Gemma, 16K input tokens/min) are handled specially: a single
    request bigger than the whole per-minute budget can NEVER succeed by retrying, so it fails fast
    as GemmaInputTPMExceeded; otherwise it is retried at most ONCE (honouring the server retryDelay,
    capped short so it fits the caller's step timeout) before giving up cleanly. Never retries
    400/401/403. Raises the last error if all attempts fail."""
    est_tokens = _estimate_input_tokens(contents) if _is_gemma_model(model) else 0
    tpm_budget = _gemma_input_tpm_budget()
    last_exc: BaseException | None = None
    input_tpm_retries = 0
    for attempt in range(max(1, retries)):
        _pace_gemma_call(model, est_input_tokens=est_tokens)
        try:
            return client.models.generate_content(model=model, contents=contents, config=config)
        except Exception as exc:  # inspect + selectively retry
            last_exc = exc
            input_tpm = _is_input_tpm_quota_error(exc)
            # A single request over the whole minute budget is unrecoverable — fail fast so the UI
            # can show a clear message instead of hanging through futile retries.
            if input_tpm and tpm_budget > 0 and est_tokens > tpm_budget:
                raise GemmaInputTPMExceeded(str(exc)) from exc
            if attempt >= retries - 1 or not _is_transient_gemini_error(exc):
                if input_tpm:
                    raise GemmaInputTPMExceeded(str(exc)) from exc
                raise
            if input_tpm:
                # Retry the input-TPM quota at most once; a short cap keeps retry+call under the
                # caller's timeout (a 58s server delay + a 25s call would blow an ~88s step budget).
                input_tpm_retries += 1
                if input_tpm_retries > 1:
                    raise GemmaInputTPMExceeded(str(exc)) from exc
                delay = _gemini_retry_delay(exc, base_delay * (2 ** attempt), cap=35.0)
                reason = "input-token quota (429)"
            elif "429" in str(exc).upper() or "RESOURCE_EXHAUSTED" in str(exc).upper() or "QUOTA" in str(exc).upper():
                delay = _gemini_retry_delay(exc, base_delay * (2 ** attempt))
                reason = "rate-limited (429)"
            else:
                delay = base_delay * (2 ** attempt)
                reason = "transient error"
            logger.warning(
                "[DocumentAI] %s %s (attempt %d/%d) — retrying in %.1fs: %s",
                model, reason, attempt + 1, retries, delay, str(exc)[:160],
            )
            time.sleep(delay)
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("gemini generate_content produced no result")


def _generate_text(
    prompt: str,
    *,
    for_summary: bool = False,
    agent_name: str | None = None,
    user_id: str | int | None = None,
    summarization_llm_config: dict | None = None,
    model_name_override: str | None = None,
    max_output_tokens: int | None = None,
) -> str:
    """
    Generate text using either Gemini or Claude depending on the model name
    stored in agent_prompts.model_ids → llm_models.name.

    Routing:
      model id tail starts with "claude" (after any vendor/ path prefix) → Anthropic API
      everything else → Gemini API

    max_output_tokens: optional per-call override of the configured output budget
    (used by the multi-stage template drafting pipeline, whose fact-inventory and
    section stages need a large budget). It is clamped to the model ceiling downstream.
    """
    model_name, gen_kwargs, llm_params = _generation_config(
        for_summary=for_summary,
        agent_name=agent_name,
        user_id=user_id,
        summarization_llm_config=summarization_llm_config,
        model_name_override=model_name_override,
    )
    if max_output_tokens:
        gen_kwargs = {**gen_kwargs, "max_output_tokens": int(max_output_tokens)}
    provider = _detect_provider(model_name)

    logger.info(
        "[DocumentAI] LLM IN USE  provider=%s  model=%s  api_key=%s  agent=%s",
        provider, model_name, _api_key_label_for_model(model_name, provider), agent_name or "N/A",
    )

    if provider == "claude":
        return _generate_text_claude(
            prompt,
            model_name=model_name,
            gen_kwargs=gen_kwargs,
            llm_params=llm_params,
        )

    if provider == "deepseek":
        try:
            result = _generate_text_deepseek(
                prompt,
                model_name=model_name,
                gen_kwargs=gen_kwargs,
                llm_params=llm_params,
            )
            if result:
                return result
            logger.warning("[DocumentAI] DeepSeek returned empty — falling back to Gemini")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[DocumentAI] DeepSeek generate failed (%s) — falling back to Gemini", exc)
        # Never leave a (free-tier) user fully blocked on a DeepSeek outage.
        model_name = "gemini-2.5-flash"
        provider = "gemini"

    if provider == "kimi":
        try:
            result = _generate_text_kimi(
                prompt,
                model_name=model_name,
                gen_kwargs=gen_kwargs,
                llm_params=llm_params,
            )
            if result:
                return result
            logger.warning("[DocumentAI] Kimi returned empty — falling back to Gemini")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[DocumentAI] Kimi generate failed (%s) — falling back to Gemini", exc)
        # Moonshot returns a transient `engine_overloaded_error` under load; never leave
        # an admin-selected Kimi model as a dead end for the user.
        model_name = "gemini-2.5-flash"
        provider = "gemini"

    # ── Gemini ───────────────────────────────────────────────────────────────
    client = _gemini_client(model_name)
    if client is None:
        logger.warning("[DocumentAI] Gemini client unavailable — check GEMINI_API_KEY")
        return ""
    gemini_config = _build_gemini_config(gen_kwargs, llm_params, model_name=model_name)
    response = _gemini_generate_content_retrying(
        client,
        model=model_name,
        contents=prompt,
        config=gemini_config,
    )
    um = getattr(response, "usage_metadata", None)
    prompt_tokens = int(getattr(um, "prompt_token_count", 0) or 0)
    completion_tokens = int(getattr(um, "candidates_token_count", 0) or 0)
    total_tokens = int(getattr(um, "total_token_count", 0) or 0)
    if not total_tokens and (prompt_tokens or completion_tokens):
        total_tokens = prompt_tokens + completion_tokens
    log_token_usage_table(
        context="gemini_generate",
        usage={
            "provider": "gemini",
            "model": model_name,
            "inputTokens": prompt_tokens,
            "outputTokens": completion_tokens,
            "totalTokens": total_tokens,
        },
        provider="gemini",
        model_name=model_name,
    )
    return (getattr(response, "text", None) or "").strip()


def _call_gemini_for_extraction(text: str) -> dict:
    """Use Gemini to extract all case fields from document text (uses form_population_agent config)."""
    try:
        packed, pack_meta = pack_for_extraction(text)
        from app.services.chronology.console import log_pack_decision

        log_pack_decision(pack_meta)
        prompt = _EXTRACTION_PROMPT + packed
        raw = _generate_text(prompt, agent_name=_AGENT_EXTRACTION)
        if not raw:
            return {}
        # Try to extract JSON
        json_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw) or re.search(r"\{[\s\S]*\}", raw)
        if json_match:
            return json.loads(json_match.group(1) if json_match.lastindex else json_match.group(0))
        return {}
    except Exception as exc:
        global _gemini_extract_unavailable_logged
        if not _gemini_extract_unavailable_logged:
            logger.warning("[DocumentAI] Gemini extraction unavailable, using regex fallback: %s", exc)
            _gemini_extract_unavailable_logged = True
        return {}


# ── LLM-based OCR-fragmentation reconstruction (for stored chunks) ────────────
# Deterministic cleanup (normalize_ocr_artifacts) only repairs a curated
# dictionary. Pervasive fragmentation — arbitrary names/places ("Sug riv"),
# punctuation spacing ("p .a .", "18 %") — needs a model to reconstruct. This is
# run ON STORED CHUNK TEXT (not the PDF) by the clean-chunks endpoint, one-time
# per case, keeping the embeddings.

_RECONSTRUCT_MODEL = "gemini-2.5-flash"
_RECONSTRUCT_PROMPT = (
    "You are an OCR text-repair tool for Indian legal documents. The TEXT below was "
    "extracted from a PDF and has spaces wrongly inserted INSIDE words, names, places, "
    "numbers, and before punctuation.\n\n"
    "Repair the FRAGMENTATION ONLY:\n"
    "- Rejoin split words/names/places: 'Krish n aji' -> 'Krishnaji', 'Sug riv' -> 'Sugriv', "
    "'L atur' -> 'Latur', 'Occ u Service' -> 'Occu Service'.\n"
    "- Remove spaces inside numbers/citations: '805 7' -> '8057', '202 5' -> '2025', '18 %' -> '18%'.\n"
    "- Remove spaces before punctuation: 'p .a .' -> 'p.a.', 'Ltd .' -> 'Ltd.', "
    "'Rs . 25 , 00 , 000' -> 'Rs. 25,00,000'.\n\n"
    "STRICT RULES (do not violate):\n"
    "- Do NOT add, remove, reorder, summarise, translate, or reword anything.\n"
    "- Keep every number, date, amount, citation, and name identical in value.\n"
    "- Preserve line breaks and overall structure.\n"
    "- Output ONLY the corrected text — no preamble, no explanation, no code fences.\n\n"
    "TEXT:\n"
)


# Below these a chunk is not judged at all. A cause title or a court stamp is a line or
# two long, so one "s/o" or one exhibit letter made it look densely fragmented; and a
# chunk that is mostly Devanagari has too little Latin text for these English signals
# to mean anything.
_FRAGMENT_MIN_CHARS = 400
_FRAGMENT_MIN_LATIN_CHARS = 200
_FRAGMENT_SIGNALS_PER_1000 = 8.0

# Ordinary legal writing that the signals below mistook for OCR splits. Each is blanked
# before counting. Measured on every stored chunk (29,023): the old check flagged 7,144,
# nearly all of them text like these; with them removed it flags 676, and none that it
# did not flag before.
_NOT_FRAGMENTS: tuple[re.Pattern[str], ...] = (
    # s/o, d/o, w/o, c/o, h/o, u/s, r/w, A/c
    re.compile(r"(?<![A-Za-z])[A-Za-z]/[A-Za-z](?![A-Za-z])"),
    # dotted leaders and ellipses: ".....PETITIONER", "...RESPONDENTS"
    re.compile(r"\.{2,}|…"),
    # initials and dotted abbreviations: "S. K. Sharma", "G.R.", "M.S.", "i.e."
    re.compile(r"(?<![A-Za-z])(?:[A-Za-z]\.){1,5}(?![A-Za-z])"),
    # quoted exhibit markers: Exhibit "A"
    re.compile(r"[\"'“”‘’]\s*[A-Za-z]\s*[\"'“”‘’]"),
    # clause markers: (a), (iv)
    re.compile(r"\(\s*(?:[A-Za-z]|[ivxlcdm]{1,6})\s*\)", re.IGNORECASE),
    # page and annexure markers: "12-14-C", "14-A", "A-12"
    re.compile(r"(?<=[-/])[A-Za-z](?![A-Za-z])|(?<![A-Za-z])[A-Za-z](?=[-/]\d)"),
    # units after a number: "Duration: 1 Y 1 M 21 D"
    re.compile(r"(?<![A-Za-z0-9])\d+\s?[A-Za-z](?![A-Za-z0-9./])"),
    # a table cell holding one letter: column headings "A | B | C"
    re.compile(r"(?m)^[ \t|]*[A-Za-z][ \t|]*$"),
)
# A single letter that is not a word ('a', 'A', 'I', 'i' are) — a syllable split off.
_STRAY_LETTER = re.compile(r"(?<![A-Za-z])[B-HJ-Zb-hj-z](?![A-Za-z])")
# A space before punctuation after Latin text: "Ltd .", "p .a .", "18 %", "year ,".
# Not a colon ("Date :" is how forms are laid out) and not after Devanagari, where a
# space before punctuation is ordinary typography.
_SPACE_BEFORE_PUNCT = re.compile(r"(?<=[A-Za-z0-9])[ \t][.,;%]")
# A number broken on the same line: "805 7", "202 5".
_SPLIT_NUMBER = re.compile(r"\b\d{2,4}[ \t]\d{1,2}\b")
_LATIN_CHAR = re.compile(r"[A-Za-z0-9]")


def _looks_fragmented(text: str) -> bool:
    """
    Heuristic: True when text shows pervasive OCR space-fragmentation worth an LLM
    reconstruction pass ("identifi cation", "com mittee", "p .a .", "202 5").

    Conservative on purpose: a chunk it flags costs a model call. Short chunks and
    mostly non-Latin chunks are not judged, and the ordinary features of legal writing
    in `_NOT_FRAGMENTS` are removed before the signals are counted, so it can only flag
    fewer chunks than the plain count would, never more.
    """
    s = str(text or "")
    if len(s) < _FRAGMENT_MIN_CHARS:
        return False
    if len(_LATIN_CHAR.findall(s)) < _FRAGMENT_MIN_LATIN_CHARS:
        return False
    cleaned = s
    for pattern in _NOT_FRAGMENTS:
        cleaned = pattern.sub(" ", cleaned)
    signals = (
        len(_STRAY_LETTER.findall(cleaned))
        + len(_SPACE_BEFORE_PUNCT.findall(cleaned))
        + len(_SPLIT_NUMBER.findall(cleaned))
    )
    return (signals / (len(s) / 1000.0)) >= _FRAGMENT_SIGNALS_PER_1000


def reconstruct_chunk_text(text: str) -> str:
    """
    LLM-reconstruct OCR-fragmented chunk text (Gemini flash, temperature 0).

    Returns the cleaned text, or the ORIGINAL input on any error / empty / clearly
    truncated output — content is never lost.
    """
    src = str(text or "")
    if not src.strip():
        return src
    try:
        client = _gemini_client()
        if client is None:
            return src
        gen_kwargs = {"temperature": 0.0, "max_output_tokens": 8192}
        config = _build_gemini_config(gen_kwargs, {}, model_name=_RECONSTRUCT_MODEL)
        response = client.models.generate_content(
            model=_RECONSTRUCT_MODEL,
            contents=_RECONSTRUCT_PROMPT + src[:24000],
            config=config,
        )
        out = (getattr(response, "text", None) or "").strip()
        # Strip an accidental outer code fence.
        match = re.fullmatch(r"```(?:\w+)?\s*\n([\s\S]*?)\n```", out)
        if match:
            out = match.group(1).strip()
        # Reconstruction only removes spaces, so output is slightly shorter — never
        # half the size. A much shorter result means refusal/truncation → keep original.
        if not out or len(out) < len(src) * 0.5:
            return src
        return out
    except Exception as exc:
        logger.warning("[DocumentAI] reconstruct_chunk_text failed (%s) — keeping original", exc)
        return src


def _is_audio_source_name(name: str) -> bool:
    lowered = str(name or "").strip().lower()
    if not lowered:
        return False
    return lowered.endswith((".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".webm", ".mp4", ".opus", ".amr"))


def _extract_speaker_turns(document_texts: list[dict[str, str]], *, max_turns: int = 140) -> list[tuple[str, str]]:
    turns: list[tuple[str, str]] = []
    for doc in document_texts:
        text = str(doc.get("text") or "")
        if not text:
            continue
        for line in text.splitlines():
            match = _SPEAKER_LINE_RE.search(line)
            if not match:
                continue
            speaker = match.group(1).strip()
            utterance = " ".join(match.group(2).split()).strip()
            if not utterance:
                continue
            turns.append((speaker, utterance))
            if len(turns) >= max_turns:
                return turns
    return turns


def _build_speaker_diarization_suffix(document_texts: list[dict[str, str]]) -> str:
    turns = _extract_speaker_turns(document_texts)
    if not turns:
        return ""

    snippets_by_speaker: dict[str, list[str]] = {}
    for speaker, utterance in turns:
        snippets_by_speaker.setdefault(speaker, [])
        if len(snippets_by_speaker[speaker]) < 2:
            snippets_by_speaker[speaker].append(utterance[:220])

    ordered_speakers = sorted(snippets_by_speaker.keys(), key=lambda x: (len(x), x))
    speaker_lines: list[str] = []
    for speaker in ordered_speakers[:8]:
        snippets = "; ".join(snippets_by_speaker[speaker])
        speaker_lines.append(f"- Speaker {speaker}: {snippets}")

    transitions: list[str] = []
    previous_speaker = turns[0][0]
    for speaker, _utterance in turns[1:]:
        if speaker == previous_speaker:
            continue
        transitions.append(f"Speaker {previous_speaker} -> Speaker {speaker}")
        previous_speaker = speaker
        if len(transitions) >= 8:
            break
    transition_lines = [f"- {item}" for item in transitions] if transitions else ["- Single-speaker sequence in retrieved context."]

    return (
        "Speaker Diarization:\n"
        + "\n".join(speaker_lines)
        + "\n\nWho Talks To Whom (turn sequence):\n"
        + "\n".join(transition_lines)
    )


def _call_gemini_for_qa(
    question: str,
    document_texts: list[dict[str, str]],
    *,
    query_intent: str | None = None,
    output_format: str | None = None,
    extra_instructions: str | None = None,
    system_instruction: str | None = None,
    user_id: str | int | None = None,
    summarization_llm_config: dict | None = None,
    agent_name: str | None = None,
    model_name_override: str | None = None,
) -> dict[str, str]:
    """
    Ask Gemini a question grounded in the provided document texts.

    Args:
        question: The user's question.
        document_texts: List of dicts with keys 'name' and 'text'.

    Returns:
        Dict with keys 'answer' and 'source_documents'.
    """
    try:
        # Build the document context block
        context_parts = []
        source_names = []
        running_chars = 0
        # Large budget so full case files and top-k retrieved chunks fit in
        # context — 380k chars ≈ 95k tokens, safe for DeepSeek (smallest window)
        # and far below Gemini/Claude limits. Truncating at 80-200k silently
        # dropped most of a large case file and produced
        # "Not mentioned in the document." answers.
        char_limit = 380_000
        # ...but a free-tier Gemma caps INPUT at ~16K tokens/min, so it 429s long before 380k chars
        # (~95K tokens). Resolve the model that will actually answer and clamp only Gemma to its
        # safe budget — every other model keeps the full 380k above, so the truncation bug that
        # motivated it does not come back. get_agent_config is cached, so this extra resolve is
        # cheap and the value is reused by _generate_text below.
        try:
            _qa_model, _, _ = _generation_config(
                for_summary=True,
                agent_name=agent_name,
                user_id=user_id,
                summarization_llm_config=summarization_llm_config,
                model_name_override=model_name_override,
            )
            if _is_gemma_model(_qa_model):
                from app.core.config import get_settings as _qa_settings
                char_limit = min(char_limit, int(getattr(_qa_settings(), "gemma_max_context_chars", 48000) or 48000))
        except Exception:
            pass
        for doc in document_texts:
            name = doc.get("name", "document")
            # Repair deterministic OCR artefacts (split numbers + known terms) before
            # the model ever sees the text, so garbled spacing is not echoed back.
            text = normalize_ocr_artifacts((doc.get("text") or "").strip())
            if not text:
                continue
            block = f"[Source file: {name}]\n{text}"
            if running_chars + len(block) > char_limit:
                block = block[: char_limit - running_chars]
                context_parts.append(block)
                source_names.append(name)
                break
            context_parts.append(block)
            source_names.append(name)
            running_chars += len(block)

        if not context_parts:
            return {
                "answer": "No case material text is available to answer this question.",
                "source_documents": "",
            }

        context = "\n\n---\n\n".join(context_parts)
        intent_hint = (query_intent or "general").strip().lower()
        format_hint = (output_format or "plain").strip().lower()
        # Detect the user's EXPLICIT output-format request from the CURRENT question
        # only (history-augmented prompts otherwise mis-detect — prior answers are
        # full of "summary" words). When the user explicitly asked for a TABLE /
        # TIMELINE, we suppress the prose instructions below so they don't fight the
        # OUTPUT CONTRACT that demands a table.
        _intent_q = question
        _cq = re.search(r"Current question:\s*(.+)\Z", str(question or ""), flags=re.IGNORECASE | re.DOTALL)
        if _cq:
            _intent_q = _cq.group(1).strip()
        _orch_intent = detect_response_format(_intent_q)
        _force_table = _orch_intent in (ResponseIntent.TABLE, ResponseIntent.TIMELINE)
        has_audio_source = any(_is_audio_source_name(name) for name in source_names)
        has_speaker_labels = bool(_extract_speaker_turns(document_texts, max_turns=1))
        require_speaker_diarization = has_audio_source or has_speaker_labels
        is_learning_agent = str(agent_name or "").strip() == "learning_mode_agent"
        if is_learning_agent:
            instruction_parts = [
                "You are in Learning Mode. Follow the system instructions (from agent configuration) for how to teach the case and prepare the learner.",
                "Use ONLY the case materials below. Honor the runtime instructions prepended to this prompt (JSON shape, turn rules, grounding).",
                "Do not invent facts, dates, names, holdings, or procedural history.",
            ]
        else:
            instruction_parts = [
                "You are a legal expert assistant.",
                "Answer the user's question based ONLY on the following case materials (PDFs, images, text files, AND transcripts from audio — treat transcript excerpts as valid sources).",
                "Do not invent facts, dates, names, holdings, or procedural history.",
                "If the answer is not supported by the provided text, say so clearly.",
                "Prefer precise legal writing over generic filler.",
                "Cite the source file name inline when materially helpful.",
                "Never say there are no audio files in the folder if the excerpts below include content from an audio filename — that transcript represents the audio.",
            ]
        if not is_learning_agent:
            if require_speaker_diarization:
                instruction_parts.append(
                    "Because this query uses audio transcript context, include a 'Speaker Diarization' section and a "
                    "'Who Talks To Whom (turn sequence)' section using only speaker labels found in the transcript."
                )
            if intent_hint == "timeline":
                instruction_parts.append("Organize the answer chronologically and focus on procedural sequence and dates.")
            elif intent_hint == "risk":
                instruction_parts.append("Focus on legal, procedural, evidentiary, and strategic risks supported by the record.")
            elif intent_hint == "evidence":
                instruction_parts.append("Focus on exhibits, proof, contradictions, admissions, and evidentiary support in the record.")
            elif intent_hint == "summary" and not _force_table:
                instruction_parts.append("Provide a structured summary that captures the most material facts and issues from the record.")
            if _force_table:
                # User EXPLICITLY asked for a table/timeline → demand pipe tables and
                # forbid prose, overriding the structured-summary guidance above.
                instruction_parts.append(
                    "OUTPUT FORMAT — MANDATORY: The user explicitly asked for a TABLE. Present the ENTIRE "
                    "answer as GitHub-Flavored Markdown pipe table(s): a header row, a |---| separator row, "
                    "and one record per physical line, every row starting and ending with '|'. Do NOT use "
                    "prose paragraphs or ## section headings. Never use HTML tables."
                )
            elif format_hint == "structured":
                instruction_parts.append(
                    "Use GitHub-Flavored Markdown with short markdown headings (##), bold sub-labels, and "
                    "bullet/numbered lists. Use a Markdown table ONLY if the user explicitly asked for a "
                    "table/timeline/matrix; otherwise prefer headings, paragraphs, and lists. Never use HTML tables."
                )
        if extra_instructions:
            instruction_parts.append(extra_instructions.strip())

        # Prompt Orchestration Layer:
        #   - Layer 1 (permanent system prompt) is delivered as the SYSTEM INSTRUCTION
        #     block so every provider (Gemini / Claude / DeepSeek) receives the same
        #     role + markdown + OCR rules.
        #   - Layer 3 (dynamic format instruction) is detected from the user's CURRENT
        #     question (`_intent_q`, computed above) and appended as the OUTPUT CONTRACT
        #     reminder. The user's wording is never modified.
        format_reminder = (
            "=== OUTPUT CONTRACT (OVERRIDES ALL PRIOR INSTRUCTIONS) ===\n"
            f"{format_instruction_for_query(_intent_q)}"
        )
        prompt = (
            f"{' '.join(instruction_parts)}\n\n"
            f"=== CASE MATERIALS (documents and/or audio transcripts) ===\n{context}\n\n"
            f"=== QUESTION ===\n{question}\n\n"
            f"{format_reminder}\n\n"
            "=== ANSWER ==="
        )
        system_block = f"SYSTEM INSTRUCTION:\n{PERMANENT_SYSTEM_PROMPT}"
        if system_instruction:
            system_block = f"{system_block}\n\n{system_instruction}"
        prompt = f"{system_block}\n\n{prompt}"
        override = str(model_name_override or "").strip() or None
        try:
            answer = _generate_text(
                prompt,
                for_summary=intent_hint == "summary",
                agent_name=agent_name or _AGENT_QA,
                user_id=user_id,
                summarization_llm_config=summarization_llm_config,
                model_name_override=override,
            )
        except Exception as exc:
            if not override:
                raise
            logger.warning(
                "[DocumentAI] Q&A failed with override model=%s (%s) — retrying with agent default",
                override,
                exc,
            )
            answer = _generate_text(
                prompt,
                for_summary=intent_hint == "summary",
                agent_name=agent_name or _AGENT_QA,
                user_id=user_id,
                summarization_llm_config=summarization_llm_config,
                model_name_override=None,
            )
        if require_speaker_diarization:
            diarization_suffix = _build_speaker_diarization_suffix(document_texts)
            if diarization_suffix and "speaker diarization" not in (answer or "").lower():
                answer = f"{(answer or '').strip()}\n\n{diarization_suffix}".strip()
        return {
            "answer": answer,
            "source_documents": ", ".join(source_names),
        }
    except Exception as exc:
        global _gemini_qa_unavailable_logged
        if not _gemini_qa_unavailable_logged:
            logger.warning("[DocumentAI] Gemini Q&A unavailable, returning fallback response: %s", exc)
            _gemini_qa_unavailable_logged = True
        return {"answer": "", "source_documents": ""}



class DocumentAIAdapter:
    CASE_NUMBER_RE = re.compile(r"(case\s*(?:no\.?|number)?\s*[:\-]?\s*[A-Z0-9\/\-]+)", re.I)
    DATE_RE = re.compile(
        r"\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|"
        r"\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|"
        r"[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\b"
    )
    PARTY_RE = re.compile(r"([A-Z][A-Za-z0-9&.,'\- ]+)\s+v(?:s\.?|ersus)\s+([A-Z][A-Za-z0-9&.,'\- ]+)", re.I)
    COURT_RE = re.compile(r"(high court|supreme court|district court|sessions court|tribunal)", re.I)

    def extract(self, document: DocumentReference) -> ExtractionResult:
        text = (document.inline_text or document.document_name or "").strip()
        quality_score = 0.97 if len(text) > 100 else 0.25

        # Use Gemini for comprehensive extraction if text is meaningful
        if len(text) > 50:
            gemini_entities = _call_gemini_for_extraction(text)
            if gemini_entities:
                logger.info("[DocumentAI] Gemini extraction succeeded: %d fields", len(gemini_entities))
                return ExtractionResult(
                    text=text,
                    entities=gemini_entities,
                    confidence_by_field={k: 0.90 for k in gemini_entities},
                    quality_score=quality_score,
                )

        # Fallback: regex-based extraction
        entities: dict[str, str] = {}
        confidence: dict[str, float] = {}
        lowered_name = document.document_name.lower()

        case_number_match = self.CASE_NUMBER_RE.search(text)
        if case_number_match:
            entities["caseNumber"] = case_number_match.group(1)
            confidence["caseNumber"] = 0.96

        party_match = self.PARTY_RE.search(text)
        if party_match:
            p = party_match.group(1).strip()
            r = party_match.group(2).strip()
            entities["caseTitle"] = f"{p} vs {r}"
            entities["petitioners"] = [{"fullName": p, "role": "Individual", "advocateName": "", "barRegistration": "", "contact": ""}]
            entities["respondents"] = [{"fullName": r, "role": "Individual", "advocateName": "", "barRegistration": "", "contact": ""}]
            confidence["caseTitle"] = 0.94

        dates = self.DATE_RE.findall(text)
        if dates:
            entities["filingDate"] = dates[0]
            confidence["filingDate"] = 0.91

        court_match = self.COURT_RE.search(text)
        if court_match:
            entities["courtName"] = court_match.group(1).title()
            entities["courtLevel"] = court_match.group(1).title()
            confidence["courtName"] = 0.92

        if "bail" in lowered_name or "bail" in text.lower():
            entities.setdefault("caseType", "Bail")
        elif "petition" in lowered_name or "petition" in text.lower():
            entities.setdefault("caseType", "Petition")

        return ExtractionResult(
            text=text,
            entities=entities,
            confidence_by_field=confidence,
            quality_score=quality_score,
        )

    def classify(self, document: DocumentReference, text: str) -> DocumentType:
        from app.services.adapters.speech_to_text import is_audio_filename, is_audio_mime

        if is_audio_mime(document.mime_type) or is_audio_filename(document.document_name or ""):
            tl = text.lower()
            if any(k in tl for k in ("witness", "deposition", "testimony", "examination")):
                return DocumentType.evidence
            if any(k in tl for k in ("hearing", "courtroom", "proceedings", "oral arguments")):
                return DocumentType.order
            if any(k in tl for k in ("consultation", "client interview", "interview")):
                return DocumentType.correspondence
            if any(k in tl for k in ("phone call", "voicemail", "telephone")):
                return DocumentType.correspondence
            if any(k in tl for k in ("recording", "audio", "tape")):
                return DocumentType.evidence
            if "pleading" in tl or "plaint" in tl:
                return DocumentType.pleading
            return DocumentType.audio_recording

        candidate = f"{document.document_name} {text}".lower()
        if "pleading" in candidate or "plaint" in candidate or "written statement" in candidate:
            return DocumentType.pleading
        if "evidence" in candidate or "exhibit" in candidate:
            return DocumentType.evidence
        if "order" in candidate or "judgment" in candidate:
            return DocumentType.order
        if "letter" in candidate or "notice" in candidate or "email" in candidate:
            return DocumentType.correspondence
        if "affidavit" in candidate:
            return DocumentType.affidavit
        if "agreement" in candidate or "contract" in candidate:
            return DocumentType.contract
        return document.declared_doc_type or DocumentType.unknown
