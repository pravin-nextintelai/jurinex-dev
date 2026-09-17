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

Three properties this holds:

* **It never blocks and never raises into retrieval.** Scheduling is a queue put.
* **It never mutates the caller's rows.** The repair works on copies of the text.
* **It never overwrites newer text.** A chunk is saved only if its content is still
  what was read, so a concurrent repair or a manual re-clean is not clobbered.
"""
from __future__ import annotations

import logging
import threading
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


def _save(target: Target, fixed: str) -> bool:
    """Write the repaired text, only if the chunk still holds what was read. True when saved."""
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE file_chunks SET content = %s, updated_at = NOW() WHERE id::text = %s AND content = %s",
            (fixed, target.chunk_id, target.content),
        )
        saved = (cur.rowcount or 0) > 0
        conn.commit()
    return saved


def heal(
    targets: Sequence[Target],
    *,
    reconstruct: Callable[[str], str] | None = None,
    save: Callable[[Target, str], bool] | None = None,
) -> HealReport:
    """Repair and save each target. Runs on the autoheal threads. Never raises."""
    rebuild = reconstruct or _reconstruct
    persist = save or _save
    report = HealReport(attempted=len(targets), chunk_ids=[target.chunk_id for target in targets])
    can_save = is_db_available() if save is None else True
    try:
        for target in targets:
            try:
                fixed = rebuild(target.content)
            except Exception as exc:  # noqa: BLE001
                report.failed += 1
                logger.warning("[Autoheal] repair failed chunk=%s: %s", target.chunk_id, exc)
                continue
            if not fixed or fixed == target.content:
                report.unchanged += 1
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
    finally:
        _release(report.chunk_ids)
    logger.info(
        "[Autoheal] done attempted=%s repaired=%s saved=%s unchanged=%s stale=%s failed=%s",
        report.attempted,
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
        claimed = _claim(targets_in(rows)[:MAX_CHUNKS_PER_RETRIEVAL])
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
