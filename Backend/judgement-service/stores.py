"""
Data-store connections and helpers: Redis (cache/sessions), Qdrant
(segment embeddings), Neo4j (citation graph), Postgres (vault).

Every store is optional and lazily connected. When a store is missing or
down the service degrades gracefully: Redis falls back to an in-process
TTL cache, Qdrant caching is skipped, Neo4j-based good-law stays "lite",
and vault writes are no-ops. Nothing here may raise at import or boot.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import uuid
from typing import Any

from config import get_settings

logger = logging.getLogger(__name__)


# ─── In-process TTL cache (Redis fallback) ───────────────────────────────────

class _MemoryTTLCache:
    def __init__(self) -> None:
        self._data: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> str | None:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires, value = item
            if expires < time.time():
                del self._data[key]
                return None
            return value

    def set(self, key: str, value: str, ttl: int) -> None:
        with self._lock:
            if len(self._data) > 5000:  # crude bound; oldest-expiry sweep
                now = time.time()
                self._data = {k: v for k, v in self._data.items() if v[0] > now}
            self._data[key] = (time.time() + ttl, value)

    def delete(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)


class Cache:
    """Redis-backed string cache with transparent in-memory fallback."""

    def __init__(self) -> None:
        self._memory = _MemoryTTLCache()
        self._redis = None
        self._redis_failed = False

    def _client(self):
        if self._redis is not None or self._redis_failed:
            return self._redis
        url = get_settings().redis_url
        if not url:
            self._redis_failed = True
            return None
        try:
            import redis  # type: ignore
            self._redis = redis.Redis.from_url(url, decode_responses=True, socket_timeout=3)
            self._redis.ping()
            logger.info("[stores] Redis connected")
        except Exception as exc:
            logger.warning("[stores] Redis unavailable (%s) — using in-memory cache", exc)
            self._redis = None
            self._redis_failed = True
        return self._redis

    def get(self, key: str) -> str | None:
        client = self._client()
        if client is not None:
            try:
                return client.get(key)
            except Exception as exc:
                logger.warning("[stores] Redis get failed (%s)", exc)
        return self._memory.get(key)

    def set(self, key: str, value: str, ttl: int = 86400) -> None:
        client = self._client()
        if client is not None:
            try:
                client.setex(key, ttl, value)
                return
            except Exception as exc:
                logger.warning("[stores] Redis set failed (%s)", exc)
        self._memory.set(key, value, ttl)

    def delete(self, key: str) -> None:
        # Remove from BOTH layers: a value may sit in the memory fallback
        # from an earlier Redis outage.
        client = self._client()
        if client is not None:
            try:
                client.delete(key)
            except Exception as exc:
                logger.warning("[stores] Redis delete failed (%s)", exc)
        self._memory.delete(key)

    def get_json(self, key: str) -> Any | None:
        raw = self.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return None

    def set_json(self, key: str, value: Any, ttl: int = 86400) -> None:
        self.set(key, json.dumps(value, default=str), ttl)

    @property
    def backend(self) -> str:
        return "redis" if self._client() is not None else "memory"


cache = Cache()


# ─── Session store (for /refine) ─────────────────────────────────────────────

class SessionStore:
    """Holds the full result set + candidate pool + reports for a search
    session. Fast path is the cache; every save is also written through to
    Postgres (citationTest) in the background, and cache misses fall back
    to Postgres — sessions survive restarts and cache TTLs."""

    def __init__(self) -> None:
        self._cache = cache
        from concurrent.futures import ThreadPoolExecutor
        self._writer = ThreadPoolExecutor(max_workers=2, thread_name_prefix="session-db")

    @staticmethod
    def new_session_id() -> str:
        return uuid.uuid4().hex

    def save(self, session_id: str, payload: dict[str, Any]) -> None:
        ttl = get_settings().session_ttl_seconds
        self._cache.set_json(f"jsession:{session_id}", payload, ttl)
        # Durable write-through — background thread so the response path
        # never waits on the remote database.
        self._writer.submit(_session_db_upsert, session_id, payload)

    def save_sync(self, session_id: str, payload: dict[str, Any]) -> None:
        """Durable-FIRST save for pipeline milestones (analyze end, run end,
        issue added, ownership tag). The cache is per-process memory, so with
        several Cloud Run instances — or a restart killing the background
        writer — an async write loses the session for every other process:
        the user's next request 404s "Unknown or expired sessionId" at
        random. Milestone responses must not return before the DB row
        exists; report-caching saves stay async (a lost one only costs a
        regeneration, never a 404)."""
        ttl = get_settings().session_ttl_seconds
        self._cache.set_json(f"jsession:{session_id}", payload, ttl)
        _session_db_upsert(session_id, payload)

    def load(self, session_id: str) -> dict[str, Any] | None:
        payload = self._cache.get_json(f"jsession:{session_id}")
        if payload is not None:
            return payload
        payload = postgres.session_select(session_id)
        if payload is not None:
            self._cache.set_json(f"jsession:{session_id}", payload,
                                 get_settings().session_ttl_seconds)
        return payload

    def delete(self, session_id: str) -> bool:
        """Remove a session everywhere — cache and durable copy. The DB
        delete runs synchronously (unlike saves) so the caller can report
        a real outcome; returns the durable layer's success."""
        self._cache.delete(f"jsession:{session_id}")
        return postgres.session_delete(session_id)


def _session_db_upsert(session_id: str, payload: dict[str, Any]) -> None:
    try:
        postgres.session_upsert(session_id, payload)
    except Exception as exc:  # background thread — never propagate
        logger.warning("[stores] background session write failed (%s)", exc)


sessions = SessionStore()


# ─── Qdrant (segment embeddings — the flywheel) ──────────────────────────────

class QdrantStore:
    def __init__(self) -> None:
        self._client = None
        self._failed = False
        self._collection_ready = False

    def _get(self):
        if self._client is not None or self._failed:
            return self._client
        settings = get_settings()
        if not settings.qdrant_url:
            self._failed = True
            return None
        try:
            from qdrant_client import QdrantClient
            self._client = QdrantClient(
                url=settings.qdrant_url,
                api_key=settings.qdrant_api_key,
                timeout=10,
            )
            self._ensure_collection()
            logger.info("[stores] Qdrant connected (%s)", settings.judgement_qdrant_collection)
        except Exception as exc:
            logger.warning("[stores] Qdrant unavailable (%s) — embedding cache disabled", exc)
            self._client = None
            self._failed = True
        return self._client

    def _ensure_collection(self) -> None:
        if self._collection_ready or self._client is None:
            return
        from qdrant_client import models as qm
        settings = get_settings()
        name = settings.judgement_qdrant_collection
        if not self._client.collection_exists(name):
            self._client.create_collection(
                collection_name=name,
                vectors_config=qm.VectorParams(size=settings.embedding_dim, distance=qm.Distance.COSINE),
            )
        self._collection_ready = True

    @staticmethod
    def point_id(doc_id: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"ik-segment:{doc_id}"))

    def get_vector(self, doc_id: str) -> list[float] | None:
        client = self._get()
        if client is None:
            return None
        try:
            points = client.retrieve(
                collection_name=get_settings().judgement_qdrant_collection,
                ids=[self.point_id(doc_id)],
                with_vectors=True,
            )
            if points and points[0].vector:
                return list(points[0].vector)
        except Exception as exc:
            logger.warning("[stores] Qdrant retrieve failed (%s)", exc)
        return None

    def put_vector(self, doc_id: str, vector: list[float], payload: dict[str, Any]) -> None:
        client = self._get()
        if client is None:
            return
        try:
            from qdrant_client import models as qm
            client.upsert(
                collection_name=get_settings().judgement_qdrant_collection,
                points=[qm.PointStruct(id=self.point_id(doc_id), vector=vector,
                                       payload={"doc_id": doc_id, **payload})],
            )
        except Exception as exc:
            logger.warning("[stores] Qdrant upsert failed (%s)", exc)

    @property
    def available(self) -> bool:
        return self._get() is not None


qdrant = QdrantStore()


# ─── Neo4j (typed citation graph — full good-law, later phase) ───────────────

class Neo4jStore:
    def __init__(self) -> None:
        self._driver = None
        self._failed = False

    def _get(self):
        if self._driver is not None or self._failed:
            return self._driver
        settings = get_settings()
        if settings.judgement_disable_neo4j or not settings.neo4j_uri:
            self._failed = True
            return None
        try:
            from neo4j import GraphDatabase
            self._driver = GraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_username, settings.neo4j_password),
            )
            self._driver.verify_connectivity()
            logger.info("[stores] Neo4j connected")
        except Exception as exc:
            logger.warning("[stores] Neo4j unavailable (%s) — good-law stays lite", exc)
            self._driver = None
            self._failed = True
        return self._driver

    def negative_treatment(self, doc_id: str) -> dict[str, Any] | None:
        """Typed treatment lookup: returns {"overruled": bool, "negative_count": int}
        when the graph knows this judgment, else None (→ lite proxy applies)."""
        driver = self._get()
        if driver is None:
            return None
        try:
            with driver.session() as session:
                record = session.run(
                    """
                    MATCH (c:Case {doc_id: $doc_id})
                    OPTIONAL MATCH (c)<-[r:CITES]-(:Case)
                    WITH c,
                         sum(CASE WHEN r.treatment IN ['overruled','superseded'] THEN 1 ELSE 0 END) AS overruled_n,
                         sum(CASE WHEN r.treatment IN ['distinguished','doubted','overruled','superseded'] THEN 1 ELSE 0 END) AS negative_n
                    RETURN overruled_n, negative_n
                    """,
                    doc_id=doc_id,
                ).single()
                if record is None:
                    return None
                return {
                    "overruled": (record["overruled_n"] or 0) > 0,
                    "negative_count": record["negative_n"] or 0,
                }
        except Exception as exc:
            logger.warning("[stores] Neo4j treatment lookup failed (%s)", exc)
            return None

    @property
    def available(self) -> bool:
        return self._get() is not None


neo4j_store = Neo4jStore()


# ─── Postgres (vault write path — flywheel persistence) ──────────────────────

_VAULT_DDL = """
CREATE TABLE IF NOT EXISTS judgement_vault (
    doc_id       TEXT PRIMARY KEY,
    title        TEXT,
    court        TEXT,
    year         INTEGER,
    headline     TEXT,
    num_citedby  INTEGER DEFAULT 0,
    first_seen   TIMESTAMPTZ DEFAULT now(),
    last_seen    TIMESTAMPTZ DEFAULT now(),
    seen_count   INTEGER DEFAULT 1
);
"""

_SESSIONS_DDL = """
CREATE TABLE IF NOT EXISTS judgement_sessions (
    session_id   TEXT PRIMARY KEY,
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE judgement_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_judgement_sessions_user
    ON judgement_sessions (user_id, updated_at DESC);
"""


class PostgresStore:
    def __init__(self) -> None:
        self._pool = None
        self._failed = False

    def _get(self):
        if self._pool is not None or self._failed:
            return self._pool
        url = get_settings().db_url
        if not url:
            self._failed = True
            return None
        try:
            from psycopg2 import pool as pgpool
            # TCP keepalives: the remote Postgres (and NATs in between) drop
            # idle connections; keepalives keep them honest, and _run below
            # recovers when one dies anyway.
            self._pool = pgpool.ThreadedConnectionPool(
                1, 5, dsn=url,
                keepalives=1, keepalives_idle=30,
                keepalives_interval=10, keepalives_count=3)
            conn = self._pool.getconn()
            try:
                with conn.cursor() as cur:
                    cur.execute(_VAULT_DDL)
                    cur.execute(_SESSIONS_DDL)
                conn.commit()
            finally:
                self._pool.putconn(conn)
            logger.info("[stores] Postgres connected — vault + sessions ready")
        except Exception as exc:
            logger.warning("[stores] Postgres unavailable (%s) — vault writes disabled", exc)
            self._pool = None
            self._failed = True
        return self._pool

    def _run(self, op: str, fn, default):
        """Run one DB operation with dead-connection recovery. A pooled
        connection the server closed while idle fails with Operational/
        InterfaceError on first use — before this, that connection went
        BACK into the pool and the write was silently lost (sessions
        stopped saving until restart). Now the dead connection is
        discarded and the operation retried once on a fresh one."""
        pool = self._get()
        if pool is None:
            return default
        import psycopg2
        for attempt in (1, 2):
            conn = None
            broken = False
            try:
                conn = pool.getconn()
                result = fn(conn)
                conn.commit()
                return result
            except (psycopg2.OperationalError, psycopg2.InterfaceError) as exc:
                broken = True
                if attempt == 1:
                    logger.warning("[stores] %s hit a dead connection (%s) — "
                                   "retrying on a fresh one", op, exc)
                else:
                    logger.warning("[stores] %s failed after retry (%s)", op, exc)
            except Exception as exc:
                logger.warning("[stores] %s failed (%s)", op, exc)
                if conn is not None:
                    try:
                        conn.rollback()
                    except Exception:
                        broken = True
                return default
            finally:
                if conn is not None:
                    try:
                        pool.putconn(conn, close=broken)
                    except Exception:
                        pass
        return default

    def session_upsert(self, session_id: str, payload: dict[str, Any]) -> bool:
        """Durable copy of a search session (results, reports, statuses) —
        everything survives cache TTLs and service restarts."""
        from psycopg2.extras import Json

        def _op(conn) -> bool:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO judgement_sessions (session_id, payload, user_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (session_id) DO UPDATE SET
                        payload = EXCLUDED.payload,
                        user_id = COALESCE(EXCLUDED.user_id, judgement_sessions.user_id),
                        updated_at = now()
                    """,
                    (session_id, Json(payload), payload.get("userId")),
                )
            return True

        return self._run("session upsert", _op, False)

    def session_list(self, user_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        """Research history: lightweight summaries of stored sessions,
        newest first, strictly scoped to one user. Unowned (NULL user_id)
        rows are never listed — history is private per user."""
        if not user_id:
            return []

        def _op(conn) -> list[dict[str, Any]]:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT session_id,
                           COALESCE(payload->>'caseTitle', '')                          AS case_title,
                           COALESCE(payload->>'caseId', '')                             AS case_id,
                           COALESCE(payload->'caseContext'->>'raw_case_summary', '')    AS summary,
                           COALESCE(jsonb_array_length(payload->'issues'), 0)           AS issue_count,
                           COALESCE((SELECT SUM(jsonb_array_length(i->'results'))
                                     FROM jsonb_array_elements(payload->'issues') i), 0) AS citation_count,
                           created_at, updated_at
                    FROM judgement_sessions
                    WHERE user_id = %s::text
                    ORDER BY updated_at DESC
                    LIMIT %s
                    """,
                    (user_id, limit),
                )
                rows = cur.fetchall()
            return [
                {
                    "sessionId": r[0],
                    "caseTitle": r[1],
                    "caseId": r[2],
                    "summary": (r[3] or "")[:220],
                    "issueCount": int(r[4] or 0),
                    "citationCount": int(r[5] or 0),
                    "createdAt": str(r[6]),
                    "updatedAt": str(r[7]),
                }
                for r in rows
            ]

        return self._run("session list", _op, [])

    def session_select(self, session_id: str) -> dict[str, Any] | None:
        def _op(conn) -> dict[str, Any] | None:
            with conn.cursor() as cur:
                cur.execute("SELECT payload FROM judgement_sessions WHERE session_id = %s",
                            (session_id,))
                row = cur.fetchone()
            return row[0] if row else None

        return self._run("session select", _op, None)

    def session_delete(self, session_id: str) -> bool:
        def _op(conn) -> bool:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM judgement_sessions WHERE session_id = %s",
                            (session_id,))
            return True

        return self._run("session delete", _op, False)

    # Columns the ENGINE owns on citation_usage_events — the pricing
    # trigger owns cost_inr/cost_usd/rate_version/cost_source; id/created_at
    # are automatic. producer_cost_inr is our own figure, drift signal only.
    _USAGE_COLS = ("event_key", "session_id", "run_id", "step_no", "user_id",
                   "case_id", "provider", "service", "operation", "stage",
                   "model", "unit", "quantity", "calls", "input_tokens",
                   "output_tokens", "cached_tokens", "cache_hit",
                   "producer_cost_inr", "metadata", "occurred_at")

    def usage_insert_events(self, rows: list[dict[str, Any]]) -> int:
        """Append per-user usage events to the admin billing ledger
        (citation_usage_events). Append-only by design; the partial unique
        index on event_key makes retries idempotent (ON CONFLICT DO
        NOTHING). metadata (JSONB, NOT NULL) carries e.g. which caching
        method served the row. Never raises into the request path."""
        if not rows:
            return 0
        from psycopg2.extras import Json
        cols = self._USAGE_COLS
        sql = (f"INSERT INTO citation_usage_events ({', '.join(cols)}) "
               f"VALUES ({', '.join('%(' + c + ')s' for c in cols)}) "
               "ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING")

        def _op(conn) -> int:
            with conn.cursor() as cur:
                for row in rows:
                    params = {c: row.get(c) for c in cols}
                    params["metadata"] = Json(params.get("metadata") or {})
                    cur.execute(sql, params)
            return len(rows)

        return self._run("usage events insert", _op, 0)

    def vault_upsert(self, rows: list[dict[str, Any]]) -> int:
        """Persist GREEN survivors. Called async after the response is sent —
        must never raise into the request path."""
        if not rows:
            return 0

        def _op(conn) -> int:
            with conn.cursor() as cur:
                for row in rows:
                    cur.execute(
                        """
                        INSERT INTO judgement_vault (doc_id, title, court, year, headline, num_citedby)
                        VALUES (%(doc_id)s, %(title)s, %(court)s, %(year)s, %(headline)s, %(num_citedby)s)
                        ON CONFLICT (doc_id) DO UPDATE SET
                            last_seen = now(),
                            seen_count = judgement_vault.seen_count + 1,
                            num_citedby = EXCLUDED.num_citedby
                        """,
                        row,
                    )
            return len(rows)

        return self._run("vault upsert", _op, 0)

    @property
    def available(self) -> bool:
        return self._get() is not None


postgres = PostgresStore()


# ─── Document_DB (read-only: per-page chunks for issue source refs) ──────────

class DocDBStore:
    """Read-only access to the agentic-document-service's Postgres, used
    solely to turn a file into page-numbered chunks (file_chunks.content +
    page_start) so issues can cite 'file, page N'. Optional — when absent,
    issues fall back to whole-file refs from the HTTP files API."""

    def __init__(self) -> None:
        self._pool = None
        self._failed = False

    def _get(self):
        if self._pool is not None or self._failed:
            return self._pool
        url = get_settings().doc_db_url
        if not url:
            self._failed = True
            return None
        try:
            from psycopg2 import pool as pgpool
            self._pool = pgpool.ThreadedConnectionPool(1, 3, dsn=url)
            logger.info("[stores] Document_DB connected (page-chunk refs enabled)")
        except Exception as exc:
            logger.warning("[stores] Document_DB unavailable (%s) — page refs disabled", exc)
            self._pool = None
            self._failed = True
        return self._pool

    def chunks_for_file(self, file_id: str) -> list[tuple[str, int]] | None:
        """[(content, page_start)] ordered by chunk_index, or None."""
        pool = self._get()
        if pool is None or not file_id:
            return None
        conn = None
        try:
            conn = pool.getconn()
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT content, COALESCE(page_start, 0)
                    FROM file_chunks
                    WHERE file_id::text = %s
                    ORDER BY chunk_index
                    """,
                    (str(file_id),),
                )
                rows = cur.fetchall()
            return [(r[0] or "", int(r[1] or 0)) for r in rows] or None
        except Exception as exc:
            logger.warning("[stores] file_chunks lookup failed (%s)", exc)
            return None
        finally:
            if conn is not None:
                pool.putconn(conn)

    @property
    def available(self) -> bool:
        return self._get() is not None


doc_db = DocDBStore()


# ─── Elasticsearch (local judgment library — the IK mirror) ──────────────────

class ElasticStore:
    """Every judgment fetched from Indian Kanoon is mirrored here AS-IS,
    under the SAME document id as IK (`tid`), so keyword search over the
    accumulated corpus is free and paginates exactly like IK's advanced
    search. Optional — when ES is absent, indexing/search degrade silently
    and IK remains the only search source."""

    def __init__(self) -> None:
        self._client = None
        self._failed = False
        # Why the connection failed, verbatim — the API surfaces it in the
        # 503 so "not reachable" never hides a missing driver or a bad
        # credential behind a generic "check ELASTICSEARCH_URL".
        self.failure_reason: str | None = None
        # Indexing is fired from executor THREADS (12 doc fetches can land
        # together) — without this lock they all raced into the connect
        # attempt before the failure latch was set, printing the warning
        # once per thread.
        self._connect_lock = threading.Lock()

    def _get(self):
        if self._client is not None or self._failed:
            return self._client
        with self._connect_lock:
            if self._client is not None or self._failed:
                return self._client
            settings = get_settings()
            if not settings.elasticsearch_url:
                self._failed = True
                self.failure_reason = "ELASTICSEARCH_URL is not set"
                return None
            try:
                # The per-request transport logs are INFO-noisy; failures
                # surface through our own warning below.
                logging.getLogger("elastic_transport.transport").setLevel(logging.WARNING)
                from elasticsearch import Elasticsearch
                kwargs: dict[str, Any] = {
                    "request_timeout": settings.elastic_request_timeout,
                    "verify_certs": settings.elastic_verify_certs,
                    "ssl_show_warn": False,
                }
                if settings.elasticsearch_username and settings.elasticsearch_password:
                    kwargs["basic_auth"] = (settings.elasticsearch_username,
                                            settings.elasticsearch_password)
                client = Elasticsearch(settings.elasticsearch_url, **kwargs)
                # info() (unlike ping()) raises with the REAL cause — an
                # auth 401 reads as an auth 401, not a vague "ping failed".
                client.info()
                self._client = client
                self._ensure_index()
                logger.info("[stores] Elasticsearch connected — judgment library "
                            "index '%s'", settings.elastic_index)
            except Exception as exc:
                reason = f"{type(exc).__name__}: {exc}"
                if isinstance(exc, ModuleNotFoundError):
                    # Running the service under an interpreter that lacks the
                    # driver — the usual cause is starting it with the system
                    # python instead of this service's venv.
                    reason += (" — install requirements.txt, or start the "
                               "service with venv/Scripts/python.exe")
                logger.warning("[stores] Elasticsearch unavailable (%s) — local "
                               "judgment library disabled until restart", reason)
                self._client = None
                self._failed = True
                self.failure_reason = reason
            return self._client

    @property
    def available(self) -> bool:
        return self._get() is not None

    def _ensure_index(self) -> None:
        cache_index = get_settings().elastic_search_cache_index
        if not self._client.indices.exists(index=cache_index):
            self._client.indices.create(index=cache_index, mappings={"properties": {
                "wire": {"type": "keyword"},
                "pagenum": {"type": "integer"},
                "docs": {"type": "object", "enabled": False},
                "saved_at": {"type": "date"},
            }})
            logger.info("[stores] created Elasticsearch index '%s'", cache_index)
        para_index = get_settings().elastic_paragraph_index
        if not self._client.indices.exists(index=para_index):
            # The paragraph layer: every judgment is ALSO indexed as legal
            # chunks so multi-phrase queries can score same/nearby-paragraph
            # co-occurrence above scattered mentions. `text` keeps the
            # standard analyzer (exact word forms for phrase matching);
            # `text.english` adds a stemmed subfield for flexible/BM25 mode.
            # Metadata fields are keyword-typed for exact filtering and are
            # filled only when reliably extracted — never invented.
            self._client.indices.create(index=para_index, mappings={"properties": {
                "judgment_id": {"type": "keyword"},
                "paragraph_no": {"type": "integer"},
                "title": {"type": "text"},
                "docsource": {"type": "text",
                              "fields": {"kw": {"type": "keyword"}}},
                "publishdate": {"type": "date",
                                "format": "yyyy-MM-dd||strict_date_optional_time",
                                "ignore_malformed": True},
                "case_number": {"type": "keyword"},
                "bench": {"type": "text"},
                "sections": {"type": "keyword"},
                "acts": {"type": "keyword"},
                "citations": {"type": "keyword"},
                "paragraph_type": {"type": "keyword"},
                "text": {"type": "text",
                         "fields": {"english": {"type": "text",
                                                "analyzer": "english"}}},
            }})
            logger.info("[stores] created Elasticsearch index '%s'", para_index)
        index = get_settings().elastic_index
        if self._client.indices.exists(index=index):
            return
        self._client.indices.create(index=index, mappings={"properties": {
            "tid": {"type": "keyword"},
            "title": {"type": "text"},
            # `doc` = IK's own judgment HTML, stored verbatim (not searched);
            # `text` = the stripped full text, the search field.
            "doc": {"type": "text", "index": False},
            "text": {"type": "text"},
            "docsource": {"type": "text",
                          "fields": {"kw": {"type": "keyword"}}},
            "publishdate": {"type": "date",
                            "format": "yyyy-MM-dd||strict_date_optional_time",
                            "ignore_malformed": True},
            "author": {"type": "text"},
            "bench": {"type": "text"},
            "numcites": {"type": "integer"},
            "numcitedby": {"type": "integer"},
            "casesCited": {"type": "object", "enabled": False},
            "citedBy": {"type": "object", "enabled": False},
        }})
        logger.info("[stores] created Elasticsearch index '%s'", index)

    def index_judgment(self, doc_id: str, body: dict[str, Any]) -> bool:
        """Add one judgment under its IK docId — CREATE-only: a docId
        already in the dataset is SKIPPED, never re-written (no duplicates,
        no churn). Fire-and-forget from the fetch path — never raises."""
        client = self._get()
        if client is None or not doc_id:
            return False
        try:
            client.index(index=get_settings().elastic_index, id=str(doc_id),
                         op_type="create",
                         document={k: v for k, v in body.items() if v is not None})
            return True
        except Exception as exc:
            if getattr(exc, "status_code", None) == 409 or "version_conflict" in str(exc):
                return False  # already in the dataset — duplicate skipped
            logger.warning("[stores] ES index of doc %s failed (%s)", doc_id, exc)
            return False

    def update_judgment(self, doc_id: str, fields: dict[str, Any]) -> None:
        """Best-effort partial merge (e.g. author/bench from /docmeta) onto
        an already-indexed judgment. Missing doc → silently skipped."""
        client = self._get()
        if client is None or not doc_id:
            return
        try:
            client.update(index=get_settings().elastic_index, id=str(doc_id),
                          doc={k: v for k, v in fields.items() if v})
        except Exception:
            pass  # not indexed yet, or ES hiccup — nothing depends on this

    def search_judgments(self, query: dict[str, Any], sort: list | None,
                         pagenum: int, size: int = 10) -> dict[str, Any] | None:
        """One page (`size` hits) of the library, IK-style: `from` walks
        pages, highlights on `text` produce the headline snippet.
        None = ES down."""
        client = self._get()
        if client is None:
            return None
        try:
            return dict(client.search(
                index=get_settings().elastic_index,
                query=query,
                sort=sort or ["_score"],
                from_=max(0, pagenum) * size,
                size=size,
                highlight={"fields": {"text": {
                    "fragment_size": 160, "number_of_fragments": 2}}},
                source_excludes=["doc", "text"],
                track_total_hits=True,
            ))
        except Exception as exc:
            logger.warning("[stores] ES search failed (%s)", exc)
            return None

    def index_paragraphs(self, judgment_id: str,
                         paragraphs: list[dict[str, Any]]) -> int:
        """Bulk-add one judgment's chunks. Deterministic ids
        (judgment_id:paragraph_no) + create-only make re-indexing a no-op —
        no duplicate chunks, ever. Never raises."""
        client = self._get()
        if client is None or not judgment_id or not paragraphs:
            return 0
        try:
            from elasticsearch.helpers import bulk
            index = get_settings().elastic_paragraph_index
            actions = [{
                "_op_type": "create",
                "_index": index,
                "_id": f"{judgment_id}:{int(row.get('paragraph_no') or 0)}",
                "_source": {k: v for k, v in row.items() if v not in (None, "", [])},
            } for row in paragraphs]
            ok, _errors = bulk(client, actions, raise_on_error=False,
                               raise_on_exception=False)
            return int(ok)
        except Exception as exc:
            logger.warning("[stores] ES paragraph indexing of %s failed (%s)",
                           judgment_id, exc)
            return 0

    def search_paragraphs(self, query: dict[str, Any], size: int = 200,
                          ) -> dict[str, Any] | None:
        """Chunk-level search — returns raw hits (with matched_queries from
        named clauses and text highlights) for judgment grouping upstream.
        None = ES down."""
        client = self._get()
        if client is None:
            return None
        try:
            return dict(client.search(
                index=get_settings().elastic_paragraph_index,
                query=query,
                size=size,
                source_includes=["judgment_id", "paragraph_no", "sections",
                                 "acts", "paragraph_type"],
                highlight={"fields": {"text": {
                    "fragment_size": 160, "number_of_fragments": 1}}},
                track_total_hits=True,
            ))
        except Exception as exc:
            logger.warning("[stores] ES paragraph search failed (%s)", exc)
            return None

    def search_cache_put(self, wire: str, pagenum: int,
                         docs: list[dict[str, Any]]) -> None:
        """Remember one IK search response under its exact wire query —
        the same query is then served from ES forever. Never raises."""
        client = self._get()
        if client is None or not docs:
            return
        try:
            key = f"{hashlib.sha1(wire.encode()).hexdigest()}:{pagenum}"
            client.index(index=get_settings().elastic_search_cache_index, id=key,
                         document={"wire": wire, "pagenum": pagenum, "docs": docs,
                                   "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                                             time.gmtime())})
        except Exception as exc:
            logger.warning("[stores] ES search-cache put failed (%s)", exc)

    def search_cache_get(self, wire: str) -> list[dict[str, Any]] | None:
        """Every judgment IK ever returned for this exact wire query (all
        remembered pages, in page order), or None when never asked."""
        client = self._get()
        if client is None:
            return None
        try:
            resp = client.search(index=get_settings().elastic_search_cache_index,
                                 query={"term": {"wire": wire}},
                                 sort=[{"pagenum": {"order": "asc"}}], size=20)
            hits = (resp.get("hits") or {}).get("hits") or []
            if not hits:
                return None
            docs: list[dict[str, Any]] = []
            for hit in hits:
                docs.extend((hit.get("_source") or {}).get("docs") or [])
            return docs
        except Exception:
            return None

    def get_judgment(self, doc_id: str) -> dict[str, Any] | None:
        """The stored judgment (incl. IK's raw HTML) by docId, or None."""
        client = self._get()
        if client is None or not doc_id:
            return None
        try:
            hit = client.get(index=get_settings().elastic_index, id=str(doc_id))
            return dict(hit.get("_source") or {})
        except Exception:
            return None


elastic = ElasticStore()


def store_health() -> dict[str, Any]:
    return {
        "cache": cache.backend,
        "qdrant": qdrant.available,
        "neo4j": neo4j_store.available,
        "postgres": postgres.available,
        "docDb": doc_db.available,
        "elastic": elastic.available,
    }
