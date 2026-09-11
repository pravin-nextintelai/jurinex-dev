"""Post-turn memory writer: file what each chat turn established, as it happens.

After an answer has been delivered, this module reads the advocate's latest
message and decides whether anything durable belongs in the case's memory
("write during the session, not at the end" — guide section 5.2).

What it may write
    [stated]  a durable fact or decision the advocate stated in their message
    [status]  a change in the state of the work: a draft generated, accepted or
              sent back for revision
    a case instruction
              a standing rule the advocate gave in so many words ("from now on,
              answer in a table"). It is appended to the case's instructions,
              recorded so it can be undone, and reported back to the chat.

What it never writes
    [extracted]  a chat answer is AI output, not the document itself. Document
                 facts come from seeding, which reads the grounded chronology and
                 the documents, and which this writer keeps current.
    [inferred]   never, anywhere.

Guards, in order
1. Skips: memory or memory generation switched off, no real user, learning mode
   or deep research, a preset or saved prompt instead of the advocate's own words,
   greetings and very short messages.
2. The extractor returns JSON ops. Only `append_line` and `replace_line` are
   accepted: the pipeline never rewrites, creates or deletes a section, because
   that silently drops lines the advocate or seeding wrote.
3. Grounding: every line must share real words with the advocate's own message,
   so a claim that appeared only in the assistant's answer cannot be filed as
   something the advocate said.
4. The shared validator: tags, caps, personal identifiers, inference language,
   sensitive details, and dedupe that keeps a changed fact's earlier value.
5. Version tokens on every write. On a conflict the section is reloaded,
   re-checked and retried once, then dropped.

Standing rules
    An instruction is saved by itself only when the advocate's message states it
    as a rule ("always", "never", "from now on" …) and the extractor's wording of
    the rule keeps that word, the case-instructions switch is on, and the
    advocate has not already undone the same instruction. Anything else that
    reads as a rule — a preference for all their work, a request they keep
    repeating — becomes a suggestion for the advocate to accept or dismiss.

Everything here runs on the writer's own threads after the answer is out, and
nothing raises into the chat.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Sequence

from pydantic import ValidationError

from app.core.config import get_settings
from app.services.memory import repository
from app.services.memory.recall import RecallHit, recent_turns
from app.services.memory.repository import VersionConflict
from app.services.memory.schemas import (
    MAX_LINE_CHARS,
    MAX_OPS_PER_TURN,
    SECTIONS,
    MemoryOp,
    MemoryOps,
    MemoryProposal,
    MemorySettings,
)
from app.services.memory.scope import CaseScope, is_real_user
from app.services.memory.seed import refresh_seed
from app.services.memory.validator import (
    ResolvedOp,
    case_over_cap,
    find_duplicate,
    normalize_for_compare,
    redact_or_reject_pii,
    validate_instructions,
    validate_line,
    validate_ops,
    validate_preferences,
)

logger = logging.getLogger("agentic_document_service.memory.writer")

EXTRACTION_AGENT = "memory_extraction_agent"
WRITER_ACTOR = "memory-writer"
MIN_MESSAGE_CHARS = 12
ANSWER_CONTEXT_CHARS = 2_500
PREVIOUS_ANSWER_CHARS = 1_200
EARLIER_REQUEST_CHARS = 200
MAX_EARLIER_REQUESTS = 8
RECENT_TURNS = 12
SNAPSHOT_CHARS = 6_000
MAX_PROPOSALS_PER_TURN = 3
EXTRACTOR_TIMEOUT_MS = 20_000
EXTRACTOR_MAX_OUTPUT_TOKENS = 4_096
GROUNDING_MIN_RATIO = 0.34
WRITER_OPS = frozenset({"append_line", "replace_line"})
SKIP_MODES = frozenset({"learning", "deep_research"})

# Two threads: extraction is one short model call per turn, and a queue is
# better than letting memory compete with answer generation for workers.
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="memory-writer")

GREETING_RE = re.compile(
    r"^\s*(?:hi+|hello|hey|thanks?|thank\s+you|thx|ok(?:ay)?|good\s+(?:morning|afternoon|evening|night)|"
    r"bye|cool|great|nice|done|yes|no|sure|got\s+it|noted)\b[\s!.,?]*$",
    re.IGNORECASE,
)

# Words that make a request a standing rule rather than a one-off. A rule is
# saved by itself only when the advocate's message AND the extractor's wording
# of the rule both carry one, so a stray "never" in a statement of fact cannot
# turn an ordinary request into a standing order.
STANDING_RULE_RE = re.compile(
    r"\b(?:always|never|from\s+now\s+on|going\s+forward|hence\s*forth|hereafter|"
    r"in\s+(?:the\s+)?future|every\s+time|each\s+time|whenever|by\s+default|as\s+a\s+rule|"
    r"remember\s+to|(?:don'?t|do\s+not)\s+ever|"
    r"throughout\s+(?:this|the)\s+(?:case|matter)|for\s+the\s+rest\s+of\s+(?:this|the)\s+(?:case|matter)|"
    r"(?:in|for)\s+(?:all|every)\s+(?:future\s+|my\s+|your\s+)?"
    r"(?:answers?|repl(?:y|ies)|responses?|drafts?|summar(?:y|ies)|outputs?|chats?|documents?))\b",
    re.IGNORECASE,
)


def has_standing_rule(text: str | None) -> bool:
    """True when the text states a rule for how to work from here on."""
    return bool(STANDING_RULE_RE.search(str(text or "")))


# ── The extractor's instructions ─────────────────────────────────────────────

EXTRACTOR_PROMPT = """\
You maintain the memory file for ONE legal case. After each exchange you decide
whether the advocate's latest message contains anything durable that belongs in
that file, or a standing rule for how to work on the case. You return JSON only.

WHAT YOU MAY RECORD
- tag "stated": a durable fact or decision the advocate states or confirms in
  THEIR message.
- tag "status": a change in the state of the work that the advocate states, such
  as a draft accepted, a revision requested, or a filing made.
Record nothing from the assistant's answer. It is shown only so you can tell what
the advocate is replying to. A fact that appears only in the answer is not the
advocate's statement, even if it is correct.
Never use the tag "extracted". Never record anything as inferred.

SHORT REPLIES
When the advocate's message answers a question in the PREVIOUS ASSISTANT MESSAGE
("Which court will this be filed in?" -> "The High Court of Bombay"), use that
question to understand the reply, and record the fact in the advocate's words,
for example "Court: The High Court of Bombay".

SECTIONS
summary (parties, stage, last action, open items), facts, parties, documents,
drafting_log, decisions, dates.
A decision hidden inside a request goes in "decisions": "go with the caregiver
ground and draft it" records the decision to use the caregiver ground.

RULES
1. Durable only. "The hearing is on 14 October" is durable. "I will look at this
   after lunch" and "be brief today" are not.
2. Calibrate to the evidence. Hedged, hypothetical or questioning statements are
   not facts. A single passing mention is recorded as a mention, never promoted to
   something like "central to the defence".
3. Update, do not duplicate. If a line in CURRENT CASE MEMORY already covers the
   fact, use "replace_line" with that line's id in "line_id". Set "changed": true
   when the fact itself changed, so its earlier value is kept.
4. Use only "append_line" and "replace_line". Never rewrite, create or delete a
   section.
5. Keep the advocate's own wording where you can. One fact per line, plain text,
   at most 300 characters.
6. Never record: the assistant's suggestions, options it offered, its analysis or
   draft text; greetings; questions; Aadhaar, PAN, bank or card numbers; anyone
   who is not part of this case.
7. Set "sensitive": true for health, financial, family or criminal-record details.
8. A request for an answer ("give me a detailed summary", "list the dates") is
   not a fact. Record nothing for it unless the message also states a fact or a
   decision.

STANDING RULES
A rule for how to work, rather than a fact about the case, is never a memory
line. Put it in "proposals", written as a short instruction in the advocate's
own words:
- kind "instruction" for this case, such as "Refer to my client as the
  Applicant" or "From now on, answer in a table";
- kind "preference" for all of the advocate's work, such as "In all my matters,
  cite SCC first".
Propose a rule when the advocate states one ("always", "never", "from now on",
"going forward", "every time", "remember to"), and keep that word in the
proposal. Also propose one when the latest message repeats a formatting or style
request that appears in EARLIER REQUESTS, such as asking for a table again; word
it the way the advocate asked, without adding "always". A one-off request about
this answer alone is not a rule.

LIMITS
At most 8 ops and 3 proposals. If nothing qualifies, return
{"ops": [], "proposals": [], "nothing_durable": true}.

Each op looks like:
{"op": "append_line", "section": "facts", "line_id": null, "match_text": null,
 "reason": "short reason", "lines": [],
 "line": {"tag": "stated", "text": "...", "source": "user", "document": null,
          "changed": false, "sensitive": false}}
"""


# ── Turn and report ──────────────────────────────────────────────────────────

@dataclass
class TurnInput:
    """Everything the writer needs about one completed chat turn."""

    scope: CaseScope | None
    question_raw: str
    answer: str = ""
    session_id: str | None = None
    chat_id: str | None = None
    mode: str = "chat"
    model: str | None = None
    # The assembly-log entry the read path built for this turn; the writer adds
    # its counts and records it, so each turn has one log row.
    log_entry: dict[str, Any] = field(default_factory=dict)
    saved_prompt: bool = False
    draft_template: str | None = None


@dataclass
class TurnContext:
    """What the extractor may look at besides the advocate's latest message."""

    # The assistant's message just before this one in the same conversation, so
    # a short reply ("The High Court of Bombay") can be understood.
    previous_answer: str = ""
    # The advocate's own earlier messages in this case, newest first, so a
    # request they keep making can be suggested as a standing instruction.
    earlier_requests: list[str] = field(default_factory=list)


@dataclass
class WriteReport:
    writes: int = 0
    proposals: int = 0
    rejected: int = 0
    instructions_saved: int = 0
    skipped_reason: str | None = None
    rejection_codes: list[str] = field(default_factory=list)
    assembly_log_id: str | None = None
    # What was written, for the turn's log row and the notice in the chat.
    details: dict[str, Any] = field(default_factory=dict)

    def reject(self, code: str, count: int = 1) -> None:
        if count <= 0:
            return
        self.rejected += count
        self.rejection_codes.extend([code] * count)

    def note(self, kind: str, item: dict[str, Any]) -> None:
        self.details.setdefault(kind, []).append(item)


@dataclass
class Extraction:
    ops: list[MemoryOp] = field(default_factory=list)
    proposals: list[MemoryProposal] = field(default_factory=list)
    nothing_durable: bool = False
    invalid: int = 0
    model: str | None = None


# ── Grounding ────────────────────────────────────────────────────────────────

_WORD_RE = re.compile(r"[a-z0-9]+")
_GROUNDING_STOPWORDS = frozenset(
    """
    about after again also among another because been before being below between both
    could does doing down during each even every from further have having here into
    itself just more most much must only other over same shall should some such than
    that their them then there these they this those through under until upon very
    were what when where which while whom whose will with within without would your
    yours please kindly
    """.split()
)
# Words an extractor adds to shape a line, which the advocate need not have typed.
_FRAMING_WORDS = frozenset(
    """
    decision decided note noted update updated status stated requested request
    recorded advocate earlier current currently regarding
    """.split()
)
_SUFFIXES = ("ing", "ed", "es", "s")


def _stem(word: str) -> str:
    for suffix in _SUFFIXES:
        if len(word) > 5 and word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[: -len(suffix)]
    return word


def content_words(text: str) -> set[str]:
    """Meaningful words of a text, lightly stemmed. Numbers and short words are left out."""
    words: set[str] = set()
    for token in _WORD_RE.findall(str(text or "").lower()):
        if token.isdigit() or len(token) < 4:
            continue
        if token in _GROUNDING_STOPWORDS or token in _FRAMING_WORDS:
            continue
        words.add(_stem(token))
    return words


def is_grounded(text: str, message: str, *, min_ratio: float = GROUNDING_MIN_RATIO) -> bool:
    """Whether a proposed line is traceable to the advocate's own message.

    Deliberately strict. Missing a paraphrased fact costs little, because the
    advocate can add it by hand; filing an assistant claim as the advocate's own
    words would poison every later session of the case.
    """
    line = content_words(text)
    if not line:
        return False
    overlap = line & content_words(message)
    return bool(overlap) and len(overlap) / len(line) >= min_ratio


# ── Skips ────────────────────────────────────────────────────────────────────

def turn_skip_reason(turn: TurnInput) -> str | None:
    """Why this turn's message is not worth extracting from, or None if it is."""
    mode = str(turn.mode or "chat").strip().lower()
    if mode in SKIP_MODES:
        return f"mode_{mode}"
    if turn.saved_prompt:
        return "saved_prompt"
    message = " ".join(str(turn.question_raw or "").split())
    if not message:
        return "no_message"
    if GREETING_RE.match(message):
        return "greeting"
    if len(message) < MIN_MESSAGE_CHARS:
        return "too_short"
    return None


# ── Extractor input ──────────────────────────────────────────────────────────

def _clip(text: str, limit: int) -> str:
    body = " ".join(str(text or "").split())
    if len(body) <= limit:
        return body
    return body[: max(1, limit - 1)].rstrip() + "…"


def _session_key(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        return str(uuid.UUID(raw))
    except (ValueError, AttributeError, TypeError):
        return raw


def turn_context(turn: TurnInput, turns: Sequence[RecallHit]) -> TurnContext:
    """The context the extractor gets from the advocate's recent turns in this case.

    `turns` are newest first and never include the current turn. The previous
    assistant message comes only from the same conversation. Earlier requests
    come from any session, leaving out saved prompts (not the advocate's own
    words) and greetings.
    """
    context = TurnContext()
    session = _session_key(turn.session_id)
    for hit in turns:
        if session and not context.previous_answer and _session_key(hit.session_id) == session:
            context.previous_answer = _clip(hit.answer, PREVIOUS_ANSWER_CHARS)
        if hit.used_saved_prompt or len(context.earlier_requests) >= MAX_EARLIER_REQUESTS:
            continue
        request = _clip(hit.question, EARLIER_REQUEST_CHARS)
        if request and not GREETING_RE.match(request):
            context.earlier_requests.append(request)
    return context


def render_snapshot(existing: dict[str, list[dict[str, Any]]], max_chars: int = SNAPSHOT_CHARS) -> str:
    """The case's current memory, each line with its id, trimmed oldest-first."""
    rows: dict[str, list[str]] = {}
    for section in SECTIONS:
        lines = [
            f"- id={line.get('id')} [{line.get('tag') or 'stated'}] {_clip(line.get('text'), MAX_LINE_CHARS)}"
            for line in existing.get(section) or []
            if str(line.get("text") or "").strip()
        ]
        if lines:
            rows[section] = lines

    def render() -> str:
        parts = [f"[{name}]\n" + "\n".join(lines) for name, lines in rows.items() if lines]
        return "\n".join(parts) if parts else "(nothing recorded yet)"

    text = render()
    while len(text) > max_chars and any(rows.values()):
        largest = max(rows, key=lambda name: len(rows[name]))
        rows[largest].pop(0)
        text = render()
    return text


def build_extractor_input(
    turn: TurnInput,
    existing: dict[str, list[dict[str, Any]]],
    *,
    today: date | None = None,
    context: TurnContext | None = None,
) -> str:
    stamp = (today or date.today()).isoformat()
    if str(turn.mode or "").strip().lower() == "draft":
        answer = "(not shown: this turn produced a draft document)"
    else:
        answer = _clip(turn.answer, ANSWER_CONTEXT_CHARS) or "(no answer)"

    parts = [
        f"TODAY: {stamp}",
        "CURRENT CASE MEMORY (already recorded; use a line's id to update it):\n" + render_snapshot(existing),
    ]
    if context is not None and context.earlier_requests:
        parts.append(
            "EARLIER REQUESTS FROM THE ADVOCATE IN THIS CASE (newest first; only for noticing a request "
            "they keep repeating, never a source of facts):\n"
            + "\n".join(f"- {request}" for request in context.earlier_requests)
        )
    if context is not None and context.previous_answer:
        parts.append(
            "PREVIOUS ASSISTANT MESSAGE (what the advocate may be replying to; context only, never a "
            "source of facts):\n<<<\n" + context.previous_answer + "\n>>>"
        )
    parts.append(
        "ADVOCATE MESSAGE (the only source of facts):\n<<<\n" + str(turn.question_raw or "").strip() + "\n>>>"
    )
    parts.append("ASSISTANT ANSWER (context only, never a source of facts):\n<<<\n" + answer + "\n>>>")
    return "\n\n".join(parts)


# ── Extractor output ─────────────────────────────────────────────────────────

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def parse_extraction(payload: Any) -> Extraction:
    """Read the extractor's output one op at a time: one bad op must not sink the rest.

    Raises `ValueError` only when the output is not JSON at all.
    """
    if isinstance(payload, MemoryOps):
        data: Any = payload.model_dump()
    elif isinstance(payload, dict):
        data = payload
    else:
        text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload or "")
        text = _FENCE_RE.sub("", text).strip()
        if not text:
            raise ValueError("The extractor returned nothing.")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if not match:
                raise ValueError("The extractor did not return JSON.") from None
            try:
                data = json.loads(match.group(0))
            except json.JSONDecodeError as exc:
                raise ValueError("The extractor did not return JSON.") from exc

    if not isinstance(data, dict):
        raise ValueError("The extractor did not return a JSON object.")

    result = Extraction(nothing_durable=bool(data.get("nothing_durable")))

    raw_ops = data.get("ops") if isinstance(data.get("ops"), list) else []
    for raw in raw_ops:
        try:
            op = MemoryOp.model_validate(raw)
        except (ValidationError, TypeError, ValueError):
            result.invalid += 1
            continue
        if len(result.ops) >= MAX_OPS_PER_TURN:
            result.invalid += 1
            continue
        result.ops.append(op)

    raw_proposals = data.get("proposals") if isinstance(data.get("proposals"), list) else []
    for raw in raw_proposals:
        try:
            proposal = MemoryProposal.model_validate(raw)
        except (ValidationError, TypeError, ValueError):
            result.invalid += 1
            continue
        if len(result.proposals) < MAX_PROPOSALS_PER_TURN:
            result.proposals.append(proposal)

    return result


# ── The model call ───────────────────────────────────────────────────────────

def _extractor_settings() -> tuple[str, str, float]:
    """(model, system prompt, temperature) for the extractor.

    An admin row in agent_prompts wins. Without one, the service-wide default
    model is a large model, far more than this small job needs, so the configured
    extraction model is used instead. The call goes straight to Gemini, so a row
    naming another provider keeps its prompt but not its model.
    """
    fallback = str(get_settings().memory_extraction_model or "gemini-2.5-flash")
    try:
        from app.services.agent_config_service import get_agent_config

        cfg = get_agent_config(EXTRACTION_AGENT, default_prompt=EXTRACTOR_PROMPT)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] extractor config unavailable: %s", exc)
        return fallback, EXTRACTOR_PROMPT, 0.1

    if getattr(cfg, "source", "") != "db":
        return fallback, EXTRACTOR_PROMPT, 0.1

    model = str(getattr(cfg, "model_name", "") or fallback)
    try:
        from app.services.adapters.document_ai import _detect_provider

        if _detect_provider(model) != "gemini":
            model = fallback
    except Exception:  # noqa: BLE001
        model = fallback
    prompt = str(getattr(cfg, "prompt", "") or EXTRACTOR_PROMPT)
    temperature = getattr(cfg, "temperature", None)
    return model, prompt, float(0.1 if temperature is None else temperature)


def _gemini_client(model: str) -> Any:
    from app.services.adapters.document_ai import _gemini_client as client_for

    return client_for(model)


def _generation_config(system_prompt: str, temperature: float, model: str, *, with_schema: bool) -> Any:
    from google.genai import types

    kwargs: dict[str, Any] = {
        "system_instruction": system_prompt,
        "temperature": temperature,
        "max_output_tokens": EXTRACTOR_MAX_OUTPUT_TOKENS,
        "response_mime_type": "application/json",
    }
    if with_schema:
        kwargs["response_schema"] = MemoryOps
    if str(model).lower().startswith("gemini-2.5-flash"):
        # A classification job: thinking tokens would only eat the output budget.
        try:
            kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
        except Exception:  # noqa: BLE001
            pass
    try:
        return types.GenerateContentConfig(
            **kwargs, http_options=types.HttpOptions(timeout=EXTRACTOR_TIMEOUT_MS)
        )
    except Exception:  # noqa: BLE001 — older SDKs have no per-request http_options
        return types.GenerateContentConfig(**kwargs)


def extract_ops(
    turn: TurnInput,
    existing: dict[str, list[dict[str, Any]]],
    *,
    today: date | None = None,
    context: TurnContext | None = None,
) -> Extraction:
    """Ask the extractor model what this turn established.

    Tries structured output first; if the SDK or model refuses the schema, asks
    again in plain JSON mode. Raises when no usable answer comes back.
    """
    model, prompt, temperature = _extractor_settings()
    client = _gemini_client(model)
    if client is None:
        raise RuntimeError("No Gemini client is configured for memory extraction.")

    contents = build_extractor_input(turn, existing, today=today, context=context)
    last_error: Exception | None = None
    for with_schema in (True, False):
        try:
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=_generation_config(prompt, temperature, model, with_schema=with_schema),
            )
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            logger.info("[Memory] extractor call failed (schema=%s): %s", with_schema, exc)
            continue
        parsed = getattr(response, "parsed", None)
        extraction = parse_extraction(
            parsed if isinstance(parsed, MemoryOps) else (getattr(response, "text", "") or "")
        )
        extraction.model = model
        return extraction
    raise RuntimeError(f"Memory extraction failed: {last_error}")


# ── Screening and writing ────────────────────────────────────────────────────

def screen_ops(ops: Sequence[MemoryOp], message: str, report: WriteReport) -> list[MemoryOp]:
    """The writer's own rules, applied before the shared validator."""
    kept: list[MemoryOp] = []
    for op in ops:
        if op.op not in WRITER_OPS:
            report.reject("writer_op_not_allowed")
            continue
        line = op.line
        if line is None:
            report.reject("missing_line")
            continue
        if line.tag == "extracted" or line.source == "document":
            report.reject("extracted_from_chat")
            continue
        if not is_grounded(line.text, message):
            report.reject("not_in_advocate_message")
            continue
        kept.append(op)
    return kept


def _remember(snapshot: dict[str, list[dict[str, Any]]], op: ResolvedOp, result: dict[str, Any]) -> None:
    """Keep the local snapshot current so later ops in the turn dedupe against it."""
    lines = snapshot.setdefault(op.section, [])
    if op.op == "replace_line" and op.line_id:
        for line in lines:
            if str(line.get("id")) == str(op.line_id):
                line["text"], line["tag"] = op.text, op.tag
                return
    lines.append({"id": result.get("line_id"), "tag": op.tag, "text": op.text})


def _write_one(
    scope: CaseScope,
    memory_op: MemoryOp,
    op: ResolvedOp,
    snapshot: dict[str, list[dict[str, Any]]],
    versions: dict[str, int | None],
    settings: MemorySettings,
    source_extra: dict[str, Any],
    report: WriteReport,
    *,
    retry: bool,
    today: date | None,
) -> bool:
    section = op.section
    try:
        result = repository.apply_op(
            scope.case_key,
            op,
            versions.get(section),
            actor=WRITER_ACTOR,
            folder_name=scope.folder_name,
            source_ref_extra=source_extra,
        )
    except VersionConflict as conflict:
        if not retry:
            report.reject("version_conflict")
            return False
        # Someone wrote this section since the snapshot. Re-check the op against
        # what is there now, then try once more.
        snapshot[section] = [dict(line) for line in (conflict.current_lines or [])]
        versions[section] = conflict.current_version
        again, rejections = validate_ops(
            [memory_op], snapshot, allow_sensitive=settings.sensitive_enabled, today=today
        )
        for rejection in rejections:
            report.reject(rejection.code)
        wrote = False
        for retry_op in again:
            wrote = _write_one(
                scope, memory_op, retry_op, snapshot, versions, settings, source_extra, report,
                retry=False, today=today,
            ) or wrote
        return wrote
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] write failed case_key=%s section=%s: %s", scope.case_key, section, exc)
        report.reject("write_failed")
        return False

    versions[section] = result.get("version", versions.get(section))
    _remember(snapshot, op, result)
    return True


def _apply_ops(
    scope: CaseScope,
    ops: Sequence[MemoryOp],
    existing: dict[str, list[dict[str, Any]]],
    versions: dict[str, int | None],
    settings: MemorySettings,
    source_extra: dict[str, Any],
    report: WriteReport,
    *,
    today: date | None,
) -> None:
    snapshot = {name: [dict(line) for line in lines] for name, lines in existing.items()}
    for memory_op in ops:
        # One op at a time, against the snapshot as it stands after earlier writes,
        # so two ops for the same fact in one turn cannot both land.
        resolved, rejections = validate_ops(
            [memory_op], snapshot, allow_sensitive=settings.sensitive_enabled, today=today
        )
        for rejection in rejections:
            report.reject(rejection.code)
        for op in resolved:
            if op.op == "append_line" and case_over_cap(snapshot):
                report.reject("case_full")
                continue
            if _write_one(
                scope, memory_op, op, snapshot, versions, settings, source_extra, report,
                retry=True, today=today,
            ):
                report.writes += 1
                report.note(
                    "lines",
                    {"section": op.section, "tag": op.tag, "text": op.text, "updated": op.op == "replace_line"},
                )


def _already_saved(text: str, saved: str) -> bool:
    if not saved.strip():
        return False
    if normalize_for_compare(text) in normalize_for_compare(saved):
        return True
    rows = [{"text": row} for row in saved.splitlines() if row.strip()]
    return find_duplicate(text, rows) is not None


def _is_auto(row: dict[str, Any]) -> bool:
    ref = row.get("source_ref")
    return isinstance(ref, dict) and bool(ref.get("auto"))


def _save_instruction(
    scope: CaseScope,
    text: str,
    source_extra: dict[str, Any],
    report: WriteReport,
) -> str:
    """Append an explicit standing instruction to this case's instructions.

    Returns "saved", "already_saved", "invalid" (the instructions would go over
    their cap), "conflict" (changed twice underneath us) or "failed".
    """
    for _attempt in range(2):
        try:
            stored = repository.get_instructions(scope.case_key) or {}
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Memory] instructions unreadable case_key=%s: %s", scope.case_key, exc)
            return "failed"
        content = str(stored.get("content") or "")
        if _already_saved(text, content):
            return "already_saved"
        merged = "\n".join(part for part in (content.rstrip(), text) if part)
        if validate_instructions(merged):
            return "invalid"
        try:
            saved = repository.put_instructions(
                scope.case_key,
                merged,
                stored.get("version"),
                updated_by=WRITER_ACTOR,
                folder_name=scope.folder_name,
            )
        except VersionConflict:
            continue
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Memory] instruction save failed case_key=%s: %s", scope.case_key, exc)
            report.reject("instruction_write_failed")
            return "failed"

        record_id: str | None = None
        try:
            # Recorded as an accepted proposal, so the advocate can see where it
            # came from and undo it.
            record_id = repository.add_proposal(
                scope.case_key,
                scope.user_id,
                "instruction",
                text,
                {**source_extra, "auto": True, "instructions_version": saved.get("version")},
                status="accepted",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Memory] saved instruction not recorded case_key=%s: %s", scope.case_key, exc)
        report.writes += 1
        report.instructions_saved += 1
        report.note("instructions", {"id": record_id, "text": text, "version": saved.get("version")})
        return "saved"

    report.reject("instruction_conflict")
    return "conflict"


def _handle_proposals(
    scope: CaseScope,
    turn: TurnInput,
    proposals: Sequence[MemoryProposal],
    source_extra: dict[str, Any],
    report: WriteReport,
    *,
    settings: MemorySettings | None = None,
) -> None:
    if not proposals:
        return
    settings = settings or MemorySettings()
    try:
        instructions = str((repository.get_instructions(scope.case_key) or {}).get("content") or "")
        preferences = str((repository.get_preferences(scope.user_id) or {}).get("content") or "")
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] could not read saved instructions for proposals: %s", exc)
        instructions = preferences = ""
    try:
        history = list(repository.list_proposals(scope.case_key, None) or [])
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] could not read earlier proposals: %s", exc)
        history = []
    pending = [row for row in history if row.get("status") == "pending"]
    dismissed = [row for row in history if row.get("status") == "rejected" and not _is_auto(row)]
    undone = [row for row in history if row.get("status") == "rejected" and _is_auto(row)]
    message_states_rule = has_standing_rule(turn.question_raw)

    for proposal in proposals:
        text = " ".join(str(proposal.text or "").split())
        if not text:
            continue
        if redact_or_reject_pii(text):
            report.reject("proposal_pii")
            continue
        if not is_grounded(text, turn.question_raw):
            report.reject("proposal_not_in_advocate_message")
            continue
        if proposal.kind == "instruction":
            problems, saved = validate_instructions(text), instructions
        else:
            problems, saved = validate_preferences(text), preferences
        if problems:
            report.reject("proposal_invalid")
            continue
        if _already_saved(text, saved):
            continue

        explicit = message_states_rule and has_standing_rule(text)
        if (
            explicit
            and proposal.kind == "instruction"
            and settings.instructions_enabled
            and find_duplicate(text, undone) is None
        ):
            outcome = _save_instruction(scope, text, source_extra, report)
            if outcome == "saved":
                instructions = "\n".join(part for part in (instructions.rstrip(), text) if part)
                continue
            if outcome == "already_saved":
                continue
            # Too long to append, or it kept changing underneath: ask instead.
        elif not explicit and find_duplicate(text, dismissed) is not None:
            report.reject("proposal_dismissed_before")
            continue

        if find_duplicate(text, pending) is not None:
            continue
        try:
            proposal_id = repository.add_proposal(
                scope.case_key, scope.user_id, proposal.kind, text, dict(source_extra)
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Memory] proposal write failed case_key=%s: %s", scope.case_key, exc)
            report.reject("proposal_write_failed")
            continue
        if proposal_id:
            report.proposals += 1
            report.note("suggestions", {"id": proposal_id, "kind": proposal.kind, "text": text})
            pending.append({"text": text})


# Upload paths prefix the original file name with an id ("<uuid>_Bail.pdf",
# "1726123456_Bail.pdf"). The separator deliberately excludes ".", so a name that
# is nothing but an id keeps its digits and the validator's identifier rules
# replace it with the generic line instead of leaving a bare extension.
_TEMPLATE_PREFIX_RE = re.compile(
    r"^(?:[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}|\d{6,})[_\- ]+",
    re.IGNORECASE,
)
_EXTENSION_RE = re.compile(r"\.[a-z0-9]{1,5}$", re.IGNORECASE)


def draft_status_line(template_path: str | None, *, today: date | None = None) -> str | None:
    """The drafting-log line for a draft-from-template turn."""
    raw = str(template_path or "").strip()
    if not raw:
        return None
    stamp = (today or date.today()).isoformat()
    name = raw.replace("\\", "/").rstrip("/").split("/")[-1]
    name = _TEMPLATE_PREFIX_RE.sub("", name).strip()
    if not _EXTENSION_RE.sub("", name).strip(" ._-"):
        name = ""
    text = f"Draft generated from template '{name}' on {stamp}" if name else ""
    if not text or validate_line("status", text, section="drafting_log") is not None:
        text = f"Draft generated from an uploaded template on {stamp}"
    return text[:MAX_LINE_CHARS]


def _record_draft(
    scope: CaseScope,
    turn: TurnInput,
    source_extra: dict[str, Any],
    report: WriteReport,
    *,
    today: date | None,
) -> None:
    text = draft_status_line(turn.draft_template, today=today)
    if not text:
        return
    try:
        result = repository.append_lines(
            scope.case_key,
            "drafting_log",
            [{"tag": "status", "text": text, "source_ref": {**source_extra, "source": "pipeline"}}],
            actor=WRITER_ACTOR,
            folder_name=scope.folder_name,
        )
        added = int(result.get("added") or 0)
        report.writes += added
        if added:
            report.note("lines", {"section": "drafting_log", "tag": "status", "text": text, "updated": False})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] draft status write failed case_key=%s: %s", scope.case_key, exc)
        report.reject("write_failed")


# ── Orchestration ────────────────────────────────────────────────────────────

def _refresh_seed(scope: CaseScope, report: WriteReport) -> None:
    """Fill the case from its details, or top it up, before reading the turn. Never raises."""
    try:
        result = refresh_seed(scope)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] seeding skipped case_key=%s: %s", scope.case_key, exc)
        return
    if not result:
        return
    added, updated = int(result.get("added") or 0), int(result.get("updated") or 0)
    if added or updated:
        report.writes += added + updated
        report.details["seeded"] = {"added": added, "updated": updated}


def _load_context(scope: CaseScope, turn: TurnInput) -> TurnContext:
    try:
        turns = recent_turns(scope, exclude_chat_id=turn.chat_id, limit=RECENT_TURNS)
    except Exception as exc:  # noqa: BLE001 — context helps; the turn is still worth reading without it
        logger.debug("[Memory] earlier turns unavailable case_key=%s: %s", scope.case_key, exc)
        return TurnContext()
    return turn_context(turn, turns)


def _run(turn: TurnInput, report: WriteReport, *, today: date | None) -> None:
    scope = turn.scope
    if not get_settings().memory_write_enabled:
        report.skipped_reason = "disabled_globally"
        return
    if scope is None or not is_real_user(scope.user_id):
        report.skipped_reason = "no_scope"
        return
    mode = str(turn.mode or "chat").strip().lower()
    if mode in SKIP_MODES:
        report.skipped_reason = f"mode_{mode}"
        return
    if not repository.available():
        report.skipped_reason = "db_unavailable"
        return

    # Read fresh: the advocate may have switched memory off since this chat began.
    settings = repository.effective_settings(
        user_id=scope.user_id, case_key=scope.case_key, firm_id=scope.firm_id
    )
    if not settings.enabled or not settings.write_enabled:
        report.skipped_reason = "disabled_by_user"
        return

    # Every turn, greetings included: a case that predates memory fills itself
    # from its details on its first chat, and new documents are picked up.
    _refresh_seed(scope, report)

    source_extra = {
        key: value
        for key, value in {"kind": "chat", "session_id": turn.session_id, "chat_id": turn.chat_id}.items()
        if value
    }

    if mode == "draft" and turn.draft_template:
        _record_draft(scope, turn, source_extra, report, today=today)

    reason = turn_skip_reason(turn)
    if reason:
        report.skipped_reason = reason
        return

    stored = repository.get_sections(scope.case_key)
    existing = {name: list((data or {}).get("lines") or []) for name, data in stored.items()}
    versions: dict[str, int | None] = {name: (data or {}).get("version") for name, data in stored.items()}
    context = _load_context(scope, turn)

    try:
        extraction = extract_ops(turn, existing, today=today, context=context)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] extractor unavailable case_key=%s: %s", scope.case_key, exc)
        report.skipped_reason = "extractor_error"
        return

    report.reject("invalid_op", extraction.invalid)
    if extraction.nothing_durable and not extraction.ops and not extraction.proposals:
        report.skipped_reason = "nothing_durable"
        return

    accepted = screen_ops(extraction.ops, turn.question_raw, report)
    _apply_ops(scope, accepted, existing, versions, settings, source_extra, report, today=today)
    _handle_proposals(scope, turn, extraction.proposals, source_extra, report, settings=settings)


def _write_log(turn: TurnInput, report: WriteReport) -> str | None:
    """One assembly-log row per turn: what was read, and what was written."""
    entry = dict(turn.log_entry or {})
    if not entry.get("case_key"):
        if turn.scope is None:
            return None
        entry["case_key"] = turn.scope.case_key
        entry["user_id"] = turn.scope.user_id

    reasons = [
        f"read:{entry['skipped_reason']}" if entry.get("skipped_reason") else "",
        f"write:{report.skipped_reason}" if report.skipped_reason else "",
    ]
    details = {key: value for key, value in report.details.items() if value}
    if report.rejection_codes:
        details["rejection_codes"] = sorted(set(report.rejection_codes))
    entry.update(
        {
            "session_id": turn.session_id or entry.get("session_id"),
            "chat_id": turn.chat_id,
            "model": turn.model or entry.get("model"),
            "mode": entry.get("mode") or turn.mode,
            "writes": report.writes,
            "rejected": report.rejected,
            "proposals": report.proposals,
            "skipped_reason": "; ".join(reason for reason in reasons if reason) or None,
            "details": details,
        }
    )
    try:
        return repository.write_assembly_log(entry)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] assembly log skipped: %s", exc)
        return None


def run_post_turn(turn: TurnInput, *, today: date | None = None) -> WriteReport:
    """Write what one turn established. Never raises."""
    report = WriteReport()
    try:
        _run(turn, report, today=today)
    except Exception as exc:  # noqa: BLE001 — memory must never fail a chat
        logger.warning(
            "[Memory] writer failed case_key=%s: %s", getattr(turn.scope, "case_key", None), exc
        )
        report.skipped_reason = report.skipped_reason or "writer_error"
    report.assembly_log_id = _write_log(turn, report)
    logger.info(
        "[Memory] post-turn case_key=%s writes=%s instructions_saved=%s proposals=%s rejected=%s "
        "skipped=%s codes=%s",
        getattr(turn.scope, "case_key", None),
        report.writes,
        report.instructions_saved,
        report.proposals,
        report.rejected,
        report.skipped_reason,
        sorted(set(report.rejection_codes)),
    )
    return report


def submit_post_turn(turn: TurnInput) -> Future | None:
    """Run the writer on its own threads. Returns the future, or None if it could not start."""
    try:
        return _EXECUTOR.submit(run_post_turn, turn)
    except Exception as exc:  # noqa: BLE001 — e.g. the executor is shutting down
        logger.warning("[Memory] writer could not start: %s", exc)
        return None
