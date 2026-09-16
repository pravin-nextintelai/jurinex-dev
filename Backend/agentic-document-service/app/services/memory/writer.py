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
    a fact about the advocate
              something the advocate says about themselves that holds in every
              case ("I mostly appear before the Aurangabad Bench"). It is kept
              with the advocate, not the case, and loads into all their cases.
              Case details are refused, and a fact the advocate deleted is not
              learned again.

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
from app.services.memory.instructions import user_proposal_key
from app.services.memory.parties import party_names_for_user
from app.services.memory.recall import RecallHit, recent_turns
from app.services.memory.repository import VersionConflict
from app.services.memory.schemas import (
    MAX_LINE_CHARS,
    MAX_OPS_PER_TURN,
    SECTIONS,
    AdvocateFact,
    MemoryOp,
    MemoryOps,
    MemoryProposal,
    MemorySettings,
)
from app.services.memory.scope import CaseScope, is_real_user
from app.services.memory.seed import refresh_seed
from app.services.memory.validator import (
    DEDUPE_SAME,
    ResolvedOp,
    advocate_set_room,
    case_over_cap,
    find_duplicate,
    instruction_set_room,
    redact_or_reject_pii,
    validate_advocate_line,
    validate_instruction_item,
    validate_line,
    validate_ops,
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
MAX_ADVOCATE_FACTS_PER_TURN = 3
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


# Words that widen a rule from this case to all of the advocate's work. A rule
# is saved as universal only when the advocate's own message says so; the
# extractor's label alone is not trusted for that.
UNIVERSAL_CUE_RE = re.compile(
    r"\b(?:(?:in|for|across|on|with)\s+(?:all|every|any)\s+(?:of\s+)?(?:my\s+|our\s+|the\s+)?"
    r"(?:cases?|matters?|files?|work|drafts?|chats?|briefs?|answers?|repl(?:y|ies))"
    r"|all\s+(?:my|our)\s+(?:cases|matters|work|drafts|files|chats)"
    r"|every\s+(?:case|matter)\b"
    r"|whatever\s+the\s+(?:case|matter)"
    r"|regardless\s+of\s+(?:the\s+)?(?:case|matter)"
    r"|in\s+general\b|as\s+a\s+general\s+rule|universally"
    r"|not\s+(?:just|only)\s+(?:for\s+|in\s+)?this\s+(?:case|matter))\b",
    re.IGNORECASE,
)


def has_universal_cue(text: str | None) -> bool:
    """True when the advocate says a rule is for all their cases, not just this one."""
    return bool(UNIVERSAL_CUE_RE.search(str(text or "")))


# A repeated request becomes a standing instruction only when it says HOW to answer:
# a layout, a language, a citation style, a form of address, a length. Asking for the
# same CONTENT again ("give me a detailed summary") is a request, however often it is
# repeated, and must never turn into a rule the advocate did not write.
MANNER_RE = re.compile(
    r"\b(?:tabular|table|tables|column|columns|chart|matrix|timeline|chronolog\w*|"
    r"bullet\w*|point[\s-]?wise|numbered|heading\w*|section[\s-]?wise|paragraph\w*|"
    r"format|formatted|layout|structure[d]?|template|style|tone|wording|"
    r"ascii|diagram\w*|markdown|plain\s+text|"
    r"english|marathi|hindi|gujarati|kannada|tamil|telugu|urdu|bengali|punjabi|"
    r"cite|cites|citation\w*|footnote\w*|authorit(?:y|ies)|"
    r"brief|briefly|concise\w*|short(?:er)?|crisp|one[\s-]?page|word\s+limit)\b"
    # How to name someone: "refer to my client as the Applicant", "call Pawar the Applicant".
    r"|\b(?:refer\s+to|address|call)\s+[^,.]{0,40}?\b(?:as|the)\b",
    re.IGNORECASE,
)


def describes_manner(text: str | None) -> bool:
    """True when a request says how an answer should be written, not what it should contain."""
    return bool(MANNER_RE.search(str(text or "")))


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
   when the fact itself changed, so its earlier value is kept. A fact the memory
   already holds unchanged is not recorded again.
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
own words from THIS message:
- kind "instruction" for this case, such as "Refer to my client as the
  Applicant" or "From now on, answer in a table";
- kind "preference" only when the advocate says the rule is for all their
  cases ("in all my matters", "in every case", "not just this case"), such as
  "In all my matters, cite SCC first". Keep those words in the proposal.
Propose a rule when the advocate:
- states one ("always", "never", "from now on", "going forward", "every time",
  "remember to"), keeping that word in the proposal; or
- asks for a way of writing or presenting answers that could apply beyond this
  one answer (a table, a language, a citation style, a form of address), worded
  the way the advocate asked, without adding "always".
A request about what this one answer should contain ("summarise page 5", "list
the dates") is not a rule.

COUNTING REPEATED REQUESTS
JuriNex saves a rule only after the advocate has asked for it more than once, so
it counts how often each rule is asked for:
- When this message asks again for a rule in RULES ALREADY NOTICED, set
  "repeats" to that rule's id. Still write "text" in this message's words.
- Never propose a rule that is already in SAVED INSTRUCTIONS.
- EARLIER REQUESTS and the CONVERSATION SUMMARY show what the advocate asked
  before. Use them only to recognise a repeat. They are never a source of facts,
  and never a reason to propose a rule this message does not ask for.

ABOUT THE ADVOCATE
Separately from this case, JuriNex remembers a few things about the advocate
that hold in every case they work on. Put one in "advocate" only when the
advocate states it about THEMSELVES in their message:
- category "practice": the courts they appear in, their areas of law, their role
  ("I mostly appear before the Aurangabad Bench", "I am a criminal lawyer");
- category "clients": the kind of clients they act for, never a client's name
  ("I usually act for borrowers, not banks");
- category "work_style": how they work ("my juniors prepare the first draft");
- category "background": their languages, experience or team ("I have 12 years
  at the bar").
Never put here anything about this case (its parties, dates, numbers, documents
or facts), a rule for how to answer (that is a proposal), anything the assistant
said, or the advocate's health, family or money (mark those "sensitive": true).
Write it in the third person, keeping the advocate's words: "Mostly appears before
the Aurangabad Bench". If WHAT JURINEX KNOWS ABOUT THE ADVOCATE already says it,
record nothing; if it changed, set "replaces" to that line's id.

LIMITS
At most 8 ops, 3 proposals and 3 advocate facts. If nothing qualifies, return
{"ops": [], "proposals": [], "advocate": [], "nothing_durable": true}.

Each op looks like:
{"op": "append_line", "section": "facts", "line_id": null, "match_text": null,
 "reason": "short reason", "lines": [],
 "line": {"tag": "stated", "text": "...", "source": "user", "document": null,
          "changed": false, "sensitive": false}}
Each proposal looks like:
{"kind": "instruction", "text": "...", "repeats": null}
Each advocate fact looks like:
{"category": "practice", "text": "...", "replaces": null, "sensitive": false}
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
    # Instruction texts already saved for this case and advocate: never proposed again.
    saved_rules: list[str] = field(default_factory=list)
    # Rules asked for before and still being counted: {"id", "text", "count", "scope"}.
    noticed_rules: list[dict[str, Any]] = field(default_factory=list)
    # This chat's rolling summary, for recognising a repeated request.
    conversation_summary: str = ""
    # What JuriNex already remembers about the advocate: {"id", "category", "text"}.
    advocate_lines: list[dict[str, Any]] = field(default_factory=list)


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
    advocate: list[AdvocateFact] = field(default_factory=list)
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


RULE_CONTEXT_CHARS = 400
SUMMARY_CONTEXT_CHARS = 3_000


def _render_noticed_rule(rule: dict[str, Any]) -> str:
    count = int(rule.get("count") or 1)
    where = "every case" if rule.get("scope") == "user" else "this case"
    times = "time" if count == 1 else "times"
    return f"- id={rule.get('id')} (asked {count} {times}; {where}) {_clip(rule.get('text'), RULE_CONTEXT_CHARS)}"


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
    if context is not None and context.saved_rules:
        parts.append(
            "SAVED INSTRUCTIONS (already applied in every answer; never propose these again):\n"
            + "\n".join(f"- {_clip(rule, RULE_CONTEXT_CHARS)}" for rule in context.saved_rules)
        )
    if context is not None and context.noticed_rules:
        parts.append(
            'RULES ALREADY NOTICED (asked for before, not saved yet; when this message asks for one again, '
            'set "repeats" to its id):\n'
            + "\n".join(_render_noticed_rule(rule) for rule in context.noticed_rules)
        )
    if context is not None and context.advocate_lines:
        parts.append(
            'WHAT JURINEX KNOWS ABOUT THE ADVOCATE (every case; never propose these again; set "replaces" to a '
            "line's id when the advocate changes one):\n"
            + "\n".join(
                f"- id={line.get('id')} [{line.get('category')}] {_clip(line.get('text'), MAX_LINE_CHARS)}"
                for line in context.advocate_lines
            )
        )
    if context is not None and context.conversation_summary.strip():
        parts.append(
            "CONVERSATION SUMMARY (earlier in this chat; only for recognising a repeated request, never a "
            "source of facts):\n<<<\n" + context.conversation_summary.strip()[:SUMMARY_CONTEXT_CHARS] + "\n>>>"
        )
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

    raw_facts = data.get("advocate") if isinstance(data.get("advocate"), list) else []
    for raw in raw_facts:
        try:
            fact = AdvocateFact.model_validate(raw)
        except (ValidationError, TypeError, ValueError):
            result.invalid += 1
            continue
        if len(result.advocate) < MAX_ADVOCATE_FACTS_PER_TURN:
            result.advocate.append(fact)

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


def _already_saved(text: str, items: Sequence[dict[str, Any]]) -> bool:
    """Whether an instruction with this meaning is already in the set."""
    return find_duplicate(text, list(items)) is not None


def _is_auto(row: dict[str, Any]) -> bool:
    ref = row.get("source_ref")
    return isinstance(ref, dict) and bool(ref.get("auto"))


def _proposal_history(key: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """(pending, dismissed by the advocate, saved-then-deleted) suggestions under one key.

    Pending includes rules still being counted out of sight.
    """
    try:
        history = list(repository.list_proposals(key, None, include_hidden=True) or [])
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] could not read earlier proposals for %s: %s", key, exc)
        history = []
    pending = [row for row in history if row.get("status") == "pending"]
    dismissed = [row for row in history if row.get("status") == "rejected" and not _is_auto(row)]
    undone = [row for row in history if row.get("status") == "rejected" and _is_auto(row)]
    return pending, dismissed, undone


def _instruction_items(scope_type: str, scope_id: str) -> list[dict[str, Any]]:
    try:
        return list(repository.get_instruction_set(scope_type, scope_id).get("items") or [])
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] could not read %s instructions for %s: %s", scope_type, scope_id, exc)
        return []


def _seen_in_other_cases(scope: CaseScope, text: str) -> list[str]:
    """Case keys where the advocate asked for the same thing before."""
    try:
        rows = repository.list_user_proposals(scope.user_id, exclude_case_key=scope.case_key)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] could not read cross-case proposals: %s", exc)
        return []
    keys: list[str] = []
    for row in rows:
        if find_duplicate(text, [row]) is not None:
            key = str(row.get("case_key") or "")
            if key and key not in keys:
                keys.append(key)
    return keys


MAX_CONTEXT_RULES = 40
MAX_TRACKED_REQUESTS = 20


def conversation_summary(scope: CaseScope, session_id: str | None) -> str:
    """This chat's rolling summary, so the extractor can recognise a repeated request. Never raises."""
    if not session_id:
        return ""
    try:
        from app.services.chat_summary import read_summary_text

        return read_summary_text(scope.folder_name, scope.user_id, session_id)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] conversation summary unavailable case_key=%s: %s", scope.case_key, exc)
        return ""


def _threshold(name: str, default: int) -> int:
    """One of the rule-counting thresholds from settings; 0 switches that step off."""
    try:
        value = int(getattr(get_settings(), name, default))
    except (TypeError, ValueError):
        return default
    return max(0, value)


def _request_count(row: dict[str, Any] | None) -> int:
    """How many separate messages asked for a noticed rule. Rows from before counting count once."""
    if not row:
        return 0
    ref = row.get("source_ref")
    if not isinstance(ref, dict):
        return 1
    try:
        return max(1, int(ref.get("request_count") or 1))
    except (TypeError, ValueError):
        return 1


def _is_hidden(row: dict[str, Any]) -> bool:
    ref = row.get("source_ref")
    return isinstance(ref, dict) and bool(ref.get("hidden"))


class _Rulebook:
    """What this turn's rules are checked against, read once per turn."""

    def __init__(self, scope: CaseScope) -> None:
        self.scope = scope
        self.items = {
            "case": _instruction_items("case", scope.case_key),
            "user": _instruction_items("user", scope.user_id),
        }
        self.pending, self.dismissed, self.undone = {}, {}, {}
        for scope_type, key in (("case", scope.case_key), ("user", user_proposal_key(scope.user_id))):
            self.pending[scope_type], self.dismissed[scope_type], self.undone[scope_type] = _proposal_history(key)
        self._party_names: tuple[str, ...] | None = None

    @property
    def party_names(self) -> tuple[str, ...]:
        # Only universal rules are checked against party names, so they are read on first use.
        if self._party_names is None:
            try:
                self._party_names = tuple(party_names_for_user(self.scope.user_id))
            except Exception as exc:  # noqa: BLE001
                logger.debug("[Memory] party names unavailable: %s", exc)
                self._party_names = ()
        return self._party_names

    def key(self, scope_type: str) -> str:
        return self.scope.case_key if scope_type == "case" else user_proposal_key(self.scope.user_id)

    def scope_id(self, scope_type: str) -> str:
        return self.scope.case_key if scope_type == "case" else str(self.scope.user_id)

    def problems(self, text: str, scope_type: str) -> list[Any]:
        return validate_instruction_item(
            text, scope_type=scope_type, party_names=self.party_names if scope_type == "user" else ()
        )

    def saved_rules(self) -> list[str]:
        """Instruction texts already saved for this case and this advocate."""
        texts = [
            str(item.get("text") or "").strip()
            for scope_type in ("case", "user")
            for item in self.items[scope_type]
        ]
        return [text for text in texts if text][:MAX_CONTEXT_RULES]

    def noticed_rules(self) -> list[dict[str, Any]]:
        """Rules asked for before and not saved yet, with their ids and request counts."""
        rows = [
            {
                "id": str(row.get("id")),
                "text": str(row.get("text") or "").strip(),
                "count": _request_count(row),
                "scope": scope_type,
            }
            for scope_type in ("case", "user")
            for row in self.pending[scope_type]
            if row.get("id") and str(row.get("text") or "").strip()
        ]
        return rows[:MAX_CONTEXT_RULES]

    def find_pending(self, text: str, scope_type: str, repeats: str | None) -> dict[str, Any] | None:
        """The noticed rule a request repeats: by the id the extractor gave, else by its wording."""
        rows = self.pending[scope_type]
        wanted = str(repeats or "").strip()
        if wanted:
            for row in rows:
                if str(row.get("id") or "") == wanted:
                    return row
        for row in rows:
            if find_duplicate(text, [row]) is not None:
                return row
        return None


@dataclass
class _Request:
    """One message asking for a rule, counted against the noticed rule it repeats."""

    row: dict[str, Any] | None  # the noticed rule it was added to; None for a new rule
    source_ref: dict[str, Any]
    count: int
    counted: bool  # False when this message had already been counted for the rule
    was_hidden: bool


def _count_request(
    book: _Rulebook,
    text: str,
    scope_type: str,
    repeats: str | None,
    *,
    explicit: bool,
    source_extra: dict[str, Any],
) -> _Request:
    from datetime import datetime, timezone

    row = book.find_pending(text, scope_type, repeats)
    chat_id = str(source_extra.get("chat_id") or "")
    stamp = {
        key: value
        for key, value in {
            "chat_id": chat_id,
            "session_id": source_extra.get("session_id"),
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }.items()
        if value
    }
    if row is None:
        ref = {**source_extra, "requests": [stamp], "request_count": 1, "explicit": explicit, "hidden": True}
        return _Request(row=None, source_ref=ref, count=1, counted=True, was_hidden=True)

    ref = dict(row.get("source_ref") or {}) if isinstance(row.get("source_ref"), dict) else {}
    requests = [item for item in ref.get("requests") or [] if isinstance(item, dict)]
    count = _request_count(row)
    already = bool(chat_id) and any(str(item.get("chat_id") or "") == chat_id for item in requests)
    if not already:
        requests.append(stamp)
        count += 1
    ref.update(
        {
            "requests": requests[-MAX_TRACKED_REQUESTS:],
            "request_count": count,
            "explicit": bool(ref.get("explicit")) or explicit,
        }
    )
    return _Request(row=row, source_ref=ref, count=count, counted=not already, was_hidden=_is_hidden(row))


def polished_rule(book: _Rulebook, text: str, scope_type: str) -> str | None:
    """A tidy wording of a rule, for the advocate to read and accept, or None.

    The advocate's message is often a half-sentence ("at each time give me simple
    answer to understand with proper"), which should never become a standing
    instruction as typed. Best-effort: on any failure their own wording stands.
    """
    try:
        from app.services.memory.polish import polish_instruction

        result = polish_instruction(
            text,
            scope_type=scope_type,
            party_names=book.party_names if scope_type == "user" else (),
        )
    except Exception as exc:  # noqa: BLE001 — a rule is still worth keeping unpolished
        logger.debug("[Memory] polish unavailable for a noticed rule: %s", exc)
        return None
    if result.problems or result.error or not result.changed:
        return None
    return result.polished or None


def _save_instruction(
    book: _Rulebook,
    text: str,
    scope_type: str,
    source_extra: dict[str, Any],
    report: WriteReport,
    *,
    request: _Request | None = None,
    display_text: str | None = None,
) -> str:
    """Add a standing instruction to the case's, or the advocate's, set.

    `display_text` is the tidied wording; the advocate's own words are kept in the
    record so a later repeat still matches what was saved.

    Returns "saved", "already_saved", "full" (no room in the set) or "failed".
    """
    items = book.items[scope_type]
    body = display_text or text
    if _already_saved(text, items) or _already_saved(body, items):
        return "already_saved"
    if instruction_set_room(items, body, scope_type=scope_type) is not None:
        return "full"
    count = request.count if request is not None else 1
    try:
        result = repository.add_instruction(
            scope_type,
            book.scope_id(scope_type),
            body,
            None,
            origin="chat",
            source_ref={
                **source_extra,
                "auto": True,
                "request_count": count,
                **({"polished": True, "original": text} if body != text else {}),
            },
            actor=WRITER_ACTOR,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] instruction save failed scope=%s: %s", scope_type, exc)
        report.reject("instruction_write_failed")
        return "failed"

    item = dict(result.get("item") or {})
    items.append(item)
    # Kept as an accepted suggestion, so deleting the instruction later tells the
    # writer not to save it again.
    record = {
        **(request.source_ref if request is not None else source_extra),
        "hidden": False,
        "auto": True,
        "instruction_id": item.get("id"),
    }
    try:
        if request is not None and request.row is not None and request.row.get("id"):
            repository.update_proposal(
                book.key(scope_type), str(request.row["id"]), source_ref=record, status="accepted"
            )
            book.pending[scope_type] = [row for row in book.pending[scope_type] if row is not request.row]
        else:
            repository.add_proposal(
                book.key(scope_type),
                book.scope.user_id,
                "instruction" if scope_type == "case" else "preference",
                text,
                record,
                status="accepted",
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] saved instruction not recorded scope=%s: %s", scope_type, exc)
    report.writes += 1
    report.instructions_saved += 1
    report.note(
        "instructions",
        {"id": item.get("id"), "text": body, "scope": scope_type, "version": result.get("version"), "requests": count},
    )
    return "saved"


def _store_request(
    book: _Rulebook,
    text: str,
    scope_type: str,
    request: _Request,
    *,
    visible: bool,
    report: WriteReport,
    polished: str | None = None,
) -> None:
    """Keep a counted request, on a new noticed rule or on the one it repeats.

    `visible` decides whether the advocate sees it under Suggestions. The stored
    text stays the advocate's own words, so a later repeat still matches it;
    `polished` carries the tidy wording the panel offers them to accept.
    """
    ref = {**request.source_ref, "hidden": not visible}
    if polished:
        ref["polished"] = polished
    newly_shown = visible and (request.row is None or request.was_hidden)
    try:
        if request.row is None:
            proposal_id = repository.add_proposal(
                book.key(scope_type),
                book.scope.user_id,
                "instruction" if scope_type == "case" else "preference",
                text,
                ref,
            )
            if proposal_id:
                book.pending[scope_type].append(
                    {"id": proposal_id, "text": text, "status": "pending", "source_ref": ref}
                )
        else:
            proposal_id = str(request.row.get("id") or "")
            if proposal_id:
                repository.update_proposal(book.key(scope_type), proposal_id, source_ref=ref)
            request.row["source_ref"] = ref
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] rule request not recorded scope=%s: %s", scope_type, exc)
        report.reject("proposal_write_failed")
        return
    if not proposal_id:
        return
    report.note("requests", {"id": proposal_id, "scope": scope_type, "text": text, "count": request.count, "shown": visible})
    if newly_shown:
        report.proposals += 1
        report.note(
            "suggestions",
            {
                "id": proposal_id,
                "kind": "instruction",
                "scope": scope_type,
                "text": polished or text,
                "count": request.count,
            },
        )


def _suggest_universal(book: _Rulebook, text: str, source_extra: dict[str, Any], report: WriteReport) -> bool:
    """Suggest for every case a rule asked for in more than one case, unless one is already shown."""
    match = next((row for row in book.pending["user"] if find_duplicate(text, [row]) is not None), None)
    try:
        if match is not None:
            if not _is_hidden(match):
                return False
            ref = {**(match.get("source_ref") or {}), "hidden": False, "learned_from": source_extra.get("learned_from")}
            proposal_id = str(match.get("id") or "")
            if not proposal_id:
                return False
            repository.update_proposal(book.key("user"), proposal_id, source_ref=ref)
            match["source_ref"] = ref
        else:
            ref = {**source_extra, "hidden": False}
            proposal_id = repository.add_proposal(book.key("user"), book.scope.user_id, "preference", text, ref)
            if not proposal_id:
                return False
            book.pending["user"].append({"id": proposal_id, "text": text, "status": "pending", "source_ref": ref})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] universal suggestion not recorded: %s", exc)
        report.reject("proposal_write_failed")
        return False
    report.proposals += 1
    report.note("suggestions", {"id": proposal_id, "kind": "instruction", "scope": "user", "text": text})
    return True


def _handle_proposals(
    scope: CaseScope,
    turn: TurnInput,
    proposals: Sequence[MemoryProposal],
    source_extra: dict[str, Any],
    report: WriteReport,
    *,
    settings: MemorySettings | None = None,
    book: _Rulebook | None = None,
) -> None:
    """Count each rule the extractor found; suggest or save it once it has been asked for enough.

    Nothing is saved the first time. A rule the advocate words as one ("always", "from now
    on") is suggested at once and saved after MEMORY_RULE_SAVE_AFTER requests. A way of
    working asked for without such words stays out of sight until MEMORY_RULE_SUGGEST_AFTER
    requests and is saved after MEMORY_PATTERN_SAVE_AFTER (0 = never on its own). Each
    message counts once. A rule already saved, dismissed, or saved and then deleted by the
    advocate is not saved again, and a rule asked for in more than one case is suggested
    for every case.
    """
    if not proposals:
        return
    settings = settings or MemorySettings()
    book = book or _Rulebook(scope)
    save_after = _threshold("memory_rule_save_after", 2)
    suggest_after = max(1, _threshold("memory_rule_suggest_after", 2))
    pattern_save_after = _threshold("memory_pattern_save_after", 3)
    message_rule = has_standing_rule(turn.question_raw)
    message_universal = has_universal_cue(turn.question_raw)

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

        # The extractor's "preference" label is honoured only when the advocate's
        # own words widen the rule to all their cases.
        scope_type = "user" if (proposal.kind == "preference" and message_universal) else "case"
        if book.problems(text, scope_type):
            report.reject("proposal_invalid")
            continue
        if _already_saved(text, book.items[scope_type]):
            continue

        explicit = message_rule and has_standing_rule(text)
        # Asking for the same content again is not a way of working. Only a rule the
        # advocate actually worded as one, or a request about HOW to answer, is counted.
        if not explicit and not describes_manner(text):
            report.reject("proposal_not_a_way_of_working")
            continue
        if not explicit and find_duplicate(text, book.dismissed[scope_type]) is not None:
            report.reject("proposal_dismissed_before")
            continue

        request = _count_request(
            book, text, scope_type, getattr(proposal, "repeats", None), explicit=explicit, source_extra=source_extra
        )
        if not request.counted:
            # This message was already counted for the rule (a retry, or two proposals
            # for the same rule): it changes nothing.
            continue

        stated_rule = bool(request.source_ref.get("explicit"))
        threshold = save_after if stated_rule else pattern_save_after
        will_save = (
            settings.instructions_enabled
            and threshold > 0
            and request.count >= threshold
            and find_duplicate(text, book.undone[scope_type]) is None
        )
        will_show = stated_rule or request.count >= suggest_after
        # Tidy the wording once, only when the advocate is about to see it or it is
        # about to be saved. A rule still being counted out of sight costs nothing.
        polished = polished_rule(book, text, scope_type) if (will_save or will_show) else None

        if will_save:
            outcome = _save_instruction(
                book, text, scope_type, source_extra, report, request=request, display_text=polished
            )
            if outcome in ("saved", "already_saved"):
                continue
            # No room in the set, or the write failed: show it as a suggestion instead.
            visible = True
        else:
            visible = will_show
        _store_request(book, text, scope_type, request, visible=visible, report=report, polished=polished)

        # The same request in another case too: worth suggesting for all cases,
        # if it is fit to be universal and the advocate has not turned it down.
        if (
            scope_type == "case"
            and not book.problems(text, "user")
            and not _already_saved(text, book.items["user"])
            and find_duplicate(text, book.dismissed["user"]) is None
            and find_duplicate(text, book.undone["user"]) is None
        ):
            elsewhere = _seen_in_other_cases(scope, text)
            if elsewhere:
                _suggest_universal(book, text, {**source_extra, "learned_from": elsewhere[:5]}, report)


@dataclass
class AdvocateState:
    """What JuriNex remembers about the advocate, read once per turn and kept current as facts are written."""

    lines: list[dict[str, Any]] = field(default_factory=list)
    forgotten: list[str] = field(default_factory=list)


def load_advocate_state(scope: CaseScope) -> AdvocateState | None:
    """The advocate's remembered facts, or None when they cannot be read. Never raises."""
    try:
        data = repository.get_advocate_memory(scope.user_id)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] advocate memory unavailable user_id=%s: %s", scope.user_id, exc)
        return None
    return AdvocateState(
        lines=[dict(line) for line in data.get("lines") or []],
        forgotten=[str(text) for text in data.get("forgotten") or [] if str(text or "").strip()],
    )


def _handle_advocate(
    scope: CaseScope,
    turn: TurnInput,
    facts: Sequence[AdvocateFact],
    source_extra: dict[str, Any],
    report: WriteReport,
    *,
    state: AdvocateState | None,
    book: _Rulebook,
) -> None:
    """Remember what the advocate said about themselves, for every case.

    A fact is kept only when it is in the advocate's own message, carries no case
    details, is not something they deleted before, and is not already known. A fact
    that says the same thing differently updates the line it matches.
    """
    if not facts or state is None:
        return
    for fact in facts:
        text = " ".join(str(fact.text or "").split())
        if not text:
            continue
        if fact.sensitive:
            report.reject("advocate_sensitive")
            continue
        if not is_grounded(text, turn.question_raw):
            report.reject("advocate_not_in_advocate_message")
            continue
        problem = validate_advocate_line(text, category=fact.category, party_names=book.party_names)
        if problem is not None:
            report.reject(f"advocate_{problem.code}")
            continue
        if find_duplicate(text, [{"text": item} for item in state.forgotten]) is not None:
            report.reject("advocate_forgotten_before")
            continue

        target: dict[str, Any] | None = None
        if fact.replaces:
            target = next((line for line in state.lines if str(line.get("id")) == str(fact.replaces)), None)
        if target is None:
            target = find_duplicate(text, state.lines)
        try:
            if target is not None:
                close = find_duplicate(text, [target], threshold=0.0) or {}
                if float(close.get("_ratio") or 0.0) >= DEDUPE_SAME and target.get("category") == fact.category:
                    continue
                result = repository.update_advocate_line(
                    scope.user_id,
                    str(target.get("id")),
                    None,
                    text=text,
                    category=fact.category,
                    source_ref_extra={"updated_in_chat": source_extra.get("chat_id")},
                    actor=WRITER_ACTOR,
                )
                target.update({"text": text, "category": fact.category})
                updated = True
            else:
                room = advocate_set_room(state.lines, text)
                if room is not None:
                    report.reject("advocate_full")
                    continue
                result = repository.add_advocate_line(
                    scope.user_id,
                    fact.category,
                    text,
                    None,
                    source_ref={**source_extra, "folder_name": scope.folder_name},
                    actor=WRITER_ACTOR,
                )
                state.lines.append(dict(result.get("line") or {"text": text, "category": fact.category}))
                updated = False
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Memory] advocate fact not saved user_id=%s: %s", scope.user_id, exc)
            report.reject("advocate_write_failed")
            continue
        line = result.get("line") or {}
        report.writes += 1
        report.note(
            "advocate",
            {"id": line.get("id"), "category": fact.category, "text": text, "updated": updated},
        )


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
    # What is already saved or still being counted, read once. The extractor sees it, so
    # it neither proposes a saved rule again nor loses count of one asked for before,
    # and the proposals below are checked against the same snapshot.
    book = _Rulebook(scope)
    context.saved_rules = book.saved_rules()
    context.noticed_rules = book.noticed_rules()
    context.conversation_summary = conversation_summary(scope, turn.session_id)
    # Remembering the advocate across cases has its own switch; when it is off the
    # extractor is not shown what is remembered, and nothing about the advocate is written.
    advocate = load_advocate_state(scope) if settings.advocate_enabled else None
    if advocate is not None:
        context.advocate_lines = [
            {"id": line.get("id"), "category": line.get("category"), "text": line.get("text")}
            for line in advocate.lines
        ]

    try:
        extraction = extract_ops(turn, existing, today=today, context=context)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] extractor unavailable case_key=%s: %s", scope.case_key, exc)
        report.skipped_reason = "extractor_error"
        return

    report.reject("invalid_op", extraction.invalid)
    if extraction.nothing_durable and not extraction.ops and not extraction.proposals and not extraction.advocate:
        report.skipped_reason = "nothing_durable"
        return

    accepted = screen_ops(extraction.ops, turn.question_raw, report)
    _apply_ops(scope, accepted, existing, versions, settings, source_extra, report, today=today)
    _handle_proposals(scope, turn, extraction.proposals, source_extra, report, settings=settings, book=book)
    _handle_advocate(scope, turn, extraction.advocate, source_extra, report, state=advocate, book=book)


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
    # The read side recorded which instructions applied; the write side adds
    # what this turn changed.
    details = {key: value for key, value in (entry.get("details") or {}).items() if value}
    details.update({key: value for key, value in report.details.items() if value})
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
        "[Memory] post-turn case_key=%s writes=%s instructions_saved=%s advocate=%s proposals=%s rejected=%s "
        "skipped=%s codes=%s",
        getattr(turn.scope, "case_key", None),
        report.writes,
        report.instructions_saved,
        len(report.details.get("advocate") or []),
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
