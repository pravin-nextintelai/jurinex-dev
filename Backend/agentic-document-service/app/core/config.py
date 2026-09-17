from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic import field_validator
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BASE_DIR / ".env",),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    service_name: str = Field(
        default="agentic-document-service",
        validation_alias=AliasChoices("SERVICE_NAME"),
    )
    environment: str = "development"
    version: str = "1.0.0"
    host: str = "0.0.0.0"
    port: int = Field(
        default=8092,
        validation_alias=AliasChoices("PORT", "AGENTIC_DOCUMENT_SERVICE_PORT", "SERVICE_PORT"),
    )
    log_level: str = "INFO"
    cors_origins: list[str] = Field(
        validation_alias=AliasChoices("CORS_ORIGINS"),
        default_factory=lambda: [
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
    )
    enable_adk_runtime: bool = True
    enable_legacy_proxy: bool = False

    database_url: str = Field(default="", validation_alias=AliasChoices("DATABASE_URL"))
    payment_db_url: str = Field(default="", validation_alias=AliasChoices("PAYMENT_DB_URL"))
    # Optional DB override for reading public.agent_prompts.
    # Use this when agent prompts live in Draft_DB while runtime tables stay in Document_DB.
    agent_prompts_database_url: str = Field(
        default="",
        validation_alias=AliasChoices("AGENT_PROMPTS_DATABASE_URL", "DRAFT_DATABASE_URL"),
    )
    google_cloud_project: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT_ID"),
    )
    google_cloud_location: str = Field(
        default="us-central1",
        validation_alias=AliasChoices("GOOGLE_CLOUD_LOCATION", "DOCUMENT_AI_LOCATION"),
    )
    document_ai_processor_id: str = Field(
        default="",
        validation_alias=AliasChoices("DOCUMENT_AI_PROCESSOR_ID"),
    )
    document_ai_ocr_processor_version_id: str = Field(
        default="",
        validation_alias=AliasChoices("DOCUMENT_AI_OCR_PROCESSOR_VERSION_ID"),
    )
    # ── Document AI OCR quality levers (anti-fragmentation) ──────────────────
    # Read the PDF's embedded Unicode text layer for born-digital PDFs instead of
    # rasterizing + OCR. This is the single biggest fix for space-fragmented text
    # ("Sug riv", "18 % p .a .") because it bypasses OCR word-segmentation entirely
    # for digital PDFs. Harmless for scanned PDFs/images (Document AI ignores it).
    document_ai_enable_native_pdf_parsing: bool = Field(
        default=True,
        validation_alias=AliasChoices("DOCUMENT_AI_ENABLE_NATIVE_PDF_PARSING"),
    )
    # Premium math OCR — recovers "18% p.a.", "₹1,50,000", super/subscripts cleanly.
    # Requires a processor version that supports premium features; default off so a
    # basic OCR processor never rejects the request.
    document_ai_enable_math_ocr: bool = Field(
        default=False,
        validation_alias=AliasChoices("DOCUMENT_AI_ENABLE_MATH_OCR"),
    )
    # Emit symbol-level detail (lets downstream code rebuild words from glyphs).
    document_ai_enable_symbol: bool = Field(
        default=False,
        validation_alias=AliasChoices("DOCUMENT_AI_ENABLE_SYMBOL"),
    )
    google_application_credentials: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_APPLICATION_CREDENTIALS"),
    )
    gcs_bucket_name: str = Field(
        default="",
        validation_alias=AliasChoices("GCS_BUCKET_NAME", "GCS_BUCKET"),
    )
    gcs_input_bucket_name: str = Field(
        default="",
        validation_alias=AliasChoices("GCS_INPUT_BUCKET_NAME"),
    )
    gcs_output_bucket_name: str = Field(
        default="",
        validation_alias=AliasChoices("GCS_OUTPUT_BUCKET_NAME"),
    )
    gcs_key_base64: str = Field(
        default="",
        validation_alias=AliasChoices("GCS_KEY_BASE64"),
    )
    firestore_database: str = "(default)"
    datastore_namespace: str = "agentic-document-service"
    bigquery_dataset: str = "agentic_document_service"
    vector_store_backend: str = "memory"
    vector_search_index: str = ""
    adk_model: str = Field(
        default="gemini-2.5-pro",
        validation_alias=AliasChoices("ADK_MODEL"),
    )
    # Intake auto-fill and chronology extraction (form_population_agent). Both values win
    # over the agent_prompts row, so they can be changed here without touching the admin DB.
    # Thinking level: minimal | low | medium | high.
    intake_extraction_model: str = Field(
        default="gemini-3.8-flash",
        validation_alias=AliasChoices("INTAKE_EXTRACTION_MODEL"),
    )
    intake_extraction_thinking_level: str = Field(
        default="medium",
        validation_alias=AliasChoices("INTAKE_EXTRACTION_THINKING_LEVEL"),
    )
    embedding_model: str = Field(
        default="gemini-embedding-001",
        validation_alias=AliasChoices("EMBEDDING_MODEL"),
    )
    gemini_api_key: str = Field(default="", validation_alias=AliasChoices("GEMINI_API_KEY"))
    # Single-pass Research mode model. gemini-3.6-flash (grounded, thinking_level="low")
    # replaced gemini-2.5-pro — cheaper and faster while keeping live Google Search grounding.
    research_model_name: str = Field(
        default="gemini-3.6-flash",
        validation_alias=AliasChoices("RESEARCH_MODEL_NAME"),
    )
    # ── Deep Research (bounded agentic loop) ─────────────────────────────────────────
    # Search rounds use Google grounding. Final synthesis is evidence-closed: it receives
    # validated findings and bounded case context, with live search disabled. The rupee limit
    # is an application reservation/settlement cap, not a provider-account billing limit.
    #
    # BUDGET SIZING (measured, gemini-3.1-flash-lite search + gemini-3.6-flash synthesis,
    # USD->INR 98): one grounded round with 4 queries costs ~₹6.4; a plan or gap call ~₹0.3;
    # synthesis costs ~₹20.6 at 16k output tokens and ~₹32.3 at 32k. The old ₹25 cap with a
    # 60% synthesis reserve left only ₹10 for searching — ONE round — and a reserve too small
    # to write a long report, which is why Deep answers came back thin. The defaults below
    # fund ~6 rounds plus a full-length synthesis. Lower DEEP_RESEARCH_BUDGET_INR to spend less.
    deep_research_reasoning_model: str = Field(
        default="gemini-3.1-flash-lite",
        validation_alias=AliasChoices("DEEP_RESEARCH_REASONING_MODEL"),
    )
    deep_research_search_model: str = Field(
        default="gemini-3.1-flash-lite",
        validation_alias=AliasChoices("DEEP_RESEARCH_SEARCH_MODEL"),
    )
    deep_research_synthesis_model: str = Field(
        default="gemini-3.6-flash",
        validation_alias=AliasChoices("DEEP_RESEARCH_SYNTHESIS_MODEL"),
    )
    # Evidence-closed synthesis controls. Search is disabled for this provider stage.
    deep_research_synthesis_temperature: float = Field(
        default=1.0,
        validation_alias=AliasChoices("DEEP_RESEARCH_SYNTHESIS_TEMPERATURE"),
    )
    deep_research_synthesis_thinking_level: str = Field(
        default="high",
        validation_alias=AliasChoices("DEEP_RESEARCH_SYNTHESIS_THINKING_LEVEL"),
    )
    # Thinking level for the cheap flash-lite steps (plan / round-search / gap-check). Applied
    # best-effort: if gemini-3.1-flash-lite rejects thinking_level at the API layer, the call
    # auto-retries without it (see deep_research/gemini.py), so this can never break a run.
    # Gemini levels: low|medium|high.
    deep_research_reasoning_thinking_level: str = Field(
        default="high",
        validation_alias=AliasChoices("DEEP_RESEARCH_REASONING_THINKING_LEVEL"),
    )
    # Hard ceiling on search rounds (each round = one grounded model call + a gap check).
    deep_research_max_rounds: int = Field(
        default=6,
        validation_alias=AliasChoices("DEEP_RESEARCH_MAX_ROUNDS"),
    )
    # Application-enforced ceiling for one run. Provider invoices remain external.
    deep_research_budget_inr: float = Field(
        default=90.0,
        ge=1.0,
        le=150.0,
        validation_alias=AliasChoices("DEEP_RESEARCH_BUDGET_INR"),
    )
    # Gemini 3 Google Search tool price in USD per executed unique query.
    deep_research_search_usd_per_query: float = Field(
        default=0.014,
        gt=0.0,
        le=1.0,
        validation_alias=AliasChoices("DEEP_RESEARCH_SEARCH_USD_PER_QUERY"),
    )
    # Fraction of the budget held back so the synthesis call can always complete.
    # 40% of ₹90 = ₹36 held back — enough for a 32k-output report (~₹32) while leaving
    # ₹54 for search rounds. At the old 60% the reserve could not even fund 16k output.
    deep_research_synthesis_reserve_frac: float = Field(
        default=0.4,
        validation_alias=AliasChoices("DEEP_RESEARCH_SYNTHESIS_RESERVE_FRAC"),
    )
    # Deep-only operational bounds. They do not affect single-pass Research mode.
    deep_research_max_sources: int = Field(
        default=24,
        validation_alias=AliasChoices("DEEP_RESEARCH_MAX_SOURCES"),
    )
    deep_research_source_concurrency: int = Field(
        default=6,
        validation_alias=AliasChoices("DEEP_RESEARCH_SOURCE_CONCURRENCY"),
    )
    deep_research_source_timeout_s: float = Field(
        default=8.0,
        validation_alias=AliasChoices("DEEP_RESEARCH_SOURCE_TIMEOUT_S"),
    )
    deep_research_source_max_bytes: int = Field(
        default=750_000,
        validation_alias=AliasChoices("DEEP_RESEARCH_SOURCE_MAX_BYTES"),
    )
    deep_research_source_max_redirects: int = Field(
        default=4,
        validation_alias=AliasChoices("DEEP_RESEARCH_SOURCE_MAX_REDIRECTS"),
    )
    deep_research_stage_timeout_s: float = Field(
        default=240.0,
        validation_alias=AliasChoices("DEEP_RESEARCH_STAGE_TIMEOUT_S"),
    )
    # Keep the provider's socket/read deadline below the orchestration deadline. This
    # lets httpx surface a retryable timeout while the Deep run still has time to
    # account for the failed call and start a replacement stream.
    deep_research_transport_timeout_s: float = Field(
        default=210.0,
        validation_alias=AliasChoices("DEEP_RESEARCH_TRANSPORT_TIMEOUT_S"),
    )
    deep_research_run_timeout_s: float = Field(
        default=720.0,
        validation_alias=AliasChoices("DEEP_RESEARCH_RUN_TIMEOUT_S"),
    )
    deep_research_synthesis_timeout_retries: int = Field(
        default=1,
        ge=0,
        le=2,
        validation_alias=AliasChoices("DEEP_RESEARCH_SYNTHESIS_TIMEOUT_RETRIES"),
    )
    deep_research_queue_timeout_s: float = Field(
        default=5.0,
        validation_alias=AliasChoices("DEEP_RESEARCH_QUEUE_TIMEOUT_S"),
    )
    deep_research_max_concurrent_runs: int = Field(
        default=2,
        validation_alias=AliasChoices("DEEP_RESEARCH_MAX_CONCURRENT_RUNS"),
    )
    # Dedicated key for Gemma models (gemma-*). Falls back to GEMINI_API_KEY when blank.
    gemma_api_key: str = Field(default="", validation_alias=AliasChoices("GEMMA_API_KEY"))
    # Dedicated model for draft-from-template mode. A stronger model (e.g. gemini-3.1-pro-preview)
    # reads the uploaded template PDF directly and reproduces all pages with clean formatting — gemma
    # cannot (PDF Parts 500 and it truncates long templates). Uses GEMINI_API_KEY. Blank -> reuse the
    # admin-selected chat model (template injected as text).
    draft_model_name: str = Field(
        default="gemini-3.1-pro-preview",
        validation_alias=AliasChoices("DRAFT_MODEL_NAME"),
    )
    # Output-token ceiling for drafts (full-length templates need room; clamped to the model's real max).
    draft_max_output_tokens: int = Field(
        default=65536,
        validation_alias=AliasChoices("DRAFT_MAX_OUTPUT_TOKENS"),
    )
    # Max DRAFTING units per template page. Each unit = one model call, so this is the biggest
    # lever on draft wall-clock and cost. 3 => a 12-page pleading drafts in ~36 calls, not 80.
    # Raise for more granular sections (slower, pricier); lower for fewer, larger sections.
    draft_units_per_page: float = Field(
        default=3.0,
        validation_alias=AliasChoices("DRAFT_UNITS_PER_PAGE"),
    )
    # GUARDIAN model for the draft audit passes (Stage D grounding + format audit, section repair;
    # Stage E slot recovery). This is the model that CHECKS and REWRITES what the draft engine
    # produced, so it is billed on every draft — Opus is the strongest backstop but the most
    # expensive. Blank -> auto (claude-opus-4-8 when ANTHROPIC_API_KEY is set, else
    # gemini-3.1-pro-preview). The frontend guardian dropdown overrides this per draft.
    draft_guardian_model: str = Field(
        default="",
        validation_alias=AliasChoices("DRAFT_GUARDIAN_MODEL"),
    )
    # Master switch for the draft GUARDIAN (Stage D/E audit + repair). Default False = guardian is
    # OFF: drafts skip the grounding/format audit, section repair and slot recovery entirely, saving
    # the guardian model's tokens on every draft. Set True to re-enable it (then draft_guardian_model
    # / the frontend dropdown pick which model runs the audit). The dropdown can also force it off
    # per-draft with a "disabled"/"none"/"off" value even when this is True.
    draft_guardian_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("DRAFT_GUARDIAN_ENABLED"),
    )
    # Minimum seconds between successive Gemma API requests (GLOBAL across threads, retries
    # included). Free Google AI Studio keys allow only 15 requests/min on gemma models, and
    # the gemma endpoint 500s far more under rapid-fire calls — 9s spacing ≈ 6-7 RPM keeps
    # well under the cap and gives the flaky endpoint room to recover. 0 disables pacing.
    gemma_min_call_interval_s: float = Field(
        default=9.0,
        validation_alias=AliasChoices("GEMMA_MIN_CALL_INTERVAL_S"),
    )
    # Free Google AI Studio keys cap Gemma at 16,000 INPUT tokens per minute per model
    # (generate_content_free_tier_input_token_count). A comprehensive/deep chat that dumps the
    # whole case (60K–130K tokens) is 4–8x over that ceiling and 429s forever. A single Gemma
    # chat call is budgeted as ~11K input + ~4.5K answer so it fits the per-minute quota AND the
    # answer is never cut short:
    #   • gemma_max_context_chars  — budget for the DOCUMENT context (chunks) fed to a Gemma chat
    #     (~36K chars ≈ 9K tokens). With gemma_history_system_max_chars (~5K tok) this fixes the
    #     per-call input at ~9K chunks + ~5K history/system = ~14K total. Feeds ~30-35 chunks
    #     (chunks average ~1,040 chars, not the 750-token target). Raise once billing lifts the
    #     ceiling. A dynamic clamp still trims further if needed to stay under the TPM budget.
    #   • gemma_free_tier_input_tpm — the per-minute input-token budget the client-side pacer
    #     spreads requests under (a rolling 60s window). Set to your tier's real limit; 0 disables
    #     token pacing (RPM pacing via gemma_min_call_interval_s still applies).
    #   • gemma_thinking_level — Gemma-4 is a THINKING model whose thinking + answer SHARE the
    #     output budget, and it rejects numeric thinking_budget — only "minimal" | "high" (400
    #     otherwise, verified live). "minimal" emits ZERO thinking tokens, so the entire output
    #     budget becomes the answer (no thinking cutting it) AND responses are ~2x faster. Use
    #     "high" only when a task genuinely needs step-by-step reasoning over speed + length.
    #   • gemma_chat_max_output_tokens — output-token budget for a Gemma chat call. Output does
    #     NOT count against the 16K INPUT/min quota, so this can be large. With thinking_level=
    #     minimal it is entirely answer (20K tokens ≈ 28 pages; Gemma's hard ceiling is 32768). A
    #     genuinely long answer streams for several minutes at ~35 tok/s — it's a ceiling, not a
    #     target, so short answers still finish fast.
    # Raise context/TPM once billing is enabled — paid tiers lift the 16K ceiling.
    gemma_max_context_chars: int = Field(
        default=36000,
        validation_alias=AliasChoices("GEMMA_MAX_CONTEXT_CHARS"),
    )
    # Fixed number of document chunks to feed a Gemma chat (predictable, NO dynamic char sizing).
    # Chunks average ~1,040 chars ≈ 260 tokens, so 27 ≈ 7K context tokens; with the ~5K history/
    # system cap that is ~12-13K total input, comfortably under the 16K/min wall. When > 0 this
    # takes precedence over gemma_max_context_chars and the dynamic clamp is skipped. 0 = fall back
    # to the char-budget + dynamic-clamp behavior.
    gemma_chat_chunk_count: int = Field(
        default=27,
        validation_alias=AliasChoices("GEMMA_CHAT_CHUNK_COUNT"),
    )
    # Skip the STREAMING attempt for Gemma chat and go straight to one non-stream call. On the free
    # tier a ~13K-token request is ~85% of the 16K/min input budget, and the stream attempt + the
    # non-stream fallback each send it — ~26K/min → guaranteed 429 on the fallback. Sending once
    # (non-stream only) halves the per-request input and makes large prompts actually succeed. The
    # trade-off is no token-by-token streaming (the full answer arrives at once). Set false once
    # billing lifts the 16K ceiling and streaming is reliable again.
    gemma_disable_streaming: bool = Field(
        default=True,
        validation_alias=AliasChoices("GEMMA_DISABLE_STREAMING"),
    )
    # Cap on the system prompt + conversation history + question portion of a Gemma chat input
    # (~20K chars ≈ 5K tokens). With gemma_max_context_chars (~9K tok for chunks) this fixes the
    # per-call budget at ~9K chunks + ~5K history/system = ~14K total input. When the history grows
    # past this, the OLDEST turns are dropped (the current question is always kept) so document
    # chunks never get starved.
    gemma_history_system_max_chars: int = Field(
        default=20000,
        validation_alias=AliasChoices("GEMMA_HISTORY_SYSTEM_MAX_CHARS"),
    )
    # Hard cap (seconds) on how long the client-side input-TPM pacer will BLOCK a single Gemma
    # call. When the rolling window is saturated (heavy back-to-back use), waiting the full ~50s
    # inside a request just blows the step timeout — so cap the wait and let the request proceed to
    # a fast 429 + clean "rate limited, try again" message instead of a long hang. 0 = no cap.
    gemma_max_pace_wait_s: float = Field(
        default=15.0,
        validation_alias=AliasChoices("GEMMA_MAX_PACE_WAIT_S"),
    )
    gemma_free_tier_input_tpm: int = Field(
        default=16000,
        validation_alias=AliasChoices("GEMMA_FREE_TIER_INPUT_TPM"),
    )
    gemma_thinking_level: str = Field(
        default="minimal",
        validation_alias=AliasChoices("GEMMA_THINKING_LEVEL"),
    )
    gemma_chat_max_output_tokens: int = Field(
        default=20000,
        validation_alias=AliasChoices("GEMMA_CHAT_MAX_OUTPUT_TOKENS"),
    )
    # How long (seconds) to cache the per-model output-token registry (public.llm_max_tokens, edited
    # via LLM Management → LLM Max Tokens). 0 = check the DB on EVERY request (fully live — an admin's
    # limit change takes effect on the very next chat, no restart). Raise it (e.g. 10) to trade a
    # little staleness for fewer DB reads under high traffic.
    max_tokens_registry_cache_seconds: int = Field(
        default=0,
        validation_alias=AliasChoices("MAX_TOKENS_REGISTRY_CACHE_SECONDS"),
    )
    # HARDCODED temperature for a Gemma CHAT/Q&A call. Gemma runs on the free tier as a managed
    # model, so its temperature is FIXED here rather than read from the admin agent_prompts row —
    # admin-configured temperature applies only to paid Gemini models. 0.3 keeps grounded factual
    # Q&A faithful to the documents. (Does NOT affect draft mode, which sets its own temperature.)
    gemma_chat_temperature: float = Field(
        default=0.3,
        validation_alias=AliasChoices("GEMMA_CHAT_TEMPERATURE"),
    )
    # When True, comprehensive/deep asks force the generation temperature up to 1.0 (for fuller,
    # less terse long-form output) EVEN IF the admin set a lower temperature on the agent row. When
    # False (default), the admin-configured temperature from agent_prompts is honored verbatim for
    # ALL asks — matching the contract "model + temperature come from admin config; only thinking is
    # hardcoded". Flip to True only if you want the code to override the admin temp for long answers.
    comprehensive_temp_nudge: bool = Field(
        default=False,
        validation_alias=AliasChoices("COMPREHENSIVE_TEMP_NUDGE"),
    )
    # Per-call timeout (seconds) for a Gemma NON-STREAM chat/deep call. The generic timeout formula
    # scales with the output-token budget (~88s for a 10K budget), but free-tier gemma is a slow,
    # throttled thinking model whose single call measured 51-88s just to return 200 OK — 88s killed
    # a call that would have succeeded, then a second call was stacked on top (tripling input-token
    # usage against the 16K/min wall). This floor gives ONE honest call room to finish. Lower it once
    # billing is enabled (calls return faster and you no longer pay the free-tier throttle).
    gemma_non_stream_timeout_s: float = Field(
        default=220.0,
        validation_alias=AliasChoices("GEMMA_NON_STREAM_TIMEOUT_S"),
    )
    anthropic_api_key: str = Field(default="", validation_alias=AliasChoices("ANTHROPIC_API_KEY"))
    # ── Z.AI Translation Agent ────────────────────────────────────────────────
    # Key for https://api.z.ai (z.ai/manage-apikey/apikey-list). Empty = translation disabled.
    zai_api_key: str = Field(default="", validation_alias=AliasChoices("ZAI_API_KEY", "Z_AI_API_KEY"))
    zai_api_base_url: str = Field(
        default="https://api.z.ai/api/v1",
        validation_alias=AliasChoices("ZAI_API_BASE_URL"),
    )
    # Reflection / COT strategies run multi-pass server-side, so allow long calls.
    zai_translation_timeout_s: float = Field(
        default=180.0,
        validation_alias=AliasChoices("ZAI_TRANSLATION_TIMEOUT_S"),
    )
    # Concurrent Z.AI calls per document-translation job (mirrors
    # OCR_PARALLEL_WORKERS for the Document AI batch pool). Raise only if the
    # Z.AI account's rate limit allows it — 429s are retried but waste time.
    zai_translation_concurrency: int = Field(
        default=12,
        validation_alias=AliasChoices("ZAI_TRANSLATION_CONCURRENCY"),
    )
    deepseek_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("DEEPSEEK_API_KEY", "Deepseek_API_KEY"),
    )
    # Concrete model ids used when the UI sends a bare provider label
    # ("deepseek"/"claude") instead of a specific model name.
    deepseek_model: str = Field(
        default="deepseek-v4-flash",
        validation_alias=AliasChoices("DEEPSEEK_MODEL"),
    )
    claude_model: str = Field(
        default="claude-sonnet-4-6",
        validation_alias=AliasChoices("CLAUDE_MODEL"),
    )
    # ── Kimi / Moonshot AI (OpenAI-compatible) ────────────────────────────────
    kimi_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("KIMI_API_KEY", "MOONSHOT_API_KEY"),
    )
    kimi_model: str = Field(
        default="kimi-k2.6",
        validation_alias=AliasChoices("KIMI_MODEL"),
    )
    # api.moonshot.ai = international endpoint; api.moonshot.cn = mainland China.
    # The key issued for one endpoint is NOT valid on the other.
    kimi_base_url: str = Field(
        default="https://api.moonshot.ai/v1",
        validation_alias=AliasChoices("KIMI_BASE_URL"),
    )
    # Kimi is a reasoning model: its hidden chain-of-thought is BILLED as output
    # tokens even though it is never shown to the user (a one-line greeting measured
    # 2,660 output tokens, ~99% of it reasoning, and took 71s). These three knobs
    # control that cost and are read from .env on every call — they OVERRIDE the
    # agent_prompts `thinking_mode` flag, which is what switched thinking on before.
    kimi_thinking_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("KIMI_THINKING_ENABLED"),
    )
    # Reasoning-token budget when thinking IS enabled (kimi-k2.6 thinking.budget_tokens).
    # Moonshot treats this as a HINT, not a hard cap. kimi-k3 ignores this and uses
    # kimi_reasoning_effort instead.
    kimi_thinking_budget_tokens: int = Field(
        default=1000,
        validation_alias=AliasChoices("KIMI_THINKING_BUDGET_TOKENS"),
    )
    # Coarse reasoning control for kimi-k3: "low" | "high" | "max" (API has no "medium";
    # "medium" is accepted as an alias for "high"). Default "high" ≈ medium effort.
    # Blank = auto: the adapter sends "low" for K3 / K2.7-Code when
    # kimi_thinking_enabled is False, and uses "high" when it is True.
    kimi_reasoning_effort: str = Field(
        default="high",
        validation_alias=AliasChoices("KIMI_REASONING_EFFORT"),
    )
    # Stream table/chronology answers token-by-token like every other answer.
    # DeepSeek BUFFERS them (nothing reaches the user until generation ends — that
    # showed up as ~66s of dead air then the whole table at once). Set this false to
    # get the old buffered behaviour, which hides half-built pipe tables mid-flight
    # but costs the live typing effect.
    kimi_stream_tabular: bool = Field(
        default=True,
        validation_alias=AliasChoices("KIMI_STREAM_TABULAR"),
    )
    # Stream Moonshot reasoning_content live as SSE type=thinking so the UI updates
    # during long CoT instead of freezing on a static "Thinking..." label.
    # Set false to hide CoT (old behaviour).
    kimi_stream_reasoning: bool = Field(
        default=True,
        validation_alias=AliasChoices("KIMI_STREAM_REASONING"),
    )
    # ── Free-tier DeepSeek routing ────────────────────────────────────────────
    # When enabled, users on the named free plan have their text LLM model forced
    # to `deepseek_model` (with a Gemini fallback on failure). Off by default.
    free_tier_deepseek_enabled: bool = Field(
        default=False, validation_alias=AliasChoices("FREE_TIER_DEEPSEEK_ENABLED")
    )
    free_plan_name: str = Field(default="free", validation_alias=AliasChoices("FREE_PLAN_NAME"))
    cloud_speech_to_text_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("CLOUD_SPEECH_TO_TEXT_API_KEY"),
    )
    jwt_secret: str = Field(default="", validation_alias=AliasChoices("JWT_SECRET"))
    redis_url: str = Field(default="", validation_alias=AliasChoices("REDIS_URL"))
    auth_service_url: str = Field(
        default="http://localhost:5001",
        validation_alias=AliasChoices("AUTH_SERVICE_URL"),
    )
    api_gateway_url: str = Field(
        default="http://localhost:5000",
        validation_alias=AliasChoices("API_GATEWAY_URL", "GATEWAY_URL"),
    )
    payment_service_url: str = Field(
        default="http://localhost:5003",
        validation_alias=AliasChoices("PAYMENT_SERVICE_URL"),
    )
    # Optional HTTP fallback for agent prompts when DB lookup is unavailable.
    agent_draft_service_url: str = Field(
        default="http://localhost:8000",
        validation_alias=AliasChoices("AGENT_DRAFT_SERVICE_URL", "DRAFTING_SERVICE_URL"),
    )
    retrieval_top_k: int = Field(
        default=40,
        validation_alias=AliasChoices("RETRIEVAL_TOP_K"),
    )
    chunk_size: int = 750
    chunk_overlap: int = 160
    chunk_min_tokens: int = 500
    chunk_max_tokens: int = 1000
    # Documents processed CONCURRENTLY within one upload batch. This is the
    # user-visible parallelism of "Create New Case" multi-file uploads — a
    # batch larger than this runs in waves and reads as sequential. Sized above
    # the max files-per-upload limit so a whole batch always runs in ONE wave;
    # Document AI stampede is prevented separately by
    # document_ai_max_concurrent_requests, not by this ceiling.
    max_parallel_document_workers: int = Field(
        default=16,
        validation_alias=AliasChoices("MAX_PARALLEL_DOCUMENT_WORKERS"),
    )
    # Document AI page limit per request (online processing max is 15 pages)
    document_ai_page_limit: int = Field(
        default=15,
        validation_alias=AliasChoices("DOCUMENT_AI_PAGE_LIMIT"),
    )
    # Threads used to send parallel page-batch OCR requests to Document AI
    ocr_parallel_workers: int = Field(
        default=8,
        validation_alias=AliasChoices("OCR_PARALLEL_WORKERS"),
    )
    # GLOBAL cap on in-flight Document AI requests across ALL documents/batches.
    # With every document processing concurrently, doc_workers × ocr_workers
    # could stampede the processor into 429s — which silently degrade OCR to the
    # pypdf fallback. This semaphore keeps concurrency safe while letting the
    # rest of each document's pipeline (chunking/embedding/persistence) run
    # fully parallel.
    document_ai_max_concurrent_requests: int = Field(
        default=10,
        validation_alias=AliasChoices("DOCUMENT_AI_MAX_CONCURRENT_REQUESTS"),
    )
    # Persistent background worker threads in the document processing queue.
    # The signed-URL upload flow enqueues ONE single-document job per file, so
    # this must cover a whole batch for all files to process concurrently —
    # at 4, a 10-file signed-URL upload ran only 4 documents at a time.
    processing_queue_workers: int = Field(
        default=12,
        validation_alias=AliasChoices("PROCESSING_QUEUE_WORKERS"),
    )
    # Max seconds to wait for a single document to finish OCR + embedding.
    # If exceeded the document is marked as failed (error) instead of staying at 20%.
    document_processing_timeout_seconds: int = Field(
        default=600,
        validation_alias=AliasChoices("DOCUMENT_PROCESSING_TIMEOUT_SECONDS"),
    )
    auto_fill_confidence_threshold: float = 0.90

    # Embedding batching & rate-limit protection
    # Max texts per single Gemini embed_content call (Gemini supports up to 100)
    embedding_batch_size: int = Field(
        default=50,
        validation_alias=AliasChoices("EMBEDDING_BATCH_SIZE"),
    )
    # Max retry attempts on 429 / quota errors (exponential backoff between each)
    embedding_max_retries: int = Field(
        default=5,
        validation_alias=AliasChoices("EMBEDDING_MAX_RETRIES"),
    )
    # Token-bucket rate: max Gemini embed API calls per minute across all threads
    # gemini-embedding-001 free-tier = 1500 RPM; set lower if you hit limits
    embedding_rpm_limit: int = Field(
        default=1500,
        validation_alias=AliasChoices("EMBEDDING_RPM_LIMIT"),
    )
    legacy_document_service_url: str = Field(
        default="",
        validation_alias=AliasChoices("LEGACY_DOCUMENT_SERVICE_URL"),
    )
    proxy_timeout_seconds: float = 300.0

    # ── Default rate / upload limits (fallback when summarization_chat_config has no row) ──
    # These are used when the DB config table is empty AND no per-plan override exists.
    default_tokens_per_day: int = Field(default=300000, validation_alias=AliasChoices("DEFAULT_TOKENS_PER_DAY"))
    default_messages_per_hour: int = Field(default=60, validation_alias=AliasChoices("DEFAULT_MESSAGES_PER_HOUR"))
    default_chats_per_minute: int = Field(default=20, validation_alias=AliasChoices("DEFAULT_CHATS_PER_MINUTE"))
    default_chats_per_day: int = Field(default=80, validation_alias=AliasChoices("DEFAULT_CHATS_PER_DAY"))
    default_max_upload_files: int = Field(default=10, validation_alias=AliasChoices("DEFAULT_MAX_UPLOAD_FILES"))
    default_max_document_size_mb: int = Field(default=40, validation_alias=AliasChoices("DEFAULT_MAX_DOCUMENT_SIZE_MB"))
    default_max_document_pages: int = Field(default=400, validation_alias=AliasChoices("DEFAULT_MAX_DOCUMENT_PAGES"))
    default_max_file_upload_per_day: int = Field(default=15, validation_alias=AliasChoices("DEFAULT_MAX_FILE_UPLOAD_PER_DAY"))
    default_max_context_documents: int = Field(default=8, validation_alias=AliasChoices("DEFAULT_MAX_CONTEXT_DOCUMENTS"))
    default_max_conversation_history: int = Field(default=25, validation_alias=AliasChoices("DEFAULT_MAX_CONVERSATION_HISTORY"))
    default_max_output_tokens: int = Field(
        default=65536,
        validation_alias=AliasChoices("DEFAULT_MAX_OUTPUT_TOKENS"),
    )

    # 0 = always read latest summarization_chat_config from DB (recommended when admins edit often).
    summarization_chat_config_cache_seconds: float = Field(
        default=0.0,
        validation_alias=AliasChoices("SUMMARIZATION_CHAT_CONFIG_CACHE_SECONDS"),
    )
    # Optional: require this header value for POST .../invalidate-cache (empty = endpoint disabled).
    summarization_config_admin_key: str = Field(
        default="",
        validation_alias=AliasChoices("SUMMARIZATION_CONFIG_ADMIN_KEY"),
    )
    # 0 = use the same max as documents (max_document_size_mb / multer_upload_ceiling_mb from chat config)
    max_audio_file_size_mb: int = Field(
        default=0,
        validation_alias=AliasChoices("MAX_AUDIO_FILE_SIZE_MB"),
    )
    # BatchRecognize / long audio: allow up to ~8h; sync calls finish sooner.
    speech_to_text_timeout_seconds: int = Field(
        default=28800,
        validation_alias=AliasChoices("SPEECH_TO_TEXT_TIMEOUT", "SPEECH_TO_TEXT_TIMEOUT_SECONDS"),
    )
    speech_to_text_language_code: str = Field(
        default="en-IN",
        validation_alias=AliasChoices("SPEECH_TO_TEXT_LANGUAGE", "SPEECH_TO_TEXT_LANGUAGE_CODE"),
    )
    speech_to_text_alternative_language_code: str = Field(
        default="hi-IN",
        validation_alias=AliasChoices("SPEECH_TO_TEXT_ALTERNATIVE_LANGUAGE", "SPEECH_TO_TEXT_ALT_LANGUAGE"),
    )
    # Speech-to-Text v2: Chirp + batch_recognize for gs:// (long audio); v1 fallback if disabled.
    speech_use_v2: bool = Field(
        default=True,
        validation_alias=AliasChoices("SPEECH_USE_V2"),
    )
    speech_v2_model: str = Field(
        default="chirp_2",
        validation_alias=AliasChoices("SPEECH_V2_MODEL"),
    )
    # Chirp 2/3 are regional — use us-central1 unless your model docs specify another region.
    speech_recognizer_location: str = Field(
        default="us-central1",
        validation_alias=AliasChoices("SPEECH_RECOGNIZER_LOCATION", "SPEECH_V2_LOCATION"),
    )
    # Named recognizer ID created in GCP Console / gcloud.
    # Set to the ID of your pre-created recognizer (e.g. "chirp-transcriber").
    # Full path: projects/{project}/locations/{location}/recognizers/{id}
    # Leave empty ("") to use the implicit wildcard recognizer "_" (auto-provisioned).
    speech_v2_recognizer_id: str = Field(
        default="chirp-transcriber",
        validation_alias=AliasChoices("SPEECH_V2_RECOGNIZER_ID"),
    )
    # Max concurrent STT submissions to avoid hitting GCP rate limits.
    stt_max_concurrent: int = Field(
        default=3,
        validation_alias=AliasChoices("STT_MAX_CONCURRENT"),
    )

    # ── Controlled memory system (JRNX-ENG-2026-008) ─────────────────────────
    # Global kill switches. Per-advocate, per-firm and per-case toggles live in
    # the memory_settings table; these turn the whole feature off for the
    # deployment (e.g. before migration 170 has been applied).
    memory_enabled: bool = Field(default=True, validation_alias=AliasChoices("MEMORY_ENABLED"))
    memory_write_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("MEMORY_WRITE_ENABLED"),
    )
    # Extraction model used by the post-turn memory writer. A cheap flash model
    # is right here: the task is structured extraction against strict rules, and
    # it runs once per substantive turn. Measured on four kinds of message (a date and
    # a decision, a standing rule, a question, a fact about the advocate):
    # gemini-3.1-flash-lite at thinking "minimal" got all four right in 1.9–2.3 s, the
    # same as gemini-2.5-flash but faster; gemini-3.7-flash at "low" returned facts with
    # empty text, which the writer has to throw away.
    memory_extraction_model: str = Field(
        default="gemini-3.1-flash-lite",
        validation_alias=AliasChoices("MEMORY_EXTRACTION_MODEL"),
    )
    # Gemini 3 thinking for the extractor: minimal | low | medium | high
    # (gemini-3.7 has no "minimal"; it is raised to "low" there).
    memory_extraction_thinking_level: str = Field(
        default="minimal",
        validation_alias=AliasChoices("MEMORY_EXTRACTION_THINKING_LEVEL"),
    )
    # Tidies an instruction the advocate typed, on request ("Polish"). A small,
    # fast model: it rewrites one sentence and adds nothing.
    memory_polish_model: str = Field(
        default="gemini-3.1-flash-lite",
        validation_alias=AliasChoices("MEMORY_POLISH_MODEL"),
    )
    # Prompt budgets are set in estimated tokens (see app/services/token_budget.py).
    # Measured on English case OCR: about 3 characters per Gemini token.
    chars_per_token_estimate: float = Field(
        default=3.0,
        validation_alias=AliasChoices("CHARS_PER_TOKEN_ESTIMATE"),
    )
    # Passages a specific (not comprehensive) case-chat question is answered from, on paid
    # models. Free-tier Gemma keeps its own per-minute-safe limits.
    chat_passage_budget_tokens: int = Field(
        default=24000,
        validation_alias=AliasChoices("CHAT_PASSAGE_BUDGET_TOKENS"),
    )
    chat_passage_top_k: int = Field(
        default=36,
        validation_alias=AliasChoices("CHAT_PASSAGE_TOP_K"),
    )
    # Case-chat history (app/services/chat_summary.py): the latest turns, with answers
    # shortened, plus a rolling summary of older turns kept per chat. The plan's
    # max_conversation_history still caps the recent turns; 0 there switches history off.
    chat_history_recent_turns: int = Field(
        default=3,
        validation_alias=AliasChoices("CHAT_HISTORY_RECENT_TURNS"),
    )
    chat_history_latest_answer_tokens: int = Field(
        default=3000,
        validation_alias=AliasChoices("CHAT_HISTORY_LATEST_ANSWER_TOKENS"),
    )
    chat_history_older_answer_tokens: int = Field(
        default=700,
        validation_alias=AliasChoices("CHAT_HISTORY_OLDER_ANSWER_TOKENS"),
    )
    chat_summary_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("CHAT_SUMMARY_ENABLED"),
    )
    chat_summary_model: str = Field(
        default="gemini-3.8-flash",
        validation_alias=AliasChoices("CHAT_SUMMARY_MODEL"),
    )
    # minimal | low | medium | high (Gemini 3 models)
    chat_summary_thinking_level: str = Field(
        default="low",
        validation_alias=AliasChoices("CHAT_SUMMARY_THINKING_LEVEL"),
    )
    chat_summary_max_tokens: int = Field(
        default=1000,
        validation_alias=AliasChoices("CHAT_SUMMARY_MAX_TOKENS"),
    )
    chat_summary_timeout_s: float = Field(
        default=60.0,
        validation_alias=AliasChoices("CHAT_SUMMARY_TIMEOUT_S"),
    )
    # Background repair of OCR-fragmented chunks that retrieval turns up
    # (app/services/chunk_autoheal.py). Retrieval never waits for it; the clean text is
    # written back for the next question. false stops queuing repairs altogether.
    chunk_autoheal_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("CHUNK_AUTOHEAL_ENABLED"),
    )
    # The model that repairs a chunk, and how hard it thinks. Repair is copy-editing, so
    # thinking stays at its lowest: gemini-2.5-flash at its default thinking ran out of
    # output room on damaged chunks and its repairs were thrown away.
    # Gemini 3 levels: minimal | low | medium | high (gemini-3.7 has no "minimal").
    chunk_autoheal_model: str = Field(
        default="gemini-3.1-flash-lite",
        validation_alias=AliasChoices("CHUNK_AUTOHEAL_MODEL"),
    )
    chunk_autoheal_thinking_level: str = Field(
        default="minimal",
        validation_alias=AliasChoices("CHUNK_AUTOHEAL_THINKING_LEVEL"),
    )
    # Case facts learned from answers (app/services/memory/answer_facts.py): a small model
    # lists the facts an answer attributes to its cited documents, and each is kept only
    # if the document's stored text contains its numbers and names. Runs after the answer.
    # gemini-3.7-flash accepts low | medium | high, not minimal.
    memory_answer_facts_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("MEMORY_ANSWER_FACTS_ENABLED"),
    )
    memory_answer_facts_model: str = Field(
        default="gemini-3.1-flash-lite",
        validation_alias=AliasChoices("MEMORY_ANSWER_FACTS_MODEL"),
    )
    memory_answer_facts_thinking_level: str = Field(
        default="minimal",
        validation_alias=AliasChoices("MEMORY_ANSWER_FACTS_THINKING_LEVEL"),
    )
    # Reviewing a stretch of conversation as a whole (app/services/memory/synthesis.py):
    # keeps the case summary's Stage / Last action / Open items current, records decisions
    # reached over several messages, and suggests ways of working the advocate keeps asking
    # for. Runs every MEMORY_SYNTHESIS_EVERY_TURNS turns of a chat, and for an earlier chat
    # left unreviewed for MEMORY_SYNTHESIS_IDLE_MINUTES. Measured on a real 10-turn chat:
    # gemini-3.7-flash at "medium" named the right last action and skipped a saved rule;
    # gemini-3.1-flash-lite named an older action and re-suggested the saved rule.
    memory_synthesis_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("MEMORY_SYNTHESIS_ENABLED"),
    )
    memory_synthesis_every_turns: int = Field(
        default=5,
        validation_alias=AliasChoices("MEMORY_SYNTHESIS_EVERY_TURNS"),
    )
    memory_synthesis_idle_minutes: int = Field(
        default=30,
        validation_alias=AliasChoices("MEMORY_SYNTHESIS_IDLE_MINUTES"),
    )
    memory_synthesis_model: str = Field(
        default="gemini-3.7-flash",
        validation_alias=AliasChoices("MEMORY_SYNTHESIS_MODEL"),
    )
    memory_synthesis_thinking_level: str = Field(
        default="medium",
        validation_alias=AliasChoices("MEMORY_SYNTHESIS_THINKING_LEVEL"),
    )
    # Learning about the advocate across their cases (app/services/memory/profile.py):
    # suggests practice facts counted from their cases and standing instructions kept in
    # two or more cases. Suggestions only. At most once per MEMORY_PROFILE_INTERVAL_HOURS
    # per advocate, and whenever they press "Look across my cases".
    memory_profile_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("MEMORY_PROFILE_ENABLED"),
    )
    memory_profile_interval_hours: float = Field(
        default=24.0,
        validation_alias=AliasChoices("MEMORY_PROFILE_INTERVAL_HOURS"),
    )
    memory_profile_model: str = Field(
        default="gemini-3.7-flash",
        validation_alias=AliasChoices("MEMORY_PROFILE_MODEL"),
    )
    memory_profile_thinking_level: str = Field(
        default="medium",
        validation_alias=AliasChoices("MEMORY_PROFILE_THINKING_LEVEL"),
    )
    # What memory may send with one question (app/services/memory/assembly.py), in
    # estimated tokens. These are the caps each block always gets; a block that has
    # more to say may stretch into room the others left free, up to MEMORY_BLOCK_STRETCH
    # times its cap, and MEMORY_SUFFIX_TOKENS bounds the lot. Saved instructions are
    # never cut, whatever these say.
    memory_suffix_tokens: int = Field(
        default=10_000,
        validation_alias=AliasChoices("MEMORY_SUFFIX_TOKENS"),
    )
    memory_advocate_tokens: int = Field(
        default=800,
        validation_alias=AliasChoices("MEMORY_ADVOCATE_TOKENS"),
    )
    memory_summary_tokens: int = Field(
        default=1_500,
        validation_alias=AliasChoices("MEMORY_SUMMARY_TOKENS"),
    )
    memory_section_tokens: int = Field(
        default=2_500,
        validation_alias=AliasChoices("MEMORY_SECTION_TOKENS"),
    )
    memory_recall_tokens: int = Field(
        default=3_000,
        validation_alias=AliasChoices("MEMORY_RECALL_TOKENS"),
    )
    # Past-session recall by meaning (app/services/memory/chat_index.py): saved turns are
    # embedded after each answer, and a question that refers back is embedded within
    # MEMORY_RECALL_EMBED_TIMEOUT_S; past that, recall uses words only. Off: words only.
    memory_recall_semantic_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("MEMORY_RECALL_SEMANTIC_ENABLED"),
    )
    memory_recall_embedding_model: str = Field(
        default="gemini-embedding-001",
        validation_alias=AliasChoices("MEMORY_RECALL_EMBEDDING_MODEL"),
    )
    memory_recall_embed_timeout_s: float = Field(
        default=1.0,
        validation_alias=AliasChoices("MEMORY_RECALL_EMBED_TIMEOUT_S"),
    )
    # How far a block may stretch beyond its cap into room nobody else is using.
    # 1.0 switches stretching off and restores fixed per-block caps.
    memory_block_stretch: float = Field(
        default=3.0,
        validation_alias=AliasChoices("MEMORY_BLOCK_STRETCH"),
    )
    # Consolidation (app/services/memory/consolidate.py): near its ceiling, what JuriNex
    # remembers about the advocate is rewritten once as fewer, sharper lines, so memory
    # keeps growing instead of stopping at "full". The merge is grounded in the stored
    # words, re-validated line by line, and reversible.
    advocate_consolidate_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("ADVOCATE_CONSOLIDATE_ENABLED"),
    )
    # How full the set must be (0.5–1.0) before a merge is worth its model call.
    advocate_consolidate_at: float = Field(
        default=0.8,
        validation_alias=AliasChoices("ADVOCATE_CONSOLIDATE_AT"),
    )
    advocate_consolidate_model: str = Field(
        default="gemini-3.8-flash",
        validation_alias=AliasChoices("ADVOCATE_CONSOLIDATE_MODEL"),
    )
    # The quietest a merge may run again for one advocate, in seconds.
    advocate_consolidate_min_interval_s: float = Field(
        default=3600.0,
        validation_alias=AliasChoices("ADVOCATE_CONSOLIDATE_MIN_INTERVAL_S"),
    )
    # Instructions from chat (app/services/memory/writer.py) are counted, not saved on sight.
    # A rule the advocate words as one ("always", "from now on") is shown as a suggestion at
    # once and saved after MEMORY_RULE_SAVE_AFTER separate requests. A way of working asked
    # for without such words stays out of sight until MEMORY_RULE_SUGGEST_AFTER requests and
    # is saved after MEMORY_PATTERN_SAVE_AFTER (0 = never saved without the advocate accepting).
    memory_rule_save_after: int = Field(
        default=2,
        validation_alias=AliasChoices("MEMORY_RULE_SAVE_AFTER"),
    )
    memory_rule_suggest_after: int = Field(
        default=2,
        validation_alias=AliasChoices("MEMORY_RULE_SUGGEST_AFTER"),
    )
    memory_pattern_save_after: int = Field(
        default=3,
        validation_alias=AliasChoices("MEMORY_PATTERN_SAVE_AFTER"),
    )
    # Reading memory sits in the chat's critical path, so it is time-boxed; on
    # timeout the turn proceeds with no memory rather than stalling.
    memory_context_timeout_s: float = Field(
        default=2.5,
        validation_alias=AliasChoices("MEMORY_CONTEXT_TIMEOUT_S"),
    )
    # Writing happens after the answer has streamed, so it may take longer.
    memory_writer_timeout_s: float = Field(
        default=12.0,
        validation_alias=AliasChoices("MEMORY_WRITER_TIMEOUT_S"),
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, list):
                        return [str(item).strip() for item in parsed if str(item).strip()]
                except json.JSONDecodeError:
                    pass
            return [origin.strip() for origin in text.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def apply_derived_defaults(self) -> "Settings":
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
