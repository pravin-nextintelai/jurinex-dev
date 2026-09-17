"""Which pages each stored chunk of a document spans.

Extraction stamps the text with "[PAGE n]" before each page (app/services/chronology/pages.py),
and the chunker splits that text, so a marker survives only in the chunk where its page
begins. Chunks were saved with no page at all: 173 of the 174 documents uploaded from May
had none, so a fact read from a document, and a citation in an answer, could name the
document but not the page.

The pages follow from reading the chunks in order. A chunk starts on the page the previous
chunk ended on, unless it opens with a marker, and ends on the last marker inside it. Text
before a chunk's first marker (including the words it repeats from the previous chunk)
is still on the page before. A document whose text carries no markers at all — those
extracted before the stamping existed — gets no page, rather than a guessed one.
"""
from __future__ import annotations

import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Iterable, Sequence

from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.chunk_pages")

_MARKER_RE = re.compile(r"\[PAGE\s+(\d{1,5})\]", re.IGNORECASE)

Span = tuple[int | None, int | None]


def page_spans(texts: Sequence[str], *, start_page: int | None = None) -> list[Span]:
    """(page_start, page_end) for each chunk text, in document order.

    `start_page` is the page the text before the first chunk ended on, for a document
    whose chunks are read from the middle.
    """
    spans: list[Span] = []
    current = start_page
    for text in texts:
        body = str(text or "")
        markers = list(_MARKER_RE.finditer(body))
        if not markers:
            spans.append((current, current))
            continue
        first = int(markers[0].group(1))
        opens_with_marker = not body[: markers[0].start()].strip()
        if opens_with_marker:
            start = first
        elif current is not None:
            start = current
        else:
            # Text before the first marker we ever saw is on the page before it.
            start = first - 1 if first > 1 else first
        end = int(markers[-1].group(1))
        spans.append((start, max(start, end) if start is not None else end))
        current = end
    return spans


def has_markers(texts: Iterable[str]) -> bool:
    return any(_MARKER_RE.search(str(text or "")) for text in texts)


# ── Stored documents ─────────────────────────────────────────────────────────

_FILES_SQL = r"""
SELECT DISTINCT c.file_id::text AS file_id
FROM file_chunks c
WHERE c.page_start IS NULL
  AND EXISTS (SELECT 1 FROM file_chunks m WHERE m.file_id = c.file_id AND m.content ~ '\[PAGE\s+\d+\]')
LIMIT %s
"""


def fill_file(file_id: str) -> int:
    """Give one document's chunks their pages, where they have none. Returns chunks updated.

    Pages already stored are kept. Never raises.
    """
    if not file_id or not is_db_available():
        return 0
    try:
        with get_db_connection() as connection, connection.cursor() as cur:
            cur.execute(
                "SELECT id::text AS id, content, page_start FROM file_chunks WHERE file_id::text = %s ORDER BY chunk_index",
                (str(file_id),),
            )
            rows = [dict(row) for row in cur.fetchall() or []]
            if not rows or not has_markers(row.get("content") for row in rows):
                connection.rollback()
                return 0
            spans = page_spans([str(row.get("content") or "") for row in rows])
            updates = [
                (start, end, row["id"])
                for row, (start, end) in zip(rows, spans)
                if row.get("page_start") is None and start is not None
            ]
            for start, end, chunk_id in updates:
                cur.execute(
                    "UPDATE file_chunks SET page_start = %s, page_end = %s WHERE id = %s::uuid AND page_start IS NULL",
                    (start, end, chunk_id),
                )
            connection.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Pages] pages not filled file_id=%s: %s", file_id, exc)
        return 0
    if updates:
        logger.info("[Pages] filled pages file_id=%s chunks=%s", file_id, len(updates))
    return len(updates)


def fill_all(limit_files: int = 1_000) -> dict[str, int]:
    """Fill pages for every document whose text has markers and whose chunks lack pages."""
    if not is_db_available():
        return {"files": 0, "chunks": 0}
    with get_db_connection() as connection, connection.cursor() as cur:
        cur.execute(_FILES_SQL, (max(1, int(limit_files)),))
        file_ids = [row["file_id"] for row in cur.fetchall() or []]
        connection.rollback()
    chunks = sum(fill_file(file_id) for file_id in file_ids)
    return {"files": len(file_ids), "chunks": chunks}


_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="chunk-pages")
_scheduled: set[str] = set()
_lock = threading.Lock()


def schedule_file(file_id: str) -> bool:
    """Fill a document's pages in the background, once per process. Returns whether it was queued."""
    key = str(file_id or "").strip()
    if not key:
        return False
    with _lock:
        if key in _scheduled:
            return False
        _scheduled.add(key)
    try:
        _EXECUTOR.submit(fill_file, key)
        return True
    except Exception as exc:  # noqa: BLE001 — e.g. shutting down
        logger.debug("[Pages] page filling not queued file_id=%s: %s", key, exc)
        return False
