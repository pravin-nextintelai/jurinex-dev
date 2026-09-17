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

from app.services.memory import script
from app.services.memory.schemas import (
    ADVOCATE_CATEGORIES,
    MAX_ADVOCATE_CHARS,
    MAX_ADVOCATE_LINES,
    MAX_CASE_CHARS,
    MAX_INSTRUCTION_ITEM_CHARS,
    MAX_INSTRUCTION_ITEMS,
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


def _devanagari(words: str) -> str:
    """Whole Devanagari words. `\\b` cannot be used: a vowel sign is not a word character."""
    return rf"(?<![{script.LETTERS}])(?:{words})(?![{script.LETTERS}])"


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
    # Marathi and Hindi: perhaps, probably, it seems, must be, could be.
    _rule(
        "inference_language",
        _devanagari(
            r"कदाचित|बहुधा|शक्यता|वाटते|वाटतं|असावा|असावी|असावे|असावेत|असू\s+शकते|असू\s+शकतो|असू\s+शकेल|"
            r"दिसते|शायद|संभवतः|संभावना|लगता\s+है|प्रतीत\s+होता|हो\s+सकता|हो\s+सकती|हो\s+सकते"
        ),
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
    # Marathi and Hindi: right now, for now, temporarily, in this chat.
    _rule(
        "transient",
        _devanagari(
            r"आत्ता|सध्यापुरते|आजपुरते|तात्पुरते|तात्पुरता|तात्पुरती|या\s+चॅटमध्ये|या\s+सत्रात|"
            r"अभी\s+के\s+लिए|फिलहाल|अस्थायी\s+रूप\s+से|इस\s+चैट\s+में"
        ),
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
    # The same, in Marathi and Hindi. `\d` also matches Devanagari digits.
    _rule(
        "case_data_date",
        r"\d{1,2}\s+(?:जानेवारी|फेब्रुवारी|मार्च|एप्रिल|मे|जून|जुलै|ऑगस्ट|सप्टेंबर|ऑक्टोबर|नोव्हेंबर|डिसेंबर|"
        r"जनवरी|फरवरी|अप्रैल|मई|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|अक्तूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर)"
        r"\S*\s+\d{4}",
        "Contains a date. Preferences are tenant-wide and must carry no case data.",
    ),
    _rule(
        "case_data_fir",
        r"एफ\.?\s?आय\.?\s?आर|गु\.?\s?र\.?\s?(?:नं|क्र)|गुन्हा\s+(?:रजिस्टर\s+)?(?:नं|क्र)|प्राथमिकी",
        "Mentions an FIR/crime number. That belongs in case memory, not here.",
    ),
    _rule(
        "case_data_case_number",
        r"(?:क्र|क्रमांक|नं)\s*\.?\s*\d+\s*/\s*\d{2,4}",
        "Contains a case number. That belongs in case memory, not here.",
    ),
    _rule(
        "case_data_party",
        rf"[{script.LETTERS}]+\s+(?:विरुद्ध|विरूद्ध|बनाम)\s+[{script.LETTERS}]",
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
# Punctuation, but not the vowel signs of Indian scripts, which `\w` does not cover:
# "मराठीत" must not become "मर ठ त". The dandas (।, ॥) are punctuation.
_PUNCT_RE = re.compile(r"[^\w\sऀ-ॣ०-෿]")
_TAG_PREFIX_RE = re.compile(r"^\s*\[(?:stated|extracted|status|inferred)\]\s*", re.IGNORECASE)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _first_match(text: str, rules: Iterable[Rule]) -> Rejection | None:
    for rule in rules:
        if rule.pattern.search(text):
            return Rejection(rule.code, rule.detail)
    return None


def normalize_for_compare(text: str) -> str:
    """Lowercase, drop any tag prefix and punctuation, collapse whitespace; "४१४४" reads "4144"."""
    cleaned = _TAG_PREFIX_RE.sub("", script.ascii_digits(text))
    cleaned = _PUNCT_RE.sub(" ", cleaned.lower())
    return _WS_RE.sub(" ", cleaned).strip()


def strip_tag_prefix(text: str) -> str:
    """Remove a leading '[stated] ' the model may have echoed into the text."""
    return _TAG_PREFIX_RE.sub("", str(text or "")).strip()


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


# ── Instruction items ────────────────────────────────────────────────────────
# One instruction per item, at case or universal scope. A universal instruction
# is loaded into every case the advocate works on, so it may carry working style
# only: a date, a case number, a party's name or anything else that belongs to
# one matter is refused there, however it is worded.

# Party names that are really institutions appear in many unrelated matters, so
# they do not mark an instruction as case-specific.
_GENERIC_PARTY_RE = re.compile(
    r"^(?:the\s+)?(?:state|union|government|govt|central|police|commissioner|collector|registrar|"
    r"municipal|corporation|authority|board|department|ministry|secretary|director|officer|"
    r"tribunal|court|bank|india|maharashtra|karnataka|delhi|gujarat|kerala|tamil|nadu|bengal|punjab)\b",
    re.IGNORECASE,
)
# Words that are part of many business names and say nothing about one case.
_NAME_STOPWORDS = frozenset(
    """
    limited private company industries enterprises traders services builders developers
    construction infrastructure textiles mills agencies associates brothers sons trust society
    association foundation institute hospital school college university insurance finance bank
    branch through proprietor partner director manager mahila nagari sahakari others another
    state government union india shri smt kumari dr adv advocate mr mrs ms
    """.split()
)

_INSTRUCTION_SET_CAPS: dict[str, int] = {"case": MAX_INSTRUCTIONS_CHARS, "user": MAX_PREFERENCES_CHARS}


def party_name_in(text: str, party_names: Iterable[str]) -> str | None:
    """The first party name that appears in `text`, or None.

    A full name matches as a phrase; a distinctive part of it ("Pawar" for
    "Sunil Pawar") matches as a whole word. Institutional parties and generic
    business words are ignored so "cite State of Maharashtra judgments first"
    can still be a universal instruction.
    """
    haystack = f" {normalize_for_compare(text)} "
    if not haystack.strip():
        return None
    for name in party_names or ():
        norm = normalize_for_compare(str(name or ""))
        if len(norm) < 4 or _GENERIC_PARTY_RE.match(norm):
            continue
        if f" {norm} " in haystack:
            return str(name)
        for token in norm.split():
            if len(token) >= 5 and token not in _NAME_STOPWORDS and f" {token} " in haystack:
                return str(name)
            # "पवार" in a Marathi line is the party "Pawar".
            if len(token) >= 5 and token not in _NAME_STOPWORDS and script.find_alike(token, text) is not None:
                return str(name)
    return None


def validate_instruction_item(
    text: str,
    *,
    scope_type: str,
    party_names: Iterable[str] = (),
) -> list[Rejection]:
    """Whether one instruction may be stored at this scope. Empty means yes."""
    clean = " ".join(str(text or "").split())
    if not clean:
        return [Rejection("empty", "The instruction is empty.")]
    problems: list[Rejection] = []
    if len(clean) > MAX_INSTRUCTION_ITEM_CHARS:
        problems.append(
            Rejection(
                "too_long",
                f"One instruction is capped at {MAX_INSTRUCTION_ITEM_CHARS} characters; split it into two.",
            )
        )
    hit = _first_match(clean, PII_RULES)
    if hit:
        problems.append(hit)
    hit = _first_match(clean, GUARDRAIL_RULES)
    if hit:
        problems.append(hit)
    if str(scope_type) == "user":
        hit = _first_match(clean, CASE_DATA_RULES)
        if hit:
            problems.append(
                Rejection(
                    hit.code,
                    "This applies in every case, so it must carry no case details. "
                    "Put facts about one matter in that case's instructions instead.",
                )
            )
        name = party_name_in(clean, party_names)
        if name:
            problems.append(
                Rejection(
                    "universal_party_name",
                    f"Names '{name}', a party in one of your cases. An instruction for every case "
                    "must not carry case details; add it to that case instead.",
                )
            )
    return problems


def instruction_set_room(
    items: Sequence[dict[str, Any]],
    new_text: str,
    *,
    scope_type: str,
) -> Rejection | None:
    """Whether the set has room for one more instruction."""
    if len(items) >= MAX_INSTRUCTION_ITEMS:
        return Rejection(
            "set_full",
            f"There are already {MAX_INSTRUCTION_ITEMS} instructions here; remove one before adding another.",
        )
    cap = _INSTRUCTION_SET_CAPS.get(str(scope_type), MAX_INSTRUCTIONS_CHARS)
    total = sum(len(str(item.get("text") or "")) for item in items) + len(" ".join(str(new_text or "").split()))
    if total > cap:
        return Rejection(
            "set_too_long",
            f"These instructions are capped at {cap} characters in total because they load into every chat; "
            "shorten or remove one first.",
        )
    return None


# ── About the advocate (remembered across every case) ────────────────────────
# A fact here loads into every case the advocate opens, so it may describe the
# advocate only: their practice, the clients they act for, how they work, their
# background. Anything that belongs to one matter is refused, however it is worded.

# "Appears before the Bench" / "appears for borrowers" is how advocates describe their
# practice, not a guess; only the hedging "it appears that" is inference.
_APPEARANCE_RE = re.compile(r"\bappear(?:s|ed|ing)?\s+(?:before|for|in|at|on\s+behalf)\b", re.IGNORECASE)


def validate_advocate_line(
    text: str,
    *,
    category: str | None = None,
    party_names: Iterable[str] = (),
) -> Rejection | None:
    """Whether one fact about the advocate may be remembered. None means it may."""
    clean = strip_tag_prefix(" ".join(str(text or "").split()))
    if category is not None and str(category) not in ADVOCATE_CATEGORIES:
        return Rejection("bad_category", f"'{category}' is not one of: {', '.join(ADVOCATE_CATEGORIES)}.")
    if not clean:
        return Rejection("empty", "The line is empty.")
    if len(clean) > MAX_LINE_CHARS:
        return Rejection("too_long", f"A remembered fact must be {MAX_LINE_CHARS} characters or fewer.")
    for rules in (PII_RULES, GUARDRAIL_RULES, SYSTEM_OUTPUT_RULES, TRANSIENT_RULES):
        hit = _first_match(clean, rules)
        if hit:
            return hit
    hit = _first_match(_APPEARANCE_RE.sub("attends", clean), INFERENCE_RULES)
    if hit:
        return hit
    hit = _first_match(clean, CASE_DATA_RULES)
    if hit:
        return Rejection(
            hit.code,
            "This is remembered in every case, so it must carry no case details. "
            "Facts about one matter belong in that case's memory.",
        )
    name = party_name_in(clean, party_names)
    if name:
        return Rejection(
            "universal_party_name",
            f"Names '{name}', a party in one of your cases. What JuriNex remembers about you "
            "must not carry case details; that belongs in the case's memory.",
        )
    return None


def advocate_set_room(lines: Sequence[dict[str, Any]], new_text: str) -> Rejection | None:
    """Whether there is room for one more fact about the advocate."""
    if len(lines) >= MAX_ADVOCATE_LINES:
        return Rejection(
            "set_full",
            f"JuriNex already remembers {MAX_ADVOCATE_LINES} things about you; forget one before adding another.",
        )
    total = sum(len(str(line.get("text") or "")) for line in lines) + len(" ".join(str(new_text or "").split()))
    if total > MAX_ADVOCATE_CHARS:
        return Rejection(
            "set_too_long",
            f"What JuriNex remembers about you is capped at {MAX_ADVOCATE_CHARS} characters because it loads into "
            "every chat; shorten or forget one first.",
        )
    return None


def split_instruction_text(text: str) -> list[str]:
    """Turn free text into instruction items: one per line, long lines split at sentences."""
    out: list[str] = []
    for raw in str(text or "").splitlines():
        line = " ".join(raw.split()).strip(" -•*•")
        if not line:
            continue
        while len(line) > MAX_INSTRUCTION_ITEM_CHARS:
            cut = line.rfind(". ", 0, MAX_INSTRUCTION_ITEM_CHARS)
            if cut < MAX_INSTRUCTION_ITEM_CHARS // 2:
                cut = line.rfind(" ", 0, MAX_INSTRUCTION_ITEM_CHARS)
            if cut <= 0:
                cut = MAX_INSTRUCTION_ITEM_CHARS - 1
            head, line = line[: cut + 1].strip(), line[cut + 1 :].strip()
            if head:
                out.append(head)
        if line:
            out.append(line)
    return out


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


# ── Rules: the same meaning, in the same direction ───────────────────────────
# `find_duplicate` compares spelling, so "Give answers in Marathi" and "Do not give
# answers in Marathi" score 0.87 and count as one. For a fact that is acceptable — the
# later statement replaces the earlier and the change is kept in the line. For a rule it
# is not: the opposite rule was dropped as "already saved", a dismissed rule blocked its
# opposite, and two opposite requests were counted as one rule and suggested together.

# "no" as in "No. 45" or "no 12" is an abbreviation, not a negation.
_NEGATION_RE = re.compile(
    r"\b(?:not|never|don'?t|doesn'?t|do\s+not|does\s+not|without|avoid|stop|skip|"
    r"instead\s+of|rather\s+than|neither|nor|no(?!\s*\.)(?!\s*\d))\b",
    re.IGNORECASE,
)
# Marathi and Hindi: don't, must not, not, never, instead of, without.
_NEGATION_DEVANAGARI_RE = re.compile(
    _devanagari(r"नको|नका|नये|नाही|नाहीत|नव्हे|कधीच|ऐवजी|नहीं|नही|बिना|बजाय|न")
)


def is_negative(text: str | None) -> bool:
    """Whether a rule asks for something NOT to be done."""
    body = str(text or "")
    return bool(_NEGATION_RE.search(body) or _NEGATION_DEVANAGARI_RE.search(body))


def same_polarity(first: str | None, second: str | None) -> bool:
    """Whether two rules point the same way: both ask for something, or both forbid it."""
    return is_negative(first) == is_negative(second)


def find_same_rule(
    text: str,
    rules: Sequence[dict[str, Any]],
    threshold: float = DEDUPE_NEAR,
) -> dict[str, Any] | None:
    """`find_duplicate` for rules: never matches one that asks for the opposite."""
    return find_duplicate(text, [rule for rule in rules if same_polarity(text, str(rule.get("text") or ""))], threshold)


def _rule_words(text: str) -> set[str]:
    words = {word for word in normalize_for_compare(text).split() if len(word) >= 4}
    return {word[:-1] if word.endswith("s") and len(word) > 4 else word for word in words}


def repeats_rule(text: str | None, rule_text: str | None) -> bool:
    """Whether a new request plausibly asks for the same rule as an earlier one.

    Used to check, not trust, a model's claim that a request repeats a noticed rule. The
    two must point the same way, and share either close wording or at least half of the
    shorter one's words.
    """
    new, old = str(text or ""), str(rule_text or "")
    if not new.strip() or not old.strip() or not same_polarity(new, old):
        return False
    if find_duplicate(new, [{"text": old}], 0.6) is not None:
        return True
    first, second = _rule_words(new), _rule_words(old)
    if not first or not second:
        return False
    # Marathi words match with their endings: "उत्तरे" is "उत्तर".
    shared = {word for word in first if word in second or script.alike_any(word, second, min_sounds=2)}
    return len(shared) / min(len(first), len(second)) >= 0.5


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
