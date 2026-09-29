"""Making room when a part of a case's memory is full.

Each section holds at most `MAX_SECTION_LINES` lines (the summary `MAX_SUMMARY_LINES`),
and a case at most `MAX_CASE_CHARS` characters. At the cap every new fact was rejected
as `section_full` or `case_full`, so a case stopped learning exactly when it was busiest
— and the advocate was told only that "a change could not be saved".

Nothing has to be thrown away to fix that. A section that has filled up is usually
holding the same fact in several wordings, and dated events that belong under Dates:

    Sale deed 4401/2006 executed on 25/11/2004
    Agreement to sell dated 25/11/2004 for Rs 4,50,000     ->  one line, under Dates
    The 25/11/2004 agreement records Rs 4,50,000

Both are what `same_fact` already tidies, under the checks it already applies: a merged
line may say nothing its originals did not, the advocate's own lines are never
rewritten, a document fact that repeats one of their lines goes rather than the line
they wrote, and a line changed since the plan was made is left alone. So when a write
finds a section full, the section is tidied once and the fact is written into the room
that frees.

Three rules keep the cost of that bounded:

* **Only when a write is actually blocked.** Nothing is tidied on a turn that fits.
* **Once per section until the section changes.** A section that could not be shortened
  is remembered by its version, so the next turn does not ask the model the same
  question again. A model or database outage is retried after
  `MEMORY_ROOM_RETRY_AFTER_S`.
* **It never raises.** A tidy that fails leaves memory exactly as it was and the write
  is rejected as before, with a reason the advocate can read in the Activity tab.

What a tidy changed is reported in the same shape as any other tidy
(`same_fact.describe_plan`), so the advocate reads the merges, removals and moves in the
Activity tab beside the fact they made room for.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Sequence

from app.core.config import get_settings

logger = logging.getLogger("agentic_document_service.memory.room")

# The key a case-wide attempt (the whole case is over its character cap) is remembered
# under, where a section-wide one is remembered under the section's name.
WHOLE_CASE = ""


def enabled() -> bool:
    return bool(getattr(get_settings(), "memory_room_enabled", True))


def retry_after_s() -> float:
    """How long an outage is left alone before the same section is tried again."""
    try:
        return max(0.0, float(getattr(get_settings(), "memory_room_retry_after_s", 600.0) or 0.0))
    except (TypeError, ValueError):
        return 600.0


@dataclass
class RoomResult:
    """What a tidy freed. `sections` holds the lines and version as they now stand."""

    # Lines the section lost: merged away, removed as a repeat, or moved elsewhere.
    lines_freed: int = 0
    chars_freed: int = 0
    # {section: {"lines": [...], "version": int}} for every section the tidy touched.
    sections: dict[str, dict[str, Any]] = field(default_factory=dict)
    # The merges, removals and moves, as the Activity tab keeps them.
    described: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    @property
    def changed(self) -> bool:
        return bool(self.sections) and not self.error


@dataclass
class _Attempt:
    """A tidy that freed nothing, so the same question is not asked again for nothing."""

    version: Any
    at: datetime
    reason: str


_attempts: dict[tuple[str, str], _Attempt] = {}


def _asked_already(case_key: str, remembered_as: str, version: Any) -> bool:
    attempt = _attempts.get((str(case_key), str(remembered_as)))
    if attempt is None:
        return False
    if attempt.reason == "unavailable":
        # Nothing was learned about this section, only that the model or the database
        # was not there. Ask again once the outage has had time to pass.
        return datetime.now(timezone.utc) - attempt.at < timedelta(seconds=retry_after_s())
    # It could not be shortened, and nothing has changed since: the answer is the same.
    return attempt.version == version


def _remember_attempt(case_key: str, remembered_as: str, version: Any, reason: str) -> None:
    _attempts[(str(case_key), str(remembered_as))] = _Attempt(
        version=version, at=datetime.now(timezone.utc), reason=reason
    )


def forget_attempts(case_key: str | None = None) -> None:
    """Ask again next time: after a case's memory is replaced, and between tests."""
    if case_key is None:
        _attempts.clear()
        return
    for key in [key for key in _attempts if key[0] == str(case_key)]:
        _attempts.pop(key, None)


def _chars(lines: Sequence[dict[str, Any]]) -> int:
    return sum(len(str(line.get("text") or "")) for line in lines)


def _touched(plan: Any) -> set[str]:
    """Every section a plan changes: where a line was, and where a moved line goes."""
    names: set[str] = set()
    for entry in plan.merges:
        names.add(str(entry["line"].get("section") or ""))
        names.update(str(line.get("section") or "") for line in entry["absorbed"])
    for item in plan.removals:
        names.add(str(item["line"].get("section") or ""))
    for item in plan.moves:
        names.add(str(item["line"].get("section") or ""))
        names.add(str(item["to"] or ""))
    return {name for name in names if name}


def make_room(
    case_key: str,
    *,
    section: str | None = None,
    folder_name: str | None = None,
    judge_fn: Callable[..., Any] | None = None,
) -> RoomResult:
    """Tidy what the case already holds so the next fact has somewhere to go.

    With `section`, only that section is read and tidied; without it the whole case is,
    which is what a case over its character cap needs. Never raises: everything that can
    go wrong comes back as `RoomResult.error`.
    """
    from app.services.memory import repository, same_fact

    if not enabled():
        return RoomResult(error="disabled")

    names = (str(section),) if section else None
    try:
        stored = repository.get_sections(case_key, names)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] could not read case_key=%s to make room: %s", case_key, exc)
        return RoomResult(error="unavailable")
    sections = {name: list((data or {}).get("lines") or []) for name, data in (stored or {}).items()}
    versions = {name: (data or {}).get("version") for name, data in (stored or {}).items()}

    remembered_as = str(section) if section else WHOLE_CASE
    version_now = versions.get(str(section)) if section else str(sorted(versions.items(), key=lambda row: row[0]))
    if _asked_already(case_key, remembered_as, version_now):
        return RoomResult(error="asked_already")
    if not any(sections.values()):
        return RoomResult(error="empty")

    try:
        plan = same_fact.plan_tidy(sections, judge_fn=judge_fn)
    except Exception as exc:  # noqa: BLE001 — the model judges whether two lines are one fact
        logger.warning("[Memory] making room in case_key=%s is unavailable: %s", case_key, exc)
        _remember_attempt(case_key, remembered_as, version_now, "unavailable")
        return RoomResult(error="unavailable")
    if not plan.changed:
        _remember_attempt(case_key, remembered_as, version_now, "nothing_to_merge")
        return RoomResult(error="nothing_to_merge")

    touched = _touched(plan)
    before = _chars([line for name in touched for line in sections.get(name) or []])
    try:
        written = same_fact.apply_tidy(case_key, plan, folder_name=folder_name)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] making room in case_key=%s failed: %s", case_key, exc)
        _remember_attempt(case_key, remembered_as, version_now, "unavailable")
        return RoomResult(error="write_failed")

    lines_freed = int(written.get("deleted") or 0) + int(written.get("moved") or 0)
    if not any(int(written.get(key) or 0) for key in ("updated", "deleted", "moved")):
        # Every line in the plan had changed since it was made, so nothing was written.
        _remember_attempt(case_key, remembered_as, version_now, "nothing_to_merge")
        return RoomResult(error="nothing_written")

    try:
        fresh = repository.get_sections(case_key, tuple(sorted(touched)) or None)
    except Exception as exc:  # noqa: BLE001 — the tidy stands; the caller just cannot use it this turn
        logger.warning("[Memory] made room in case_key=%s but could not read it back: %s", case_key, exc)
        return RoomResult(error="unavailable")
    now = {
        name: {"lines": list((data or {}).get("lines") or []), "version": (data or {}).get("version")}
        for name, data in (fresh or {}).items()
    }
    chars_freed = max(0, before - _chars([line for data in now.values() for line in data["lines"]]))
    described = same_fact.describe_plan(plan)
    logger.info(
        "[Memory] made room case_key=%s in %s: %s line(s) and %s char(s) freed (%s merged, %s removed, %s moved)",
        case_key,
        section or "the case",
        lines_freed,
        chars_freed,
        len(described.get("merged") or []),
        len(described.get("removed") or []),
        len(described.get("moved") or []),
    )
    return RoomResult(lines_freed=lines_freed, chars_freed=chars_freed, sections=now, described=described)
