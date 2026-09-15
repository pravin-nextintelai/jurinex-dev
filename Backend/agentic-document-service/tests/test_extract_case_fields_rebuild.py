"""Chronology rebuild: works after a restart (documents read back from the database) and a
requested rebuild replaces the stored tree instead of returning it unchanged."""
from __future__ import annotations

import contextlib
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import folder_service as fs

FOLDER = "o_Sugriv_Jadhav___Others_vs_State_of_Maharashtra___Others"
# extract_case_fields ignores documents whose text is 50 characters or shorter.
OCR_TEXT = "[PAGE 1]\nCopy of the order dated 31/01/2024 passed by the Hon'ble High Court at Aurangabad."
ROWS = [
    {"id": "f1", "originalname": "482 Ambadas Jadhav.pdf", "gcs_path": "gs://b/f1", "full_text_content": OCR_TEXT},
    {"id": "f2", "originalname": "blank.pdf", "gcs_path": "", "full_text_content": "   "},
]


def _tree(events: int, *, page: str = "20"):
    dates = [SimpleNamespace(events=[SimpleNamespace(sourcePage=page)])] if events else []
    return SimpleNamespace(dates=dates, eventCount=events, as_dict=lambda: {"eventCount": events})


def _report(events: list):
    return SimpleNamespace(
        events=events, corrections=[], pages_cited=0, kept=len(events), dropped=0, reasons={},
        proposed=len(events), pages_missing=0, ocr_pages=0, swept=0,
    )


class RebuildTests(unittest.TestCase):
    def setUp(self):
        self.svc = fs.FolderWorkflowService.__new__(fs.FolderWorkflowService)
        self.svc._pipeline = SimpleNamespace(_cases={})
        self.svc._extracted_by_case = {}
        self.svc._chronology_by_case = {}
        self.stored = _tree(1)
        self.merged = _tree(15)
        self.merge = MagicMock(return_value=self.merged)
        self.store = MagicMock()
        self.extract = MagicMock(return_value={"caseTitle": "Ambadas Jadhav", "events": [{}]})
        self.rows = list(ROWS)
        self.events = ["e1", "e2"]

    def _run(self, *, user_id="65", force=False):
        stack = contextlib.ExitStack()
        stack.enter_context(patch.object(fs, "is_db_available", return_value=True))
        stack.enter_context(patch.object(fs, "merge_into_tree", self.merge))
        stack.enter_context(patch.object(fs, "refresh_tree", lambda tree, _text: tree))
        stack.enter_context(patch.object(fs, "report_from_extraction", lambda *a, **k: _report(self.events)))
        stack.enter_context(patch.object(fs, "log_progress", lambda *a, **k: None))
        stack.enter_context(patch.object(fs, "log_run_report", lambda *a, **k: None))
        stack.enter_context(patch("app.services.chronology.pages.split_into_pages", return_value=[]))
        stack.enter_context(patch("app.services.adapters.document_ai._call_gemini_for_extraction", self.extract))
        stack.enter_context(patch.object(self.svc, "_get_documents_in_folder_from_db", return_value=self.rows, create=True))
        stack.enter_context(patch.object(self.svc, "get_chronology", return_value=self.stored))
        stack.enter_context(patch.object(self.svc, "_paged_document_text", lambda doc: doc.text))
        stack.enter_context(patch.object(self.svc, "_normalize_entities", lambda data: dict(data), create=True))
        stack.enter_context(patch.object(self.svc, "_store_chronology", self.store))
        with stack:
            return self.svc.extract_case_fields(FOLDER, user_id=user_id, force_rebuild=force)

    def test_rebuild_reads_documents_from_the_database_after_a_restart(self):
        response = self._run()
        self.assertEqual(response.sourceDocuments, ["482 Ambadas Jadhav.pdf"])
        sent = self.extract.call_args[0][0]
        self.assertIn("order dated 31/01/2024", sent)
        self.assertNotIn("blank.pdf", sent)
        self.store.assert_called_once()

    def test_the_database_copy_is_not_cached_in_memory(self):
        self._run()
        self.assertEqual(self.svc._pipeline._cases, {})

    def test_missing_case_still_reports_not_found(self):
        self.rows = []
        with self.assertRaises(ValueError):
            self._run()

    def test_without_a_user_the_database_is_not_read(self):
        with self.assertRaises(ValueError):
            self._run(user_id=None)

    def test_requested_rebuild_replaces_the_stored_tree(self):
        self._run(force=True)
        base = self.merge.call_args[0][0]
        self.assertIsNot(base, self.stored)
        self.assertEqual(list(base.dates), [])

    def test_requested_rebuild_keeps_the_old_tree_when_nothing_new_was_found(self):
        self.events = []
        self._run(force=True)
        self.assertIs(self.merge.call_args[0][0], self.stored)

    def test_requested_rebuild_runs_even_when_fields_and_pages_are_already_there(self):
        self.svc._extracted_by_case[FOLDER] = {"caseTitle": "A", "caseNumber": "B", "courtName": "C"}
        self._run(force=True)
        self.extract.assert_called_once()

    def test_plain_call_with_complete_data_uses_the_stored_chronology(self):
        self.svc._extracted_by_case[FOLDER] = {"caseTitle": "A", "caseNumber": "B", "courtName": "C"}
        self._run(force=False)
        self.extract.assert_not_called()

    def test_in_memory_documents_are_used_when_present(self):
        doc = SimpleNamespace(document_name="fresh.pdf", text="Filed on 11.10.2024 at Latur", metadata={})
        self.svc._pipeline._cases[FOLDER] = SimpleNamespace(documents=[doc])
        response = self._run()
        self.assertEqual(response.sourceDocuments, ["fresh.pdf"])


if __name__ == "__main__":
    unittest.main()
