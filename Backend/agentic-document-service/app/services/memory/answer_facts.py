"""Case facts learned from JuriNex's answers — only what the case's own documents show.

The writer used to learn only from what the advocate typed, so an advocate who spent a
day asking about a case ("who is the petitioner?", "when was the sale deed signed?")
ended with an empty Facts section, although every answer had read those facts out of
the documents.

An answer is the assistant's words, and memory must never hold a claim the documents
do not make. So a fact from an answer is kept only when it survives two independent
steps:

1. **Extraction.** A small model lists the durable facts the answer attributes to one of
   the documents it cited: parties, dates, numbers, what a document records. Analysis,
   advice and anything hedged are excluded.
2. **Verification, without a model.** The fact is looked up in the stored text of the
   document it names. It is kept only if one stored chunk of that document contains
   every number in the fact and most of its words. The page comes from that chunk.
   A date the answer misread, or a name it misspelt, finds no chunk and is dropped.

Kept facts are tagged `[extracted]`, carry the document and page, and are only ever
added: a fact already in memory, above all one the advocate stated, is never replaced.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.memory.answer_facts")

ANSWER_SECTIONS: tuple[str, ...] = ("facts", "parties", "dates", "documents")
MAX_FACTS_PER_TURN = 6
MAX_FACT_CHARS = 240
# How much of the answer and of memory the extractor is shown.
ANSWER_CHARS = 16_000
MEMORY_LINES_SHOWN = 80
TIMEOUT_MS = 20_000
MAX_OUTPUT_TOKENS = 2_048
# Verification: share of a fact's content words one chunk must contain, and how many
# candidate chunks are read per fact.
MIN_WORD_SUPPORT = 0.6
CANDIDATE_CHUNKS = 60

PROMPT = """\
You read one answer that JuriNex, a legal research assistant, gave about a case, and
list the durable case facts it reports from the case's documents, so they can be kept
in that case's memory file.

Record a fact only when the answer attributes it to one of the DOCUMENTS listed:
the parties and their roles, dates of events, case, survey, deed and document numbers,
courts, amounts, property descriptions, and what a document is or records.

Never record:
- JuriNex's analysis, opinions, arguments, strategy, advice, risks or next steps;
- anything hedged ("appears", "likely", "may", "possibly", "seems");
- anything about the advocate, this chat, JuriNex or memory;
- a fact CURRENT CASE MEMORY already holds;
- Aadhaar, PAN, bank account or card numbers.

Each fact is one plain sentence of at most 200 characters, such as
"Sale Deed No. 4401/2006 was executed on 25.08.2006". Copy every name, date, number and
amount exactly as the answer writes it.

section: "parties" (who someone is in the case), "dates" (an event and its date),
"documents" (what a document is or records), "facts" (anything else).
document: the listed document the fact comes from, written exactly as listed.
sensitive: true for health, family, financial or criminal-record details.

At most 6 facts, most important first. If none qualify, return {"facts": []}.
Return JSON only:
{"facts": [{"section": "parties", "text": "...", "document": "...", "sensitive": false}]}
"""

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
_DIGITS_RE = re.compile(r"\d+")
_WORD_RE = re.compile(r"[A-Za-z]{5,}")


@dataclass(frozen=True)
class CitedDocument:
    name: str
    file_id: str


@dataclass(frozen=True)
class AnswerFact:
    section: str
    text: str
    document: str
    sensitive: bool = False


@dataclass(frozen=True)
class Support:
    """Where in the stored document a fact was found."""

    document: str
    file_id: str
    chunk_id: str
    page: int | None


# ── Settings ─────────────────────────────────────────────────────────────────

def enabled() -> bool:
    return bool(getattr(get_settings(), "memory_answer_facts_enabled", True))


def model_settings() -> tuple[str, str]:
    settings = get_settings()
    model = str(getattr(settings, "memory_answer_facts_model", "") or "").strip() or "gemini-3.1-flash-lite"
    level = str(getattr(settings, "memory_answer_facts_thinking_level", "") or "").strip().lower() or "minimal"
    return model, level


# ── Inputs ───────────────────────────────────────────────────────────────────

def cited_documents(citations: Iterable[Any] | None) -> list[CitedDocument]:
    """The documents an answer cited that can be looked up: a name and a stored file id."""
    found: list[CitedDocument] = []
    seen: set[str] = set()
    for item in citations or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("document_name") or item.get("filename") or "").strip()
        file_id = str(item.get("file_id") or item.get("document_id") or "").strip()
        if not name or not file_id or file_id in seen:
            continue
        seen.add(file_id)
        found.append(CitedDocument(name=name, file_id=file_id))
    return found


def build_request(
    question: str,
    answer: str,
    documents: Sequence[CitedDocument],
    memory_lines: Sequence[dict[str, Any]],
) -> str:
    parts = ["DOCUMENTS:"]
    parts.extend(f"- {doc.name}" for doc in documents)
    parts += ["", "CURRENT CASE MEMORY:"]
    shown = [str(line.get("text") or "").strip() for line in memory_lines if str(line.get("text") or "").strip()]
    parts.extend([f"- {text}" for text in shown[:MEMORY_LINES_SHOWN]] or ["(empty)"])
    parts += ["", "THE ADVOCATE ASKED:", str(question or "").strip()[:2_000] or "(a saved prompt)"]
    parts += ["", "JURINEX ANSWERED:", str(answer or "").strip()[:ANSWER_CHARS]]
    return "\n".join(parts)


def _match_document(named: str, documents: Sequence[CitedDocument]) -> CitedDocument | None:
    target = named.strip().lower()
    if not target:
        return documents[0] if len(documents) == 1 else None
    for doc in documents:
        candidate = doc.name.lower()
        if target == candidate or target in candidate or candidate in target:
            return doc
    return None


def parse_facts(payload: Any, documents: Sequence[CitedDocument]) -> list[AnswerFact]:
    """The facts in the model's output that name a cited document and an allowed section."""
    text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload or "")
    text = _FENCE_RE.sub("", text).strip()
    if not text:
        raise ValueError("The model returned nothing.")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError("The model did not return JSON.") from None
        data = json.loads(match.group(0))
    rows = data.get("facts") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError("The model returned no fact list.")
    facts: list[AnswerFact] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        section = str(row.get("section") or "").strip().lower()
        body = " ".join(str(row.get("text") or "").split()).lstrip("-• ").strip()
        doc = _match_document(str(row.get("document") or ""), documents)
        if section not in ANSWER_SECTIONS or not body or len(body) > MAX_FACT_CHARS or doc is None:
            continue
        facts.append(AnswerFact(section=section, text=body, document=doc.name, sensitive=bool(row.get("sensitive"))))
        if len(facts) >= MAX_FACTS_PER_TURN:
            break
    return facts


def _config(model: str, level: str) -> Any:
    from google.genai import types

    from app.services.adapters.document_ai import _build_gemini_config

    config = _build_gemini_config(
        {"temperature": 0.0, "max_output_tokens": MAX_OUTPUT_TOKENS},
        {"thinking_level": level},
        model_name=model,
    )
    try:
        config.system_instruction = PROMPT
        config.response_mime_type = "application/json"
        config.http_options = types.HttpOptions(timeout=TIMEOUT_MS)
    except Exception:  # noqa: BLE001 — a plain-dict config from an older SDK
        pass
    return config


def extract(
    question: str,
    answer: str,
    documents: Sequence[CitedDocument],
    memory_lines: Sequence[dict[str, Any]],
) -> list[AnswerFact]:
    """The facts the answer attributes to its documents. Raises when the model is unusable."""
    from app.services.adapters.document_ai import _gemini_client

    model, level = model_settings()
    client = _gemini_client(model)
    if client is None:
        raise RuntimeError("No Gemini client is configured for answer facts.")
    response = client.models.generate_content(
        model=model,
        contents=build_request(question, answer, documents, memory_lines),
        config=_config(model, level),
    )
    return parse_facts(getattr(response, "text", "") or "", documents)


# ── Verification against the stored document ─────────────────────────────────
# What is checked is what a wrong fact gets wrong: its numbers and its names. The
# answer's own phrasing ("acted as attorney holder in the administrative
# correspondence") is not in the document and is not checked, or every paraphrase
# would be dropped.

# "1,53,600" and "153600" are the same amount; Indian grouping puts commas anywhere.
_GROUPED_NUMBER_RE = re.compile(r"(?<=\d),(?=\d)")
# Capitalised words that name nothing in particular, so they do not count as names.
_NOT_NAMES = frozenset(
    """
    the this that these those and for with from under before after into upon
    registered special civil criminal writ original additional sub government
    petitioner petitioners respondent respondents applicant appellant plaintiff
    defendant defendants accused complainant state court high bench suit petition
    deed sale agreement power attorney general order notice letter resolution circular
    gazette application copy exhibit annexure page section rule act no rs dated
    village taluka district hectares ares sq meters mr mrs smt shri late legal heirs
    """.split()
)
_NAME_RE = re.compile(r"\b[A-Z][A-Za-z]{2,}\b")
_PAGE_MARKER_RE = re.compile(r"\[PAGE\s+(\d+)\]", re.IGNORECASE)
MIN_NAME_SUPPORT = 0.75


def _normalise(text: str) -> str:
    return _GROUPED_NUMBER_RE.sub("", str(text or ""))


def _digit_runs(text: str) -> set[str]:
    """Every number in a text, without leading zeros: "25.08.2006" -> {"25", "8", "2006"}."""
    return {run.lstrip("0") or "0" for run in _DIGITS_RE.findall(_normalise(text))}


def _names(text: str) -> set[str]:
    return {word.lower() for word in _NAME_RE.findall(text) if word.lower() not in _NOT_NAMES}


def supports(fact_text: str, chunk_text: str) -> bool:
    """Whether stored text backs a fact.

    Every number in the fact must be there. So must most of its names. A fact with
    neither is checked on its content words instead, and one with too little to check
    is not kept.
    """
    from app.services.memory.writer import content_words

    numbers = _digit_runs(fact_text)
    if numbers and not numbers <= _digit_runs(chunk_text):
        return False
    names = _names(fact_text)
    if names:
        present = {name for name in names if re.search(rf"\b{re.escape(name)}\b", chunk_text, re.IGNORECASE)}
        return len(present) / len(names) >= MIN_NAME_SUPPORT
    if numbers:
        return bool(content_words(fact_text) & content_words(chunk_text))
    words = content_words(fact_text)
    if len(words) < 2:
        return False  # too little to verify
    return len(words & content_words(chunk_text)) / len(words) >= MIN_WORD_SUPPORT


_YEAR_RE = re.compile(r"^(?:19|20)\d{2}$")


def _search_patterns(fact_text: str) -> list[str]:
    """ILIKE patterns that narrow a document's chunks to ones that could hold the fact.

    The most distinctive numbers first. A year matches dozens of chunks in any case
    file and would push the right one past the candidate limit, so years are used only
    when the fact has no other number.
    """
    numbers = sorted({run for run in _DIGITS_RE.findall(_normalise(fact_text)) if len(run) >= 3}, key=len, reverse=True)
    distinctive = [run for run in numbers if not _YEAR_RE.match(run)]
    numbers = distinctive or numbers
    if numbers:
        return [f"%{run}%" for run in numbers[:3]]
    names = sorted(_names(fact_text), key=len, reverse=True)
    if names:
        return [f"%{name}%" for name in names[:4]]
    words = sorted({word.lower() for word in _WORD_RE.findall(fact_text)}, key=len, reverse=True)
    return [f"%{word}%" for word in words[:4]]


def _candidate_chunks(file_id: str, patterns: Sequence[str]) -> list[dict[str, Any]]:
    """Chunks that could hold the fact, each joined with its neighbours.

    A fact often straddles a chunk boundary (a date at the end of one, the deed it dates
    at the start of the next), so each candidate is read with the chunk before and after.
    """
    if not patterns:
        return []
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id::text AS id, chunk_index, page_start, content FROM file_chunks "
            "WHERE file_id::text = %s AND replace(content, ',', '') ILIKE ANY(%s) "
            "ORDER BY chunk_index LIMIT %s",
            (file_id, list(patterns), CANDIDATE_CHUNKS),
        )
        hits = [dict(row) for row in cur.fetchall()]
        if not hits:
            return []
        wanted = sorted({hit["chunk_index"] + step for hit in hits for step in (-1, 0, 1) if hit.get("chunk_index") is not None})
        cur.execute(
            "SELECT chunk_index, content FROM file_chunks WHERE file_id::text = %s AND chunk_index = ANY(%s)",
            (file_id, wanted),
        )
        text_at = {row["chunk_index"]: str(row["content"] or "") for row in cur.fetchall()}
    for hit in hits:
        index = hit.get("chunk_index")
        if index is None:
            hit["window"] = str(hit.get("content") or "")
            hit["before"] = ""
            continue
        hit["before"] = text_at.get(index - 1, "")
        hit["window"] = "\n".join(part for part in (hit["before"], text_at.get(index, ""), text_at.get(index + 1, "")) if part)
    return hits


def page_of(fact_text: str, hit: dict[str, Any]) -> int | None:
    """The page a fact is on: the chunk's own page, or the last "[PAGE n]" marker before it."""
    page = hit.get("page_start")
    if isinstance(page, int):
        return page
    window = str(hit.get("window") or hit.get("content") or "")
    anchors = sorted({run for run in _DIGITS_RE.findall(_normalise(fact_text)) if len(run) >= 3}, key=len, reverse=True)
    anchors += sorted(_names(fact_text), key=len, reverse=True)
    normalised = _normalise(window)
    position = -1
    for anchor in anchors:
        found = re.search(re.escape(anchor), normalised, re.IGNORECASE)
        if found:
            position = found.start()
            break
    markers = list(_PAGE_MARKER_RE.finditer(normalised))
    before = [marker for marker in markers if position < 0 or marker.start() <= position]
    chosen = before[-1] if before else (markers[0] if markers and position < 0 else None)
    return int(chosen.group(1)) if chosen else None


def find_support(fact: AnswerFact, documents: Sequence[CitedDocument]) -> Support | None:
    """The stored text of the fact's document that backs it, or None. Raises on database errors."""
    doc = _match_document(fact.document, documents)
    if doc is None or not is_db_available():
        return None
    for hit in _candidate_chunks(doc.file_id, _search_patterns(fact.text)):
        if supports(fact.text, str(hit.get("window") or "")):
            return Support(
                document=doc.name,
                file_id=doc.file_id,
                chunk_id=str(hit.get("id") or ""),
                page=page_of(fact.text, hit),
            )
    return None
