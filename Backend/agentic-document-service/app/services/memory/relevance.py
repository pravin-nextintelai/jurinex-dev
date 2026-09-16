"""Which remembered facts about the advocate are worth sending with this question.

Selection used to be "the oldest ones fall off": the whole block was rendered and
facts were dropped from the front until it fit the budget. A fact about how the
advocate wants drafts written was therefore dropped from a drafting question purely
because it had been saved early, and nothing anywhere said so.

Here each fact is scored against the advocate's actual words and the best ones that
fit are kept. Three signals, cheapest first:

* **words in common** with the question, which is what "relevant" usually means;
* **what the question is about** — a drafting question wants how they work, a
  question about a court wants their practice — so a fact can win on subject even
  when it shares no words;
* **recency**, as a tie-break only, so a newer fact edges out an older one of equal
  worth rather than deciding anything on its own.

It is deliberately local: no model call and no embedding service, because this runs
on every turn in the chat's critical path. A wrong guess costs one less-useful fact
in the block, never a wrong answer.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

# Words that carry no subject. Kept small on purpose: this is a relevance hint, not
# a search engine, and over-trimming makes short questions score nothing at all.
STOPWORDS: frozenset[str] = frozenset(
    """
    the and for are but not you all any can her was one our out his has how its who
    what when where which why with this that these those from into than then them they
    there their have had been being does did doing done will would shall should could
    may might must about above after again against because before below between both
    during each few more most other some such only own same too very just also get got
    give please tell show make made need want know like use used using per via
    case cases matter file files note notes point points thing things way ways
    """.split()
)

_WORD_RE = re.compile(r"[a-z]+")

# A fact's subject, when the question names it without sharing any word with it.
# "Draft the reply" should reach a fact about how they want drafts written even
# though the fact may say "prayer clauses" and nothing else.
_CATEGORY_CUES: dict[str, tuple[str, ...]] = {
    "work_style": (
        r"draft", r"redraft", r"write", r"rewrite", r"wording", r"word\s+it", r"phrase",
        r"tone", r"style", r"format", r"structure", r"layout", r"template", r"clause",
        r"prayer", r"summar(?:y|ise|ize)", r"brief", r"concise", r"language", r"english",
        r"marathi", r"hindi", r"cite", r"citation", r"footnote", r"opinion", r"note",
        r"table", r"bullet", r"heading", r"paragraph", r"length", r"detail",
    ),
    "practice": (
        r"court", r"bench", r"tribunal", r"forum", r"jurisdiction", r"appear",
        r"practice", r"writ", r"petition", r"appeal", r"revision", r"bail",
        r"criminal", r"civil", r"tax", r"service", r"labour", r"arbitrat",
        r"matrimonial", r"property", r"company", r"constitutional", r"area\s+of",
        r"speciali[sz]", r"filing", r"procedure", r"rule", r"practice\s+direction",
    ),
    "clients": (
        r"client", r"instruct", r"represent", r"appear\s+for", r"on\s+behalf",
        r"builder", r"bank", r"company", r"corporate", r"firm", r"industry",
        r"sector", r"business", r"individual", r"pro\s+bono", r"retainer", r"brief\s+from",
    ),
    "background": (
        r"experience", r"year", r"senior", r"junior", r"chamber", r"enrol",
        r"qualif", r"educat", r"degree", r"career", r"background", r"about\s+you",
        r"about\s+me", r"who\s+are\s+you", r"my\s+profile",
    ),
}

_CATEGORY_PATTERNS: dict[str, re.Pattern[str]] = {
    category: re.compile("|".join(rf"\b{cue}" for cue in cues), re.IGNORECASE)
    for category, cues in _CATEGORY_CUES.items()
}

# What each signal is worth. Words in common dominate; subject breaks the common
# case where a question shares no vocabulary with the fact; recency only separates
# facts that are otherwise equal.
WEIGHT_OVERLAP = 2.0
WEIGHT_CATEGORY = 1.5
WEIGHT_RECENCY = 0.5


def terms(text: str | None) -> set[str]:
    """The subject words of a piece of text, lowercased and stripped of filler."""
    found = _WORD_RE.findall(str(text or "").lower())
    return {word for word in found if len(word) >= 3 and word not in STOPWORDS}


def category_hits(question: str | None) -> set[str]:
    """The fact categories this question is asking about, if any."""
    body = str(question or "")
    return {name for name, pattern in _CATEGORY_PATTERNS.items() if pattern.search(body)}


@dataclass(frozen=True)
class Scored:
    """One fact with the reason it scored what it did, for the log and the panel."""

    line: dict[str, Any]
    score: float
    overlap: int
    on_subject: bool
    rank: int = 0

    @property
    def line_id(self) -> str:
        return str(self.line.get("id") or "")


@dataclass(frozen=True)
class Selection:
    """What was chosen for this turn, and what did not fit."""

    kept: list[dict[str, Any]] = field(default_factory=list)
    dropped: list[dict[str, Any]] = field(default_factory=list)
    scores: dict[str, float] = field(default_factory=dict)

    @property
    def kept_ids(self) -> list[str]:
        return [str(line.get("id") or "") for line in self.kept if line.get("id")]

    @property
    def dropped_ids(self) -> list[str]:
        return [str(line.get("id") or "") for line in self.dropped if line.get("id")]


def score_facts(lines: Sequence[dict[str, Any]], question: str | None) -> list[Scored]:
    """Every fact scored against the question, best first.

    Position in the stored order stands in for recency: the facts are stored oldest
    first, so a later position means a newer fact.
    """
    question_terms = terms(question)
    subjects = category_hits(question)
    total = max(1, len(lines) - 1)
    scored: list[Scored] = []
    for position, line in enumerate(lines):
        overlap = len(terms(line.get("text")) & question_terms)
        on_subject = str(line.get("category") or "") in subjects
        recency = position / total
        score = (
            WEIGHT_OVERLAP * overlap
            + WEIGHT_CATEGORY * (1.0 if on_subject else 0.0)
            + WEIGHT_RECENCY * recency
        )
        scored.append(Scored(line=line, score=score, overlap=overlap, on_subject=on_subject))
    # Best first; an equal score falls back to the newer fact.
    order = sorted(
        range(len(scored)),
        key=lambda i: (-scored[i].score, -i),
    )
    return [
        Scored(
            line=scored[i].line,
            score=scored[i].score,
            overlap=scored[i].overlap,
            on_subject=scored[i].on_subject,
            rank=rank,
        )
        for rank, i in enumerate(order)
    ]


def select(
    lines: Sequence[dict[str, Any]],
    *,
    question: str | None,
    limit_chars: int,
    render: Callable[[Sequence[dict[str, Any]]], str],
) -> Selection:
    """The most useful facts that fit `limit_chars` once rendered.

    Facts are taken best-first but rendered in their stored order, so the block the
    model sees keeps a stable shape from turn to turn and only its membership moves.
    A fact that does not fit is not the end: the next one is still tried, because a
    short fact may fit where a long one did not.
    """
    usable = [
        line
        for line in lines
        if str(line.get("text") or "").strip() and str(line.get("category") or "").strip()
    ]
    if not usable or limit_chars <= 0:
        return Selection(kept=[], dropped=list(usable), scores={})

    order = {id(line): position for position, line in enumerate(usable)}
    scored = score_facts(usable, question)
    scores = {
        str(item.line.get("id") or f"#{order[id(item.line)]}"): round(item.score, 3)
        for item in scored
    }

    kept: list[dict[str, Any]] = []
    for item in scored:
        candidate = sorted([*kept, item.line], key=lambda line: order[id(line)])
        if len(render(candidate)) <= limit_chars:
            kept = candidate
    kept_ids = {id(line) for line in kept}
    dropped = [line for line in usable if id(line) not in kept_ids]
    return Selection(kept=kept, dropped=dropped, scores=scores)


def describe(selection: Selection, question: str | None) -> str:
    """One line for the assembly log: what was chosen and why. Never raises."""
    subjects = ",".join(sorted(category_hits(question))) or "-"
    return f"kept={len(selection.kept)} dropped={len(selection.dropped)} subject={subjects}"
