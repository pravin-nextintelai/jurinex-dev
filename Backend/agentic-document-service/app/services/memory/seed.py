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

Seeding also keeps itself current. `refresh_seed` runs after chat turns: at most
every ten minutes per case it re-reads the case details, the chronology and the
document list, and seeds again only when something there has changed. A case
created before memory existed fills itself on its next chat, and a newly
processed document shows up without anyone pressing a button. Two choices the
advocate makes are respected: a seeded line they deleted is not brought back on
its own, and after "forget everything" nothing is refilled until they ask.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
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
SEED_ACTOR = "memory-seed"
MAX_SEED_DATES = 15
DOC_GIST_CHARS = 120
# How often a case is re-read after chat turns. A read loads the case row, the
# chronology and the document list, so it is throttled per case.
SEED_RECHECK_SECONDS = 600
SEED_LOCK_TIMEOUT_S = 20.0
MAX_TRACKED_SOURCES = 500

_BLANK_VALUES = frozenset({"none", "null", "n/a", "na", "-", "undefined"})
_SENTENCE_END_RE = re.compile(r"(?<=[a-z0-9)\]]{2})[.!?](?=\s+[A-Z])")
_MARKDOWN_RE = re.compile(r"[#*_`>|]+")
_HISTORY_SUFFIX_RE = re.compile(r"\s*\(earlier:.*$", re.IGNORECASE | re.DOTALL)

# One seeding run per case at a time in this process, so two chat turns that
# finish together cannot both add the same lines.
_LOCKS_GUARD = threading.Lock()
_CASE_LOCKS: dict[str, threading.Lock] = {}


def _case_lock(case_key: str) -> threading.Lock:
    with _LOCKS_GUARD:
        lock = _CASE_LOCKS.get(case_key)
        if lock is None:
            lock = _CASE_LOCKS[case_key] = threading.Lock()
        return lock


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


def build_candidates(
    case_row: dict[str, Any] | None,
    tree: Any,
    files: Iterable[dict[str, Any]] | None,
) -> list[SeedCandidate]:
    """Everything seeding would like to write for one case."""
    return candidates_from_case_row(case_row) + candidates_from_chronology(tree) + candidates_from_files(files)


def seed_fingerprint(candidates: Sequence[SeedCandidate]) -> str:
    """Changes whenever seeding would have something different to say."""
    digest = hashlib.sha256()
    for source, text in sorted((candidate.source, candidate.text) for candidate in candidates):
        digest.update(source.encode("utf-8", "replace"))
        digest.update(b"\x00")
        digest.update(text.encode("utf-8", "replace"))
        digest.update(b"\x01")
    return digest.hexdigest()


def seeded_sources(existing: dict[str, list[dict[str, Any]]]) -> set[str]:
    """Where the seeded lines a case holds right now came from."""
    found: set[str] = set()
    for lines in existing.values():
        for line in lines:
            ref = line.get("source_ref") or {}
            if isinstance(ref, dict) and ref.get("kind") == SEED_KIND and ref.get("source"):
                found.add(str(ref["source"]))
    return found


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
    skip_sources: Iterable[str] = (),
) -> SeedPlan:
    """Decide what to add, update or skip. Pure: touches no database.

    `skip_sources` names seeded lines the advocate has since deleted; they are
    not added back.
    """
    plan = SeedPlan()
    deleted = {str(source) for source in skip_sources if source}

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

        if candidate.source in deleted and candidate.source not in seeded:
            plan.skipped.append(_skip(candidate, "deleted_by_user"))
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
                # A document line only gains or changes its gist, which is not a
                # change in the facts, so it is simply replaced.
                new_text = (
                    text
                    if candidate.section == "documents"
                    else merge_with_history(text, _current_fact(old_text), today=today)
                )
                plan.updates.append(
                    {
                        "section": section,
                        "line_id": str(line.get("id")),
                        "tag": candidate.tag,
                        "text": new_text,
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
    respect_deletions: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Seed one case's memory. Best-effort: never raises into the caller.

    Respects the advocate's toggles: nothing is written while memory, or memory
    generation, is switched off for the firm, the user or the case.

    With `respect_deletions` (the automatic runs), a line an earlier run seeded
    and the advocate has since deleted stays deleted. "Fill from case details"
    passes False and restores everything.
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

    lock = _case_lock(key)
    if not lock.acquire(timeout=SEED_LOCK_TIMEOUT_S):
        report["skipped_reason"] = "busy"
        return report
    try:
        return _seed_locked(
            key,
            report,
            candidates=build_candidates(case_row, tree, files),
            folder_name=folder_name,
            user_id=user_id,
            files=files,
            actor=actor,
            respect_deletions=respect_deletions,
            now=now,
        )
    finally:
        lock.release()


def _seed_locked(
    key: str,
    report: dict[str, Any],
    *,
    candidates: list[SeedCandidate],
    folder_name: str | None,
    user_id: str | None,
    files: Sequence[dict[str, Any]] | None,
    actor: str | None,
    respect_deletions: bool,
    now: datetime | None,
) -> dict[str, Any]:
    try:
        stored = repository.get_sections(key)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] seed read failed case_key=%s: %s", key, exc)
        report["skipped_reason"] = "read_failed"
        return report
    existing = {name: list((data or {}).get("lines") or []) for name, data in stored.items()}
    meta = _read_meta(key)

    doc_names = [
        name
        for name in (_field(doc, "name", "originalname") for doc in files or [] if isinstance(doc, dict))
        if name
    ]
    present = seeded_sources(existing)
    earlier = {str(source) for source in (meta.get("sources") or []) if str(source or "").strip()}
    plan = plan_seed(
        candidates,
        existing,
        doc_names=doc_names or None,
        skip_sources=(earlier - present) if respect_deletions else (),
    )
    report["skipped"] = len(plan.skipped)
    who = actor or (str(user_id) if user_id else SEED_KIND)
    failures = 0
    written: set[str] = set()

    for section in SECTIONS:
        lines = plan.additions.get(section)
        if not lines:
            continue
        try:
            result = repository.append_lines(key, section, lines, actor=who, folder_name=folder_name)
            added = int(result.get("added") or 0)
            report["added"] += added
            written.update(str((line.get("source_ref") or {}).get("source") or "") for line in lines[:added])
        except Exception as exc:  # noqa: BLE001
            failures += 1
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
            written.add(str(update["source_ref"].get("source") or ""))
        except Exception as exc:  # noqa: BLE001
            failures += 1
            logger.warning(
                "[Memory] seed update failed case_key=%s line_id=%s: %s", key, update.get("line_id"), exc
            )

    stamp = (now or datetime.now(timezone.utc)).isoformat()
    bookkeeping: dict[str, Any] = {
        "auto_seed": True,
        "seeded_at": stamp,
        "checked_at": stamp,
        "sources": sorted(source for source in (earlier | present | written) if source)[:MAX_TRACKED_SOURCES],
    }
    if not failures:
        # A run that could not write everything records no fingerprint, so the
        # next check seeds again instead of deciding nothing has changed.
        bookkeeping["fingerprint"] = seed_fingerprint(candidates)
    _write_meta(key, bookkeeping, folder_name)

    logger.info(
        "[Memory] seeded case_key=%s added=%s updated=%s skipped=%s failures=%s",
        key,
        report["added"],
        report["updated"],
        report["skipped"],
        failures,
    )
    return report


def _read_meta(key: str) -> dict[str, Any]:
    try:
        return repository.get_seed_meta(key) or {}
    except Exception as exc:  # noqa: BLE001 — bookkeeping must never stop seeding
        logger.debug("[Memory] seed bookkeeping unreadable case_key=%s: %s", key, exc)
        return {}


def _write_meta(key: str, meta: dict[str, Any], folder_name: str | None) -> None:
    try:
        repository.set_seed_meta(key, meta, folder_name=folder_name)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] seed bookkeeping not saved case_key=%s: %s", key, exc)


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ── Inputs and refresh ───────────────────────────────────────────────────────

def load_seed_inputs(scope: Any) -> tuple[dict[str, Any] | None, Any, list[dict[str, Any]]]:
    """The confirmed case row, the chronology and the documents for one case.

    Each is loaded independently and best-effort: seeding from whatever is
    available beats refusing to seed because one source failed.
    """
    from app.services.container import get_folder_service

    service = get_folder_service()
    case_row: dict[str, Any] | None = None
    if scope.case_id:
        try:
            case_row = service._get_case_from_db(scope.case_id, scope.user_id)  # noqa: SLF001
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Memory] seed could not load case_id=%s: %s", scope.case_id, exc)

    tree: Any = None
    try:
        tree = service.get_chronology(scope.case_id or scope.case_key, folder_name=scope.folder_name)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] seed could not load the chronology for %s: %s", scope.case_key, exc)

    files: list[dict[str, Any]] = []
    try:
        listing = service.get_documents_in_folder(scope.folder_name, scope.user_id) or {}
        files = list(listing.get("documents") or listing.get("files") or [])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] seed could not list documents for %s: %s", scope.folder_name, exc)

    return case_row, tree, files


def refresh_seed(
    scope: Any,
    *,
    now: datetime | None = None,
    min_interval_s: float = SEED_RECHECK_SECONDS,
) -> dict[str, Any] | None:
    """Keep a case's seeded lines current. Called after chat turns; never raises.

    Returns the seeding report when seeding ran, and None when there was nothing
    to do: automatic seeding is off for the case (the advocate chose "forget
    everything"), the case was checked recently, another thread is seeding it,
    or nothing seeding reads from has changed since the last run.
    """
    key = str(getattr(scope, "case_key", "") or "").strip()
    if not key:
        return None
    moment = now or datetime.now(timezone.utc)
    meta = _read_meta(key)
    if meta.get("auto_seed") is False:
        return None
    checked = _parse_time(meta.get("checked_at"))
    if checked is not None and 0 <= (moment - checked).total_seconds() < min_interval_s:
        return None
    if _case_lock(key).locked():
        return None

    try:
        case_row, tree, files = load_seed_inputs(scope)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] seed inputs unavailable case_key=%s: %s", key, exc)
        return None

    folder_name = getattr(scope, "folder_name", None)
    fingerprint = seed_fingerprint(build_candidates(case_row, tree, files))
    if meta.get("fingerprint") and meta.get("fingerprint") == fingerprint:
        _write_meta(key, {**meta, "checked_at": moment.isoformat()}, folder_name)
        return None

    return seed_case_memory(
        key,
        folder_name=folder_name,
        user_id=getattr(scope, "user_id", None),
        firm_id=getattr(scope, "firm_id", None),
        case_row=case_row,
        tree=tree,
        files=files,
        actor=SEED_ACTOR,
        now=moment,
    )
