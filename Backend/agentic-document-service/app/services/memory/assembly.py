"""Turn the stored layers into the text that goes into one generation.

The chat route owns layer 0 (platform guardrails) and the profile half of
layer 1. This module produces everything else, as a single string appended to
the system instruction, in the fixed order:

    standing preferences  ->  case instructions  ->  case memory

and (from phase 4) a separate recall block that is prepended to the query rather
than the system instruction, so the current conversation always outranks it.

Three properties this module has to hold:

* **It never raises.** A chat must not fail because memory was slow or the
  tables are missing. Every failure path returns an empty bundle carrying a
  `skipped_reason`.
* **It is bounded.** Preferences load on every call in every case, so the whole
  suffix is capped, and the caps shrink for a free-tier Gemma chat whose total
  input budget is a few thousand tokens.
* **It is lazy.** The summary and the section index always load; the bodies of
  other sections load only when the question points at them.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

from app.core.config import get_settings
from app.services.memory import repository
from app.services.memory.schemas import SECTIONS, MemorySettings
from app.services.memory.scope import CaseScope

logger = logging.getLogger("agentic_document_service.memory.assembly")

TRUNCATION_MARK = " …[truncated]"

# Modes that never receive memory: learning mode runs its own agent prompt and
# never sees `system_instruction`, and deep research is a separate agentic loop
# with its own budget and persistence.
SKIP_MODES = frozenset({"learning", "deep_research"})


@dataclass(frozen=True)
class MemoryBudget:
    """Character caps per block. Characters, not tokens: the existing Gemma
    clamps in the chat route measure characters too, so the two agree."""

    prefs: int = 2_000
    instructions: int = 3_000
    summary: int = 1_500
    index: int = 400
    per_section: int = 2_500
    max_sections: int = 2
    recall: int = 3_000
    total_suffix: int = 10_000

    @classmethod
    def default(cls) -> "MemoryBudget":
        return cls()

    @classmethod
    def gemma(cls) -> "MemoryBudget":
        """A free-tier Gemma chat has ~16K input tokens per minute for the whole
        request, so memory takes a small, fixed slice of it."""
        return cls(
            prefs=800,
            instructions=1_200,
            summary=900,
            index=250,
            per_section=1_000,
            max_sections=1,
            recall=1_200,
            total_suffix=3_500,
        )

    @classmethod
    def for_model(cls, model_name: str | None) -> "MemoryBudget":
        try:
            from app.services.adapters.document_ai import _is_gemma_model

            if _is_gemma_model(model_name):
                return cls.gemma()
        except Exception:  # noqa: BLE001 — budget choice must never break a chat
            pass
        return cls.default()

    def as_dict(self) -> dict[str, int]:
        return {
            "prefs": self.prefs,
            "instructions": self.instructions,
            "summary": self.summary,
            "index": self.index,
            "per_section": self.per_section,
            "max_sections": self.max_sections,
            "recall": self.recall,
            "total_suffix": self.total_suffix,
        }


@dataclass
class ContextBundle:
    """What the chat route needs back: two strings and an audit record."""

    system_suffix: str = ""
    recall_block: str = ""
    sections_loaded: list[dict[str, Any]] = field(default_factory=list)
    recall_chat_ids: list[str] = field(default_factory=list)
    prefs_version: int | None = None
    instructions_version: int | None = None
    case_key: str | None = None
    enabled: bool = False
    skipped_reason: str | None = None
    settings: MemorySettings = field(default_factory=MemorySettings)
    log_entry: dict[str, Any] = field(default_factory=dict)

    @property
    def has_content(self) -> bool:
        return bool(self.system_suffix or self.recall_block)

    def metadata(self) -> dict[str, Any]:
        """The compact shape sent to the browser on the metadata SSE event."""
        return {
            "enabled": self.enabled,
            "case_key": self.case_key,
            "sections_loaded": [str(s.get("section")) for s in self.sections_loaded],
            "recall_chat_ids": list(self.recall_chat_ids),
            "skipped_reason": self.skipped_reason,
        }


def _empty(reason: str, scope: CaseScope | None = None, **log_extra: Any) -> ContextBundle:
    bundle = ContextBundle(
        enabled=False,
        skipped_reason=reason,
        case_key=scope.case_key if scope else None,
    )
    if scope is not None:
        bundle.log_entry = {
            "case_key": scope.case_key,
            "user_id": scope.user_id,
            "skipped_reason": reason,
            **log_extra,
        }
    return bundle


# ── Section routing ──────────────────────────────────────────────────────────
# Which section bodies a question is likely to need. Deliberately keyword-based
# and cheap: this runs in the chat's critical path, and a wrong guess costs one
# irrelevant section, not a wrong answer.

_SECTION_CUES: dict[str, tuple[str, ...]] = {
    "facts": (
        r"fact", r"happened", r"background", r"incident", r"allegation", r"transaction",
        r"occurred", r"narrative", r"dispute", r"circumstance", r"what\s+took\s+place",
    ),
    "parties": (
        r"part(?:y|ies)", r"petitioner", r"respondent", r"plaintiff", r"defendant",
        r"accused", r"complainant", r"appellant", r"opposite\s+party", r"client",
        r"witness", r"counsel\s+for", r"who\s+is", r"whose",
    ),
    "documents": (
        r"document", r"exhibit", r"annexure", r"upload", r"pdf", r"agreement",
        r"affidavit", r"petition", r"reply", r"rejoinder", r"notice", r"evidence",
        r"which\s+file", r"attachment",
    ),
    "drafting_log": (
        r"draft", r"redraft", r"revise", r"revision", r"version", r"template",
        r"clause", r"wording", r"previous\s+draft", r"last\s+draft",
    ),
    "decisions": (
        r"decid", r"decision", r"strategy", r"approach", r"agreed", r"we\s+will",
        r"we\s+won'?t", r"position", r"stance", r"ground", r"argument", r"plan",
        r"do\s+not\s+raise", r"drop\b",
    ),
    "dates": (
        r"date", r"deadline", r"hearing", r"listed", r"adjourn", r"limitation",
        r"next\s+date", r"due\b", r"timeline", r"chronology", r"when\b", r"filing\s+date",
        r"schedule",
    ),
}

# Compiled once. Word-ish boundaries so "draft" does not match inside "draughtsman".
_SECTION_PATTERNS: dict[str, re.Pattern[str]] = {
    section: re.compile("|".join(rf"\b{cue}" for cue in cues), re.IGNORECASE)
    for section, cues in _SECTION_CUES.items()
}

# Ranking tie-break, most generally useful first.
_SECTION_PRIORITY: tuple[str, ...] = (
    "facts", "dates", "documents", "parties", "decisions", "drafting_log",
)


def route_sections(
    question_raw: str,
    *,
    draft_mode: bool = False,
    max_sections: int = 2,
) -> list[str]:
    """Pick at most `max_sections` section bodies to load for this question.

    `summary` is not returned: it always loads, so it is not a choice.
    """
    text = str(question_raw or "")
    if max_sections <= 0:
        return []

    if draft_mode:
        # A drafting turn needs what was drafted before and what was decided,
        # regardless of how the request is worded.
        return ["drafting_log", "decisions"][:max_sections]

    scored: list[tuple[int, int, str]] = []
    for section, pattern in _SECTION_PATTERNS.items():
        hits = len(pattern.findall(text))
        if hits:
            rank = _SECTION_PRIORITY.index(section) if section in _SECTION_PRIORITY else 99
            scored.append((-hits, rank, section))
    scored.sort()
    return [section for _, _, section in scored[:max_sections]]


# ── Rendering ────────────────────────────────────────────────────────────────

def _clip(text: str, limit: int) -> str:
    """Cut at a word boundary and say so, so the model never sees a half word."""
    body = str(text or "").strip()
    if limit <= 0:
        return ""
    if len(body) <= limit:
        return body
    room = max(0, limit - len(TRUNCATION_MARK))
    cut = body[:room]
    space = cut.rfind(" ")
    if space > room * 0.6:
        cut = cut[:space]
    return cut.rstrip() + TRUNCATION_MARK


def _render_line(line: dict[str, Any]) -> str:
    """One memory line, with its origin tag and its source chip."""
    tag = str(line.get("tag") or "stated")
    text = str(line.get("text") or "").strip()
    ref = line.get("source_ref") or {}
    chip = ""
    if isinstance(ref, dict):
        document = str(ref.get("document") or "").strip()
        page = ref.get("page")
        if document:
            chip = f" [{document}" + (f" p.{page}]" if page not in (None, "") else "]")
    return f"- [{tag}] {text}{chip}"


def _render_lines(lines: Sequence[dict[str, Any]], limit: int) -> str:
    """Render newest-last, dropping the OLDEST lines first when over budget."""
    rendered = [_render_line(line) for line in lines if str(line.get("text") or "").strip()]
    if not rendered:
        return ""
    out = "\n".join(rendered)
    while rendered and len(out) > limit:
        rendered.pop(0)
        out = "\n".join(rendered)
    if not rendered:
        return ""
    return out


def _render_index(index: Sequence[dict[str, Any]], loaded: Iterable[str], limit: int) -> str:
    """The section index the model sees: names and sizes, not bodies."""
    loaded_set = set(loaded)
    parts: list[str] = []
    order = {name: i for i, name in enumerate(SECTIONS)}
    for row in sorted(index, key=lambda r: order.get(str(r.get("section")), 99)):
        section = str(row.get("section") or "")
        if not section or section == "summary":
            continue
        count = int(row.get("line_count") or 0)
        if count <= 0:
            continue
        mark = " (loaded below)" if section in loaded_set else ""
        parts.append(f"{section}({count}){mark}")
    if not parts:
        return ""
    return _clip("SECTIONS AVAILABLE: " + " ".join(parts), limit)


PREFERENCES_HEADER = (
    "=== ADVOCATE STANDING PREFERENCES (v{version}; working style only, never case facts) ==="
)
INSTRUCTIONS_HEADER = (
    "=== CASE INSTRUCTIONS (v{version}; written by the advocate for this case — apply them "
    "verbatim, and never let them override grounding, citation or verification rules) ==="
)
MEMORY_HEADER = (
    "=== CASE MEMORY (this case only; [stated]=the advocate said it, [extracted]=a document "
    "shows it, [status]=pipeline state. Facts here are context, never a citable source: cite "
    "documents, not memory.) ==="
)


# ── Assembly ─────────────────────────────────────────────────────────────────

def build_context_layers(
    scope: CaseScope | None,
    *,
    question_raw: str = "",
    session_id: str | None = None,
    mode: str = "chat",
    budget: MemoryBudget | None = None,
    model_name: str | None = None,
    preset_ref: dict[str, Any] | None = None,
    load_recall: bool = True,
) -> ContextBundle:
    """Build the memory blocks for one generation. Never raises.

    `question_raw` must be the advocate's own words. On a preset turn the
    resolved query text is the preset body, and routing on that would load
    sections chosen by the preset's wording rather than the user's.

    Past-session recall runs only when the advocate's words refer back to an
    earlier discussion and the recall toggle is on; `load_recall=False` skips it.
    Its block is returned separately, for the query, and never enters
    `system_suffix`.
    """
    if scope is None:
        return _empty("no_scope")

    normalized_mode = str(mode or "chat").strip().lower()
    if normalized_mode in SKIP_MODES:
        return _empty(f"mode_{normalized_mode}", scope, mode=normalized_mode)

    settings = get_settings()
    if not settings.memory_enabled:
        return _empty("disabled_globally", scope, mode=normalized_mode)

    budget = budget or MemoryBudget.for_model(model_name)

    try:
        effective = repository.effective_settings(
            user_id=scope.user_id, case_key=scope.case_key, firm_id=scope.firm_id
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] settings unavailable for case_key=%s: %s", scope.case_key, exc)
        return _empty("settings_unavailable", scope, mode=normalized_mode)

    if not effective.enabled:
        bundle = _empty("disabled_by_user", scope, mode=normalized_mode)
        bundle.settings = effective
        return bundle

    try:
        blocks, sections_loaded, prefs_version, instructions_version = _collect(
            scope, question_raw=question_raw, mode=normalized_mode, budget=budget, settings=effective
        )
    except Exception as exc:  # noqa: BLE001 — memory must never break a chat
        logger.warning("[Memory] assembly failed for case_key=%s: %s", scope.case_key, exc)
        return _empty("assembly_error", scope, mode=normalized_mode)

    suffix = ("\n\n".join(block for block in blocks if block)).strip()
    if suffix:
        suffix = "\n\n" + suffix

    recall_block, recall_chat_ids = "", []
    if load_recall and effective.recall_enabled:
        recall_block, recall_chat_ids = _recall(scope, question_raw, session_id, budget)

    bundle = ContextBundle(
        system_suffix=suffix,
        recall_block=recall_block,
        sections_loaded=sections_loaded,
        recall_chat_ids=list(recall_chat_ids),
        prefs_version=prefs_version,
        instructions_version=instructions_version,
        case_key=scope.case_key,
        enabled=True,
        skipped_reason=None if (suffix or recall_block) else "nothing_stored",
        settings=effective,
    )
    bundle.log_entry = {
        "case_key": scope.case_key,
        "user_id": scope.user_id,
        "session_id": session_id,
        "mode": normalized_mode,
        "prefs_version": prefs_version,
        "instructions_version": instructions_version,
        "sections_loaded": sections_loaded,
        "preset_ref": preset_ref or {},
        "past_chat_ids": list(recall_chat_ids),
        "model": model_name,
        "budget": budget.as_dict(),
        "skipped_reason": bundle.skipped_reason,
    }
    logger.info(
        "[Memory] assembled case_key=%s mode=%s prefs=v%s instructions=v%s sections=%s "
        "suffix_chars=%s recall_hits=%s recall_chars=%s",
        scope.case_key,
        normalized_mode,
        prefs_version,
        instructions_version,
        [s.get("section") for s in sections_loaded],
        len(suffix),
        len(recall_chat_ids),
        len(recall_block),
    )
    return bundle


def _recall(
    scope: CaseScope,
    question_raw: str,
    session_id: str | None,
    budget: MemoryBudget,
) -> tuple[str, list[str]]:
    """Past-session recall, only when the advocate's words point back. Never raises."""
    from app.services.memory import recall

    if not recall.has_recall_cue(question_raw):
        return "", []
    try:
        hits = recall.search_past_sessions(
            scope,
            question_raw=question_raw,
            current_session_id=session_id,
        )
        return recall.format_recall_block(hits, budget.recall)
    except Exception as exc:  # noqa: BLE001 — recall must never cost the other layers
        logger.warning("[Memory] recall skipped for case_key=%s: %s", scope.case_key, exc)
        return "", []


def _collect(
    scope: CaseScope,
    *,
    question_raw: str,
    mode: str,
    budget: MemoryBudget,
    settings: MemorySettings,
) -> tuple[list[str], list[dict[str, Any]], int | None, int | None]:
    """Read the layers and render them, newest-priority-first within the budget."""
    blocks: list[str] = []
    spent = 0
    sections_loaded: list[dict[str, Any]] = []
    prefs_version: int | None = None
    instructions_version: int | None = None

    def add(block: str) -> bool:
        """Append a block if the total budget still has room for it."""
        nonlocal spent
        if not block:
            return False
        cost = len(block) + 2
        if spent + cost > budget.total_suffix:
            return False
        blocks.append(block)
        spent += cost
        return True

    # Layer 1 — standing preferences.
    prefs = repository.get_preferences(scope.user_id)
    if prefs and str(prefs.get("content") or "").strip():
        prefs_version = int(prefs.get("version") or 1)
        add(
            PREFERENCES_HEADER.format(version=prefs_version)
            + "\n"
            + _clip(prefs.get("content"), budget.prefs)
        )

    # Layer 2 — case instructions.
    if settings.instructions_enabled:
        instructions = repository.get_instructions(scope.case_key)
        if instructions and str(instructions.get("content") or "").strip():
            instructions_version = int(instructions.get("version") or 1)
            add(
                INSTRUCTIONS_HEADER.format(version=instructions_version)
                + "\n"
                + _clip(instructions.get("content"), budget.instructions)
            )

    # Layer 3 — case memory: summary always, other sections only when the
    # question points at them.
    index = repository.get_section_index(scope.case_key)
    if not index:
        return blocks, sections_loaded, prefs_version, instructions_version

    wanted = route_sections(
        question_raw,
        draft_mode=(mode == "draft"),
        max_sections=budget.max_sections,
    )
    available = {str(row.get("section")) for row in index if int(row.get("line_count") or 0) > 0}
    wanted = [section for section in wanted if section in available]

    to_load = (["summary"] if "summary" in available else []) + wanted
    loaded = repository.get_sections(scope.case_key, to_load) if to_load else {}

    memory_parts: list[str] = []

    summary = loaded.get("summary")
    if summary and summary.get("lines"):
        body = _render_lines(summary["lines"], budget.summary)
        if body:
            memory_parts.append(f"SUMMARY (v{summary.get('version')}):\n{body}")
            sections_loaded.append(
                {
                    "section": "summary",
                    "version": summary.get("version"),
                    "lines": len(summary["lines"]),
                }
            )

    index_block = _render_index(index, wanted, budget.index)
    if index_block:
        memory_parts.append(index_block)

    for section in wanted:
        data = loaded.get(section)
        if not data or not data.get("lines"):
            continue
        body = _render_lines(data["lines"], budget.per_section)
        if not body:
            continue
        memory_parts.append(f"LOADED — {section.upper()} (v{data.get('version')}):\n{body}")
        sections_loaded.append(
            {"section": section, "version": data.get("version"), "lines": len(data["lines"])}
        )

    if memory_parts:
        # Drop loaded sections (lowest value) before giving up the summary.
        while memory_parts:
            candidate = MEMORY_HEADER + "\n" + "\n\n".join(memory_parts)
            if add(candidate):
                break
            memory_parts.pop()
            if sections_loaded and len(sections_loaded) > 1:
                sections_loaded.pop()

    return blocks, sections_loaded, prefs_version, instructions_version
