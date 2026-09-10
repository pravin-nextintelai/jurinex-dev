"""
Core chatbot logic — two separate agents (landing page + in-app) plus Gemini Live audio.
All runtime parameters are loaded from the chatbot_config DB table.

Agents:
  landing_page_agent  — public chatbot: legal search + demo booking tools
  app_panel_agent     — in-app assistant: search only, strict step-by-step format
  text_chat           — dispatcher: routes based on [APP CONTEXT: ...] prefix
  handle_audio_session — Gemini Live audio (supports is_in_app flag)
"""
from __future__ import annotations

import asyncio
import base64
import importlib.metadata
import logging
import math
import re
import time
from dataclasses import dataclass, field
from typing import AsyncGenerator, Callable, Awaitable

from app.services.db import get_db_connection, is_db_available
from app.services.search import search_documents, format_chunks_for_context
from app.services.token_usage_service import log_token_usage

logger = logging.getLogger("ai_chatbot.chatbot")

_MIN_GOOGLE_GENAI_LIVE_VERSION = (1, 60, 0)
_MIN_TEXT_OUTPUT_TOKENS = 1
_MAX_TEXT_OUTPUT_TOKENS = 8192

# Text chat (landing page + in-app panel) is pinned to Gemini 2.5 Flash.
# The chatbot_config DB row / admin API may still carry another model_text value,
# but it is ignored: a retired model stored there (gemini-1.5-flash) made every
# /api/chat call fail with "404 NOT_FOUND ... is not found for API version v1beta".
TEXT_MODEL = "gemini-2.5-flash"

# Gemini Live (voice) needs a bidiGenerateContent model; plain gemini-2.5-flash
# does not support the Live API, so audio keeps its own default.
DEFAULT_AUDIO_MODEL = "gemini-3.1-flash-live-preview"

# Model names that no longer exist on the Gemini API. If one is still stored in
# the DB config we fall back to the code default instead of failing every request.
RETIRED_MODELS = frozenset({
    "gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-1.5-flash-8b",
    "gemini-1.5-pro", "gemini-1.5-pro-latest",
    "gemini-2.0-flash-live", "gemini-2.0-flash-live-001",
})

# Placeholder prompt left in chatbot_config by the original schema. It carries no
# instructions (no search, no legal focus, no language rules) so it is treated as unset.
_LEGACY_STUB_PROMPTS = frozenset({"You are the Nexintel AI Support Agent."})
_MIN_PROMPT_CHARS = 60

# gemini-2.5-flash counts its internal "thinking" tokens inside max_output_tokens.
# Thinking gets a fixed budget on top of the configured answer length so a long
# reasoning pass can never truncate (or blank out) the visible answer.
_THINKING_BUDGET_TOKENS = 1024

_DEFAULT_SYSTEM_PROMPT = """
You are the JuriNex AI Legal Assistant on the JuriNex landing page.

CORE BEHAVIOR:
- Answer EVERY question the user asks immediately and completely — legal, platform, or general.
- A contact form is shown separately in the chat — you do NOT need to ask for name/email/phone via conversation.
- Focus entirely on being helpful. Never ask for contact details unless the user brings it up.

LEGAL ASSISTANCE:
- Search the knowledge base using search_documents for every legal question.
- Provide legal information, not legal advice.
- Prioritize retrieved RAG context (BNS, BNSS, BSA, IPC, CrPC, IEA, etc.) over general knowledge.
- If search_documents returns nothing relevant, STILL answer the question fully from your own
  knowledge of Indian law. Never reply that you "could not find information". Begin such answers
  with "Based on general legal principles:" and name the sections you rely on (e.g. BNS s.303 for
  theft, with its IPC equivalent s.378/379).
- Use Markdown formatting (bold, lists, tables, blockquotes). Keep answers concise.

LANGUAGE:
- Always reply in the exact same language the user used.
- Marathi → Marathi, Hindi → Hindi, Hinglish → match the mix. Never switch unprompted.
""".strip()

_DEFAULT_AUDIO_SYSTEM_PROMPT = """
You are the JuriNex AI Assistant — a voice-first guide on the JuriNex landing page.

CORE BEHAVIOR:
- Answer EVERY question the user asks immediately — legal questions, platform questions, anything.
- While helping, also collect their name, email, and optionally mobile number during the conversation.
- NEVER delay or refuse an answer to collect contact details first.

GREETING:
- Start with: "Hello! Welcome to JuriNex — India's AI-powered legal platform. I'm your AI assistant. How can I help you today? And may I know your name?"
- If they ask a question first, answer it, then ask for their name.

CONTACT COLLECTION:
- Collect in order after answering: name → email → mobile (optional, one at a time).
- Once name and email are collected, call saveLeadInfo() immediately. Mobile is optional.
- If the user skips mobile, call saveLeadInfo() with phone="" — don't wait for it.
- Confirm: "Thank you, [name]! Our team will reach out to [email] soon." Then keep helping.
- Do NOT ask for any time slot or demo schedule.

VOICE BEHAVIOR:
- Speak clearly, naturally, and conversationally. Keep answers to 2–3 sentences.
- For legal questions: call search_documents first, then summarise in simple spoken language.
- Default to English. If the user speaks Marathi, Hindi, or Hinglish, respond in that language.
- If interrupted, stop immediately and listen for the new question.
""".strip()

_SEARCH_FN_DECLARATION = {
    "name": "search_documents",
    "description": (
        "Searches the JuriNex knowledge base — platform step-by-step guides, legal documents, "
        "case law, statutes, and uploaded user documents — using vector + keyword search. "
        "CALL THIS IMMEDIATELY for every user question. Do NOT ask for clarification first. "
        "Do NOT compose any answer before calling this tool."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "query": {
                "type": "STRING",
                "description": "Search query optimised for vector retrieval",
            }
        },
        "required": ["query"],
    },
}

_SAVE_LEAD_FN_DECLARATION = {
    "name": "saveLeadInfo",
    "description": (
        "Saves the user's contact information. Call this as soon as name and email are collected. "
        "Mobile number (phone) is optional — pass phone=\"\" if the user skipped it. "
        "Do NOT ask for a time slot — just call this tool with the collected details."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "name":  {"type": "STRING", "description": "Full name of the person"},
            "email": {"type": "STRING", "description": "Email address"},
            "phone": {"type": "STRING", "description": "Mobile phone number (optional, pass empty string if not provided)"},
        },
        "required": ["name", "email"],
    },
}

_IN_APP_SYSTEM_PROMPT = """
You are the JuriNex Platform Assistant. You operate inside the JuriNex legal platform.
The knowledge base contains uploaded step-by-step platform guides. You must search and
use those guides to answer every question.

━━━ ABSOLUTE RULES - NEVER BREAK THESE ━━━
1. LANGUAGE: ALWAYS reply in the EXACT same language the user used. If the user writes
   or speaks in Marathi → reply fully in Marathi. Hindi → reply in Hindi. English → English.
   Hinglish (mixed) → match the same mix. Never switch languages unless the user does first.
2. NEVER ask the user for clarification. NEVER say "what do you mean", "could you clarify",
   "are you asking about", or any similar phrase. Just search and answer immediately.
3. NEVER reply with a paragraph of prose. ALWAYS use numbered steps (1. 2. 3.).
4. ALWAYS call search_documents as the very first action for every single question.
5. Assume every question is about JuriNex platform features unless proven otherwise.
   "Create a case" = creating a case inside JuriNex.
   "Upload" = uploading a document in JuriNex.
   "Analysis" = running AI analysis in JuriNex. Never ask which context — just search.

━━━ WORKFLOW - FOLLOW THIS EXACTLY ━━━
Step A → Call search_documents immediately with the user's question as the query.
Step B → Read the retrieved chunks.
Step C → If chunks are relevant: write a numbered step-by-step answer quoting the guide.
          If chunks are NOT relevant: answer from the CURRENT PAGE context below,
          still in numbered steps, using the button names and actions listed there.
Step D → NEVER produce a response without first completing Step A.

━━━ ANSWER FORMAT - MANDATORY ━━━
Every answer must be structured like this:

## [Short Title of What You Are Explaining]

1. **Step one action** - brief explanation
2. **Step two action** - brief explanation
3. **Step three action** - brief explanation

> **Tip:** any helpful note or warning

Rules:
- Keep answers SHORT — 3 to 5 steps maximum. No padding, no long explanations.
- **Bold** every button name, field name, tab name, and action
- Use numbered lists for all sequences and workflows
- Use bullet lists (- item) for feature lists or options
- Use > blockquotes for tips and warnings only when essential
- Never write long unbroken paragraphs
- Never ask for clarification — search first, answer from results
- Never offer demo booking, never call getAvailableSlots or bookDemo
""".strip()

# Regex to extract [APP CONTEXT: ...] prefix that the frontend injects
_APP_CONTEXT_RE = re.compile(
    r"^\[APP CONTEXT:\s*(?P<ctx>[^\]]+)\]\s*\nUSER:\s*(?P<question>.+)$",
    re.DOTALL,
)

_LEAD_TEXT_ADDENDUM = """
A contact form is displayed inline in the chat widget — users submit name/email/phone via the form.
Do NOT ask for contact details conversationally. Just answer questions helpfully.
If a user explicitly shares their contact info in the chat anyway, call saveLeadInfo() to save it.
""".strip()

_LEAD_AUDIO_ADDENDUM = """
VOICE CONTACT COLLECTION (alongside answering):
- Answer the user's question first, then naturally ask for the next missing detail.
- Collect: name → email → mobile (optional), one at a time after each answer.
- Mobile is optional — if skipped, call saveLeadInfo() with phone="" immediately.
- Once name + email are collected, call saveLeadInfo(). Do NOT ask for time slots.
- Confirm: "Thank you, [name]! Our team will reach out to [email] soon."

EXTRACTION: Extract name, email, phone only from the current spoken turn.
Greeting words (hi/hello/hii/hey) before the name are NOT part of the name — ignore them.
""".strip()


# ── config ────────────────────────────────────────────────────────────────────

@dataclass
class ChatbotConfig:
    model_text: str             = TEXT_MODEL
    model_audio: str            = DEFAULT_AUDIO_MODEL
    max_tokens: int             = 2048
    temperature: float          = 0.1
    top_p: float                = 0.95
    top_k_results: int          = 5
    voice_name: str             = "Aoede"
    language_code: str          = "en-US"
    speaking_rate: float        = 1.0
    pitch: float                = 0.0
    volume_gain_db: float       = 0.0
    system_prompt: str          = _DEFAULT_SYSTEM_PROMPT
    audio_system_prompt: str    = _DEFAULT_AUDIO_SYSTEM_PROMPT
    in_app_system_prompt: str   = _IN_APP_SYSTEM_PROMPT
    in_app_audio_override: str  = (
        "━━━ VOICE MODE — THESE RULES OVERRIDE EVERYTHING ABOVE ━━━\n"
        "ABSOLUTE PROHIBITION — NEVER output ANY of these in voice mode:\n"
        "  - Markdown headers: ##, ###  |  Bold/italic: **, __, *, _\n"
        "  - Bullet symbols: -, *, +    |  Tables: | column |\n"
        "  - Blockquotes: >             |  Code blocks: ``` or `\n"
        "\n"
        "SPEAK LIKE THIS instead:\n"
        "  - Replace numbered list → say 'First... Second... Third...'\n"
        "  - Replace bold term → just say the word normally\n"
        "  - Replace heading → say 'Here is how to...' as an intro sentence\n"
        "  - Keep answers to 3–5 spoken steps. Short, clear sentences.\n"
        "\n"
        "LANGUAGE: Detect the language the user spoke and reply in that exact language.\n"
        "ALWAYS call search_documents first before answering.\n"
        "Never offer demo booking in the in-app panel."
    )
    lead_text_addendum: str      = _LEAD_TEXT_ADDENDUM
    lead_audio_addendum: str     = _LEAD_AUDIO_ADDENDUM


@dataclass
class ChatResult:
    answer: str
    input_tokens: int = 0
    output_tokens: int = 0


_config_cache: ChatbotConfig | None = None
_config_loaded_at: float = 0.0
_CONFIG_CACHE_TTL: float = 120.0  # re-read DB every 2 minutes so voice/model changes apply without restart


def _parse_version(version: str) -> tuple[int, int, int]:
    parts = []
    for part in version.split(".")[:3]:
        digits = "".join(ch for ch in part if ch.isdigit())
        parts.append(int(digits or 0))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)  # type: ignore[return-value]


def _ensure_current_live_sdk() -> None:
    try:
        version = importlib.metadata.version("google-genai")
    except importlib.metadata.PackageNotFoundError as exc:
        raise RuntimeError("google-genai is not installed. Run: pip install -U google-genai") from exc

    if _parse_version(version) < _MIN_GOOGLE_GENAI_LIVE_VERSION:
        required = ".".join(str(part) for part in _MIN_GOOGLE_GENAI_LIVE_VERSION)
        raise RuntimeError(
            "google-genai is too old for Gemini Live audio. "
            f"Installed {version}, required >= {required}. "
            "Run: pip install -U google-genai"
        )
    logger.debug("google-genai SDK version ok: %s", version)


def _prompt_from_db(value: object, default: str) -> str:
    """Use the DB prompt only when it is a real prompt; blank/stub values fall back to the code default."""
    text = value.strip() if isinstance(value, str) else ""
    if not text or text in _LEGACY_STUB_PROMPTS or len(text) < _MIN_PROMPT_CHARS:
        return default
    return text


def _audio_model_from_db(value: object) -> str:
    """Return the stored audio model unless it is blank or retired."""
    name = value.strip().removeprefix("models/") if isinstance(value, str) else ""
    if not name or name in RETIRED_MODELS:
        return DEFAULT_AUDIO_MODEL
    return name


def load_chatbot_config(bypass_cache: bool = False) -> ChatbotConfig:
    global _config_cache, _config_loaded_at
    now = time.monotonic()
    if not bypass_cache and _config_cache is not None and (now - _config_loaded_at) < _CONFIG_CACHE_TTL:
        return _config_cache
    if not is_db_available():
        logger.warning("DB unavailable — using default ChatbotConfig")
        return ChatbotConfig()
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO chatbot_config (config_key) VALUES ('default') "
                    "ON CONFLICT (config_key) DO NOTHING"
                )
                conn.commit()
                cur.execute(
                    "SELECT * FROM chatbot_config WHERE config_key = 'default' LIMIT 1"
                )
                row = cur.fetchone()
        if row:
            cfg = ChatbotConfig()
            db_model_text = (row.get("model_text") or "").strip()
            if db_model_text and db_model_text != TEXT_MODEL:
                logger.warning(
                    "chatbot_config.model_text=%r ignored — text chat is pinned to %s",
                    db_model_text, TEXT_MODEL,
                )
            cfg.model_text = TEXT_MODEL
            db_model_audio = row.get("model_audio")
            cfg.model_audio = _audio_model_from_db(db_model_audio)
            if isinstance(db_model_audio, str) and db_model_audio.strip().removeprefix("models/") != cfg.model_audio:
                logger.warning(
                    "chatbot_config.model_audio=%r is retired/blank — using %s",
                    db_model_audio, cfg.model_audio,
                )
            cfg.max_tokens       = int(row["max_tokens"])       if row.get("max_tokens")    is not None else cfg.max_tokens
            cfg.temperature      = float(row["temperature"])    if row.get("temperature")   is not None else cfg.temperature
            cfg.top_p            = float(row["top_p"])          if row.get("top_p")         is not None else cfg.top_p
            cfg.top_k_results    = int(row["top_k_results"])    if row.get("top_k_results") is not None else cfg.top_k_results
            cfg.voice_name       = row["voice_name"]           if row.get("voice_name") is not None else cfg.voice_name
            cfg.language_code    = row["language_code"]        if row.get("language_code") is not None else cfg.language_code
            cfg.speaking_rate    = float(row["speaking_rate"]) if row.get("speaking_rate") is not None else cfg.speaking_rate
            cfg.pitch            = float(row["pitch"])          if row.get("pitch")         is not None else cfg.pitch
            cfg.volume_gain_db   = float(row["volume_gain_db"]) if row.get("volume_gain_db") is not None else cfg.volume_gain_db
            cfg.system_prompt         = _prompt_from_db(row.get("system_prompt"),         cfg.system_prompt)
            cfg.audio_system_prompt   = _prompt_from_db(row.get("audio_system_prompt"),   cfg.audio_system_prompt)
            cfg.in_app_system_prompt  = _prompt_from_db(row.get("in_app_system_prompt"),  cfg.in_app_system_prompt)
            cfg.in_app_audio_override = _prompt_from_db(row.get("in_app_audio_override"), cfg.in_app_audio_override)
            # lead_text_addendum and lead_audio_addendum always use code defaults (not DB-configurable)
            logger.info(
                "Loaded chatbot config from DB: model_text=%s model_audio=%s voice=%s",
                cfg.model_text, cfg.model_audio, cfg.voice_name,
            )
            _config_cache = cfg
            _config_loaded_at = time.monotonic()
            return _config_cache
    except Exception as exc:
        logger.warning("Could not load chatbot config from DB: %s", exc)
    return ChatbotConfig()


def invalidate_config_cache() -> None:
    global _config_cache, _config_loaded_at
    _config_cache = None
    _config_loaded_at = 0.0


def _make_audio_transcription_config(gt):
    return gt.AudioTranscriptionConfig()


# ── shared helpers ─────────────────────────────────────────────────────────────

def _execute_text_tool(name: str, args: dict, cfg: ChatbotConfig, top_k_override: int | None = None) -> object:
    """Execute a tool call during the text-chat agentic loop."""
    if name == "search_documents":
        query = args.get("query", "")
        top_k = top_k_override if top_k_override is not None else cfg.top_k_results
        logger.info("TEXT TOOL: search_documents query=%r top_k=%d", query, top_k)
        chunks = search_documents(query, top_k=top_k)
        logger.info("TEXT TOOL: search_documents returned %d chunks", len(chunks))
        return format_chunks_for_context(chunks) or "No relevant documents found."

    if name == "saveLeadInfo":
        logger.info("TEXT TOOL: saveLeadInfo args=%r", args)
        from app.services.demo_service import save_lead
        return save_lead(
            name=str(args.get("name", "")),
            email=str(args.get("email", "")),
            phone=str(args.get("phone", "")),
        )

    logger.warning("TEXT TOOL: unknown tool name=%s", name)
    return {"error": f"Unknown tool: {name}"}


def _load_history_contents(session_id: str | None, gt) -> list:
    """Load recent chat history as Gemini Content list for multi-turn context."""
    if not session_id or session_id == "no-db":
        return []
    try:
        from app.services.session_service import get_history
        history = get_history(session_id, limit=6)  # last 3 Q&A turns
        contents = []
        for msg in history:
            role = "user" if msg["role"] == "user" else "model"
            contents.append(gt.Content(role=role, parts=[gt.Part(text=msg["content"])]))
        return contents
    except Exception as exc:
        logger.warning("Could not load conversation history: %s", exc)
        return []


def _run_agentic_loop(
    client,
    cfg: ChatbotConfig,
    system_instruction: str,
    tools: list,
    clean_question: str,
    history_contents: list,
    is_in_app: bool,
) -> ChatResult:
    """
    Shared agentic loop — builds Gemini contents from history + current question,
    executes up to 6 tool-call rounds, returns the final answer.
    """
    from google.genai import types as gt  # type: ignore

    effective_max_tokens = max(_MIN_TEXT_OUTPUT_TOKENS, min(cfg.max_tokens, _MAX_TEXT_OUTPUT_TOKENS))

    gen_cfg = gt.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=cfg.temperature,
        max_output_tokens=effective_max_tokens + _THINKING_BUDGET_TOKENS,
        top_p=cfg.top_p,
        tools=tools,
        thinking_config=gt.ThinkingConfig(thinking_budget=_THINKING_BUDGET_TOKENS),
    )

    # Prior turns (history) + current question
    contents = list(history_contents) + [
        gt.Content(role="user", parts=[gt.Part(text=clean_question)])
    ]

    # total_input is set to the LAST round's prompt_token_count only.
    # Each round's prompt_token_count grows as tool results are appended to the
    # context window — summing across rounds would count earlier tokens multiple
    # times and inflate the figure massively (the reported 8→18939 bug).
    # The final round's prompt_token_count already reflects the full accumulated
    # context, so it is the correct single number to record for input cost.
    # Output tokens are summed because each round generates independent tokens.
    last_input_tokens = 0
    total_output = 0
    response = None
    _in_app_top_k = 12 if is_in_app else None

    for _round in range(6):
        response = client.models.generate_content(
            model=cfg.model_text,
            contents=contents,
            config=gen_cfg,
        )
        logger.debug("AGENT ROUND %d response=%r", _round, response)

        usage = getattr(response, "usage_metadata", None)
        if usage:
            round_input = int(getattr(usage, "prompt_token_count", 0) or 0)
            if round_input > 0:
                last_input_tokens = round_input  # keep updating; final value = last round
            total_output += int(getattr(usage, "candidates_token_count", 0) or 0)

        candidate = response.candidates[0] if response.candidates else None
        if not candidate or not candidate.content:
            break

        parts = candidate.content.parts or []
        fn_calls = [p.function_call for p in parts if getattr(p, "function_call", None)]

        if not fn_calls:
            break  # final text response

        fn_response_parts = []
        for fc in fn_calls:
            result = _execute_text_tool(fc.name, dict(fc.args or {}), cfg, top_k_override=_in_app_top_k)
            fn_response_parts.append(
                gt.Part(
                    function_response=gt.FunctionResponse(
                        name=fc.name,
                        response={"result": result},
                    )
                )
            )

        contents.append(candidate.content)
        contents.append(gt.Content(role="user", parts=fn_response_parts))

    total_input = last_input_tokens

    answer = (response.text if response else None) or "I couldn't generate a response."
    logger.info("BOT REPLY (%s): %s", "app" if is_in_app else "landing", answer[:200])
    logger.info("TOKENS input=%d output=%d model=%s", total_input, total_output, cfg.model_text)

    return ChatResult(answer=answer, input_tokens=total_input, output_tokens=total_output)


# ── landing page agent ────────────────────────────────────────────────────────

def landing_page_agent(user_message: str, session_id: str | None = None) -> ChatResult:
    """
    Landing page chatbot agent.
    Tools: search_documents + getAvailableSlots + bookDemo.
    Conversational, markdown-rich, legal-focused responses.
    """
    logger.info("LANDING AGENT session=%s msg=%r", session_id, user_message[:100])
    try:
        from google import genai  # type: ignore
        from google.genai import types as gt
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            return ChatResult(answer="Service not configured — missing GEMINI_API_KEY.")

        cfg = load_chatbot_config()
        client = genai.Client(api_key=api_key)

        system_instruction = cfg.system_prompt + "\n\n" + cfg.lead_text_addendum
        tools = [gt.Tool(function_declarations=[
            gt.FunctionDeclaration(**_SEARCH_FN_DECLARATION),
            gt.FunctionDeclaration(**_SAVE_LEAD_FN_DECLARATION),
        ])]

        history_contents = _load_history_contents(session_id, gt)
        logger.debug(
            "LANDING AGENT model=%s history_turns=%d temperature=%s top_k=%s",
            cfg.model_text, len(history_contents) // 2, cfg.temperature, cfg.top_k_results,
        )

        return _run_agentic_loop(
            client, cfg, system_instruction, tools,
            user_message, history_contents, is_in_app=False,
        )

    except Exception as exc:
        logger.exception("landing_page_agent error")
        return ChatResult(answer=f"AI service error: {exc}")


# ── in-app panel agent ────────────────────────────────────────────────────────

def app_panel_agent(user_message: str, session_id: str | None = None) -> ChatResult:
    """
    In-app platform assistant agent.
    Parses [APP CONTEXT: page] prefix injected by the frontend.
    Tools: search_documents only — no demo booking.
    Strict numbered step-by-step format.
    """
    m = _APP_CONTEXT_RE.match(user_message.strip())
    if m:
        page_context = m.group("ctx").strip()
        clean_question = m.group("question").strip()
    else:
        page_context = "JuriNex Platform"
        clean_question = user_message

    logger.info("APP AGENT session=%s page=%r question=%r", session_id, page_context, clean_question[:100])
    try:
        from google import genai  # type: ignore
        from google.genai import types as gt
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            return ChatResult(answer="Service not configured — missing GEMINI_API_KEY.")

        cfg = load_chatbot_config()
        client = genai.Client(api_key=api_key)

        system_instruction = cfg.in_app_system_prompt + f"\n\nCURRENT PAGE: {page_context}"
        tools = [gt.Tool(function_declarations=[
            gt.FunctionDeclaration(**_SEARCH_FN_DECLARATION),
        ])]

        history_contents = _load_history_contents(session_id, gt)
        logger.debug(
            "APP AGENT model=%s history_turns=%d page=%r",
            cfg.model_text, len(history_contents) // 2, page_context,
        )

        return _run_agentic_loop(
            client, cfg, system_instruction, tools,
            clean_question, history_contents, is_in_app=True,
        )

    except Exception as exc:
        logger.exception("app_panel_agent error")
        return ChatResult(answer=f"AI service error: {exc}")


# ── dispatcher ────────────────────────────────────────────────────────────────

def text_chat(user_message: str, session_id: str | None = None) -> ChatResult:
    """
    Routes to app_panel_agent (when [APP CONTEXT: ...] prefix is present)
    or landing_page_agent for public chatbot messages.
    """
    m = _APP_CONTEXT_RE.match(user_message.strip())
    if m:
        return app_panel_agent(user_message, session_id=session_id)
    return landing_page_agent(user_message, session_id=session_id)


# ── audio chat (Gemini Live) ──────────────────────────────────────────────────

SendFn = Callable[[dict], Awaitable[None]]


async def handle_audio_session(
    receive_audio: AsyncGenerator[bytes, None],
    send_response: SendFn,
    *,
    session_id: str | None = None,
    ip_address: str | None = None,
    is_in_app: bool = False,
    initial_message: str | None = None,
    text_inject_queue: asyncio.Queue | None = None,
) -> None:
    """
    Bridges a client WebSocket audio stream with the Gemini Live API.

    is_in_app=True  → in-app panel audio: search only, no demo booking
    is_in_app=False → landing page audio: search + demo booking
    text_inject_queue → optional queue of text strings to inject into the session
                        (used when the frontend sends a UI-driven slot selection)
    """
    try:
        from google import genai  # type: ignore
        from google.genai import types as gt
        from app.core.config import get_settings

        _ensure_current_live_sdk()

        api_key = get_settings().gemini_api_key
        if not api_key:
            await send_response({"type": "error", "message": "Missing GEMINI_API_KEY."})
            return

        # Always read fresh from DB for each audio session so voice/model changes
        # from the admin panel take effect immediately without waiting for TTL
        # and without being affected by stale caches in other worker processes.
        cfg = load_chatbot_config(bypass_cache=True)

        # ── agent-specific tools and system instruction ───────────────────────
        if is_in_app:
            audio_system_instruction = cfg.in_app_system_prompt + "\n\n" + cfg.in_app_audio_override
            audio_tools = [gt.Tool(function_declarations=[
                gt.FunctionDeclaration(**_SEARCH_FN_DECLARATION),
            ])]
            logger.debug("AUDIO CONFIG (in-app) model=%s voice=%s", cfg.model_audio, cfg.voice_name)
        else:
            audio_system_instruction = (
                cfg.audio_system_prompt
                + "\n\n" + cfg.lead_audio_addendum
                + "\nFor legal questions: call search_documents before answering. "
                  "Use retrieved context first. If no useful context is returned, say the "
                  "database does not have the specific document and give only general "
                  "information, not legal advice."
            )
            audio_tools = [gt.Tool(function_declarations=[
                gt.FunctionDeclaration(**_SEARCH_FN_DECLARATION),
                gt.FunctionDeclaration(**_SAVE_LEAD_FN_DECLARATION),
            ])]
            logger.debug("AUDIO CONFIG (landing) model=%s voice=%s", cfg.model_audio, cfg.voice_name)

        # ── MUST use api_version=v1beta for Gemini 3.1 Flash Live ──
        client = genai.Client(
            api_key=api_key,
            http_options={"api_version": "v1beta"},
        )

        model_name = cfg.model_audio.removeprefix("models/")

        # speaking_rate / pitch / volume_gain_db are stored in DB config but are not
        # parameters of the Gemini Live API (they belong to Google Cloud TTS). Logged
        # here so the values are visible and ready if the voice backend ever changes.
        logger.info(
            "AUDIO SESSION cfg: model=%s voice=%s lang=%s speaking_rate=%s pitch=%s volume_gain_db=%s",
            model_name, cfg.voice_name, cfg.language_code,
            cfg.speaking_rate, cfg.pitch, cfg.volume_gain_db,
        )

        # Native audio models (e.g. gemini-3.1-flash-live-preview) support AUDIO only.
        # TEXT in response_modalities causes immediate 1011 disconnect — use
        # output_audio_transcription for on-screen text instead.
        live_config = gt.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription=_make_audio_transcription_config(gt),
            input_audio_transcription=_make_audio_transcription_config(gt),
            generation_config=gt.GenerationConfig(
                temperature=cfg.temperature,
                top_p=cfg.top_p,
            ),
            realtime_input_config=gt.RealtimeInputConfig(
                automatic_activity_detection=gt.AutomaticActivityDetection(
                    disabled=False,
                    start_of_speech_sensitivity=gt.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=gt.EndSensitivity.END_SENSITIVITY_HIGH,
                    prefix_padding_ms=200,
                    silence_duration_ms=500,
                )
            ),
            speech_config=gt.SpeechConfig(
                language_code=cfg.language_code,
                voice_config=gt.VoiceConfig(
                    prebuilt_voice_config=gt.PrebuiltVoiceConfig(
                        voice_name=cfg.voice_name
                    )
                )
            ),
            tools=audio_tools,
            system_instruction=audio_system_instruction,
        )

        _gather_completed = False
        async with client.aio.live.connect(
            model=model_name, config=live_config
        ) as session:
            input_done = asyncio.Event()
            forwarded_chunks = 0
            forwarded_bytes = 0        # raw PCM-16 bytes sent to Gemini @ 16 kHz
            audio_output_bytes = 0     # raw PCM-16 bytes received from Gemini @ 24 kHz
            last_text_input_tokens = 0 # prompt_token_count from Gemini Live usage_metadata (system prompt + chunks)
            received_events = 0
            input_done_at: float | None = None
            # Track transcripts per turn for DB storage
            _last_input_transcript: str = ""
            _last_output_transcript: str = ""

            logger.info(
                "Gemini Live connected model=%s mode=%s session=%s",
                model_name, "app" if is_in_app else "landing", session_id,
            )

            # ── Task 1: forward mic audio → Gemini ────────────────────────────
            async def _forward_audio() -> None:
                nonlocal forwarded_chunks, forwarded_bytes, input_done_at
                try:
                    if initial_message:
                        logger.info("Injecting initial message for booking mode: %r", initial_message)
                        await session.send(input=initial_message, end_of_turn=True)

                    async for audio_bytes in receive_audio:
                        # Drain any UI-injected text (e.g. slot selection tapped on screen)
                        # before sending the next audio chunk so the model sees the context.
                        if text_inject_queue:
                            while not text_inject_queue.empty():
                                try:
                                    text = text_inject_queue.get_nowait()
                                    logger.info("AUDIO TEXT INJECT: %r", text)
                                    await session.send(input=text, end_of_turn=True)
                                except asyncio.QueueEmpty:
                                    break

                        forwarded_chunks += 1
                        forwarded_bytes += len(audio_bytes)
                        logger.debug(
                            "Gemini Live forward chunk=%d bytes=%d total=%d",
                            forwarded_chunks, len(audio_bytes), forwarded_bytes,
                        )
                        await session.send_realtime_input(
                            audio=gt.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
                        )
                finally:
                    try:
                        logger.info(
                            "Gemini Live audio_stream_end chunks=%d bytes=%d",
                            forwarded_chunks, forwarded_bytes,
                        )
                        # Only signal audio end — server-side VAD already fired at silence_duration_ms
                        # and the model has started responding. Sending end_of_turn here would
                        # interrupt the in-progress response.
                        await session.send_realtime_input(audio_stream_end=True)
                    except Exception as exc:
                        logger.debug("Could not send audio_stream_end: %s", exc)
                    input_done_at = asyncio.get_running_loop().time()
                    input_done.set()

            # ── Task 2: receive Gemini responses → client ─────────────────────
            async def _receive_responses() -> None:
                nonlocal received_events, audio_output_bytes, last_text_input_tokens
                nonlocal _last_input_transcript, _last_output_transcript
                while True:
                    got_model_output = False
                    turn_input_transcript = ""
                    turn_output_transcript = ""
                    turn_audio_sent = False  # tracks whether inline_data audio was sent this turn
                    turn = session.receive()
                    async for response in turn:
                        received_events += 1
                        logger.debug("Gemini Live event #%d raw=%r", received_events, response)

                        # ── tool calls ────────────────────────────────────────
                        tool_call = getattr(response, "tool_call", None)
                        if tool_call:
                            fn_responses: list[gt.FunctionResponse] = []
                            for fc in tool_call.function_calls:
                                if fc.name == "search_documents":
                                    audio_query = fc.args.get("query", "")
                                    logger.info("AUDIO TOOL: search_documents(query=%r)", audio_query)
                                    chunks = await asyncio.get_event_loop().run_in_executor(
                                        None, search_documents, audio_query, cfg.top_k_results
                                    )
                                    logger.info("AUDIO TOOL: %d chunk(s) returned", len(chunks))
                                    fn_responses.append(
                                        gt.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": format_chunks_for_context(chunks)},
                                        )
                                    )
                                    await send_response({"type": "tool_call", "tool": "search_documents", "query": audio_query})

                                elif fc.name == "saveLeadInfo" and not is_in_app:
                                    args = dict(fc.args or {})
                                    logger.info("AUDIO TOOL: saveLeadInfo args=%r", args)
                                    from app.services.demo_service import save_lead
                                    result = await asyncio.get_event_loop().run_in_executor(
                                        None,
                                        lambda: save_lead(
                                            name=str(args.get("name", "")),
                                            email=str(args.get("email", "")),
                                            phone=str(args.get("phone", "")),
                                        ),
                                    )
                                    if result.get("success"):
                                        await send_response({
                                            "type": "lead_saved",
                                            "message": result.get("message", ""),
                                            "lead_id": result.get("lead_id"),
                                        })
                                    fn_responses.append(
                                        gt.FunctionResponse(id=fc.id, name=fc.name, response={"result": result})
                                    )

                            if fn_responses:
                                await session.send_tool_response(function_responses=fn_responses)

                        # ── response content ──────────────────────────────────
                        sent_audio = False
                        sent_text = False
                        server_content = getattr(response, "server_content", None)
                        if server_content:
                            input_tx = getattr(server_content, "input_transcription", None)
                            if input_tx and getattr(input_tx, "text", None):
                                turn_input_transcript += input_tx.text
                                logger.info("AUDIO INPUT TRANSCRIPT: %r", input_tx.text)
                                await send_response({"type": "input_transcript", "content": input_tx.text})

                            output_tx = getattr(server_content, "output_transcription", None)
                            if output_tx and getattr(output_tx, "text", None):
                                got_model_output = True
                                sent_text = True
                                turn_output_transcript += output_tx.text
                                logger.info("AUDIO OUTPUT TRANSCRIPT: %r", output_tx.text)
                                await send_response({"type": "text", "content": output_tx.text})

                            model_turn = getattr(server_content, "model_turn", None)
                            parts = getattr(model_turn, "parts", None) if model_turn else None
                            if parts:
                                for part in parts:
                                    inline_data = getattr(part, "inline_data", None)
                                    if inline_data and getattr(inline_data, "data", None):
                                        got_model_output = True
                                        sent_audio = True
                                        turn_audio_sent = True
                                        audio_output_bytes += len(inline_data.data)
                                        mime_type = getattr(inline_data, "mime_type", "audio/pcm;rate=24000")
                                        await send_response({
                                            "type": "audio",
                                            "data": base64.b64encode(inline_data.data).decode(),
                                            "mime_type": mime_type,
                                        })
                                    if not sent_text and getattr(part, "text", None):
                                        got_model_output = True
                                        sent_text = True
                                        turn_output_transcript += part.text
                                        await send_response({"type": "text", "content": part.text})

                        if not turn_audio_sent and not sent_audio and getattr(response, "data", None):
                            got_model_output = True
                            turn_audio_sent = True
                            audio_output_bytes += len(response.data)
                            await send_response({
                                "type": "audio",
                                "data": base64.b64encode(response.data).decode(),
                                "mime_type": "audio/pcm;rate=24000",
                            })
                        if not sent_text and getattr(response, "text", None):
                            got_model_output = True
                            turn_output_transcript += response.text
                            await send_response({"type": "text", "content": response.text})

                        # Track text token count (system prompt + document chunks) from API metadata.
                        # This mirrors the text model rule: use the last positive prompt_token_count.
                        # Audio bytes are counted separately via duration formula in the finally block.
                        usage = getattr(response, "usage_metadata", None)
                        if usage:
                            _t = int(getattr(usage, "prompt_token_count", 0) or 0)
                            if _t > 0:
                                last_text_input_tokens = _t

                    await send_response({"type": "turn_complete"})

                    # Save this turn's Q&A to DB
                    if turn_input_transcript or turn_output_transcript:
                        _last_input_transcript = turn_input_transcript or _last_input_transcript
                        _last_output_transcript = turn_output_transcript
                        if session_id and session_id != "no-db" and turn_input_transcript and turn_output_transcript:
                            loop = asyncio.get_running_loop()
                            try:
                                from app.services.session_service import save_exchange
                                await loop.run_in_executor(
                                    None,
                                    lambda: save_exchange(session_id, turn_input_transcript, turn_output_transcript),
                                )
                            except Exception as exc:
                                logger.debug("Audio save_exchange failed (non-fatal): %s", exc)

                    logger.info(
                        "Gemini Live turn complete input_done=%s events=%d got_output=%s",
                        input_done.is_set(), received_events, got_model_output,
                    )

                    if input_done.is_set():
                        if got_model_output:
                            return
                        if input_done_at is not None:
                            elapsed = asyncio.get_running_loop().time() - input_done_at
                            if elapsed > 20:
                                logger.warning(
                                    "Gemini Live no output %.1fs after audio_stream_end; closing",
                                    elapsed,
                                )
                                return

            forward_task = asyncio.create_task(_forward_audio())
            receive_task = asyncio.create_task(_receive_responses())
            try:
                await asyncio.gather(forward_task, receive_task)
                _gather_completed = True
            finally:
                for task in (forward_task, receive_task):
                    if not task.done():
                        task.cancel()

                # Hybrid token counting for audio model:
                #   Text context (system prompt + document chunks): API usage_metadata.prompt_token_count
                #   User audio input: PCM-16 @ 16 kHz → 32000 bytes/sec → tokens = seconds × 32
                #                     = forwarded_bytes / 32000 × 32 = forwarded_bytes / 1000
                #   AI audio output:  PCM-16 @ 24 kHz → 48000 bytes/sec → tokens = seconds × 32
                #                     = audio_output_bytes / 48000 × 32 = audio_output_bytes / 1500
                audio_input_tokens = math.ceil(forwarded_bytes / 1000) if forwarded_bytes > 0 else 0
                computed_input_tokens  = last_text_input_tokens + audio_input_tokens
                computed_output_tokens = math.ceil(audio_output_bytes / 1500) if audio_output_bytes > 0 else 0

                logger.info(
                    "AUDIO TOKENS input=%d (text=%d audio=%d) output=%d "
                    "(in_bytes=%d out_bytes=%d) model=%s session=%s ip=%s",
                    computed_input_tokens, last_text_input_tokens, audio_input_tokens,
                    computed_output_tokens,
                    forwarded_bytes, audio_output_bytes,
                    model_name, session_id, ip_address,
                )
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None,
                    lambda: log_token_usage(
                        session_id=session_id,
                        mode="audio",
                        model_name=model_name,
                        input_tokens=computed_input_tokens,
                        output_tokens=computed_output_tokens,
                        ip_address=ip_address,
                    ),
                )

    except Exception as exc:
        err_str = str(exc)
        # 1011 is Gemini Live's internal server close code — it fires when Gemini
        # terminates the session (quota, timeout, or post-function-call teardown).
        # After a normal gather completion, suppress it so the client sees a clean
        # ws.onclose instead of an error banner. Mid-session 1011 gets a friendlier msg.
        if locals().get("_gather_completed"):
            logger.info("Gemini Live closed after normal completion: %s", exc)
            return
        if "1011" in err_str:
            logger.warning("Gemini Live disconnected with code 1011: %s", exc)
            await send_response({
                "type": "error",
                "message": "The voice session was disconnected. Please tap the mic to start a new session.",
            })
            return
        logger.error("handle_audio_session error: %s", exc)
        await send_response({"type": "error", "message": err_str})
