"""Background repair of OCR-fragmented chunks that retrieval turns up.

Cases indexed before the OCR work still hold chunks like "Ltd . p .a . 18 %". Retrieval
used to repair those inline: each fragmented hit was sent to an LLM and the search
waited for the rewrite. At about 8 seconds a call, two hits pushed the chat's retrieval
past its 15-second limit, so the question fell back to sending whole documents — slower,
larger, and less focused than the passages it had already found.

Now retrieval hands the rows back untouched and the repair runs here, on its own
threads. The question that found a fragmented chunk is answered from the text as it
stands; the cleaned text is written back, so the next question that retrieves that
chunk reads it clean.

Four properties this holds:

* **It never blocks and never raises into retrieval.** Scheduling is a queue put.
* **It never mutates the caller's rows.** The repair works on copies of the text.
* **It never overwrites newer text.** A chunk is saved only if its content is still
  what was read, so a concurrent repair or a manual re-clean is not clobbered.
* **Each chunk is repaired once.** `file_chunks.healed_at` (migration 178) is set when
  a chunk has been through repair, whether the text changed or not, and a marked chunk
  is never queued again. The fragmentation check is a heuristic, so some chunks it
  flags are ordinary legal text the repair cannot change; without the mark those were
  re-sent to the model on every question. A repair that *failed* is left unmarked, so
  it is tried again later.
"""
from __future__ import annotations

import logging
import threading
import uuid
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Sequence

from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.chunk_autoheal")

# At most this many chunks are queued from one retrieval, so a query that happens to
# surface a badly indexed document cannot start a long run of model calls.
MAX_CHUNKS_PER_RETRIEVAL = 8
# Repairs running at once, across every request.
WORKERS = 2

_EXECUTOR = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="chunk-autoheal")
# Chunk ids queued or being repaired now, so two questions that retrieve the same chunk
# moments apart do not pay for it twice.
_in_flight: set[str] = set()
_in_flight_lock = threading.Lock()

# Whether file_chunks has `healed_at` (migration 178): None until first checked.
_healed_column: bool | None = None
_healed_column_lock = threading.Lock()
# Without the column, chunks already repaired are remembered in this process instead,
# so a false alarm still costs one call per restart rather than one per question.
_FALLBACK_LIMIT = 20_000
_healed_in_process: "OrderedDict[str, None]" = OrderedDict()
_healed_in_process_lock = threading.Lock()


@dataclass(frozen=True)
class Target:
    chunk_id: str
    content: str


@dataclass
class HealReport:
    attempted: int = 0
    repaired: int = 0
    saved: int = 0
    unchanged: int = 0
    failed: int = 0
    skipped_stale: int = 0
    already_healed: int = 0
    chunk_ids: list[str] = field(default_factory=list)


def enabled() -> bool:
    return bool(getattr(get_settings(), "chunk_autoheal_enabled", True))


def _looks_fragmented(text: str) -> bool:
    from app.services.adapters.document_ai import _looks_fragmented as check

    return check(text)


def _reconstruct(text: str) -> str:
    from app.services.adapters.document_ai import reconstruct_chunk_text

    return reconstruct_chunk_text(text)


def targets_in(rows: Iterable[dict[str, Any]]) -> list[Target]:
    """Retrieved rows worth repairing: fragmented, saved (they have an id), not already queued."""
    found: list[Target] = []
    seen: set[str] = set()
    for row in rows:
        chunk_id = str(row.get("chunk_id") or "").strip()
        content = str(row.get("content") or "")
        if not chunk_id or chunk_id in seen or not content.strip():
            continue
        seen.add(chunk_id)
        try:
            if not _looks_fragmented(content):
                continue
        except Exception:  # noqa: BLE001 — a checker failure means "not worth repairing"
            continue
        found.append(Target(chunk_id=chunk_id, content=content))
    return found


def _claim(targets: Sequence[Target]) -> list[Target]:
    """The targets nobody else is repairing, now marked as ours."""
    with _in_flight_lock:
        claimed = [target for target in targets if target.chunk_id not in _in_flight]
        _in_flight.update(target.chunk_id for target in claimed)
    return claimed


def _release(chunk_ids: Iterable[str]) -> None:
    with _in_flight_lock:
        _in_flight.difference_update(chunk_ids)


# ── Healed once ──────────────────────────────────────────────────────────────

def _uuid_ids(chunk_ids: Iterable[str]) -> list[str]:
    """The ids that are real UUIDs, so they can be matched against the primary key."""
    valid: list[str] = []
    for value in chunk_ids:
        try:
            valid.append(str(uuid.UUID(str(value))))
        except (ValueError, TypeError, AttributeError):
            continue
    return valid


def healed_column_available() -> bool:
    """Whether file_chunks has `healed_at`, adding it if it can. Settled once per process.

    Always uses its own connection. A caller about to write chunks inside a transaction
    should call this first: adding the column needs a table lock that the caller's own
    row locks would otherwise make it wait for.
    """
    global _healed_column
    if _healed_column is not None:
        return _healed_column
    with _healed_column_lock:
        if _healed_column is not None:
            return _healed_column
        try:
            with get_db_connection() as connection:
                with connection.cursor() as cur:
                    cur.execute(
                        "SELECT 1 FROM information_schema.columns "
                        "WHERE table_name = 'file_chunks' AND column_name = 'healed_at' LIMIT 1"
                    )
                    if cur.fetchone() is None:
                        cur.execute("SET LOCAL lock_timeout = '2s'")
                        cur.execute("ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS healed_at TIMESTAMPTZ")
                connection.commit()
            _healed_column = True
        except Exception as exc:  # noqa: BLE001
            _healed_column = False
            logger.warning(
                "[Autoheal] repaired chunks are remembered in memory only until migration 178 is applied: %s", exc
            )
    return _healed_column


def _remember_in_process(chunk_ids: Iterable[str]) -> None:
    with _healed_in_process_lock:
        for chunk_id in chunk_ids:
            _healed_in_process[chunk_id] = None
            _healed_in_process.move_to_end(chunk_id)
        while len(_healed_in_process) > _FALLBACK_LIMIT:
            _healed_in_process.popitem(last=False)


def unhealed(targets: Sequence[Target]) -> list[Target]:
    """The targets that have never been through repair."""
    if not targets:
        return []
    with _healed_in_process_lock:
        fresh = [target for target in targets if target.chunk_id not in _healed_in_process]
    if not fresh or not is_db_available() or not healed_column_available():
        return fresh
    ids = _uuid_ids(target.chunk_id for target in fresh)
    if not ids:
        return fresh
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id::text AS id FROM file_chunks WHERE id = ANY(%s::uuid[]) AND healed_at IS NOT NULL",
            (ids,),
        )
        done = {str(row["id"] if hasattr(row, "keys") else row[0]) for row in cur.fetchall()}
    return [target for target in fresh if target.chunk_id not in done]


def mark_healed(chunk_ids: Iterable[str], *, cur: Any = None) -> int:
    """Record that these chunks have been through repair. Returns rows marked. Never raises.

    `cur` lets a caller that is already writing (the manual re-clean) mark inside its
    own transaction; that caller must have settled `healed_column_available()` before
    opening it, and nothing is marked in the database if it did not.
    """
    ids = [str(value) for value in chunk_ids if str(value or "").strip()]
    if not ids:
        return 0
    _remember_in_process(ids)
    valid = _uuid_ids(ids)
    if not valid:
        return 0
    try:
        if cur is not None:
            if _healed_column is not True:
                return 0
            # A savepoint, so a failure here cannot abort the caller's own writes.
            cur.execute("SAVEPOINT chunk_autoheal_mark")
            try:
                cur.execute("UPDATE file_chunks SET healed_at = NOW() WHERE id = ANY(%s::uuid[])", (valid,))
                marked = int(cur.rowcount or 0)
                cur.execute("RELEASE SAVEPOINT chunk_autoheal_mark")
                return marked
            except Exception:
                cur.execute("ROLLBACK TO SAVEPOINT chunk_autoheal_mark")
                raise
        if not is_db_available() or not healed_column_available():
            return 0
        with get_db_connection() as conn, conn.cursor() as own:
            own.execute("UPDATE file_chunks SET healed_at = NOW() WHERE id = ANY(%s::uuid[])", (valid,))
            marked = int(own.rowcount or 0)
            conn.commit()
        return marked
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Autoheal] repaired chunks not marked: %s", exc)
        return 0


def _save(target: Target, fixed: str) -> bool:
    """Write the repaired text and mark it healed, only if the chunk still holds what was read.

    True when saved.
    """
    marks = healed_column_available()
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE file_chunks SET content = %s, updated_at = NOW()"
            + (", healed_at = NOW()" if marks else "")
            + " WHERE id = %s::uuid AND content = %s",
            (fixed, target.chunk_id, target.content),
        )
        saved = (cur.rowcount or 0) > 0
        conn.commit()
    if saved:
        _remember_in_process([target.chunk_id])
    return saved


def heal(
    targets: Sequence[Target],
    *,
    reconstruct: Callable[[str], str] | None = None,
    save: Callable[[Target, str], bool] | None = None,
) -> HealReport:
    """Repair and save each target, once. Runs on the autoheal threads. Never raises.

    A chunk already repaired is skipped before any model call. A chunk the model left
    unchanged is marked too, so a false alarm is not paid for again. A failed repair is
    left unmarked, to be tried on a later question.
    """
    rebuild = reconstruct or _reconstruct
    persist = save or _save
    report = HealReport(attempted=len(targets), chunk_ids=[target.chunk_id for target in targets])
    can_save = is_db_available() if save is None else True
    try:
        try:
            pending = unhealed(targets)
        except Exception as exc:  # noqa: BLE001 — unknown means "try", not "skip"
            logger.debug("[Autoheal] healed check unavailable: %s", exc)
            pending = list(targets)
        report.already_healed = len(targets) - len(pending)
        left_unchanged: list[str] = []
        for target in pending:
            try:
                fixed = rebuild(target.content)
            except Exception as exc:  # noqa: BLE001
                report.failed += 1
                logger.warning("[Autoheal] repair failed chunk=%s: %s", target.chunk_id, exc)
                continue
            if not fixed or fixed == target.content:
                report.unchanged += 1
                left_unchanged.append(target.chunk_id)
                continue
            report.repaired += 1
            if not can_save:
                continue
            try:
                if persist(target, fixed):
                    report.saved += 1
                else:
                    report.skipped_stale += 1
            except Exception as exc:  # noqa: BLE001
                report.failed += 1
                logger.warning("[Autoheal] repaired text not saved chunk=%s: %s", target.chunk_id, exc)
        # Nothing to fix is an outcome too: mark it so the same false alarm is not re-sent.
        if left_unchanged and can_save:
            mark_healed(left_unchanged)
    finally:
        _release(report.chunk_ids)
    logger.info(
        "[Autoheal] done attempted=%s already_healed=%s repaired=%s saved=%s unchanged=%s stale=%s failed=%s",
        report.attempted,
        report.already_healed,
        report.repaired,
        report.saved,
        report.unchanged,
        report.skipped_stale,
        report.failed,
    )
    return report


def schedule(rows: Iterable[dict[str, Any]]) -> Future | None:
    """Queue repair of the fragmented rows retrieval returned. Never blocks, never raises.

    Returns the future, or None when nothing was queued.
    """
    try:
        if not enabled():
            return None
        found = targets_in(rows)
        with _healed_in_process_lock:
            # Already repaired in this process: skip without even a database check.
            found = [target for target in found if target.chunk_id not in _healed_in_process]
        claimed = _claim(found[:MAX_CHUNKS_PER_RETRIEVAL])
        if not claimed:
            return None
        logger.info("[Autoheal] queued %d fragmented chunk(s) for background repair", len(claimed))
        try:
            return _EXECUTOR.submit(heal, claimed)
        except Exception:
            _release(target.chunk_id for target in claimed)
            raise
    except Exception as exc:  # noqa: BLE001 — repair is an optimisation, never a failure
        logger.warning("[Autoheal] repair not queued: %s", exc)
        return None
