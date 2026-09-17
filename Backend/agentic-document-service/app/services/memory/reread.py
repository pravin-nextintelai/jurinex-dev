"""Reading a case's earlier chats again, so memory learns from what was said before it could.

Memory learns from each turn as it is answered. Everything said before memory existed,
or before the writer learned to read something new (facts from cited answers, Marathi,
reviews of a whole conversation), was never read that way, so an advocate coming back
to a case with a long history found its memory nearly empty.

Here a case's unread turns are read oldest first by the same writer, and then its chats
that were never reviewed are reviewed. Newer turns have already shaped memory, so
reading again is held to stricter rules (`writer.RereadGuard`):

* it never overwrites a line it did not add in the same run: an old hearing date cannot
  replace the current one;
* it never brings back a line written before, which the advocate deleted or a newer
  value replaced;
* it saves no rule by itself: what it finds about how to work is only suggested;
* it neither changes nor makes room among the facts remembered about the advocate;
* an old chat's review adds decisions and suggestions; only the case's latest chat may
  update Stage, Last action and Open items.

It runs in the background, one case at a time: after an answer in a case that still has
unread turns (at most once every few hours per case, and never for a case whose memory
the advocate asked to forget), and whenever the advocate asks for it in the memory
panel. Each run is capped, so a long history is read over several runs.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from typing import Any

from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available
from app.services.memory import repository, writer
from app.services.memory.recall import STATEMENT_TIMEOUT, folder_is_ambiguous
from app.services.memory.scope import CaseScope, is_real_user

logger = logging.getLogger("agentic_document_service.memory.reread")

# A turn answered this recently may still be with the live writer.
SETTLE_MINUTES = 10
# Model calls failing this many turns in a row stop the run; the rest is read next time.
MAX_FAILURES_IN_A_ROW = 3
MIN_REVIEW_TURNS = 2

_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="memory-reread")
_lock = threading.Lock()
_jobs: dict[str, "RereadStatus"] = {}
_last_automatic: dict[str, float] = {}


# ── Settings ─────────────────────────────────────────────────────────────────

def automatic_enabled() -> bool:
    settings = get_settings()
    return bool(getattr(settings, "memory_enabled", True)) and bool(getattr(settings, "memory_reread_enabled", True))


def _setting_int(name: str, default: int) -> int:
    try:
        return max(0, int(getattr(get_settings(), name, default)))
    except (TypeError, ValueError):
        return default


def every_seconds() -> float:
    try:
        return max(0.0, float(getattr(get_settings(), "memory_reread_every_hours", 6.0)) * 3600)
    except (TypeError, ValueError):
        return 6 * 3600.0


# ── Status ───────────────────────────────────────────────────────────────────

@dataclass
class RereadStatus:
    case_key: str
    state: str = "idle"  # idle | queued | running | done | stopped
    automatic: bool = False
    started_at: str | None = None
    finished_at: str | None = None
    turns_planned: int = 0
    turns_read: int = 0
    reviews: int = 0
    saved: int = 0
    suggested: int = 0
    stopped_reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def job(case_key: str) -> RereadStatus | None:
    with _lock:
        return _jobs.get(str(case_key))


def is_running(case_key: str) -> bool:
    current = job(case_key)
    return current is not None and current.state in ("queued", "running")


# ── What is unread ───────────────────────────────────────────────────────────

_UNREAD_WHERE = """
FROM folder_chats fc
LEFT JOIN memory_turn_reads r ON r.chat_id = fc.id
WHERE fc.folder_name = %s
  AND fc.user_id::text = %s
  AND fc.session_id IS NOT NULL
  AND coalesce(fc.answer, '') <> ''
  AND fc.created_at < NOW() - make_interval(mins => %s)
  AND (r.chat_id IS NULL OR r.reader_version < %s)
"""

_UNREAD_SQL = (
    "SELECT fc.id::text AS chat_id, fc.session_id::text AS session_id, fc.question, fc.answer, "
    "fc.prompt_label, fc.used_secret_prompt, (fc.secret_id IS NOT NULL) AS preset, fc.citations, fc.created_at"
    + _UNREAD_WHERE
    + "ORDER BY fc.created_at ASC LIMIT %s"
)
_UNREAD_COUNT_SQL = "SELECT count(*) AS unread" + _UNREAD_WHERE

# Chats never reviewed, oldest first, once they have gone quiet.
_UNREVIEWED_SQL = """
SELECT fc.session_id::text AS session_id, count(*) AS turns, max(fc.created_at) AS last_at
FROM folder_chats fc
WHERE fc.folder_name = %s
  AND fc.user_id::text = %s
  AND fc.session_id IS NOT NULL
  AND coalesce(fc.answer, '') <> ''
  AND NOT EXISTS (
        SELECT 1 FROM memory_review_state s
        WHERE s.case_key = %s AND s.user_id = %s AND s.session_id = fc.session_id::text
  )
GROUP BY fc.session_id
HAVING count(*) >= %s AND max(fc.created_at) < NOW() - make_interval(mins => %s)
ORDER BY max(fc.created_at) ASC
LIMIT %s
"""

_LATEST_SESSION_SQL = """
SELECT session_id::text AS session_id
FROM folder_chats
WHERE folder_name = %s AND user_id::text = %s AND session_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 1
"""


def _read(scope: CaseScope, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]] | None:
    """Rows from the advocate's own chats in this folder; None when they cannot be told apart."""
    with get_db_connection() as connection:
        repository.ensure_tables(connection)  # the reads table, on a database that predates it
        return _read_on(connection, scope, sql, params)


def _read_on(connection: Any, scope: CaseScope, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]] | None:
    with connection.cursor() as cur:
        try:
            cur.execute("SELECT set_config('statement_timeout', %s, true)", (STATEMENT_TIMEOUT,))
            if folder_is_ambiguous(cur, scope):
                return None
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall() or []]
        finally:
            connection.rollback()


def unread_count(scope: CaseScope) -> int | None:
    """How many of the advocate's turns in this case are unread. None when it cannot be told."""
    if scope is None or not is_real_user(scope.user_id) or not is_db_available():
        return None
    try:
        rows = _read(
            scope,
            _UNREAD_COUNT_SQL,
            (scope.folder_name, str(scope.user_id), SETTLE_MINUTES, writer.READER_VERSION),
        )
    except Exception as exc:  # noqa: BLE001 — e.g. the reads table is not there yet
        logger.debug("[Memory] unread turns not counted case_key=%s: %s", scope.case_key, exc)
        return None
    if rows is None:
        return None
    return int((rows[0] if rows else {}).get("unread") or 0)


def _unreviewed_params(scope: CaseScope, limit: int) -> tuple[Any, ...]:
    from app.services.memory import synthesis

    return (
        scope.folder_name, str(scope.user_id), scope.case_key, str(scope.user_id),
        MIN_REVIEW_TURNS, synthesis.idle_minutes(), max(1, int(limit)),
    )


def has_work(scope: CaseScope) -> bool:
    """Whether a run would find anything: unread turns, or a quiet chat never reviewed."""
    from app.services.memory import synthesis

    if unread_count(scope):
        return True
    if not synthesis.enabled():
        return False
    try:
        return bool(_read(scope, _UNREVIEWED_SQL, _unreviewed_params(scope, 1)))
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] unreviewed chats not counted case_key=%s: %s", scope.case_key, exc)
        return False


def paused(scope: CaseScope) -> bool:
    """Whether the advocate asked to forget this case's memory: then nothing refills it by itself."""
    try:
        return repository.get_seed_meta(scope.case_key).get("auto_seed") is False
    except Exception:  # noqa: BLE001
        return False


# ── One run ──────────────────────────────────────────────────────────────────

def _day(value: Any) -> date | None:
    return value.date() if isinstance(value, datetime) else None


def _saved_prompt(row: dict[str, Any]) -> bool:
    flag = row.get("used_secret_prompt")
    used = flag if isinstance(flag, bool) else str(flag or "").strip().lower() in {"true", "t", "1", "yes", "y"}
    label = " ".join(str(row.get("prompt_label") or "").split())
    return bool(row.get("preset")) or used or bool(label and " ".join(str(row.get("question") or "").split()) == label)


def turn_from_row(scope: CaseScope, row: dict[str, Any], guard: writer.RereadGuard) -> writer.TurnInput:
    """An earlier turn, as the writer would have seen it when it was answered."""
    saved = _saved_prompt(row)
    citations = row.get("citations")
    return writer.TurnInput(
        scope=scope,
        question_raw="" if saved else str(row.get("question") or ""),
        answer=str(row.get("answer") or ""),
        session_id=row.get("session_id"),
        chat_id=row.get("chat_id"),
        mode="chat",
        saved_prompt=saved,
        citations=[item for item in citations if isinstance(item, dict)] if isinstance(citations, list) else [],
        log_entry={"case_key": scope.case_key, "user_id": scope.user_id, "mode": "reread"},
        reread=guard,
        created_at=row.get("created_at"),
    )


def _model_failed(report: writer.WriteReport) -> bool:
    return report.skipped_reason in ("extractor_error", "writer_error") or "answer_facts_unavailable" in report.rejection_codes


_STOPPING = frozenset({"disabled_globally", "no_scope", "db_unavailable", "disabled_by_user"})


def run(
    scope: CaseScope,
    *,
    automatic: bool = False,
    max_turns: int | None = None,
    max_reviews: int | None = None,
) -> RereadStatus:
    """Read this case's unread turns, then review its unreviewed chats. Never raises."""
    status = RereadStatus(case_key=scope.case_key, state="running", automatic=automatic, started_at=_now())
    with _lock:
        _jobs[scope.case_key] = status
    try:
        _run(scope, status, max_turns=max_turns, max_reviews=max_reviews)
        if status.state == "running":
            status.state = "done"
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] reading earlier turns failed case_key=%s: %s", scope.case_key, exc)
        status.state, status.stopped_reason = "stopped", "error"
    status.finished_at = _now()
    logger.info(
        "[Memory] read earlier turns case_key=%s state=%s turns=%s/%s reviews=%s saved=%s suggested=%s reason=%s",
        scope.case_key, status.state, status.turns_read, status.turns_planned, status.reviews,
        status.saved, status.suggested, status.stopped_reason,
    )
    return status


def _stop(status: RereadStatus, reason: str) -> None:
    status.state, status.stopped_reason = "stopped", reason


def _run(scope: CaseScope, status: RereadStatus, *, max_turns: int | None, max_reviews: int | None) -> None:
    from app.services.memory import synthesis

    if not get_settings().memory_write_enabled:
        return _stop(status, "disabled_globally")
    if scope is None or not is_real_user(scope.user_id) or not repository.available():
        return _stop(status, "no_scope")
    settings = repository.effective_settings(user_id=scope.user_id, case_key=scope.case_key, firm_id=scope.firm_id)
    if not settings.enabled or not settings.write_enabled:
        return _stop(status, "disabled_by_user")

    turns_cap = _setting_int("memory_reread_max_turns", 40) if max_turns is None else max(0, int(max_turns))
    reviews_cap = _setting_int("memory_reread_max_reviews", 5) if max_reviews is None else max(0, int(max_reviews))
    guard = writer.RereadGuard(written_before=[{"text": text} for text in repository.written_line_texts(scope.case_key)])

    rows = []
    if turns_cap:
        rows = _read(
            scope,
            _UNREAD_SQL,
            (scope.folder_name, str(scope.user_id), SETTLE_MINUTES, writer.READER_VERSION, turns_cap),
        )
        if rows is None:
            return _stop(status, "folder_name_shared")
    status.turns_planned = len(rows)

    failures = 0
    for row in rows:
        turn = turn_from_row(scope, row, guard)
        report = writer.WriteReport()
        try:
            writer._run(turn, report, today=_day(row.get("created_at")))
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Memory] earlier turn not read case_key=%s chat_id=%s: %s", scope.case_key, turn.chat_id, exc)
            report.skipped_reason = "writer_error"
        if report.skipped_reason in _STOPPING:
            return _stop(status, str(report.skipped_reason))
        if _model_failed(report):
            failures += 1
            if failures >= MAX_FAILURES_IN_A_ROW:
                return _stop(status, "model_unavailable")
            continue
        failures = 0
        repository.mark_turns_read(
            scope.case_key, [str(turn.chat_id)], writer.READER_VERSION, outcome=report.skipped_reason or "read"
        )
        status.turns_read += 1
        status.saved += report.writes
        status.suggested += report.proposals
        if report.writes or report.proposals:
            writer._write_log(turn, report)

    if not reviews_cap or not synthesis.enabled():
        return None
    sessions = _read(scope, _UNREVIEWED_SQL, _unreviewed_params(scope, reviews_cap)) or []
    latest = (_read(scope, _LATEST_SESSION_SQL, (scope.folder_name, str(scope.user_id))) or [{}])
    latest_session = str((latest[0] if latest else {}).get("session_id") or "")
    placeholder = writer.TurnInput(scope=scope, question_raw="")
    for session_row in sessions:
        session = str(session_row.get("session_id") or "")
        chat_rows = writer.session_turns(scope, session, since=None, limit=synthesis.MAX_TURNS_PER_REVIEW * 3)
        if len(chat_rows) < MIN_REVIEW_TURNS:
            continue
        lock = synthesis.session_lock(scope.case_key, str(scope.user_id), session)
        if not lock.acquire(blocking=False):
            continue  # the live writer is reviewing it right now
        report = writer.WriteReport()
        try:
            writer._run_review(
                scope, placeholder, report, settings, session, chat_rows, None, "reread",
                today=_day(chat_rows[-1].get("created_at")),
                guard=guard,
                summary_allowed=session == latest_session,
            )
        finally:
            lock.release()
        if "review_unavailable" in report.rejection_codes:
            return _stop(status, "model_unavailable")
        status.reviews += 1
        status.saved += report.writes
        status.suggested += report.proposals
        if report.writes or report.proposals:
            writer._write_log(
                writer.TurnInput(
                    scope=scope,
                    question_raw="",
                    session_id=session,
                    log_entry={"case_key": scope.case_key, "user_id": scope.user_id, "mode": "reread"},
                ),
                report,
            )
    return None


# ── In the background ────────────────────────────────────────────────────────

def _queue(scope: CaseScope, *, automatic: bool) -> RereadStatus:
    status = RereadStatus(case_key=scope.case_key, state="queued", automatic=automatic, started_at=_now())
    with _lock:
        _jobs[scope.case_key] = status

    def work() -> None:
        try:
            if automatic and (paused(scope) or not has_work(scope)):
                with _lock:
                    status.state, status.finished_at = "idle", _now()
                return
        except Exception as exc:  # noqa: BLE001
            logger.debug("[Memory] earlier turns not checked case_key=%s: %s", scope.case_key, exc)
            status.state, status.finished_at = "idle", _now()
            return
        run(scope, automatic=automatic)

    try:
        _EXECUTOR.submit(work)
    except Exception as exc:  # noqa: BLE001 — e.g. shutting down
        logger.debug("[Memory] reading earlier turns not queued case_key=%s: %s", scope.case_key, exc)
        status.state, status.stopped_reason = "stopped", "not_queued"
    return status


def schedule_case(scope: CaseScope) -> bool:
    """After an answer: read this case's earlier turns in the background, if some are unread.

    At most once every MEMORY_REREAD_EVERY_HOURS per case, one case at a time, and never
    for a case whose memory the advocate asked to forget. Returns whether a run was queued.
    """
    if scope is None or not automatic_enabled() or not is_real_user(scope.user_id):
        return False
    key = scope.case_key
    now = time.monotonic()
    with _lock:
        current = _jobs.get(key)
        if current is not None and current.state in ("queued", "running"):
            return False
        last = _last_automatic.get(key)
        if last is not None and now - last < every_seconds():
            return False
        _last_automatic[key] = now
    _queue(scope, automatic=True)
    return True


def start(scope: CaseScope) -> RereadStatus:
    """The advocate asked: read this case's earlier turns now, whatever the schedule."""
    current = job(scope.case_key)
    if current is not None and current.state in ("queued", "running"):
        return current
    return _queue(scope, automatic=False)


def status(scope: CaseScope) -> dict[str, Any]:
    """For the memory panel: how many turns are unread, and the latest run."""
    current = job(scope.case_key)
    return {
        "case_key": scope.case_key,
        "unread": unread_count(scope),
        "automatic": automatic_enabled(),
        "paused": paused(scope),
        "reader_version": writer.READER_VERSION,
        "job": current.as_dict() if current else None,
    }
