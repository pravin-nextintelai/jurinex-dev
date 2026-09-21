"""One fact, one line: the same fact written two ways is merged, never kept twice.

Case memory held the same event twice, in different words: "25 Aug 2006: Registered sale
deed executed" from the case's chronology, then "Registered Sale Deed No. 4401/2006 was
executed on 25/08/2006" from an answer. The dedupe in validator.py compares spelling, and
these two share too little of it; `answer_facts.adds_to` then kept the second because it
adds a deed number. Read turn after turn, one case held a dozen facts twice.

Telling that two lines are one fact takes reading them, so it is done in three steps:

1. **Candidates, without a model.** A saved line can be the same fact as a new one only
   when both name the same whole date, or the same document, suit, survey or amount
   number, and share a word about what happened; or, with no date or number on either,
   name the same people or offices. Two different dates are two events: "Suit No.
   17/2005 instituted" on 12/07/2005 and "decreed" on 02/09/2006 are never compared.
2. **The judgement, from a small model.** It says whether a candidate records the same
   fact (the same deed, order, payment or party, not merely the same suit or property)
   and writes one line that says everything both say.
3. **The check, without a model.** The merged line must keep every date, number and name
   of both lines, add none, add no negation, and keep most of their words. A merge that
   fails the check is not written, and neither is the repeat.

A line the advocate stated is never rewritten: a fact from a document that repeats it is
simply not kept. Seeding uses step 1 with a coverage check instead of a model, so a
chronology line that a saved line already says in fuller words is not added again.
`plan_tidy` and `tidy_case` apply the same steps to what a case already holds.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Callable, Sequence

from app.services.memory import answer_facts, script
from app.services.memory.schemas import MAX_LINE_CHARS, SECTIONS
from app.services.memory.validator import is_negative

logger = logging.getLogger("agentic_document_service.memory.same_fact")

MAX_CANDIDATES = 3
# Share of each line's words a merged line must keep, and how many words it may add.
MIN_WORDS_KEPT = 0.75
MAX_NEW_WORDS = 3
# Share of a line's words a saved line must hold to cover it, when no model is asked.
COVER_WORDS = 0.5
# Documents and pages a merged line remembers besides its first source.
MAX_ALSO = 6
MERGE_ACTOR = "memory-writer"
MERGE_REASON = "same fact"
# A dated fact read from a document belongs with the case's dates.
DATED_SECTIONS = ("documents", "facts")

JUDGE_PROMPT = """\
You keep the memory file of one legal case free of repeats.

Each ITEM has a NEW line and up to three SAVED lines from the same case's memory. Say
which SAVED line, if any, records the same fact as NEW:
- the same event: the same deed executed, suit filed, order passed, notice or letter
  issued, application made or payment made;
- the same person, office or body in the same role in the case;
- the same description of the same document or property.
Sharing a date, a suit or survey number, a property or a person is not enough.
"Suit No. 17/2005 instituted on 12.07.2005" and "Written statement filed in Suit No.
17/2005" are different facts. "Gat No. 111/3 measures 6 H 40 R" and "Gat No. 111/3 is
assessed at Rs. 13" are different facts.

For the same fact, write "merged": one line that says everything both lines say.
- Keep every name, date, number and amount, written as in either line.
- Add nothing that neither line says: no inference, no opinion, no new date. Never
  attach a date to something the lines do not say happened on it.
- Start with the date when the SAVED line starts with one, as "25 Aug 2006: ...".
- Plain text, at most 250 characters, in the language of the SAVED line.

Return JSON only, one entry per ITEM:
{"items": [{"item": 1, "same_as": "A", "merged": "..."}, {"item": 2, "same_as": null, "merged": null}]}
"""

_LETTERS = "ABC"
_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
# The "(earlier: …; updated …)" note a changed fact carries (validator.merge_with_history).
_HISTORY_RE = re.compile(r"\s*\(earlier:.*$", re.IGNORECASE | re.DOTALL)
_COMPOUND_RE = re.compile(r"\d+(?:\s*[/-]\s*\d+)+")
_RUN_RE = re.compile(r"\d+")
# The words that name a numbered thing: "Special Civil Suit" in "Special Civil Suit No. 17/2005".
_LABEL_RE = re.compile(r"((?:[A-Za-z][\w'&.-]*\s+){1,4})(?:No|Nos|Number)\b\.?", re.IGNORECASE)
# Words that say who or where, not what happened: every fact in a case shares them.
_GENERIC_WORDS = frozenset(
    """
    petitioner respondent plaintiff defendant applicant appellant accus complainant
    court case cases matter document page copy annexure dated date number
    """.split()
)


# ── What a line says ─────────────────────────────────────────────────────────

def current(text: Any) -> str:
    """A line without the earlier value it keeps in brackets."""
    return _HISTORY_RE.sub("", str(text or "")).strip()


def _history(text: Any) -> str:
    found = _HISTORY_RE.search(str(text or ""))
    return found.group(0) if found else ""


def _valid_day_month(day: str, month: int | None) -> bool:
    return bool(month) and 1 <= int(day) <= 31


def _without_dates(body: str) -> str:
    """The text with its dates taken out, so a date's day and month are not read as numbers."""
    body = answer_facts._ISO_DATE_RE.sub(
        lambda m: " " if _valid_day_month(m.group(3), int(m.group(2)) if 1 <= int(m.group(2)) <= 12 else None) else m.group(0),
        body,
    )
    body = answer_facts._NUMERIC_DATE_RE.sub(
        lambda m: " " if _valid_day_month(m.group(1), int(m.group(2)) if 1 <= int(m.group(2)) <= 12 else None) else m.group(0),
        body,
    )
    body = answer_facts._DAY_MONTH_RE.sub(
        lambda m: " " if _valid_day_month(m.group(1), answer_facts._month(m.group(2))) else m.group(0), body
    )
    return answer_facts._MONTH_DAY_RE.sub(
        lambda m: " " if _valid_day_month(m.group(2), answer_facts._month(m.group(1))) else m.group(0), body
    )


@dataclass(frozen=True)
class Facets:
    """What a line says that can be compared: its dates, numbers, names and words."""

    dates: frozenset[tuple[int, int, int]]
    # Every number outside a date: "Rs. 1,53,600", "No. 3", "111/3" -> {"153600", "3", "111"}.
    numbers: frozenset[str]
    # Numbers that name one thing: "17/2005", "4401", "153600". Not a year, not "No. 3".
    identifiers: frozenset[str]
    names: frozenset[str]
    words: frozenset[str]
    negative: bool
    # Words naming a numbered thing ("special", "civil", "suit"): every fact about that
    # suit shares them, so they say nothing about which event a line records.
    labels: frozenset[str] = frozenset()

    @property
    def event_words(self) -> frozenset[str]:
        """The words about what happened: not names, not the parties' roles, not a number's label."""
        return frozenset(
            word
            for word in self.words
            if word not in self.names and word not in _GENERIC_WORDS and word not in self.labels
        )


@lru_cache(maxsize=4096)
def facets(text: str) -> Facets:
    from app.services.memory.writer import content_words

    body = answer_facts._normalise(str(text or ""))
    rest = _without_dates(body)
    runs = [run.lstrip("0") for run in _RUN_RE.findall(rest) if run.strip("0")]
    identifiers = {re.sub(r"\s+", "", found.group(0)) for found in _COMPOUND_RE.finditer(rest)}
    identifiers |= {
        run.lstrip("0")
        for run in _RUN_RE.findall(_COMPOUND_RE.sub(" ", rest))
        if len(run.lstrip("0")) >= 3 and not answer_facts._YEAR_RE.match(run)
    }
    labels: set[str] = set()
    for found in _LABEL_RE.finditer(str(text or "")):
        labels |= content_words(found.group(1))
    return Facets(
        dates=frozenset(answer_facts._dates(body)),
        numbers=frozenset(runs),
        identifiers=frozenset(identifiers),
        names=frozenset(answer_facts._names(str(text or ""))),
        words=frozenset(content_words(str(text or ""))),
        negative=is_negative(text),
        labels=frozenset(labels),
    )


def _alike(word: str, other: str) -> bool:
    """One word written two ways: "inform" and "information", "Nazarana" and "Nazrana", "पवार" and "Pawar"."""
    if word == other:
        return True
    shorter, longer = sorted((word, other), key=len)
    if len(shorter) >= 5 and longer.startswith(shorter):
        return True
    if script.has_devanagari(word) or script.has_devanagari(other):
        return script.sound_alike(word, other)
    sounds = script.skeleton(word)
    return len(sounds) >= 4 and sounds == script.skeleton(other)


def _shared(words: frozenset[str], other: frozenset[str]) -> set[str]:
    return {word for word in words if word in other or any(_alike(word, candidate) for candidate in other)}


# ── Step 1: candidates ───────────────────────────────────────────────────────

# A party is compared by its names when this share of the shorter list is in the other.
PARTY_NAMES_SHARED = 0.6


def _score(new: Facets, old: Facets, *, parties: bool) -> float:
    """How strongly a saved line looks like the same fact as a new one; 0 when it cannot be."""
    if new.dates and old.dates and not new.dates & old.dates:
        return 0.0  # two different dates: two events
    dates = new.dates & old.dates
    identifiers = new.identifiers & old.identifiers
    if dates:
        words = _shared(new.words - _GENERIC_WORDS, old.words - _GENERIC_WORDS)
        if words or identifiers:
            return 4.0 + len(identifiers) + 0.5 * len(words)
        return 0.0
    words = _shared(new.event_words, old.event_words)
    if identifiers and words:
        if bool(new.dates) != bool(old.dates):
            # A number in common is not enough to tie an undated line to a dated event:
            # "Written statement filed in Suit No. 17/2005" is not the suit's institution.
            undated = old if new.dates else new
            if len(words) < 0.5 * len(undated.event_words):
                return 0.0
        return 2.0 + len(identifiers) + 0.5 * len(words)
    if parties and not (new.dates or old.dates):
        names = _shared(new.names, old.names)
        fewest = min(len(new.names), len(old.names))
        if len(names) >= 2 and len(names) >= PARTY_NAMES_SHARED * fewest:
            return 1.0 + 0.25 * len(names)  # the same people or office
    return 0.0


def candidates(
    text: str,
    lines: Sequence[dict[str, Any]],
    *,
    section: str | None = None,
    limit: int = MAX_CANDIDATES,
) -> list[dict[str, Any]]:
    """Saved lines that may record the same fact as `text`, most likely first.

    People are compared by name only within Parties: "Respondent: The Tahsildar,
    Nandurbar" and a payment made to the Tahsildar share names, not a fact.
    """
    new = facets(current(text))
    if not (new.dates or new.identifiers or new.names):
        return []
    scored: list[tuple[float, int, dict[str, Any]]] = []
    for index, line in enumerate(lines):
        body = current(line.get("text"))
        if not body:
            continue
        parties = section == "parties" and line.get("section") == "parties"
        score = _score(new, facets(body), parties=parties)
        if score > 0:
            scored.append((score, -index, line))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [line for _, _, line in scored[:limit]]


# ── Step 3: the check ────────────────────────────────────────────────────────

def keeps_everything(merged: str | None, originals: Sequence[str]) -> bool:
    """Whether one line says everything the originals say, and nothing they do not.

    Every date, number and name of every original must be in it, and no other; no
    negation may appear that none of them had; and it must keep most of each original's
    words while adding at most a few of its own.
    """
    body = " ".join(str(merged or "").split())
    texts = [current(text) for text in originals if current(text)]
    if not body or not texts or len(body) > MAX_LINE_CHARS:
        return False
    got = facets(body)
    wanted = [facets(text) for text in texts]
    if got.dates != frozenset().union(*(item.dates for item in wanted)):
        return False
    if got.numbers != frozenset().union(*(item.numbers for item in wanted)):
        return False
    joined = "\n".join(texts)
    if any(not answer_facts._name_in(name, body) for item in wanted for name in item.names):
        return False
    if any(not answer_facts._name_in(name, joined) for name in got.names):
        return False
    if got.negative and not any(item.negative for item in wanted):
        return False
    for item in wanted:
        if item.words and len(_shared(item.words, got.words)) < MIN_WORDS_KEPT * len(item.words):
            return False
    everything = frozenset().union(*(item.words for item in wanted))
    return len(got.words - frozenset(_shared(got.words, everything))) <= MAX_NEW_WORDS


def covers(saved: str, other: str, *, min_words: float = COVER_WORDS) -> bool:
    """Whether a saved line already says what another says: its dates, numbers, names and most words."""
    body, text = current(saved), current(other)
    if not body or not text:
        return False
    have, want = facets(body), facets(text)
    if not want.dates <= have.dates or not want.numbers <= have.numbers:
        return False
    if any(not answer_facts._name_in(name, body) for name in want.names):
        return False
    if not want.words:
        return True
    return len(_shared(want.words, have.words)) >= min_words * len(want.words)


def best_merge(saved_text: str, new_text: str, proposed: str | None) -> str | None:
    """The line to keep for two lines judged the same fact, or None when none is safe.

    The model's merge if it passes the check; else whichever of the two lines already
    says everything. A saved line's "(earlier: …)" note stays on it when there is room.
    """
    saved = current(saved_text)
    for option in (proposed, saved, new_text):
        text = " ".join(str(option or "").split())
        if text and keeps_everything(text, [saved, new_text]):
            note = _history(saved_text)
            return text + note if note and len(text + note) <= MAX_LINE_CHARS else text
    return None


def merged_source_ref(saved: dict[str, Any] | None, added: dict[str, Any] | None, *, saved_text: str = "") -> dict[str, Any]:
    """Where a merged line came from: the saved line's source, and every document it now draws on.

    A seeded line remembers the text seeding wrote (`seed_text`), so a later seeding run
    recognises its own fact under the fuller wording instead of writing it back.
    """
    ref = dict(saved or {})
    extra = {
        key: value
        for key, value in (added or {}).items()
        if key in ("kind", "document", "page", "file_id", "chunk_id", "chat_id", "session_id") and value not in (None, "")
    }
    if ref.get("kind") == "seed" and "seed_text" not in ref and saved_text:
        ref["seed_text"] = current(saved_text)
    also = [dict(item) for item in ref.get("also") or [] if isinstance(item, dict)]
    if extra.get("document"):
        if not ref.get("document"):
            ref.update({key: extra[key] for key in ("document", "page", "file_id", "chunk_id") if key in extra})
        else:
            places = [(str(ref.get("document")), str(ref.get("page")))] + [
                (str(item.get("document")), str(item.get("page"))) for item in also
            ]
            if (str(extra.get("document")), str(extra.get("page"))) not in places:
                also.append(extra)
    for item in (added or {}).get("also") or []:
        if isinstance(item, dict) and item not in also and len(also) < MAX_ALSO:
            also.append(dict(item))
    if also:
        ref["also"] = also[-MAX_ALSO:]
    ref["merged"] = int(ref.get("merged") or 0) + 1
    return ref


_DATED_BEFORE_RE = re.compile(r"\b(?:dated|dt\.?)\s*$", re.IGNORECASE)


def _without_document_dates(body: str) -> str:
    """The text without dates that only say which document is meant ("the Gazette dated 01/01/2016")."""
    def blank(found: re.Match[str]) -> str:
        return " " if _DATED_BEFORE_RE.search(found.string[max(0, found.start() - 12):found.start()]) else found.group(0)

    for pattern in (
        answer_facts._ISO_DATE_RE,
        answer_facts._NUMERIC_DATE_RE,
        answer_facts._DAY_MONTH_RE,
        answer_facts._MONTH_DAY_RE,
    ):
        body = pattern.sub(blank, body)
    return body


def dated_section(section: str, text: str) -> str:
    """Where a fact read from a document belongs: something that happened on a whole date goes with the dates.

    "Sale Deed No. 4401/2006 was executed on 25/08/2006" is an event. "The Gazette dated
    01/01/2016 sets the time for industrial use" describes a document, and stays with them.
    """
    if section in DATED_SECTIONS and answer_facts._dates(_without_document_dates(answer_facts._normalise(current(text)))):
        return "dates"
    return section


# ── Step 2: the judgement ────────────────────────────────────────────────────

@dataclass
class Judgement:
    same_as: dict[str, Any] | None = None
    merged: str | None = None


def build_request(items: Sequence[tuple[str, Sequence[dict[str, Any]]]]) -> str:
    parts: list[str] = []
    for number, (text, options) in enumerate(items, start=1):
        parts += [f"ITEM {number}", f"NEW: {current(text)}", "SAVED:"]
        parts += [f"{letter}: {current(line.get('text'))}" for letter, line in zip(_LETTERS, options)]
        parts.append("")
    return "\n".join(parts).strip()


def parse_judgements(payload: Any, items: Sequence[tuple[str, Sequence[dict[str, Any]]]]) -> list[Judgement]:
    """One judgement per item. An item the model left out, or answered with an unknown letter, is not the same."""
    text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload or "")
    text = _FENCE_RE.sub("", text).strip()
    if not text:
        raise ValueError("The model returned nothing.")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        found = re.search(r"\{.*\}", text, re.DOTALL)
        if not found:
            raise ValueError("The model did not return JSON.") from None
        data = json.loads(found.group(0))
    rows = data.get("items") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError("The model returned no items.")
    out = [Judgement() for _ in items]
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            index = int(row.get("item")) - 1
        except (TypeError, ValueError):
            continue
        if not 0 <= index < len(items):
            continue
        letter = str(row.get("same_as") or "").strip().upper()[:1]
        options = items[index][1]
        if letter and letter in _LETTERS and _LETTERS.index(letter) < len(options):
            merged = " ".join(str(row.get("merged") or "").split()) or None
            out[index] = Judgement(same_as=options[_LETTERS.index(letter)], merged=merged)
    return out


def judge(items: Sequence[tuple[str, Sequence[dict[str, Any]]]]) -> list[Judgement]:
    """Whether each new line repeats one of its candidates, and the merged line. Raises when the model is unusable."""
    if not items:
        return []
    from app.services.adapters.document_ai import _gemini_client

    model, level = answer_facts.model_settings()
    client = _gemini_client(model)
    if client is None:
        raise RuntimeError("No Gemini client is configured for merging memory lines.")
    last: Exception | None = None
    for _attempt in range(2):
        try:
            response = client.models.generate_content(
                model=model,
                contents=build_request(items),
                config=answer_facts._config(model, level, JUDGE_PROMPT),
            )
            return parse_judgements(getattr(response, "text", "") or "", items)
        except Exception as exc:  # noqa: BLE001 — one retry: a busy model often answers the second time
            last = exc
    raise RuntimeError(f"Merging memory lines failed: {last}")


@dataclass
class Match:
    """A saved line that records the same fact as a new one."""

    line: dict[str, Any]
    # The checked line that says both; the saved line's own text when it already says
    # everything; None when the two could not be merged safely.
    merged: str | None


def find_same(
    text: str,
    lines: Sequence[dict[str, Any]],
    *,
    section: str | None = None,
    judge_fn: Callable[[Sequence[tuple[str, Sequence[dict[str, Any]]]]], list[Judgement]] | None = None,
) -> Match | None:
    """The saved line recording the same fact as `text`, or None. Raises when the model is unusable."""
    options = candidates(text, lines, section=section)
    if not options:
        return None
    verdict = (judge_fn or judge)([(text, options)])[0]
    if verdict.same_as is None:
        return None
    return Match(line=verdict.same_as, merged=best_merge(str(verdict.same_as.get("text") or ""), text, verdict.merged))


# ── What a case already holds ────────────────────────────────────────────────

def _tag(line: dict[str, Any]) -> str:
    return str(line.get("tag") or "stated")


def _ref(line: dict[str, Any]) -> dict[str, Any]:
    ref = line.get("source_ref")
    return dict(ref) if isinstance(ref, dict) else {}


@dataclass
class TidyPlan:
    """What tidying one case would change. Nothing is written until `apply_tidy`."""

    # {"line": the saved line kept, "text": its merged text, "source_ref", "absorbed": [lines merged into it]}
    merges: list[dict[str, Any]] = field(default_factory=list)
    # {"line": a document fact removed, "kept": the line the advocate stated that already says it}
    removals: list[dict[str, Any]] = field(default_factory=list)
    # {"line": a dated fact from a document, "to": "dates"}
    moves: list[dict[str, Any]] = field(default_factory=list)
    # {"line", "same_as"}: judged the same fact, but no merge passed the check, so both stay.
    unmerged: list[dict[str, Any]] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.merges or self.removals or self.moves)


def plan_tidy(
    sections: dict[str, Sequence[dict[str, Any]]],
    *,
    judge_fn: Callable[[Sequence[tuple[str, Sequence[dict[str, Any]]]]], list[Judgement]] | None = None,
) -> TidyPlan:
    """Find the facts a case holds more than once, and how to keep each once. Raises when the model is unusable.

    Lines are read oldest first; each is compared with the lines kept before it. Two
    document facts become one merged line where the older one was. A document fact that
    repeats a line the advocate stated is removed. Two stated lines are the advocate's
    own and are left alone. Facts read from answers that carry a whole date and were
    filed under Documents or Facts are moved to Dates.
    """
    order = {name: index for index, name in enumerate(SECTIONS)}
    flat = [
        {**dict(line), "section": name}
        for name, lines in sections.items()
        for line in lines or []
        if str(line.get("text") or "").strip() and line.get("id")
    ]
    flat.sort(key=lambda line: (str(line.get("created_at") or ""), order.get(line["section"], 99), int(line.get("ord") or 0)))

    plan = TidyPlan()
    kept: list[dict[str, Any]] = []
    merges: dict[str, dict[str, Any]] = {}
    removed: set[str] = set()
    for line in flat:
        text = str(line.get("text") or "")
        options = candidates(text, kept, section=str(line["section"]))
        if _tag(line) != "extracted":
            # Two lines the advocate stated are theirs to tidy: only document facts are compared.
            options = [option for option in options if _tag(option) == "extracted"]
        verdict = (judge_fn or judge)([(text, options)])[0] if options else Judgement()
        target = verdict.same_as
        if target is None or (_tag(line) != "extracted" and _tag(target) != "extracted"):
            kept.append(line)
            continue
        if _tag(target) != "extracted":
            plan.removals.append({"line": line, "kept": target})
            removed.add(str(line["id"]))
            continue
        if _tag(line) != "extracted":
            # The advocate's line came later and says the same: it stays, the document fact goes,
            # with whatever had already been merged into it.
            entry = merges.pop(str(target["id"]), None)
            gone = [entry["line"], *entry["absorbed"]] if entry else [target]
            plan.removals.extend({"line": item, "kept": line} for item in gone)
            removed.add(str(target["id"]))
            kept = [item for item in kept if item is not target] + [line]
            continue
        merged = best_merge(str(target.get("text") or ""), text, verdict.merged)
        if merged is None:
            plan.unmerged.append({"line": line, "same_as": target})
            kept.append(line)
            continue
        entry = merges.setdefault(
            str(target["id"]),
            {"line": dict(target), "text": str(target.get("text") or ""), "source_ref": _ref(target), "absorbed": []},
        )
        entry["source_ref"] = merged_source_ref(entry["source_ref"], _ref(line), saved_text=entry["text"])
        entry["text"] = merged
        entry["absorbed"].append(line)
        removed.add(str(line["id"]))
        target["text"] = merged
    plan.merges = list(merges.values())
    for line in kept:
        if str(line["id"]) in removed or _tag(line) != "extracted" or _ref(line).get("kind") != "answer":
            continue
        to = dated_section(str(line["section"]), str(line.get("text") or ""))
        if to != line["section"]:
            plan.moves.append({"line": line, "to": to})
    return plan


def describe_plan(plan: TidyPlan) -> dict[str, Any]:
    """The plan in the form the activity log keeps and the advocate reads."""
    return {
        "merged": [
            {
                "section": entry["line"].get("section"),
                "text": entry["text"],
                "from": [current(entry["line"].get("text"))] + [current(line.get("text")) for line in entry["absorbed"]],
            }
            for entry in plan.merges
        ],
        "removed": [
            {"section": item["line"].get("section"), "text": current(item["line"].get("text")), "kept": current(item["kept"].get("text"))}
            for item in plan.removals
        ],
        "moved": [
            {"text": current(item["line"].get("text")), "from": item["line"].get("section"), "to": item["to"]}
            for item in plan.moves
        ],
    }


def apply_tidy(case_key: str, plan: TidyPlan, *, actor: str = MERGE_ACTOR, folder_name: str | None = None) -> dict[str, int]:
    """Write a tidy plan in one transaction. A line changed since it was planned is left as it is."""
    from app.services.memory import repository

    updates = [
        {
            "id": str(entry["line"]["id"]),
            "expected_text": str(entry["line"].get("text") or ""),
            "text": entry["text"],
            "source_ref": entry["source_ref"],
        }
        for entry in plan.merges
    ]
    deletes = [
        {"id": str(line["id"]), "expected_text": str(line.get("text") or "")}
        for entry in plan.merges
        for line in entry["absorbed"]
    ] + [{"id": str(item["line"]["id"]), "expected_text": str(item["line"].get("text") or "")} for item in plan.removals]
    moves = [{"id": str(item["line"]["id"]), "section": item["to"]} for item in plan.moves]
    return repository.rewrite_lines(
        case_key, updates=updates, deletes=deletes, moves=moves, actor=actor, folder_name=folder_name
    )


def tidy_case(
    case_key: str,
    *,
    user_id: str | None = None,
    folder_name: str | None = None,
    apply: bool = False,
    judge_fn: Callable[[Sequence[tuple[str, Sequence[dict[str, Any]]]]], list[Judgement]] | None = None,
) -> dict[str, Any]:
    """Plan, and with `apply` write, one case's merges; log what changed for the Activity tab."""
    from app.services.memory import repository

    stored = repository.get_sections(case_key)
    sections = {name: list((data or {}).get("lines") or []) for name, data in stored.items()}
    plan = plan_tidy(sections, judge_fn=judge_fn)
    report: dict[str, Any] = {"case_key": case_key, **describe_plan(plan), "unmerged": len(plan.unmerged)}
    if not apply or not plan.changed:
        report["written"] = None
        return report
    written = apply_tidy(case_key, plan, folder_name=folder_name)
    report["written"] = written
    changes = int(written.get("updated") or 0) + int(written.get("deleted") or 0) + int(written.get("moved") or 0)
    if changes and user_id:
        try:
            repository.write_assembly_log(
                {
                    "case_key": case_key,
                    "user_id": str(user_id),
                    "mode": "tidy",
                    "writes": changes,
                    "details": {key: report[key] for key in ("merged", "removed", "moved") if report[key]},
                }
            )
        except Exception as exc:  # noqa: BLE001 — the tidy itself stands
            logger.warning("[Memory] tidy not logged case_key=%s: %s", case_key, exc)
    logger.info(
        "[Memory] tidied case_key=%s merged=%s removed=%s moved=%s unmerged=%s",
        case_key, len(plan.merges), len(plan.removals), len(plan.moves), len(plan.unmerged),
    )
    return report
