"""What memory did after a chat turn: the turn log, chat-saved records and suggestions twice."""
from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import memory as memory_routes
from app.api.routes.rbac.auth import get_current_user
from app.services.memory import repository
from app.services.memory.scope import CaseScope

USER = {"id": 42, "name": "Adv. Kulkarni", "email": "a@x.in", "role": "user", "account_type": "SOLO"}
SCOPE = CaseScope(case_key="512", folder_name="State_v_Pawar", user_id="42", case_id="512")
CHAT = "44444444-4444-4444-4444-444444444444"


def client() -> TestClient:
    app = FastAPI()
    app.include_router(memory_routes.router)
    app.dependency_overrides[get_current_user] = lambda: dict(USER)
    return TestClient(app)


class RecordingCursor:
    def __init__(self, conn: "RecordingConn") -> None:
        self.conn = conn
        self._one = None
        self.rowcount = 0

    def __enter__(self) -> "RecordingCursor":
        return self

    def __exit__(self, *exc) -> None:
        return None

    def execute(self, sql: str, params=None) -> None:
        flat = " ".join(sql.split())
        self.conn.executed.append((flat, list(params or [])))
        lowered = flat.lower()
        self._one = next((value for needle, value in self.conn.answers.items() if needle in lowered), None)
        self.rowcount = self.conn.rowcount

    def fetchone(self):
        return self._one

    def fetchall(self):
        return list(self.conn.rows)


class RecordingConn:
    """Records every statement; answers fetchone() by matching a SQL fragment."""

    def __init__(self, answers: dict | None = None, rows: list | None = None, rowcount: int = 0) -> None:
        self.answers = dict(answers or {})
        self.rows = list(rows or [])
        self.rowcount = rowcount
        self.executed: list[tuple[str, list]] = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self) -> RecordingCursor:
        return RecordingCursor(self)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


class ProposalRecordTests(unittest.TestCase):
    def test_an_instruction_saved_from_chat_is_recorded_as_accepted(self) -> None:
        conn = RecordingConn({"insert into memory_proposals": {"id": "p1"}})
        proposal_id = repository.add_proposal(
            "512", "42", "instruction", "Always cite SCC first", {"auto": True, "instruction_id": "i1"}, status="accepted", conn=conn
        )
        self.assertEqual(proposal_id, "p1")
        self.assertEqual(len(conn.executed), 1, "no duplicate check for a saved record")
        sql, params = conn.executed[0]
        self.assertIn("NOW()", sql)
        self.assertEqual(params[0], "512")
        self.assertEqual(params[4], "accepted")
        self.assertEqual(json.loads(params[5]), {"auto": True, "instruction_id": "i1"})

    def test_a_pending_suggestion_still_checks_for_duplicates(self) -> None:
        conn = RecordingConn({"insert into memory_proposals": {"id": "p2"}})
        repository.add_proposal("512", "42", "instruction", "Cite SCC first", conn=conn)
        self.assertTrue(conn.executed[0][0].lower().startswith("select id from memory_proposals"))
        self.assertIn("NULL) RETURNING", conn.executed[-1][0])

    def test_an_unknown_status_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            repository.add_proposal("512", "42", "instruction", "x", status="maybe", conn=RecordingConn())

    def test_deleting_a_chat_saved_instruction_marks_its_record(self) -> None:
        conn = RecordingConn(rowcount=1)
        self.assertEqual(repository.reject_proposals_for_instruction("i1", conn=conn), 1)
        sql, params = conn.executed[0]
        self.assertIn("status = 'rejected'", sql)
        self.assertIn("source_ref->>'instruction_id' = %s", sql)
        self.assertEqual(params, ["i1"])
        self.assertEqual(conn.commits, 1)
        self.assertEqual(repository.reject_proposals_for_instruction("", conn=conn), 0)

    def test_cross_case_suggestions_are_read_for_the_advocate_only(self) -> None:
        conn = RecordingConn(rows=[{"id": "p9", "case_key": "264", "text": "Answer in tables", "status": "pending"}])
        rows = repository.list_user_proposals("42", exclude_case_key="512", conn=conn)
        self.assertEqual(rows[0]["case_key"], "264")
        sql, params = conn.executed[0]
        self.assertIn("user_id = %s", sql)
        self.assertIn("case_key NOT LIKE 'user:%%'", sql)
        self.assertIn("case_key <> %s", sql)
        self.assertEqual(params[:3], ["42", ["pending", "accepted"], "512"])
        self.assertEqual(repository.list_user_proposals("", conn=conn), [])


class SeedMetaTests(unittest.TestCase):
    def test_bookkeeping_is_read_from_this_cases_summary_section(self) -> None:
        conn = RecordingConn({"select seed_meta": {"seed_meta": {"auto_seed": False}}})
        self.assertEqual(repository.get_seed_meta("512", conn=conn), {"auto_seed": False})
        sql, params = conn.executed[0]
        self.assertIn("case_key = %s", sql)
        self.assertEqual(params, ["512", "summary"])

    def test_text_json_is_understood_and_nothing_stored_is_empty(self) -> None:
        conn = RecordingConn({"select seed_meta": {"seed_meta": '{"fingerprint": "abc"}'}})
        self.assertEqual(repository.get_seed_meta("512", conn=conn), {"fingerprint": "abc"})
        self.assertEqual(repository.get_seed_meta("512", conn=RecordingConn()), {})

    def test_writing_bookkeeping_never_touches_a_version(self) -> None:
        conn = RecordingConn()
        repository.set_seed_meta("512", {"auto_seed": True}, folder_name="State_v_Pawar", conn=conn)
        sql, params = conn.executed[0]
        self.assertNotIn("version", sql.lower())
        self.assertEqual(params[:3], ["512", "State_v_Pawar", "summary"])
        self.assertEqual(json.loads(params[3]), {"auto_seed": True})
        self.assertEqual(conn.commits, 1)

    def test_forgetting_a_case_pauses_automatic_seeding_in_the_same_transaction(self) -> None:
        conn = RecordingConn()
        with patch.object(repository, "purge_case_keys", return_value={"case_memory_lines": 4}):
            counts = repository.delete_all("512", conn=conn)
        self.assertEqual(counts, {"case_memory_lines": 4})
        upsert = next(params for sql, params in conn.executed if "seed_meta" in sql)
        self.assertEqual(upsert[0], "512")
        self.assertFalse(json.loads(upsert[3])["auto_seed"])
        self.assertEqual(conn.commits, 1)


class TurnLogTests(unittest.TestCase):
    def test_details_are_written_with_the_turn(self) -> None:
        conn = RecordingConn({"insert into memory_assembly_log": {"id": "log-1"}})
        with patch.object(repository, "_details_column", True):
            log_id = repository.write_assembly_log(
                {"case_key": "512", "chat_id": CHAT, "details": {"lines": [{"text": "x"}]}}, conn=conn
            )
        self.assertEqual(log_id, "log-1")
        sql, params = conn.executed[0]
        self.assertIn(", details)", sql)
        self.assertEqual(json.loads(params[-1]), {"lines": [{"text": "x"}]})

    def test_without_the_column_the_log_is_still_written(self) -> None:
        conn = RecordingConn({"insert into memory_assembly_log": {"id": "log-2"}})
        with patch.object(repository, "_details_column", False):
            self.assertEqual(
                repository.write_assembly_log({"case_key": "512", "details": {"lines": []}}, conn=conn), "log-2"
            )
        self.assertNotIn("details", conn.executed[0][0])

    def test_a_turn_is_looked_up_within_its_case(self) -> None:
        conn = RecordingConn({"from memory_assembly_log": {"id": "log-1", "writes": 2}})
        self.assertEqual(repository.get_turn_log("512", CHAT, conn=conn)["writes"], 2)
        sql, params = conn.executed[0]
        self.assertIn("case_key = %s AND chat_id = %s::uuid", sql)
        self.assertEqual(params, ["512", CHAT])

    def test_a_malformed_chat_id_reads_nothing(self) -> None:
        conn = RecordingConn()
        self.assertIsNone(repository.get_turn_log("512", "not-a-uuid", conn=conn))
        self.assertEqual(conn.executed, [])


class TurnRouteTests(unittest.TestCase):
    def test_a_turn_still_being_written_is_not_ready(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes.repository, "get_turn_log", return_value=None
        ):
            body = client().get(f"/api/memory/cases/State_v_Pawar/turns/{CHAT}").json()
        self.assertEqual(body, {"chat_id": CHAT, "ready": False})

    def test_a_finished_turn_reports_what_changed(self) -> None:
        row = {
            "writes": 4,
            "proposals": 1,
            "rejected": 1,
            "skipped_reason": None,
            "details": {
                "lines": [{"section": "facts", "tag": "stated", "text": "Court: The High Court of Bombay"}],
                "instructions": [{"id": "i1", "text": "Always cite SCC first", "scope": "case", "version": 3}],
                "suggestions": [{"id": "p2", "kind": "instruction", "scope": "user", "text": "Give tabular events output"}],
                "instructions_applied": ["u1", "c1"],
                "seeded": {"added": 2, "updated": 0},
                "rejection_codes": ["duplicate"],
            },
        }
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes.repository, "get_turn_log", return_value=row
        ) as lookup:
            body = client().get(f"/api/memory/cases/State_v_Pawar/turns/{CHAT}").json()
        lookup.assert_called_once_with("512", CHAT)
        self.assertTrue(body["ready"])
        self.assertEqual((body["writes"], body["proposals"], body["rejected"]), (4, 1, 1))
        self.assertEqual(body["instructions"][0]["scope"], "case")
        self.assertEqual(body["suggestions"][0]["scope"], "user")
        self.assertEqual(body["instructions_applied"], 2)
        self.assertEqual(body["seeded"], {"added": 2, "updated": 0})
        self.assertNotIn("rejection_codes", body)

    def test_a_turn_logged_before_details_existed_still_reads(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes.repository, "get_turn_log", return_value={"writes": 0, "skipped_reason": "write:greeting"}
        ):
            body = client().get(f"/api/memory/cases/State_v_Pawar/turns/{CHAT}").json()
        self.assertEqual(
            (body["lines"], body["instructions"], body["suggestions"], body["seeded"], body["instructions_applied"]),
            ([], [], [], None, 0),
        )

    def test_another_advocates_case_is_404(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=None), patch.object(
            memory_routes.repository, "get_turn_log"
        ) as lookup:
            response = client().get(f"/api/memory/cases/Someone_Elses_Case/turns/{CHAT}")
        self.assertEqual(response.status_code, 404)
        lookup.assert_not_called()


class ProposalTwiceTests(unittest.TestCase):
    def test_accepting_a_suggestion_twice_does_not_add_it_twice(self) -> None:
        handled = {"id": "p1", "kind": "instruction", "status": "accepted", "text": "Always cite SCC first", "source_ref": {}}
        with patch.object(memory_routes, "resolve_case_scope", return_value=SCOPE), patch.object(
            memory_routes.repository, "get_proposal", return_value=handled
        ), patch.object(memory_routes.repository, "add_instruction") as add, patch.object(
            memory_routes.repository, "set_proposal_status"
        ) as status_mock:
            body = client().post("/api/memory/cases/State_v_Pawar/proposals/p1/accept").json()
        add.assert_not_called()
        status_mock.assert_not_called()
        self.assertEqual(body["status"], "accepted")


if __name__ == "__main__":
    unittest.main()
