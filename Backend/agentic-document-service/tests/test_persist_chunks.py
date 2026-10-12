"""Chunk persistence for large documents: sliced multi-row upserts run a few at a time.

A 2,000-page file is ~2,400 chunks. They are written as slices of
_CHUNK_ROWS_PER_STATEMENT rows, each slice on its own connection so several are in
flight at once against the remote database, and vectors are sent as 6-decimal
literals. The database is faked here: these tests check the slicing, the id
mapping back onto the chunks, the ordering guarantees and error propagation.
"""
from __future__ import annotations

import random
import threading
import time
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from app.schemas.contracts import DocumentType
from app.services import pipeline_service as ps
from app.services.adapters.vector_store import ChunkRecord


class VectorLiteralTests(unittest.TestCase):
    def test_six_decimal_floats(self) -> None:
        self.assertEqual(ps._vector_literal([0.1234567, -1.0, 0.0]), "[0.123457,-1.000000,0.000000]")

    def test_much_shorter_than_repr(self) -> None:
        vec = [random.uniform(-0.1, 0.1) for _ in range(768)]
        naive = "[" + ",".join(str(float(v)) for v in vec) + "]"
        self.assertLess(len(ps._vector_literal(vec)), len(naive) * 0.6)


class RunDbSlicesTests(unittest.TestCase):
    def test_results_keep_index_order_and_run_on_several_threads(self) -> None:
        names: set[str] = set()
        lock = threading.Lock()

        def task(index: int) -> int:
            time.sleep(0.03)
            with lock:
                names.add(threading.current_thread().name)
            return index * index

        self.assertEqual(ps._run_db_slices(task, 6), [0, 1, 4, 9, 16, 25])
        self.assertGreaterEqual(len(names), 2)

    def test_single_slice_runs_inline(self) -> None:
        seen: list[str] = []
        ps._run_db_slices(lambda i: seen.append(threading.current_thread().name), 1)
        self.assertEqual(seen, [threading.current_thread().name])

    def test_failure_propagates(self) -> None:
        def task(index: int) -> int:
            if index == 2:
                raise RuntimeError("slice 2 failed")
            return index

        with self.assertRaises(RuntimeError):
            ps._run_db_slices(task, 4)


class _FakeCursor:
    def __init__(self, log: list, lock: threading.Lock) -> None:
        self._log = log
        self._lock = lock
        self._last_rows: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql: str, values: list) -> None:
        with self._lock:
            self._log.append((sql, list(values)))
        if "INSERT INTO file_chunks" in sql:
            # 7 values per row; the 2nd is chunk_index.
            self._last_rows = [
                {"id": f"id-{values[i + 1]}", "chunk_index": values[i + 1]}
                for i in range(0, len(values), 7)
            ]
        else:
            self._last_rows = []

    def fetchall(self):
        return list(self._last_rows)


class _FakeConn:
    def __init__(self, log: list, lock: threading.Lock) -> None:
        self._log, self._lock = log, lock
        self.commits = 0

    def cursor(self):
        return _FakeCursor(self._log, self._lock)

    def commit(self) -> None:
        self.commits += 1


class PersistChunksTests(unittest.TestCase):
    def _chunks(self, n: int) -> list[ChunkRecord]:
        return [
            ChunkRecord(
                chunk_id=f"mem-{i}", case_id="case", document_id="doc", document_name="doc.pdf",
                doc_type=DocumentType.unknown, text=f"[PAGE {i + 1}]\nchunk {i} text",
                embedding=[0.1 * (i % 7), -0.25, 0.5], metadata={"heading": "", "chunk_index": str(i),
                                                                  "page_start": str(i + 1), "page_end": str(i + 1)},
            )
            for i in range(n)
        ]

    def test_large_document_is_written_in_slices_with_ids_mapped_back(self) -> None:
        log: list = []
        lock = threading.Lock()
        conns: list[_FakeConn] = []

        @contextmanager
        def fake_connection():
            conn = _FakeConn(log, lock)
            conns.append(conn)
            yield conn

        service = ps.LegalCasePipelineService()
        n = ps._CHUNK_ROWS_PER_STATEMENT * 2 + 17  # 3 slices per table
        with patch.object(ps, "is_db_available", lambda: True), \
             patch.object(ps, "get_db_connection", fake_connection):
            persisted = service.persist_chunks_to_db("11111111-1111-1111-1111-111111111111", self._chunks(n))

        self.assertEqual(len(persisted), n)
        self.assertEqual([p.chunk_id for p in persisted][:3], ["id-0", "id-1", "id-2"])
        self.assertEqual(persisted[-1].chunk_id, f"id-{n - 1}")
        self.assertTrue(all(p.document_id == "11111111-1111-1111-1111-111111111111" for p in persisted))
        chunk_statements = [s for s, _ in log if "INSERT INTO file_chunks" in s]
        vector_statements = [s for s, _ in log if "INSERT INTO chunk_vectors" in s]
        self.assertEqual(len(chunk_statements), 3)
        self.assertEqual(len(vector_statements), 3)
        # Every connection committed exactly once, one per slice.
        self.assertEqual(len(conns), 6)
        self.assertTrue(all(c.commits == 1 for c in conns))
        # Vector values are compact literals bound to the mapped ids.
        _, vector_values = next((s, v) for s, v in log if "INSERT INTO chunk_vectors" in s and v[0] == "id-0")
        self.assertEqual(vector_values[1], "[0.000000,-0.250000,0.500000]")
        # Page numbers travel with the chunk rows.
        _, chunk_values = next((s, v) for s, v in log if "INSERT INTO file_chunks" in s and v[1] == 0)
        self.assertEqual((chunk_values[4], chunk_values[5]), (1, 1))

    def test_failure_returns_in_memory_chunks(self) -> None:
        @contextmanager
        def broken_connection():
            raise RuntimeError("db down")
            yield  # pragma: no cover

        service = ps.LegalCasePipelineService()
        chunks = self._chunks(5)
        with patch.object(ps, "is_db_available", lambda: True), \
             patch.object(ps, "get_db_connection", broken_connection):
            persisted = service.persist_chunks_to_db("11111111-1111-1111-1111-111111111111", chunks)
        self.assertIs(persisted, chunks)


if __name__ == "__main__":
    unittest.main()
