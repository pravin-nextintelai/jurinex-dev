"""What may be stored in memory, and what may never be.

Pure functions only — no DB, no network — so the whole rule set is unit-testable.

Two directions of failure this closes:
  * storing everything  -> transient chatter and drafts crowd out real facts
  * storing inferences  -> one hallucination becomes a permanent "fact"

The rules are held in `_RULES` so tests can enumerate them and so a rejection
carries a stable machine-readable `code` the UI can render.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable, NamedTuple, Sequence

from app.services.memory.schemas import (
    MAX_CASE_CHARS,
    MAX_INSTRUCTIONS_CHARS,
    MAX_LINE_CHARS,
    MAX_PREFERENCES_CHARS,
    MAX_PREFERENCES_WORDS,
    MAX_SECTION_LINES,
    MAX_SUMMARY_CHARS,
    MAX_SUMMARY_LINES,
    MemoryLine,
    MemoryOp,
    TAGS,
)


class Rejection(NamedTuple):
    """Why a piece of text may not be stored."""

    code: str
    detail: str


@dataclass(frozen=True)
class Rule:
    code: str
    pattern: re.Pattern[str]
    detail: str


def _rule(code: str, pattern: str, detail: str) -> Rule:
    return Rule(code=code, pattern=re.compile(pattern, re.IGNORECASE), detail=detail)


# ── Rule sets ────────────────────────────────────────────────────────────────

# A model conclusion dressed as a fact. "The complaint is likely retaliatory"
# must never enter memory; it is surfaced to the advocate instead.
INFERENCE_RULES: tuple[Rule, ...] = (
    _rule(
        "inference_language",
        r"\b(probably|likely|presumably|possibly|perhaps|seems?\s|seemed|appears?\s|appeared|"
        r"might\s+be|may\s+be|could\s+be|i\s+think|i\s+believe|i\s+assume|assuming|"
        r"suggests?\b|suggesting|implies|implied|inferred|infer\b|it\s+is\s+inferred|"
        r"in\s+all\s+likelihood|arguably)",
        "Reads as a conclusion, not something the user stated or a document shows.",
    ),
)

# Facts that expire on their own. Filing them creates stale noise.
TRANSIENT_RULES: tuple[Rule, ...] = (
    _rule(
        "transient",
        r"\b(this\s+session|in\s+this\s+chat|right\s+now|just\s+now|for\s+now|"
        r"temporarily|at\s+the\s+moment|as\s+of\s+this\s+message|currently\s+typing|"
        r"i\s+am\s+in\s+a\s+hurry|be\s+concise\s+today|after\s+lunch|later\s+today)",
        "Transient context; it belongs in the message, not in memory.",
    ),
)

# The system's own output: options it offered, analysis it produced, draft text.
SYSTEM_OUTPUT_RULES: tuple[Rule, ...] = (
    _rule(
        "system_output",
        r"^\s*(option\s*\d*\b|alternatively\b|you\s+could\b|we\s+could\b|consider\s+"
        r"|suggest(ion|ed|s)?\b|recommend(ation|ed|s)?\b|draft:|proposed\s+wording|here\s+is\s+)",
        "Looks like a suggestion, option list or draft text; those live in the drafting log, not memory.",
    ),
)

# Never stored anywhere, in any layer. Ordered most specific first, because a
# 12-digit account number also matches the Aadhaar shape and the caller shows
# the matched rule's wording to the advocate.
PII_RULES: tuple[Rule, ...] = (
    _rule(
        "pii_bank_account",
        r"\b(a/c|acct|account\s*(no|number))\b[^\n]{0,20}\d{9,18}",
        "Contains what looks like a bank account number.",
    ),
    _rule("pii_ifsc", r"\b[A-Z]{4}0[A-Z0-9]{6}\b", "Contains what looks like an IFSC code."),
    _rule("pii_pan", r"\b[A-Z]{5}\d{4}[A-Z]\b", "Contains what looks like a PAN."),
    _rule("pii_card", r"\b(?:\d[ -]?){13,19}\b", "Contains what looks like a card number."),
    _rule("pii_aadhaar", r"\b\d{4}\s?\d{4}\s?\d{4}\b", "Contains what looks like an Aadhaar number."),
)

# Case data that must never reach a tenant-wide or cross-case store.
CASE_DATA_RULES: tuple[Rule, ...] = (
    _rule(
        "case_data_date",
        r"(\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b"
        r"|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b"
        r"|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b)",
        "Contains a date. Preferences are tenant-wide and must carry no case data.",
    ),
    _rule(
        "case_data_fir",
        r"(\bf\.?\s?i\.?\s?r\.?\b|\bcrime\s*no\b|\bfir\s*(no|number)\b)",
        "Mentions an FIR/crime number. That belongs in case memory, not here.",
    ),
    _rule(
        "case_data_case_number",
        r"\b(w\.?p\.?|crl|o\.?s\.?|c\.?s\.?|slp|cwp|rfa|crp|c\.?c\.?|m\.?a\.?|s\.?a\.?)\b"
        r"[^\n]{0,10}\d+\s*(/|of)\s*\d{2,4}",
        "Contains a case number. That belongs in case memory, not here.",
    ),
    _rule(
        "case_data_party",
        r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:v\.?s?\.?|versus)\s+[A-Z]",
        "Names parties to a matter. Preferences are tenant-wide and must carry no case data.",
    ),
)

# Free text that tries to switch off grounding, verification or the guardrails.
GUARDRAIL_RULES: tuple[Rule, ...] = (
    _rule(
        "guardrail_disable",
        r"\b(ignore|disregard|override|bypass|disable|turn\s+off|skip|suppress)\b[^\n]{0,50}"
        r"\b(rule|rules|guardrail|guardrails|safety|grounding|citation|citations|instruction|"
        r"instructions|system\s+prompt|verification|verify|checklist|policy|protocol)\b",
        "Tries to switch off a platform rule. Instructions may narrow behaviour, never disable it.",
    ),
    _rule(
        "guardrail_never_say",
        r"never\s+say\b[^\n]{0,40}\bnot\s+(available|found|in\s+the\s+(documents|materials|record))",
        "Tries to stop the assistant from admitting a gap in the materials.",
    ),
    _rule(
        "guardrail_force_answer",
        r"\b(always|just)\s+answer\b[^\n]{0,30}\beven\s+if\b",
        "Tries to force an answer where the materials do not support one.",
    ),
    _rule(
        "guardrail_invent",
        r"\b(invent|make\s+up|fabricate|assume|guess)\b[^\n]{0,25}"
        r"\b(fact|facts|date|dates|citation|citations|case|cases|authority)\b",
        "Tries to authorise inventing facts or citations.",
    ),
    _rule(
        "guardrail_persona_break",
        r"\b(pretend\s+(you|to)|act\s+as\s+if|you\s+are\s+no\s+longer|developer\s+mode|jailbreak|dan\s+mode)\b",
        "Tries to break the assistant out of its role.",
    ),
)

# Everything, for tests that want to enumerate the whole rule surface.
_RULES: dict[str, tuple[Rule, ...]] = {
    "inference": INFERENCE_RULES,
    "transient": TRANSIENT_RULES,
    "system_output": SYSTEM_OUTPUT_RULES,
    "pii": PII_RULES,
    "case_data": CASE_DATA_RULES,
    "guardrail": GUARDRAIL_RULES,
}

# Dedupe thresholds: at or above NEAR the new line supersedes the old one; at or
# above SAME it adds nothing and is dropped.
DEDUPE_NEAR = 0.85
DEDUPE_SAME = 0.97

_WS_RE = re.compile(r"\s+")
_PUNCT_RE = re.compile(r"[^\w\s]")
_TAG_PREFIX_RE = re.compile(r"^\s*\[(?:stated|extracted|status|inferred)\]\s*", re.IGNORECASE)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _first_match(text: str, rules: Iterable[Rule]) -> Rejection | None:
    for rule in rules:
        if rule.pattern.search(text):
            return Rejection(rule.code, rule.detail)
    return None


def normalize_for_compare(text: str) -> str:
    """Lowercase, drop any tag prefix and punctuation, collapse whitespace."""
    cleaned = _TAG_PREFIX_RE.sub("", str(text or ""))
    cleaned = _PUNCT_RE.sub(" ", cleaned.lower())
    return _WS_RE.sub(" ", cleaned).strip()


def strip_tag_prefix(text: str) -> str:
    """Remove a leading '[stated] ' the model may have echoed into the text."""
    return _TAG_PREFIX_RE.sub("", str(text or "")).strip()


def drop_matching_line(content: str, text: str) -> tuple[str, bool]:
    """Remove the last line of `content` that says the same thing as `text`.

    Used to undo an instruction saved from chat. The advocate may have edited
    the instructions since, so only a line that still matches is removed.
    """
    body = str(content or "")
    target = normalize_for_compare(text)
    if not target:
        return body, False
    rows = body.split("\n")
    for index in range(len(rows) - 1, -1, -1):
        if normalize_for_compare(rows[index]) == target:
            return "\n".join(rows[:index] + rows[index + 1 :]).strip("\n"), True
    return body, False


def redact_or_reject_pii(text: str) -> Rejection | None:
    """Personal identifiers are never stored, in any layer."""
    return _first_match(str(text or ""), PII_RULES)


# ── Line validation ──────────────────────────────────────────────────────────

def validate_line(
    tag: str,
    text: str,
    *,
    section: str,
    doc_names: Sequence[str] | None = None,
    source: str = "user",
    document: str | None = None,
) -> Rejection | None:
    """Decide whether one memory line may be stored. None means it may."""
    clean = strip_tag_prefix(text)

    if str(tag).lower() not in TAGS:
        return Rejection(
            "bad_tag",
            f"Tag '{tag}' is not allowed. Only {', '.join(TAGS)} are stored; a model conclusion is never a fact.",
        )
    if not clean:
        return Rejection("empty", "The line is empty.")
    if len(clean) > MAX_LINE_CHARS:
        return Rejection("too_long", f"A memory line must be {MAX_LINE_CHARS} characters or fewer.")
    if clean.count("\n") >= 3:
        return Rejection("multiline", "A memory line is one fact on one line, not a block of text.")

    hit = redact_or_reject_pii(clean)
    if hit:
        return hit

    # `status` lines are pipeline bookkeeping ("Draft v2 accepted, prayer clause
    # to revise"), so the suggestion/inference wording checks do not apply.
    # System-output shapes are checked first: a line that OPENS with "Suggest…"
    # is an option the system offered, which is a more useful thing to say than
    # "that reads like an inference".
    if str(tag).lower() != "status":
        hit = _first_match(clean, SYSTEM_OUTPUT_RULES)
        if hit:
            return hit
        hit = _first_match(clean, INFERENCE_RULES)
        if hit:
            return hit

    hit = _first_match(clean, TRANSIENT_RULES)
    if hit:
        return hit

    if str(tag).lower() == "extracted":
        named = (document or "").strip()
        if not named:
            return Rejection(
                "extracted_without_document",
                "An [extracted] line must name the document it came from.",
            )
        if doc_names is not None and not _document_exists(named, doc_names):
            return Rejection(
                "unknown_document",
                f"'{named}' is not a document in this case.",
            )

    if section == "summary" and len(clean) > MAX_SUMMARY_CHARS:
        return Rejection("summary_too_long", "The summary section is capped at 1,500 characters.")

    return None


def _document_exists(named: str, doc_names: Sequence[str]) -> bool:
    target = named.strip().lower()
    for name in doc_names:
        candidate = str(name or "").strip().lower()
        if not candidate:
            continue
        if target == candidate or target in candidate or candidate in target:
            return True
    return False


# ── Layer 1 / Layer 2 validation ─────────────────────────────────────────────

def validate_preferences(text: str) -> list[Rejection]:
    """Tenant-wide working style. Small, behavioural, and free of case data."""
    clean = str(text or "").strip()
    problems: list[Rejection] = []
    if len(clean) > MAX_PREFERENCES_CHARS:
        problems.append(
            Rejection("too_long", f"Preferences are capped at {MAX_PREFERENCES_CHARS} characters.")
        )
    words = len(clean.split())
    if words > MAX_PREFERENCES_WORDS:
        problems.append(
            Rejection(
                "too_many_words",
                f"Preferences load on every call in every case; keep them under "
                f"{MAX_PREFERENCES_WORDS} words (currently {words}).",
            )
        )
    for rules in (PII_RULES, CASE_DATA_RULES, GUARDRAIL_RULES):
        hit = _first_match(clean, rules)
        if hit:
            problems.append(hit)
    return problems


def validate_instructions(text: str) -> list[Rejection]:
    """Standing orders for one case. May narrow behaviour, never disable it."""
    clean = str(text or "").strip()
    problems: list[Rejection] = []
    if len(clean) > MAX_INSTRUCTIONS_CHARS:
        problems.append(
            Rejection("too_long", f"Case instructions are capped at {MAX_INSTRUCTIONS_CHARS} characters.")
        )
    hit = _first_match(clean, PII_RULES)
    if hit:
        problems.append(hit)
    hit = _first_match(clean, GUARDRAIL_RULES)
    if hit:
        problems.append(hit)
    return problems


# ── Dedupe ───────────────────────────────────────────────────────────────────

def find_duplicate(
    text: str,
    existing_lines: Sequence[dict[str, Any]],
    threshold: float = DEDUPE_NEAR,
) -> dict[str, Any] | None:
    """Closest existing line at or above `threshold`, or None."""
    target = normalize_for_compare(text)
    if not target:
        return None
    best: dict[str, Any] | None = None
    best_ratio = 0.0
    for line in existing_lines:
        candidate = normalize_for_compare(str(line.get("text") or ""))
        if not candidate:
            continue
        ratio = difflib.SequenceMatcher(None, target, candidate).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best = line
    if best is not None and best_ratio >= threshold:
        enriched = dict(best)
        enriched["_ratio"] = round(best_ratio, 4)
        return enriched
    return None


def merge_with_history(new_text: str, old_text: str, *, today: date | None = None) -> str:
    """Keep the superseded fact in-line rather than overwriting it.

    "Custody: judicial since 24-08 (earlier: police custody; updated 2026-09-10)"
    beats losing the earlier state entirely. Falls back to the new text alone if
    the merged form would exceed the line cap.
    """
    stamp = (today or date.today()).isoformat()
    new_clean = strip_tag_prefix(new_text)
    old_clean = strip_tag_prefix(old_text)
    if not old_clean:
        return new_clean[:MAX_LINE_CHARS]

    room = MAX_LINE_CHARS - len(new_clean) - len(f" (earlier: ; updated {stamp})")
    if room < 12:
        return new_clean[:MAX_LINE_CHARS]
    short_old = old_clean if len(old_clean) <= room else old_clean[: room - 1].rstrip() + "…"
    merged = f"{new_clean} (earlier: {short_old}; updated {stamp})"
    return merged[:MAX_LINE_CHARS]


# ── Op validation ────────────────────────────────────────────────────────────

@dataclass
class ResolvedOp:
    """An op after validation: ready for the repository, with dedupe applied."""

    op: str
    section: str
    tag: str = "stated"
    text: str = ""
    source_ref: dict[str, Any] = None  # type: ignore[assignment]
    line_id: str | None = None
    lines: list[dict[str, Any]] = None  # type: ignore[assignment]
    sensitive: bool = False
    reason: str = ""

    def __post_init__(self) -> None:
        if self.source_ref is None:
            self.source_ref = {}
        if self.lines is None:
            self.lines = []


def validate_ops(
    ops: Sequence[MemoryOp],
    existing: dict[str, list[dict[str, Any]]],
    *,
    doc_names: Sequence[str] | None = None,
    allow_sensitive: bool = True,
    today: date | None = None,
) -> tuple[list[ResolvedOp], list[Rejection]]:
    """Turn extractor ops into repository ops, dropping anything that fails a rule.

    Dedupe runs here, against a snapshot of the sections: a near-duplicate
    `append_line` becomes a `replace_line` on the matched line, and an identical
    one is dropped. `existing` is mutated locally only (a copy is kept per
    section) so several ops in one turn cannot re-add the same fact.
    """
    resolved: list[ResolvedOp] = []
    rejections: list[Rejection] = []
    snapshot: dict[str, list[dict[str, Any]]] = {
        section: [dict(line) for line in lines] for section, lines in (existing or {}).items()
    }

    for op in ops:
        section = str(op.section)
        kind = str(op.op)

        if kind == "delete_section":
            # The pipeline may never delete a section; only an explicit user
            # action can (guide 5.5: "Only on explicit user action").
            rejections.append(
                Rejection("delete_not_allowed", "delete_section is a user action, not a pipeline write.")
            )
            continue

        if kind in {"create_section", "rewrite_section"}:
            kept: list[dict[str, Any]] = []
            for line in op.lines or []:
                bad = _check_line(line, section=section, doc_names=doc_names, allow_sensitive=allow_sensitive)
                if bad:
                    rejections.append(bad)
                    continue
                kept.append(_line_payload(line))
            if not kept:
                continue
            limit = MAX_SUMMARY_LINES if section == "summary" else MAX_SECTION_LINES
            if len(kept) > limit:
                kept = kept[:limit]
            resolved.append(
                ResolvedOp(op=kind, section=section, lines=kept, reason=op.reason or "")
            )
            snapshot[section] = [dict(line) for line in kept]
            continue

        if kind not in {"append_line", "replace_line"}:
            rejections.append(Rejection("bad_op", f"Unknown operation '{kind}'."))
            continue

        line = op.line
        if line is None:
            rejections.append(Rejection("missing_line", f"Operation '{kind}' carries no line."))
            continue
        bad = _check_line(line, section=section, doc_names=doc_names, allow_sensitive=allow_sensitive)
        if bad:
            rejections.append(bad)
            continue

        text = strip_tag_prefix(line.text)
        section_lines = snapshot.setdefault(section, [])

        # An explicit replace target wins; otherwise look for a near-duplicate.
        target: dict[str, Any] | None = None
        if op.line_id:
            target = next((l for l in section_lines if str(l.get("id")) == str(op.line_id)), None)
        if target is None and op.match_text:
            target = find_duplicate(op.match_text, section_lines, DEDUPE_NEAR)
        if target is None:
            target = find_duplicate(text, section_lines, DEDUPE_NEAR)

        if target is not None:
            ratio = float(target.get("_ratio") or 0.0)
            if ratio >= DEDUPE_SAME and not line.changed:
                rejections.append(
                    Rejection("duplicate", "That fact is already recorded; nothing to add.")
                )
                continue
            final_text = (
                merge_with_history(text, str(target.get("text") or ""), today=today)
                if line.changed
                else text
            )
            resolved.append(
                ResolvedOp(
                    op="replace_line",
                    section=section,
                    tag=line.tag,
                    text=final_text,
                    line_id=str(target.get("id")) if target.get("id") is not None else None,
                    source_ref=_source_ref(line),
                    sensitive=bool(line.sensitive),
                    reason=op.reason or "",
                )
            )
            target["text"] = final_text
            continue

        limit = MAX_SUMMARY_LINES if section == "summary" else MAX_SECTION_LINES
        if len(section_lines) >= limit:
            rejections.append(
                Rejection("section_full", f"The '{section}' section is at its {limit}-line cap.")
            )
            continue

        resolved.append(
            ResolvedOp(
                op="append_line",
                section=section,
                tag=line.tag,
                text=text,
                source_ref=_source_ref(line),
                sensitive=bool(line.sensitive),
                reason=op.reason or "",
            )
        )
        section_lines.append({"id": None, "text": text, "tag": line.tag})

    return resolved, rejections


def _check_line(
    line: MemoryLine,
    *,
    section: str,
    doc_names: Sequence[str] | None,
    allow_sensitive: bool,
) -> Rejection | None:
    if line.sensitive and not allow_sensitive:
        return Rejection(
            "sensitive_disabled",
            "Sensitive personal details are turned off for this advocate.",
        )
    return validate_line(
        line.tag,
        line.text,
        section=section,
        doc_names=doc_names,
        source=line.source,
        document=line.document,
    )


def _line_payload(line: MemoryLine) -> dict[str, Any]:
    return {
        "tag": line.tag,
        "text": strip_tag_prefix(line.text),
        "source_ref": _source_ref(line),
        "sensitive": bool(line.sensitive),
    }


def _source_ref(line: MemoryLine) -> dict[str, Any]:
    ref: dict[str, Any] = {"source": line.source}
    if line.document:
        ref["document"] = line.document
    if line.sensitive:
        ref["sensitive"] = True
    return ref


def total_chars(sections: dict[str, list[dict[str, Any]]]) -> int:
    """Rough size of a case's whole memory, for the per-case cap."""
    return sum(len(str(line.get("text") or "")) for lines in sections.values() for line in lines)


def case_over_cap(sections: dict[str, list[dict[str, Any]]]) -> bool:
    return total_chars(sections) > MAX_CASE_CHARS
