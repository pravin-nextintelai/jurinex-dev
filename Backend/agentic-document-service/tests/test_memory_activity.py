"""Turning memory's per-turn log into lines an advocate can read."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import memory as memory_routes
from app.api.routes.rbac.auth import get_current_user
from app.services.memory import activity
from app.services.memory.scope import CaseScope

WHEN = datetime(2026, 9, 17, 5, 2, tzinfo=timezone.utc)


def row(**overrides):
    base = {
        "id": "log-1",
        "created_at": WHEN,
        "chat_id": "chat-1",
        "question": "tell me about this case",
        "prompt_label": None,
        "preset": False,
        "skipped_reason": None,
        "details": {},
        "sections_loaded": [],
    }
    base.update(overrides)
    return base


class Case(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.object(activity, "get_settings", return_value=SimpleNamespace(memory_rule_suggest_after=2))
        patcher.start()
        self.addCleanup(patcher.stop)


class SkipTests(Case):
    def test_a_question_says_nothing_was_kept_and_why(self) -> None:
        entry = activity.describe(row(skipped_reason="read:nothing_stored; write:nothing_durable"))
        self.assertEqual(entry["outcome"], "nothing")
        self.assertIn("no fact, decision or rule", entry["headline"])
        self.assertIn("not kept", entry["hint"])
        self.assertEqual(entry["reason_code"], "nothing_durable")

    def test_each_skip_has_its_own_plain_reason(self) -> None:
        for code, outcome in (
            ("greeting", "nothing"),
            ("too_short", "nothing"),
            ("saved_prompt", "skipped"),
            ("disabled_by_user", "off"),
            ("extractor_error", "error"),
        ):
            with self.subTest(code=code):
                entry = activity.describe(row(skipped_reason=f"write:{code}"))
                self.assertEqual(entry["outcome"], outcome)
                # Plain words, never the raw code ("too_short", "write:greeting").
                self.assertNotIn("_", entry["headline"])
                self.assertNotIn(":", entry["headline"].split(" ", 1)[0])

    def test_an_unknown_skip_is_described_not_shown_raw(self) -> None:
        entry = activity.describe(row(skipped_reason="write:something_new"))
        self.assertEqual(entry["headline"], "This turn was not checked")

    def test_only_the_writers_reason_counts(self) -> None:
        self.assertIsNone(activity.write_reason("read:nothing_stored"))
        self.assertEqual(activity.write_reason("read:x; write:greeting"), "greeting")


class ChangeTests(Case):
    def test_saved_facts_lead_the_headline(self) -> None:
        details = {"lines": [
            {"section": "dates", "text": "Hearing on 14 October", "updated": False},
            {"section": "decisions", "text": "Not pressing the alibi", "updated": True},
        ]}
        entry = activity.describe(row(details=details))
        self.assertEqual((entry["outcome"], entry["headline"]), ("saved", "Saved 2 facts"))
        self.assertEqual(entry["items"][0]["section_label"], "Dates")
        self.assertTrue(entry["items"][1]["updated"])

    def test_a_fact_read_from_a_document_says_which_and_what_page(self) -> None:
        details = {
            "lines": [{"section": "dates", "tag": "extracted", "text": "FIR registered on 14/03/2026",
                       "document": "FIR 45-2026.pdf", "page": 2}],
            "rejection_codes": ["answer_fact_not_in_document"],
        }
        entry = activity.describe(row(details=details))
        self.assertEqual(entry["headline"], "Saved 1 fact")
        self.assertEqual((entry["items"][0]["document"], entry["items"][0]["page"]), ("FIR 45-2026.pdf", 2))
        self.assertIn("not found in the document it cited", entry["reasons"][0])

    def test_one_shown_rule_is_one_suggestion_with_what_was_said(self) -> None:
        """Logged under "requests" and "suggestions" with one id: shown once, polished."""
        details = {
            "requests": [{"id": "p1", "text": "give me summary in text and table", "count": 2, "scope": "case", "shown": True}],
            "suggestions": [{"id": "p1", "kind": "instruction", "text": "Give summaries as text and a table.", "scope": "case"}],
        }
        entry = activity.describe(row(details=details))
        self.assertEqual(entry["headline"], "Suggested a rule for you to review")
        self.assertEqual(len(entry["items"]), 1)
        self.assertEqual(entry["items"][0]["text"], "Give summaries as text and a table.")
        self.assertEqual(entry["items"][0]["spoken"], "give me summary in text and table")

    def test_a_rule_still_being_counted_says_how_far_along(self) -> None:
        details = {"requests": [{"id": "p2", "text": "answer in Marathi", "count": 1, "scope": "case", "shown": False}]}
        entry = activity.describe(row(details=details))
        self.assertEqual(entry["outcome"], "noticed")
        self.assertEqual((entry["items"][0]["count"], entry["items"][0]["needed"]), (1, 2))

    def test_refusals_are_explained_in_words(self) -> None:
        details = {"rejection_codes": ["proposal_not_a_way_of_working", "write_failed", "invalid_op"]}
        entry = activity.describe(row(details=details))
        self.assertEqual(entry["headline"], "Checked, but nothing could be kept")
        self.assertIn("what this one answer should contain", entry["reasons"][0])
        self.assertEqual(entry["reasons"][1], activity.GENERIC_REJECTION)
        self.assertEqual(len(entry["reasons"]), 2)

    def test_what_was_learned_about_the_advocate_is_shown(self) -> None:
        details = {
            "advocate": [{"category": "practice", "text": "Appears before the Aurangabad Bench", "updated": False}],
            "advocate_consolidated": [{"applied": True, "changed": True, "lines_before": 6, "lines_after": 3}],
        }
        entry = activity.describe(row(details=details))
        self.assertEqual(entry["headline"], "Remembered something about you")
        self.assertEqual([item["kind"] for item in entry["items"]], ["about_you", "tidied"])

    def test_what_the_answer_used_is_reported(self) -> None:
        details = {"instructions_applied": ["i1", "i2"], "advocate_lines": 3}
        entry = activity.describe(row(details=details, sections_loaded=[{"section": "summary"}, {"section": "dates"}]))
        self.assertEqual(entry["used"], {"instructions": 2, "about_you": 3, "sections": ["summary", "dates"]})


class MessageTests(Case):
    def test_a_saved_prompt_shows_its_label_never_its_text(self) -> None:
        entry = activity.describe(row(question=None, prompt_label="Case summary", preset=True))
        self.assertEqual((entry["question"], entry["preset"]), ("Case summary", True))

    def test_long_messages_are_shortened(self) -> None:
        entry = activity.describe(row(question="x" * 1000))
        self.assertEqual(len(entry["question"]), activity.QUESTION_CHARS)
        self.assertTrue(entry["question"].endswith("…"))

    def test_a_row_with_nothing_in_it_is_still_safe(self) -> None:
        entry = activity.describe({"created_at": None, "details": "not a dict"})
        self.assertEqual(entry["outcome"], "nothing")
        self.assertEqual(entry["items"], [])

    def test_the_summary_counts_each_outcome(self) -> None:
        entries = [{"outcome": "saved"}, {"outcome": "nothing"}, {"outcome": "nothing"}, {"outcome": "suggested"}]
        counts = activity.summarise(entries)
        self.assertEqual((counts["turns"], counts["saved"], counts["nothing"], counts["suggested"]), (4, 1, 2, 1))


class RouteTests(Case):
    USER = {"id": 65, "name": "Adv", "email": "a@x.in", "role": "user", "account_type": "SOLO"}
    SCOPE = CaseScope(case_key="273", folder_name="Hitesh", user_id="65", case_id="273", accessible_user_ids=("65",))

    def client(self) -> TestClient:
        app = FastAPI()
        app.include_router(memory_routes.router)
        app.dependency_overrides[get_current_user] = lambda: self.USER
        return TestClient(app)

    def test_the_route_returns_this_advocates_turns_in_this_case(self) -> None:
        rows = [row(skipped_reason="write:greeting"), row(id="log-2", details={"lines": [{"section": "facts", "text": "x"}]})]
        with patch.object(memory_routes, "resolve_case_scope", return_value=self.SCOPE), \
                patch.object(memory_routes.repository, "list_turn_activity", return_value=rows) as read:
            response = self.client().get("/api/memory/cases/Hitesh/activity?limit=10")
        self.assertEqual(response.status_code, 200)
        read.assert_called_once_with("273", "65", 10)
        body = response.json()
        self.assertEqual(body["summary"]["turns"], 2)
        self.assertEqual([entry["outcome"] for entry in body["entries"]], ["nothing", "saved"])

    def test_a_case_the_advocate_cannot_open_is_not_found(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=None):
            response = self.client().get("/api/memory/cases/Other/activity")
        self.assertEqual(response.status_code, 404)


class RepositoryTests(unittest.TestCase):
    def test_the_query_is_scoped_to_one_advocate_and_hides_saved_prompt_text(self) -> None:
        from unittest.mock import MagicMock

        from app.services.memory import repository

        cur = MagicMock()
        cur.fetchall.return_value = []
        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        with patch.object(repository, "_conn") as own:
            own.return_value.__enter__.return_value = conn
            repository.list_turn_activity("273", "65", 500)
        sql, params = cur.execute.call_args.args
        self.assertIn("l.case_key = %s AND l.user_id = %s", sql)
        self.assertIn("CASE WHEN fc.secret_id IS NULL THEN", sql)
        self.assertEqual(params, ("273", "65", 100))
        self.assertEqual(repository.list_turn_activity("273", "", 10), [])


if __name__ == "__main__":
    unittest.main()
