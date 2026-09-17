"""Which page each stored chunk is on, and which page a fact read from a document is on.

Before, every chunk was saved with no page (173 of the 174 documents uploaded from May
had none), and a fact's page came only from a "[PAGE n]" stamp inside the few hundred
characters around it. A stamp survives only in the chunk where its page begins, so most
facts from answers had no page. Checked on the nine stored documents whose text carries
stamps: every one of 1,252 chunks with a unique passage was given its true page.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.schemas.contracts import DocumentType
from app.services import chunk_pages
from app.services import pipeline_service
from app.services.adapters.vector_store import ChunkRecord
from app.services.memory import answer_facts as af


class PageSpanTests(unittest.TestCase):
    def test_pages_carry_from_chunk_to_chunk(self) -> None:
        texts = [
            "[PAGE 1]\nINDEX\n1. Synopsis",
            "2. Memo of application",  # no stamp: still page 1
            "list of documents\n\n[PAGE 2]\nMEMO OF APPLICATION",  # starts on 1, reaches 2
            "[PAGE 3]\nThe applicant states [PAGE 4] that on 12/08/2024",
            "the FIR was registered",  # continues page 4
        ]
        self.assertEqual(chunk_pages.page_spans(texts), [(1, 1), (1, 1), (1, 2), (3, 4), (4, 4)])

    def test_words_repeated_from_the_previous_chunk_are_on_its_page(self) -> None:
        # The chunker opens a chunk with the last words of the one before.
        texts = ["[PAGE 6]\nthe deed was executed", "the deed was executed [PAGE 7]\nby the vendor"]
        self.assertEqual(chunk_pages.page_spans(texts), [(6, 6), (6, 7)])

    def test_text_before_the_first_stamp_seen_is_on_the_page_before(self) -> None:
        self.assertEqual(chunk_pages.page_spans(["tail of a page [PAGE 9]\nnext page"]), [(8, 9)])

    def test_a_document_read_from_the_middle_starts_where_it_left_off(self) -> None:
        self.assertEqual(chunk_pages.page_spans(["no stamp here"], start_page=12), [(12, 12)])

    def test_text_without_stamps_gets_no_page_rather_than_a_guess(self) -> None:
        self.assertEqual(chunk_pages.page_spans(["one", "two"]), [(None, None), (None, None)])
        self.assertFalse(chunk_pages.has_markers(["one", "two"]))


class FakeCursor:
    def __init__(self, rows) -> None:
        self.rows = rows
        self.executed: list[tuple[str, tuple]] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        return None

    def execute(self, sql, params=None) -> None:
        self.executed.append((" ".join(sql.split()), tuple(params or ())))

    def fetchall(self):
        return self.rows


class FakeConn:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor
        self.commits = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return self._cursor

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        pass


class FillFileTests(unittest.TestCase):
    def fill(self, rows) -> FakeCursor:
        cursor = FakeCursor(rows)
        with patch.object(chunk_pages, "is_db_available", return_value=True), \
                patch.object(chunk_pages, "get_db_connection", return_value=FakeConn(cursor)):
            chunk_pages.fill_file("file-1")
        return cursor

    def test_only_chunks_without_a_page_are_given_one(self) -> None:
        cursor = self.fill([
            {"id": "c1", "content": "[PAGE 1]\nIndex", "page_start": None},
            {"id": "c2", "content": "Synopsis", "page_start": 5},  # stored page kept
            {"id": "c3", "content": "[PAGE 2]\nMemo", "page_start": None},
        ])
        updates = [params for sql, params in cursor.executed if sql.startswith("UPDATE file_chunks")]
        self.assertEqual(updates, [(1, 1, "c1"), (2, 2, "c3")])
        self.assertTrue(all("page_start IS NULL" in sql for sql, _ in cursor.executed if sql.startswith("UPDATE")))

    def test_a_document_without_stamps_is_left_alone(self) -> None:
        cursor = self.fill([{"id": "c1", "content": "Index", "page_start": None}])
        self.assertFalse(any(sql.startswith("UPDATE") for sql, _ in cursor.executed))


def record(text: str) -> ChunkRecord:
    return ChunkRecord(
        chunk_id="x", case_id="case", document_id="doc", document_name="P.pdf",
        doc_type=DocumentType.unknown, text=text, embedding=[0.1], metadata={"heading": ""},
    )


class UploadTests(unittest.TestCase):
    def test_new_chunks_are_given_their_pages_and_saved_with_them(self) -> None:
        rows = [record("[PAGE 1]\nIndex"), record("Synopsis"), record("[PAGE 2]\nMemo"), record("no stamps")]
        pipeline_service.assign_chunk_pages(rows)
        self.assertEqual([(r.metadata.get("page_start"), r.metadata.get("page_end")) for r in rows],
                         [("1", "1"), ("1", "1"), ("2", "2"), ("2", "2")])

        cursor = FakeCursor([{"chunk_index": index, "id": f"id-{index}"} for index in range(4)])
        with patch.object(pipeline_service, "is_db_available", return_value=True), \
                patch.object(pipeline_service, "get_db_connection", return_value=FakeConn(cursor)):
            pipeline_service.LegalCasePipelineService.persist_chunks_to_db(MagicMock(), "11111111-1111-1111-1111-111111111111", rows)
        _, values = next((sql, params) for sql, params in cursor.executed if "INSERT INTO file_chunks" in sql)
        # (file_id, chunk_index, content, token_count, page_start, page_end, heading) per chunk
        self.assertEqual([(values[i + 4], values[i + 5]) for i in range(0, len(values), 7)], [(1, 1), (1, 1), (2, 2), (2, 2)])

    def test_text_without_stamps_is_saved_without_pages(self) -> None:
        rows = [record("plain"), record("text")]
        pipeline_service.assign_chunk_pages(rows)
        self.assertEqual([r.metadata.get("page_start") for r in rows], [None, None])


def part(index: int, text: str, page_start=None, *, own=False) -> dict:
    return {"index": index, "text": text, "page_start": page_start, "page_end": page_start, "own": own}


class FactPageTests(unittest.TestCase):
    FACT = "Registered Sale Deed No. 4401/2006 was executed on 25/08/2006"

    def test_a_fact_in_the_next_chunk_is_on_that_chunks_page(self) -> None:
        hit = {"parts": [part(4, "Synopsis", 1), part(5, "Index", 1, own=True), part(6, "Sale Deed No. 4401/2006", 3)]}
        self.assertEqual(af.page_of(self.FACT, hit), 3)

    def test_a_stamp_in_an_earlier_part_carries_forward(self) -> None:
        hit = {"parts": [part(4, "[PAGE 9]\nMemo"), part(5, "Sale Deed No. 4401/2006", own=True)]}
        self.assertEqual(af.page_of(self.FACT, hit), 9)

    def test_with_no_stamp_nearby_the_page_is_read_from_before_the_window(self) -> None:
        hit = {"parts": [part(4, "memo"), part(5, "Sale Deed No. 4401/2006", own=True)]}
        self.assertEqual(af.page_of(self.FACT, hit, earlier=lambda: 14), 14)
        self.assertIsNone(af.page_of(self.FACT, hit))

    def test_a_chunk_stored_without_pages_is_filled_for_next_time(self) -> None:
        doc = af.CitedDocument(name="P.pdf", file_id="file-1")
        fact = af.AnswerFact(section="documents", text=self.FACT, document="P.pdf")
        hit = {"id": "c5", "chunk_index": 5, "window": "[PAGE 9]\nSale Deed No. 4401/2006 executed on 25/08/2006",
               "parts": [part(5, "[PAGE 9]\nSale Deed No. 4401/2006 executed on 25/08/2006", own=True)]}
        with patch.object(af, "is_db_available", return_value=True), \
                patch.object(af, "_candidate_chunks", return_value=[hit]), \
                patch.object(chunk_pages, "schedule_file") as schedule:
            support = af.find_support(fact, [doc])
        self.assertEqual(support.page, 9)
        schedule.assert_called_once_with("file-1")


if __name__ == "__main__":
    unittest.main()
