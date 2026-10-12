"""Background writer: bounded queue -> batch INSERTs on a separate connection.

Runs on its own daemon thread so rows survive request rollbacks and work the
same under FastAPI, Flask, gunicorn workers and plain scripts. Three sinks:

* ``DbSink``   - direct INSERT with psycopg (3), psycopg2 or asyncpg, whichever is installed
* ``HttpSink`` - POST batches to the owner service's ``/internal/error-logs``
* ``MemorySink`` - tests

Nothing in here raises to the caller.
"""
from __future__ import annotations

import atexit
import json
import logging
import queue
import threading
import time
import urllib.error
import urllib.request
from typing import Any, List, Optional, Sequence, Union

from . import ddl
from .config import Config
from .context import mark_internal
from .model import AuditEvent, ErrorEvent
from .sanitize import payload_json

log = logging.getLogger("errorlog")

Event = Union[ErrorEvent, AuditEvent]


def _split(events: Sequence[Event]) -> tuple:
    errors = [e for e in events if isinstance(e, ErrorEvent)]
    audits = [e for e in events if isinstance(e, AuditEvent)]
    return errors, audits


class Sink:
    name = "none"

    def write(self, events: Sequence[Event]) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def retention(self, days: int, audit_days: int) -> Optional[int]:
        return None

    def close(self) -> None:
        return None


class MemorySink(Sink):
    name = "memory"

    def __init__(self) -> None:
        self.rows: List[ErrorEvent] = []
        self.audit_rows: List[AuditEvent] = []
        self.fail = False

    def write(self, events: Sequence[Event]) -> None:
        if self.fail:
            raise RuntimeError("memory sink failing on purpose")
        errors, audits = _split(events)
        self.rows.extend(errors)
        self.audit_rows.extend(audits)


class HttpSink(Sink):
    name = "http"

    def __init__(self, cfg: Config) -> None:
        from .config import _normalize_ingest_url

        url = _normalize_ingest_url(cfg.ingest_url) or ""
        self.url = url
        self.audit_url = (
            url[: -len("/internal/error-logs")] + "/internal/audit-logs"
            if url.endswith("/internal/error-logs")
            else (url + "/internal/audit-logs" if url else "")
        )
        self.key = cfg.ingest_key or ""
        self.timeout = cfg.http_timeout_s
        if url:
            log.info("errorlog http ingest %s (audit %s)", self.url, self.audit_url)

    def _post(self, url: str, rows: List[dict]) -> None:
        body = json.dumps(rows, ensure_ascii=False, default=str).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Internal-Key": self.key,
                "User-Agent": "jurinex-errorlog/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:  # noqa: S310 - fixed internal URL
            if resp.status >= 300:
                raise RuntimeError(f"ingest returned HTTP {resp.status}")

    def write(self, events: Sequence[Event]) -> None:
        errors, audits = _split(events)
        for i in range(0, len(errors), 100):
            self._post(self.url, [e.to_dict() for e in errors[i : i + 100]])
        for i in range(0, len(audits), 100):
            self._post(self.audit_url, [e.to_dict() for e in audits[i : i + 100]])


class DbSink(Sink):
    name = "db"

    def __init__(self, cfg: Config) -> None:
        self.url = cfg.database_url  # type: ignore[assignment]
        self.connect_timeout = int(cfg.db_connect_timeout_s) or 5
        self.driver = self._detect_driver()
        self._conn: Any = None
        self._ensured = False
        self._ensure_failed_warned = False

    @staticmethod
    def _detect_driver() -> str:
        for name in ("psycopg", "psycopg2", "asyncpg"):
            try:
                __import__(name)
                return name
            except ImportError:
                continue
        raise RuntimeError("errorlog: no PostgreSQL driver (psycopg, psycopg2 or asyncpg) is installed")

    # ── connection handling ────────────────────────────────────────────────

    def _connect(self) -> Any:
        if self.driver == "psycopg":
            import psycopg

            return psycopg.connect(self.url, connect_timeout=self.connect_timeout, autocommit=False)
        if self.driver == "psycopg2":
            import psycopg2

            return psycopg2.connect(self.url, connect_timeout=self.connect_timeout)
        raise RuntimeError("asyncpg connections are per batch")

    def _get_conn(self) -> Any:
        if self._conn is not None:
            closed = getattr(self._conn, "closed", False)
            if not closed:
                return self._conn
            self._conn = None
        self._conn = self._connect()
        return self._conn

    def _drop_conn(self) -> None:
        conn, self._conn = self._conn, None
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass

    def close(self) -> None:
        self._drop_conn()

    # ── DDL ────────────────────────────────────────────────────────────────

    def ensure_table(self) -> None:
        if self._ensured:
            return
        try:
            if self.driver == "asyncpg":
                self._run_asyncpg(self._asyncpg_ensure)
            else:
                conn = self._get_conn()
                with conn.cursor() as cur:
                    for stmt in ddl.ALL_STATEMENTS + ddl.AUDIT_ALL_STATEMENTS:
                        cur.execute(stmt)
                conn.commit()
            self._ensured = True
        except Exception as exc:  # noqa: BLE001
            # Table may already exist and the role may lack CREATE: keep going.
            self._drop_conn()
            if not self._ensure_failed_warned:
                self._ensure_failed_warned = True
                log.warning("errorlog: could not ensure error_logs table (%s); inserts will be attempted anyway", exc)
            self._ensured = True

    # ── writes ─────────────────────────────────────────────────────────────

    @staticmethod
    def _rows(events: Sequence[Event]) -> List[tuple]:
        rows = []
        for e in events:
            rows.append(e.to_row(payload_json(e.payload) if e.payload else None))
        return rows

    def write(self, events: Sequence[Event]) -> None:
        self.ensure_table()
        errors, audits = _split(events)
        err_rows, audit_rows = self._rows(errors), self._rows(audits)
        if self.driver == "asyncpg":
            self._run_asyncpg(lambda conn: self._asyncpg_write(conn, err_rows, audit_rows))
            return
        try:
            conn = self._get_conn()
            with conn.cursor() as cur:
                if err_rows:
                    cur.executemany(ddl.INSERT_SQL_PSYCOPG, err_rows)
                if audit_rows:
                    cur.executemany(ddl.AUDIT_INSERT_SQL_PSYCOPG, audit_rows)
            conn.commit()
        except Exception:
            self._drop_conn()
            raise

    def retention(self, days: int, audit_days: int) -> Optional[int]:
        if self.driver == "asyncpg":
            return self._run_asyncpg(lambda conn: self._asyncpg_retention(conn, days, audit_days))
        conn = self._get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(ddl.RETENTION_SQL, (int(days),))
                deleted = cur.rowcount
                cur.execute(ddl.AUDIT_RETENTION_SQL, (int(audit_days),))
                deleted += max(cur.rowcount, 0)
            conn.commit()
            return deleted
        except Exception:
            self._drop_conn()
            raise

    # ── asyncpg (run on a private loop inside the writer thread) ───────────

    def _run_asyncpg(self, fn):
        import asyncio

        import asyncpg

        async def runner():
            conn = await asyncio.wait_for(asyncpg.connect(self.url), timeout=self.connect_timeout)
            try:
                return await fn(conn)
            finally:
                await conn.close()

        return asyncio.run(runner())

    @staticmethod
    async def _asyncpg_ensure(conn) -> None:
        for stmt in ddl.ALL_STATEMENTS + ddl.AUDIT_ALL_STATEMENTS:
            await conn.execute(stmt)

    @staticmethod
    def _uuid_fix(rows: List[tuple], uuid_positions=(0,)) -> List[tuple]:
        import uuid as _uuid

        fixed = []
        for r in rows:
            r = list(r)
            for pos in uuid_positions:
                if r[pos] is not None:
                    try:
                        r[pos] = _uuid.UUID(str(r[pos]))
                    except ValueError:
                        pass
            fixed.append(tuple(r))
        return fixed

    @classmethod
    async def _asyncpg_write(cls, conn, err_rows: List[tuple], audit_rows: List[tuple]) -> None:
        if err_rows:
            await conn.executemany(ddl.INSERT_SQL_ASYNCPG, cls._uuid_fix(err_rows))
        if audit_rows:
            await conn.executemany(ddl.AUDIT_INSERT_SQL_ASYNCPG, cls._uuid_fix(audit_rows, (0, 14)))

    @staticmethod
    async def _asyncpg_retention(conn, days: int, audit_days: int) -> Optional[int]:
        total = 0
        for sql, d in ((ddl.RETENTION_SQL_ASYNCPG, days), (ddl.AUDIT_RETENTION_SQL_ASYNCPG, audit_days)):
            result = await conn.execute(sql, int(d))
            try:
                total += int(str(result).split()[-1])
            except (ValueError, IndexError):
                pass
        return total


def make_sink(cfg: Config) -> Optional[Sink]:
    if cfg.database_url:
        try:
            return DbSink(cfg)
        except Exception as exc:  # noqa: BLE001
            log.warning("errorlog: direct DB sink unavailable (%s)", exc)
            if not cfg.ingest_url:
                return None
    if cfg.ingest_url:
        return HttpSink(cfg)
    return None


class Writer:
    def __init__(self, cfg: Config, sink: Optional[Sink] = None) -> None:
        self.cfg = cfg
        self.sink: Optional[Sink] = sink if sink is not None else make_sink(cfg)
        self.q: "queue.Queue[Event]" = queue.Queue(maxsize=max(100, cfg.queue_max))
        self.dropped = 0
        self.written = 0
        self.failed_batches = 0
        self._retry: Optional[List[ErrorEvent]] = None
        self._retry_count = 0
        self._retry_after = 0.0
        self._last_drop_warn = 0.0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._idle = threading.Event()
        self._idle.set()
        self._last_retention = 0.0
        self._started_at = time.monotonic()
        self._lock = threading.Lock()
        self._warned_no_sink = False

    # ── lifecycle ──────────────────────────────────────────────────────────

    def start(self) -> None:
        with self._lock:
            if self._thread is not None:
                return
            if self.sink is None:
                if not self._warned_no_sink:
                    self._warned_no_sink = True
                    log.warning(
                        "errorlog: no sink configured (set ERROR_LOG_DATABASE_URL or ERROR_LOG_INGEST_URL); "
                        "errors will be counted but not stored"
                    )
                return
            self._thread = threading.Thread(target=self._run, name="errorlog-writer", daemon=True)
            self._thread.start()
            atexit.register(self.shutdown)

    def shutdown(self, timeout: float = 5.0) -> None:
        self._stop.set()
        t = self._thread
        if t is not None and t.is_alive() and threading.current_thread() is not t:
            t.join(timeout)
        if self.sink is not None:
            try:
                self.sink.close()
            except Exception:  # noqa: BLE001
                pass

    def flush(self, timeout: float = 5.0) -> bool:
        """Block until the queue is drained (tests / shutdown). Returns True when drained."""
        if self._thread is None:
            return self.sink is None or self.q.empty()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.q.empty() and self._idle.is_set() and self._retry is None:
                return True
            time.sleep(0.02)
        return self.q.empty() and self._idle.is_set()

    def stats(self) -> dict:
        return {
            "sink": self.sink.name if self.sink else None,
            "queued": self.q.qsize(),
            "written": self.written,
            "dropped": self.dropped,
            "failed_batches": self.failed_batches,
            "retrying": len(self._retry) if self._retry else 0,
            "thread_alive": bool(self._thread and self._thread.is_alive()),
        }

    # ── producer side ──────────────────────────────────────────────────────

    def enqueue(self, event: Event) -> bool:
        if self.sink is None:
            self.dropped += 1
            return False
        if self._thread is None:
            self.start()
        try:
            self.q.put_nowait(event)
            self._idle.clear()
            return True
        except queue.Full:
            self.dropped += 1
            now = time.monotonic()
            if now - self._last_drop_warn > 60:
                self._last_drop_warn = now
                log.warning("errorlog: queue full (%d), dropping error rows", self.q.maxsize)
            return False

    # ── consumer side ──────────────────────────────────────────────────────

    def _collect(self) -> List[ErrorEvent]:
        batch: List[ErrorEvent] = []
        try:
            first = self.q.get(timeout=max(0.1, self.cfg.flush_interval_s))
        except queue.Empty:
            return batch
        batch.append(first)
        while len(batch) < max(1, self.cfg.batch_size):
            try:
                batch.append(self.q.get_nowait())
            except queue.Empty:
                break
        return batch

    def _run(self) -> None:
        mark_internal(True)
        while True:
            try:
                if self._stop.is_set() and self.q.empty() and self._retry is None:
                    break
                self._idle.clear() if not self.q.empty() else None
                if self._retry is not None and time.monotonic() >= self._retry_after:
                    self._write(self._retry, retrying=True)
                batch = self._collect()
                if batch:
                    self._write(batch)
                if self.q.empty() and self._retry is None:
                    self._idle.set()
                self._maybe_retention()
            except Exception as exc:  # noqa: BLE001 - keep the thread alive no matter what
                log.debug("errorlog: writer loop error: %s", exc)
                time.sleep(0.5)

    def _write(self, batch: List[ErrorEvent], *, retrying: bool = False) -> None:
        assert self.sink is not None
        try:
            self.sink.write(batch)
            self.written += len(batch)
            if retrying:
                self._retry = None
                self._retry_count = 0
        except Exception as exc:  # noqa: BLE001
            self.failed_batches += 1
            if retrying:
                self._retry_count += 1
                if self._retry_count >= 3:
                    log.warning("errorlog: giving up on %d rows after 3 attempts (%s)", len(batch), exc)
                    self.dropped += len(batch)
                    self._retry = None
                    self._retry_count = 0
                    return
                self._retry_after = time.monotonic() + min(30.0, 2.0 * (2 ** self._retry_count))
                return
            if self._retry is None:
                self._retry = list(batch)
                self._retry_count = 0
                self._retry_after = time.monotonic() + 2.0
                log.warning("errorlog: write failed (%s); will retry %d rows", exc, len(batch))
            else:
                # Already holding a failed batch: merge up to one more batch, then drop.
                if len(self._retry) + len(batch) <= max(100, self.cfg.batch_size * 2):
                    self._retry.extend(batch)
                else:
                    self.dropped += len(batch)

    def _maybe_retention(self) -> None:
        if not self.cfg.retention_enabled or self.sink is None or self.sink.name != "db":
            return
        now = time.monotonic()
        # First run a minute after start, then once a day.
        if self._last_retention == 0.0 and now - self._started_at < 60:
            return
        if self._last_retention and now - self._last_retention < 86400:
            return
        self._last_retention = now
        try:
            deleted = self.sink.retention(self.cfg.retention_days, self.cfg.audit_retention_days)
            if deleted:
                log.info("errorlog: retention removed %s rows (resolved errors > %d days, audit > %d days)", deleted, self.cfg.retention_days, self.cfg.audit_retention_days)
        except Exception as exc:  # noqa: BLE001
            log.debug("errorlog: retention failed: %s", exc)
