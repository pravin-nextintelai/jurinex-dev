"""Documents added to a case reach memory once they are processed, not at the next chat.

Before, a newly processed document was seeded into memory only by a chat turn, and at most
every ten minutes per case: an advocate who uploaded a document and opened the memory
panel did not find it there.
"""
from __future__ import annotations

import threading
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.schemas.contracts import ProcessingState, QueuedDocumentStatus
from app.services import folder_service
from app.services.memory import activity
from app.services.memory import seed
from app.services.memory.scope import CaseScope

SCOPE = CaseScope(case_key="512", folder_name="State_v_Pawar", user_id="42", case_id="512")
NOW = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)


def inline_executor():
    return patch.object(seed, "_UPLOAD_EXECUTOR", SimpleNamespace(submit=lambda fn, *a, **k: fn(*a, **k)))


def memory_settings(**overrides):
    return patch("app.core.config.get_settings", return_value=SimpleNamespace(memory_enabled=True, memory_write_enabled=True, **overrides))


class ScheduleTests(unittest.TestCase):
    def test_a_processed_upload_refreshes_its_case_at_once(self) -> None:
        with inline_executor(), memory_settings(), patch.object(seed, "refresh_after_upload") as refresh:
            self.assertTrue(seed.schedule_after_upload("State_v_Pawar", "42", documents=["FIR.pdf"]))
        refresh.assert_called_once_with("State_v_Pawar", "42", documents=["FIR.pdf"])

    def test_intake_folders_wait_for_the_case_to_be_created(self) -> None:
        with inline_executor(), memory_settings(), patch.object(seed, "refresh_after_upload") as refresh:
            self.assertFalse(seed.schedule_after_upload("temp-3c87f6631f6c", "42"))
        refresh.assert_not_called()

    def test_nothing_runs_without_a_real_user_or_with_memory_off(self) -> None:
        with inline_executor(), patch.object(seed, "refresh_after_upload") as refresh:
            with memory_settings():
                self.assertFalse(seed.schedule_after_upload("State_v_Pawar", "anonymous"))
            with patch("app.core.config.get_settings", return_value=SimpleNamespace(memory_enabled=True, memory_write_enabled=False)):
                self.assertFalse(seed.schedule_after_upload("State_v_Pawar", "42"))
        refresh.assert_not_called()


class RefreshTests(unittest.TestCase):
    def test_new_lines_are_written_without_waiting_and_shown_in_activity(self) -> None:
        with patch("app.services.memory.scope.resolve_case_scope", return_value=SCOPE), \
                patch.object(seed, "refresh_seed", return_value={"added": 2, "updated": 1}) as refresh, \
                patch.object(seed.repository, "write_assembly_log") as log:
            seed.refresh_after_upload("State_v_Pawar", "42", documents=["FIR.pdf", "Order.pdf"])
        self.assertEqual(refresh.call_args.kwargs["min_interval_s"], 0)
        entry = log.call_args.args[0]
        self.assertEqual((entry["case_key"], entry["mode"], entry["writes"]), ("512", "upload", 3))
        self.assertEqual(entry["details"], {"seeded": {"added": 2, "updated": 1}, "documents": ["FIR.pdf", "Order.pdf"]})

    def test_nothing_is_logged_when_nothing_changed_or_memory_was_forgotten(self) -> None:
        # refresh_seed returns None for both: the fingerprint is unchanged, or automatic seeding is off.
        with patch("app.services.memory.scope.resolve_case_scope", return_value=SCOPE), \
                patch.object(seed, "refresh_seed", return_value=None), \
                patch.object(seed.repository, "write_assembly_log") as log:
            self.assertIsNone(seed.refresh_after_upload("State_v_Pawar", "42"))
        log.assert_not_called()

    def test_a_folder_that_is_not_the_advocates_case_is_left_alone(self) -> None:
        with patch("app.services.memory.scope.resolve_case_scope", return_value=None), \
                patch.object(seed, "refresh_seed") as refresh:
            self.assertIsNone(seed.refresh_after_upload("Someone_Elses", "42"))
        refresh.assert_not_called()


def status(name: str, state: ProcessingState) -> QueuedDocumentStatus:
    return QueuedDocumentStatus(document_id=name, document_name=name, status=state, updated_at=NOW)


class UploadJobTests(unittest.TestCase):
    def run_job_end(self, documents: list[QueuedDocumentStatus]):
        job = folder_service.ProcessingJobRecord(
            job_id="job-1", case_id="State_v_Pawar", folder_name="State_v_Pawar", user_id="42",
            status=ProcessingState.processed, submitted_at=NOW, updated_at=NOW,
            documents={doc.document_id: doc for doc in documents},
        )
        service = SimpleNamespace(_lock=threading.Lock(), _jobs={"job-1": job})
        with patch.object(seed, "schedule_after_upload") as schedule:
            folder_service.FolderWorkflowService._refresh_memory_after_upload(service, "job-1", "State_v_Pawar")
        return schedule

    def test_the_documents_that_were_processed_are_passed_on(self) -> None:
        schedule = self.run_job_end([status("FIR.pdf", ProcessingState.processed), status("Bad.pdf", ProcessingState.error)])
        schedule.assert_called_once_with("State_v_Pawar", "42", documents=["FIR.pdf"])

    def test_a_job_where_nothing_was_processed_changes_nothing(self) -> None:
        schedule = self.run_job_end([status("Bad.pdf", ProcessingState.error)])
        schedule.assert_not_called()


class ActivityTests(unittest.TestCase):
    def test_an_upload_refresh_reads_as_one(self) -> None:
        entry = activity.describe({
            "id": "l1", "mode": "upload", "created_at": NOW,
            "details": {"seeded": {"added": 2, "updated": 0}, "documents": ["FIR.pdf"]},
        })
        self.assertEqual((entry["outcome"], entry["headline"]), ("saved", "Added your newly processed documents to memory"))
        self.assertEqual([item["kind"] for item in entry["items"]], ["filled_in", "uploaded"])

    def test_a_chat_turn_that_only_filled_in_details_says_so(self) -> None:
        entry = activity.describe({"id": "l2", "mode": "chat", "created_at": NOW, "details": {"seeded": {"added": 3}}})
        self.assertEqual(entry["headline"], "Filled in memory from the case details")


if __name__ == "__main__":
    unittest.main()
