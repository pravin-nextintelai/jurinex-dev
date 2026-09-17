"""Past chats indexed by meaning, so recall finds a discussion however it was worded.

Recall searched chat history with English full-text search, so an earlier discussion
was found only when the advocate reused its words ("which ground did we agree to drop"
missed "we will press the Section 63-1A ground and drop the limitation point"), and a
question in Marathi or Hindi found nothing at all.

Each saved turn is embedded with a multilingual model into a few vectors: the
advocate's own words, and the answer in overlapping passages, so a point made deep in
a long answer can still be found. Scoping does not change: the vectors hold no folder
or user, every search joins `folder_chats` for them, and a turn deleted from history
takes its vectors with it.

A vector here is only ever a real embedding. The service's embedding adapter falls back
to hash vectors when Gemini is unavailable, which would rank chats at random; here a
failed call leaves the turn unindexed, to be tried again, and recall falls back to
words.
"""
from __future__ import annotations

import hashlib
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.memory.chat_index")

DIMS = 768
QUESTION_CHARS = 2_000
PASSAGE_CHARS = 2_000
PASSAGE_OVERLAP = 200
MAX_PASSAGES = 8
# The advocate's words, repeated at the head of each answer passage so the passage
# keeps its context.
ASKED_CHARS = 300
BATCH = 50
INDEX_TIMEOUT_MS = 30_000
# Nearest vectors read per search, before keeping the best one per turn.
SEARCH_VECTORS = 120
# A case not indexed is looked at again at most this often.
CASE_RECHECK_S = 600
# After the table could not be created, how long before trying again.
TABLE_RETRY_S = 300

_DDL = f"""
CREATE TABLE IF NOT EXISTS folder_chat_vectors (
    chat_id      UUID        NOT NULL REFERENCES folder_chats(id) ON DELETE CASCADE,
    kind         TEXT        NOT NULL CHECK (kind IN ('question', 'answer')),
    piece        INTEGER     NOT NULL CHECK (piece >= 0),
    start_char   INTEGER     NOT NULL DEFAULT 0,
    end_char     INTEGER     NOT NULL DEFAULT 0,
    embedding    vector({DIMS}) NOT NULL,
    model        TEXT        NOT NULL,
    content_hash TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, kind, piece)
)
"""

_table_ready = False
_table_failed_at = 0.0
_table_lock = threading.Lock()
_clients: dict[str, Any] = {}
_clients_lock = threading.Lock()

_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="chat-index")
_queued: set[str] = set()
_cases_checked: dict[tuple[str, str], float] = {}
_queue_lock = threading.Lock()


# ── Settings ─────────────────────────────────────────────────────────────────

def enabled() -> bool:
    settings = get_settings()
    return bool(getattr(settings, "memory_enabled", True)) and bool(
        getattr(settings, "memory_recall_semantic_enabled", True)
    )


def model_name() -> str:
    return str(getattr(get_settings(), "memory_recall_embedding_model", "") or "").strip() or "gemini-embedding-001"


def query_timeout_ms() -> int:
    seconds = float(getattr(get_settings(), "memory_recall_embed_timeout_s", 1.0) or 1.0)
    return max(300, int(seconds * 1000))


# ── What is embedded ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Passage:
    kind: str  # "question" | "answer"
    piece: int
    start: int
    end: int
    text: str


def collapse(text: Any) -> str:
    """Whitespace collapsed, as recall renders an answer, so passage offsets line up."""
    return " ".join(str(text or "").split())


def passages(question: str | None, answer: str | None, *, label: str | None = None) -> list[Passage]:
    """The pieces of one turn to embed: the advocate's words, then the answer in passages.

    A saved prompt's stored question is the prompt, not the advocate's words, so its
    name (`label`) stands in for it.
    """
    asked = collapse(label) or collapse(question)
    body = collapse(answer)
    out: list[Passage] = []
    if asked:
        out.append(Passage("question", 0, 0, 0, asked[:QUESTION_CHARS]))
    if not body:
        return out
    head = f"Advocate asked: {asked[:ASKED_CHARS]}\nAnswer: " if asked else "Answer: "
    step = PASSAGE_CHARS - PASSAGE_OVERLAP
    start = 0
    piece = 0
    while start < len(body) and piece < MAX_PASSAGES:
        end = min(len(body), start + PASSAGE_CHARS)
        out.append(Passage("answer", piece, start, end, head + body[start:end]))
        if end >= len(body):
            break
        start += step
        piece += 1
    return out


def content_hash(text: str, model: str) -> str:
    return hashlib.sha1(f"{model}|{DIMS}|{text}".encode("utf-8")).hexdigest()


def vector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(repr(float(value)) for value in values) + "]"


# ── Embedding ────────────────────────────────────────────────────────────────

def _client() -> Any:
    """One client for indexing and questions: indexing after each answer keeps its
    connection warm, and the first question after a restart need not pay for a handshake."""
    with _clients_lock:
        if "client" not in _clients:
            from google import genai

            _clients["client"] = genai.Client(api_key=get_settings().gemini_api_key)
        return _clients["client"]


def embed(texts: Sequence[str], *, task: str, timeout_ms: int = INDEX_TIMEOUT_MS) -> list[list[float]] | None:
    """Real embeddings for the texts, in order, or None. Never a hash fallback; never raises."""
    if not texts:
        return []
    if not getattr(get_settings(), "gemini_api_key", None):
        return None
    model = model_name()
    try:
        from google.genai import types

        from app.services.adapters import embeddings

        client = _client()
        config = types.EmbedContentConfig(
            task_type=task,
            output_dimensionality=DIMS,
            http_options=types.HttpOptions(timeout=int(timeout_ms)),
        )
        vectors: list[list[float]] = []
        for start in range(0, len(texts), BATCH):
            batch = list(texts[start : start + BATCH])
            embeddings._get_rate_limiter().acquire()
            result = client.models.embed_content(model=model, contents=batch, config=config)
            embeddings._record_embedding_tokens(result, model, batch)
            values = [list(getattr(item, "values", None) or []) for item in getattr(result, "embeddings", None) or []]
            if len(values) != len(batch) or any(len(vector) != DIMS for vector in values):
                logger.warning("[Memory] chat embeddings incomplete: got %s of %s", len(values), len(batch))
                return None
            vectors.extend(values)
        return vectors
    except Exception as exc:  # noqa: BLE001
        logger.info("[Memory] chat embeddings unavailable (%s): %s", task, exc)
        return None


def embed_query(text: str | None) -> list[float] | None:
    """The question's embedding for search, within the chat's time box, or None."""
    body = collapse(text)[:QUESTION_CHARS]
    if not body or not enabled():
        return None
    vectors = embed([body], task="RETRIEVAL_QUERY", timeout_ms=query_timeout_ms())
    return vectors[0] if vectors else None


# ── The table ────────────────────────────────────────────────────────────────

def table_ready() -> bool:
    """Whether folder_chat_vectors exists, creating it if it can. Never raises."""
    global _table_ready, _table_failed_at
    if _table_ready:
        return True
    if time.monotonic() - _table_failed_at < TABLE_RETRY_S and _table_failed_at:
        return False
    with _table_lock:
        if _table_ready:
            return True
        try:
            with get_db_connection() as connection:
                with connection.cursor() as cur:
                    cur.execute("SELECT to_regclass('public.folder_chat_vectors') AS name")
                    row = cur.fetchone() or {}
                    if not row.get("name"):
                        cur.execute("SET LOCAL lock_timeout = '2s'")
                        cur.execute(_DDL)
                connection.commit()
            _table_ready = True
        except Exception as exc:  # noqa: BLE001
            _table_failed_at = time.monotonic()
            logger.warning("[Memory] chat index unavailable until migration 181 is applied: %s", exc)
    return _table_ready


# ── Indexing ─────────────────────────────────────────────────────────────────

_ROWS_SQL = """
SELECT id::text AS chat_id, question, answer, prompt_label, used_secret_prompt, (secret_id IS NOT NULL) AS preset
FROM folder_chats
WHERE id::text = ANY(%s::text[])
"""

_EXISTING_SQL = """
SELECT chat_id::text AS chat_id, kind, piece, content_hash
FROM folder_chat_vectors
WHERE chat_id::text = ANY(%s::text[])
"""

_UPSERT_SQL = """
INSERT INTO folder_chat_vectors (chat_id, kind, piece, start_char, end_char, embedding, model, content_hash)
VALUES (%s::uuid, %s, %s, %s, %s, %s::vector, %s, %s)
ON CONFLICT (chat_id, kind, piece) DO UPDATE
   SET start_char = EXCLUDED.start_char,
       end_char = EXCLUDED.end_char,
       embedding = EXCLUDED.embedding,
       model = EXCLUDED.model,
       content_hash = EXCLUDED.content_hash,
       created_at = NOW()
"""

_TRIM_SQL = """
DELETE FROM folder_chat_vectors
WHERE chat_id = %s::uuid AND kind = %s AND piece >= %s
"""

_MISSING_SQL = """
SELECT fc.id::text AS chat_id
FROM folder_chats fc
WHERE coalesce(fc.answer, '') <> ''
  AND (%s::text IS NULL OR fc.folder_name = %s)
  AND (%s::text IS NULL OR fc.user_id::text = %s)
  AND NOT EXISTS (
        SELECT 1 FROM folder_chat_vectors v
        WHERE v.chat_id = fc.id AND v.kind = 'answer' AND v.piece = 0 AND v.model = %s
  )
ORDER BY fc.created_at DESC
LIMIT %s
"""


def _is_saved_prompt(row: dict[str, Any]) -> bool:
    """As recall decides it: a saved prompt stores its name, not the advocate's words, as the question."""
    flag = row.get("used_secret_prompt")
    used = flag if isinstance(flag, bool) else str(flag or "").strip().lower() in {"true", "t", "1", "yes", "y"}
    label = collapse(row.get("prompt_label"))
    return bool(row.get("preset")) or used or bool(label and collapse(row.get("question")) == label)


@dataclass
class IndexReport:
    turns: int = 0
    embedded: int = 0
    unchanged: int = 0
    failed: bool = False


def index_chats(chat_ids: Iterable[str]) -> IndexReport:
    """Embed the given turns, skipping passages already embedded unchanged. Never raises."""
    report = IndexReport()
    ids = sorted({str(chat_id).strip() for chat_id in chat_ids if str(chat_id or "").strip()})
    if not ids or not enabled() or not is_db_available() or not table_ready():
        return report
    model = model_name()
    try:
        with get_db_connection() as connection, connection.cursor() as cur:
            cur.execute(_ROWS_SQL, (ids,))
            rows = [dict(row) for row in cur.fetchall() or []]
            cur.execute(_EXISTING_SQL, (ids,))
            existing = {(row["chat_id"], row["kind"], int(row["piece"])): row["content_hash"] for row in cur.fetchall() or []}
            connection.rollback()

        work: list[tuple[str, Passage, str]] = []
        counts: dict[tuple[str, str], int] = {}
        for row in rows:
            label = row.get("prompt_label") if _is_saved_prompt(row) else None
            pieces = passages(row.get("question"), row.get("answer"), label=label)
            if not any(piece.kind == "answer" for piece in pieces):
                continue
            report.turns += 1
            for kind in ("question", "answer"):
                counts[(row["chat_id"], kind)] = sum(1 for piece in pieces if piece.kind == kind)
            for piece in pieces:
                digest = content_hash(piece.text, model)
                if existing.get((row["chat_id"], piece.kind, piece.piece)) == digest:
                    report.unchanged += 1
                    continue
                work.append((row["chat_id"], piece, digest))

        if work:
            vectors = embed([piece.text for _, piece, _ in work], task="RETRIEVAL_DOCUMENT")
            if vectors is None:
                report.failed = True
                return report
            with get_db_connection() as connection, connection.cursor() as cur:
                for (chat_id, piece, digest), vector in zip(work, vectors):
                    cur.execute(
                        _UPSERT_SQL,
                        (chat_id, piece.kind, piece.piece, piece.start, piece.end, vector_literal(vector), model, digest),
                    )
                report.embedded = len(work)
                # An answer that got shorter leaves passages behind; they must not match.
                for (chat_id, kind), count in counts.items():
                    cur.execute(_TRIM_SQL, (chat_id, kind, count))
                connection.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Memory] chat indexing failed for %s turns: %s", len(ids), exc)
        report.failed = True
        return report
    if report.embedded:
        logger.info(
            "[Memory] chat index turns=%s embedded=%s unchanged=%s", report.turns, report.embedded, report.unchanged
        )
    return report


def missing(*, folder_name: str | None = None, user_id: str | None = None, limit: int = 200) -> list[str]:
    """Turns with an answer and no vectors from the current model, newest first. Never raises."""
    if not enabled() or not is_db_available() or not table_ready():
        return []
    folder = folder_name or None
    user = str(user_id) if user_id not in (None, "") else None
    try:
        with get_db_connection() as connection, connection.cursor() as cur:
            cur.execute(_MISSING_SQL, (folder, folder, user, user, model_name(), max(1, int(limit))))
            ids = [row["chat_id"] for row in cur.fetchall() or []]
            connection.rollback()
        return ids
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] could not list unindexed turns: %s", exc)
        return []


def backfill(*, folder_name: str | None = None, user_id: str | None = None, limit: int = 1_000) -> IndexReport:
    """Index turns saved before the index existed, in batches. Stops at the first failure."""
    total = IndexReport()
    remaining = max(0, int(limit))
    while remaining > 0:
        ids = missing(folder_name=folder_name, user_id=user_id, limit=min(25, remaining))
        if not ids:
            break
        report = index_chats(ids)
        total.turns += report.turns
        total.embedded += report.embedded
        total.unchanged += report.unchanged
        remaining -= len(ids)
        if report.failed or report.turns == 0:
            total.failed = report.failed
            break
    return total


# ── In the background ────────────────────────────────────────────────────────

def _run_quietly(fn: Any, *args: Any, **kwargs: Any) -> None:
    try:
        fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] background chat indexing failed: %s", exc)


def _index_and_release(ids: list[str]) -> None:
    try:
        index_chats(ids)
    finally:
        with _queue_lock:
            _queued.difference_update(ids)


def schedule(chat_ids: Iterable[str]) -> bool:
    """Index these turns on the index's own thread. Returns whether anything was queued."""
    if not enabled():
        return False
    with _queue_lock:
        ids = [str(chat_id) for chat_id in chat_ids if chat_id and str(chat_id) not in _queued]
        _queued.update(ids)
    if not ids:
        return False
    try:
        _EXECUTOR.submit(_run_quietly, _index_and_release, ids)
        return True
    except Exception as exc:  # noqa: BLE001 — e.g. shutting down
        logger.debug("[Memory] chat indexing not queued: %s", exc)
        with _queue_lock:
            _queued.difference_update(ids)
        return False


def schedule_case(folder_name: str, user_id: str) -> bool:
    """Index a case's earlier turns in the background, at most once per CASE_RECHECK_S."""
    if not enabled() or not folder_name or not user_id:
        return False
    key = (str(folder_name), str(user_id))
    now = time.monotonic()
    with _queue_lock:
        last = _cases_checked.get(key)
        if last is not None and now - last < CASE_RECHECK_S:
            return False
        _cases_checked[key] = now
    try:
        _EXECUTOR.submit(_run_quietly, backfill, folder_name=key[0], user_id=key[1], limit=400)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.debug("[Memory] case indexing not queued: %s", exc)
        return False


# ── Searching ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class VectorHit:
    """The closest vector of one earlier turn."""

    chat_id: str
    similarity: float
    kind: str
    piece: int
    start: int
    end: int


# Scoped exactly as recall's word search: this folder, this advocate, never the
# current session. The vectors hold no scope of their own.
_SEARCH_SQL = """
SELECT v.chat_id::text AS chat_id, v.kind, v.piece, v.start_char, v.end_char,
       1 - (v.embedding <=> %s::vector) AS similarity
FROM folder_chat_vectors v
JOIN folder_chats fc ON fc.id = v.chat_id
WHERE fc.folder_name = %s
  AND fc.user_id::text = %s
  AND fc.session_id IS NOT NULL
  AND fc.session_id::text <> %s
  AND v.model = %s
ORDER BY v.embedding <=> %s::vector
LIMIT %s
"""

_UNINDEXED_SQL = """
SELECT EXISTS (
    SELECT 1 FROM folder_chats fc
    WHERE fc.folder_name = %s AND fc.user_id::text = %s AND coalesce(fc.answer, '') <> ''
      AND NOT EXISTS (
            SELECT 1 FROM folder_chat_vectors v
            WHERE v.chat_id = fc.id AND v.kind = 'answer' AND v.piece = 0 AND v.model = %s
      )
) AS missing
"""


def search(
    cur: Any,
    *,
    folder_name: str,
    user_id: str,
    exclude_session: str,
    query_vector: Sequence[float],
    limit: int = SEARCH_VECTORS,
) -> list[VectorHit]:
    """Earlier turns closest in meaning, best first, one hit per turn. Uses the caller's cursor."""
    literal = vector_literal(query_vector)
    cur.execute(
        _SEARCH_SQL, (literal, folder_name, str(user_id), exclude_session, model_name(), literal, int(limit))
    )
    best: dict[str, VectorHit] = {}
    for row in cur.fetchall() or []:
        hit = VectorHit(
            chat_id=str(row["chat_id"]),
            similarity=float(row["similarity"] or 0.0),
            kind=str(row["kind"]),
            piece=int(row["piece"] or 0),
            start=int(row["start_char"] or 0),
            end=int(row["end_char"] or 0),
        )
        if hit.chat_id not in best or hit.similarity > best[hit.chat_id].similarity:
            best[hit.chat_id] = hit
    return sorted(best.values(), key=lambda hit: hit.similarity, reverse=True)


def case_has_unindexed(cur: Any, *, folder_name: str, user_id: str) -> bool:
    cur.execute(_UNINDEXED_SQL, (folder_name, str(user_id), model_name()))
    row = cur.fetchone() or {}
    return bool(row.get("missing"))
