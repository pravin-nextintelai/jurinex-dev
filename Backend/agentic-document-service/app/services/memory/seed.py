"""Seed case memory from what case creation already established.

By the time a case is created, three things are known and trustworthy:

* **The case form the advocate confirmed.** Title, number, court, parties and
  dates were reviewed on the Review step before saving. The guide defines
  `[stated]` as a fact the advocate typed *or confirmed*, and these fields have
  no single source document, which an `[extracted]` line must name. So they seed
  as `[stated]`.
* **The grounded chronology.** Every event carries the document (and usually
  the page) it came from, so its dates seed as `[extracted]`.
* **The processed documents.** One `[extracted]` index line per file, with a
  short gist when a summary exists.

Seeding is idempotent and never destructive. Every seeded line records where it
came from in `source_ref.source`. Re-running (after new documents are processed,
say) adds only what is new; a seeded fact whose value changed — the next hearing
date moved — is updated in place with its earlier value kept in-line; anything
that duplicates an existing line, including one the advocate wrote, is skipped.
Lines the advocate or the chat wrote are never rewritten or deleted here.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Iterable, Sequence

from app.services.memory import repository
from app.services.memory.schemas import MAX_LINE_CHARS, SECTIONS
from app.services.memory.validator import (
    DEDUPE_NEAR,
    DEDUPE_SAME,
    Rejection,
    ResolvedOp,
    find_duplicate,
    merge_with_history,
    normalize_for_compare,
    validate_line,
)

logger = logging.getLogger("agentic_document_service.memory.seed")

SEED_KIND = "seed"
MAX_SEED_DATES = 15
DOC_GIST_CHARS = 120

_BLANK_VALUES = frozenset({"none", "null", "n/a", "na", "-", "undefined"})
_SENTENCE_END_RE = re.compile(r"(?<=[a-z0-9)\]]{2})[.!?](?=\s+[A-Z])")
_MARKDOWN_RE = re.compile(r"[#*_`>|]+")
_HISTORY_SUFFIX_RE = re.compile(r"\s*\(earlier:.*$", re.IGNORECASE | re.DOTALL)


@dataclass(frozen=True)
class SeedCandidate:
    """One line seeding would like to write."""

    section: str
    tag: str
    text: str
    # Idempotency key, e.g. "cases_row:next_hearing_date" or "chronology:2021-01-10".
    source: str
    document: str | None = None
    page: str | None = None
    # A shorter form to try if the full text is refused, e.g. a document name
    # without a generated gist that happens to read like an inference.
    fallback_text: str | None = None

    def source_ref(self) -> dict[str, Any]:
        ref: dict[str, Any] = {"kind": SEED_KIND, "source": self.source}
        if self.document:
            ref["document"] = self.document
        if self.page not in (None, ""):
            ref["page"] = self.page
        return ref


@dataclass
class SeedPlan:
    """What seeding decided, before anything is written."""

    additions: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    updates: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[dict[str, Any]] = field(default_factory=list)

    @property
    def added_count(self) -> int:
        return sum(len(lines) for lines in self.additions.values())


# ── Value helpers ────────────────────────────────────────────────────────────

def _clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()[:10]
    text = " ".join(str(value).split())
    return "" if text.lower() in _BLANK_VALUES else text


def _field(row: dict[str, Any], *names: str) -> str:
    for name in names:
        value = _clean(row.get(name))
        if value:
            return value
    return ""


def _clip(text: str, limit: int = MAX_LINE_CHARS) -> str:
    if len(text) <= limit:
        return text
    cut = text[: max(1, limit - 1)].rstrip()
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:") + "…"


def _as_list(value: Any) -> list[Any]:
    """Case rows store parties and judges as JSON text, JSONB, or a plain name."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, dict):
        return [value]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
        except (ValueError, TypeError):
            return [text]
        if isinstance(parsed, list):
            return parsed
        return [parsed] if parsed else []
    return []


def _person_name(item: Any) -> str:
    if isinstance(item, dict):
        return _field(item, "fullName", "full_name", "name", "partyName", "party_name")
    return _clean(item)


def _person_counsel(item: Any) -> str:
    if isinstance(item, dict):
        return _field(item, "advocateName", "advocate_name", "counsel")
    return ""


def _gist(summary: Any, limit: int = DOC_GIST_CHARS) -> str:
    """First sentence of a generated summary, without markdown, within `limit`."""
    text = _clean(_MARKDOWN_RE.sub(" ", str(summary or "")))
    if not text:
        return ""
    match = _SENTENCE_END_RE.search(text)
    if match and match.end() <= limit:
        text = text[: match.end()]
    return _clip(text, limit)


def dedupe_threshold(section: str) -> float:
    """How similar a line must be to count as a duplicate.

    Date lines differ by a digit or two ("12 Jan 2020: Notice issued" versus
    "13 Jan 2020: Notice issued") yet are different facts, so they must be
    near-identical before one is dropped.
    """
    return DEDUPE_SAME if section == "dates" else DEDUPE_NEAR


def _current_fact(text: str) -> str:
    """A seeded line without its "(earlier: …)" history suffix."""
    return _HISTORY_SUFFIX_RE.sub("", str(text or "")).strip()


# ── Candidates ───────────────────────────────────────────────────────────────

def candidates_from_case_row(case_row: dict[str, Any] | None) -> list[SeedCandidate]:
    """Facts from the case form the advocate confirmed when creating the case."""
    if not case_row:
        return []
    row = dict(case_row)
    out: list[SeedCandidate] = []

    def stated(section: str, key: str, text: str) -> None:
        if text:
            out.append(
                SeedCandidate(section=section, tag="stated", text=_clip(text), source=f"cases_row:{key}")
            )

    title = _field(row, "case_title", "caseTitle")
    stated("summary", "case_title", f"Case: {title}" if title else "")

    number = _field(row, "case_number", "caseNumber")
    stated("summary", "case_number", f"Case number: {number}" if number else "")

    court = _field(row, "court_name", "courtName")
    if court:
        parts = [court, _field(row, "bench_division", "benchDivision"), _field(row, "court_level", "courtLevel")]
        stated("summary", "court", "Court: " + ", ".join(p for p in parts if p))

    case_type = _field(row, "case_type", "caseType")
    if case_type:
        parts = [case_type, _field(row, "sub_type", "subType")]
        stated("summary", "case_type", "Matter type: " + " / ".join(p for p in parts if p))

    jurisdiction = _field(row, "jurisdiction")
    state = _field(row, "state")
    if jurisdiction or state:
        stated("summary", "jurisdiction", "Jurisdiction: " + ", ".join(p for p in (jurisdiction, state) if p))

    status = _field(row, "status", "currentStatus")
    stated("summary", "status", f"Status: {status}" if status else "")

    judges = [name for name in (_person_name(j) for j in _as_list(row.get("judges"))) if name]
    if judges:
        stated("summary", "judges", "Presiding: " + ", ".join(judges))

    for role, key in (("Petitioner", "petitioners"), ("Respondent", "respondents")):
        for item in _as_list(row.get(key)):
            name = _person_name(item)
            if not name:
                continue
            counsel = _person_counsel(item)
            text = f"{role}: {name}" + (f"; counsel {counsel}" if counsel else "")
            identity = normalize_for_compare(name)[:80] or name[:80]
            stated("parties", f"{key}:{identity}", text)

    filed = _field(row, "filing_date", "filingDate")
    stated("dates", "filing_date", f"Filed on {filed}" if filed else "")

    hearing = _field(row, "next_hearing_date", "nextHearingDate")
    stated("dates", "next_hearing_date", f"Next hearing: {hearing}" if hearing else "")

    return out


def _chronology_nodes(tree: Any) -> list[dict[str, Any]]:
    if tree is None:
        return []
    if hasattr(tree, "model_dump"):
        data = tree.model_dump(mode="json")
    elif isinstance(tree, dict):
        data = tree
    else:
        return []
    return [node for node in (data.get("dates") or []) if isinstance(node, dict)]


def candidates_from_chronology(tree: Any, *, max_dates: int = MAX_SEED_DATES) -> list[SeedCandidate]:
    """The most recent grounded dates, each tied to the document that shows it."""
    nodes = _chronology_nodes(tree)
    if not nodes or max_dates <= 0:
        return []

    ordered = sorted(nodes, key=lambda node: str(node.get("date") or ""))
    out: list[SeedCandidate] = []
    for node in ordered[-max_dates:]:
        key = _clean(node.get("date"))
        display = _clean(node.get("displayDate")) or key
        if not key:
            continue
        events = [event for event in (node.get("events") or []) if isinstance(event, dict)]
        grounded = next((event for event in events if _clean(event.get("sourceDocument"))), None)
        if grounded is None:
            # An [extracted] line must name its document; an ungrounded date is not seeded.
            continue
        title = (
            _clean(grounded.get("title"))
            or _clean(node.get("summary"))
            or _clean(grounded.get("particulars"))
        )
        if not title:
            continue
        out.append(
            SeedCandidate(
                section="dates",
                tag="extracted",
                text=_clip(f"{display}: {title}"),
                source=f"chronology:{key}",
                document=_clean(grounded.get("sourceDocument")),
                page=_clean(grounded.get("sourcePage")) or None,
            )
        )
    return out


def candidates_from_files(files: Iterable[dict[str, Any]] | None) -> list[SeedCandidate]:
    """One index line per processed document, with a short gist when one exists."""
    out: list[SeedCandidate] = []
    seen: set[str] = set()
    for doc in files or []:
        if not isinstance(doc, dict) or doc.get("is_folder"):
            continue
        name = _field(doc, "name", "originalname", "document_name")
        if not name:
            continue
        identity = _clean(doc.get("id")) or name
        if identity in seen:
            continue
        seen.add(identity)
        gist = _gist(doc.get("summary"))
        out.append(
            SeedCandidate(
                section="documents",
                tag="extracted",
                text=_clip(f"{name}: {gist}") if gist else _clip(name),
                source=f"file:{identity}",
                document=name,
                fallback_text=_clip(name) if gist else None,
            )
        )
    return out


# ── Planning ─────────────────────────────────────────────────────────────────

def _skip(candidate: SeedCandidate, reason: str) -> dict[str, Any]:
    return {"section": candidate.section, "source": candidate.source, "reason": reason}


def _validated_text(
    candidate: SeedCandidate,
    doc_names: Sequence[str] | None,
) -> tuple[str, Rejection | None]:
    def check(text: str) -> Rejection | None:
        return validate_line(
            candidate.tag,
            text,
            section=candidate.section,
            doc_names=doc_names,
            source="document" if candidate.tag == "extracted" else "user",
            document=candidate.document,
        )

    rejection = check(candidate.text)
    if rejection is None:
        return candidate.text, None
    if candidate.fallback_text:
        if check(candidate.fallback_text) is None:
            return candidate.fallback_text, None
    return candidate.text, rejection


def plan_seed(
    candidates: Sequence[SeedCandidate],
    existing: dict[str, list[dict[str, Any]]],
    *,
    doc_names: Sequence[str] | None = None,
    today: date | None = None,
) -> SeedPlan:
    """Decide what to add, update or skip. Pure: touches no database."""
    plan = SeedPlan()

    # Lines an earlier seed wrote, keyed by where they came from.
    seeded: dict[str, tuple[str, dict[str, Any]]] = {}
    for section, lines in existing.items():
        for line in lines:
            ref = line.get("source_ref") or {}
            if isinstance(ref, dict) and ref.get("kind") == SEED_KIND and ref.get("source"):
                seeded[str(ref["source"])] = (section, line)

    for candidate in candidates:
        if candidate.section not in SECTIONS:
            plan.skipped.append(_skip(candidate, "unknown_section"))
            continue

        text, rejection = _validated_text(candidate, doc_names)
        if rejection is not None:
            plan.skipped.append(_skip(candidate, rejection.code))
            continue

        prior = seeded.get(candidate.source)
        if prior is not None:
            section, line = prior
            old_text = str(line.get("text") or "")
            if normalize_for_compare(_current_fact(old_text)) == normalize_for_compare(text):
                plan.skipped.append(_skip(candidate, "already_seeded"))
            else:
                # The fact changed. Update, do not duplicate — and keep what it was.
                plan.updates.append(
                    {
                        "section": section,
                        "line_id": str(line.get("id")),
                        "tag": candidate.tag,
                        "text": merge_with_history(text, _current_fact(old_text), today=today),
                        "source_ref": candidate.source_ref(),
                    }
                )
            continue

        pool = list(existing.get(candidate.section, [])) + plan.additions.get(candidate.section, [])
        if find_duplicate(text, pool, dedupe_threshold(candidate.section)) is not None:
            plan.skipped.append(_skip(candidate, "duplicate"))
            continue

        plan.additions.setdefault(candidate.section, []).append(
            {"tag": candidate.tag, "text": text, "source_ref": candidate.source_ref()}
        )
    return plan


# ── Writing ──────────────────────────────────────────────────────────────────

def seed_case_memory(
    case_key: str,
    *,
    folder_name: str | None = None,
    user_id: str | None = None,
    firm_id: str | None = None,
    case_row: dict[str, Any] | None = None,
    tree: Any = None,
    files: Sequence[dict[str, Any]] | None = None,
    actor: str | None = None,
) -> dict[str, Any]:
    """Seed one case's memory. Best-effort: never raises into the caller.

    Respects the advocate's toggles: nothing is written while memory, or memory
    generation, is switched off for the firm, the user or the case.
    """
    key = str(case_key or "").strip()
    report: dict[str, Any] = {
        "case_key": key or None,
        "added": 0,
        "updated": 0,
        "skipped": 0,
        "skipped_reason": None,
    }
    if not key:
        report["skipped_reason"] = "no_case_key"
        return report
    if not repository.available():
        report["skipped_reason"] = "db_unavailable"
        return report

    try:
        settings = repository.effective_settings(user_id=user_id, case_key=key, firm_id=firm_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] seed settings unavailable case_key=%s: %s", key, exc)
        report["skipped_reason"] = "settings_unavailable"
        return report
    if not settings.enabled or not settings.write_enabled:
        report["skipped_reason"] = "disabled_by_user"
        return report

    try:
        stored = repository.get_sections(key)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] seed read failed case_key=%s: %s", key, exc)
        report["skipped_reason"] = "read_failed"
        return report
    existing = {name: list((data or {}).get("lines") or []) for name, data in stored.items()}

    doc_names = [
        name
        for name in (_field(doc, "name", "originalname") for doc in files or [] if isinstance(doc, dict))
        if name
    ]
    candidates = (
        candidates_from_case_row(case_row)
        + candidates_from_chronology(tree)
        + candidates_from_files(files)
    )
    plan = plan_seed(candidates, existing, doc_names=doc_names or None)
    report["skipped"] = len(plan.skipped)
    who = actor or (str(user_id) if user_id else SEED_KIND)

    for section in SECTIONS:
        lines = plan.additions.get(section)
        if not lines:
            continue
        try:
            result = repository.append_lines(key, section, lines, actor=who, folder_name=folder_name)
            report["added"] += int(result.get("added") or 0)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Memory] seed append failed case_key=%s section=%s: %s", key, section, exc)

    for update in plan.updates:
        try:
            repository.apply_op(
                key,
                ResolvedOp(
                    op="replace_line",
                    section=update["section"],
                    tag=update["tag"],
                    text=update["text"],
                    line_id=update["line_id"],
                    source_ref=update["source_ref"],
                ),
                None,
                actor=who,
                folder_name=folder_name,
            )
            report["updated"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[Memory] seed update failed case_key=%s line_id=%s: %s", key, update.get("line_id"), exc
            )

    logger.info(
        "[Memory] seeded case_key=%s added=%s updated=%s skipped=%s",
        key,
        report["added"],
        report["updated"],
        report["skipped"],
    )
    return report
