"""Case-chat history: latest turns with shortened answers, plus a rolling summary."""
from __future__ import annotations

import contextlib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import chat_summary as cs

T0 = datetime(2026, 9, 15, 5, 0, tzinfo=timezone.utc)
SESSION = "8f14e45f-ceea-467f-a0e6-7a1b2c3d4e5f"


def _settings(**overrides):
    values = {
        "chat_summary_enabled": True,
        "chat_history_recent_turns": 3,
        "chat_history_latest_answer_tokens": 3000,
        "chat_history_older_answer_tokens": 700,
        "chat_summary_model": "gemini-3.8-flash",
        "chat_summary_thinking_level": "low",
        "chat_summary_max_tokens": 1000,
        "chat_summary_timeout_s": 60.0,
        "chars_per_token_estimate": 3.0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _turn(n: int, answer_chars: int = 200) -> cs.Turn:
    return cs.Turn(
        chat_id=f"chat-{n}",
        question=f"Question {n} about the FIR",
        answer=(f"Answer {n}. " + "Detail sentence here. " * (answer_chars // 22 + 1))[:answer_chars],
        created_at=T0 + timedelta(minutes=n),
    )


class SettingsCase(unittest.TestCase):
    settings = _settings()

    def setUp(self):
        stack = contextlib.ExitStack()
        stack.enter_context(patch.object(cs, "get_settings", side_effect=lambda: self.settings))
        stack.enter_context(patch("app.core.config.get_settings", side_effect=lambda: self.settings))
        self.addCleanup(stack.close)


class TextTests(SettingsCase):
    def test_short_text_is_unchanged(self):
        self.assertEqual(cs.shorten("A short answer.", 100), "A short answer.")

    def test_long_text_is_cut_at_a_paragraph_and_marked(self):
        text = "First paragraph. " * 30 + "\n\n" + "Second paragraph. " * 30
        out = cs.shorten(text, 600)
        self.assertLessEqual(len(out), 600)
        self.assertTrue(out.endswith(cs.SHORTENED_MARK))
        self.assertNotIn("Second paragraph", out)

    def test_fit_summary_drops_whole_items_from_the_end(self):
        text = "- first item\n- second item\n- third item that does not fit"
        self.assertEqual(cs.fit_summary(text, 30), "- first item\n- second item")

    def test_session_ids_are_normalised(self):
        self.assertEqual(cs.normalize_session_id("8F14E45FCEEA467FA0E67A1B2C3D4E5F"), SESSION)

    def test_recent_turns_never_exceed_the_plan(self):
        self.assertEqual(cs.recent_turn_count(2), 2)
        self.assertEqual(cs.recent_turn_count(25), 3)
        self.assertEqual(cs.recent_turn_count(0), 0)
        self.assertEqual(cs.recent_turn_count(None), 0)

    def test_folding_holds_back_the_widest_verbatim_window(self):
        """Whatever the plan allows, the summary never covers a turn still sent in full."""
        for plan in (1, 2, 3, 25):
            self.assertGreaterEqual(cs.fold_offset(), cs.recent_turn_count(plan))
        self.assertEqual(cs.fold_offset(), 3)


class RenderHistoryTests(SettingsCase):
    def test_summary_then_uncovered_turns_then_latest_turns(self):
        turns = [_turn(n, answer_chars=20_000) for n in (6, 5, 4, 3, 2, 1)]  # newest first
        summary = cs.SummaryRow(summary="- The advocate asked for the FIR date.", covered_turns=2,
                                covered_until=T0 + timedelta(minutes=2))
        block = cs.render_history("What next?", turns_newest_first=turns, summary=summary, recent_count=3)

        order = [block.index(h) for h in (cs.SUMMARY_HEADER, cs.GAP_HEADER, cs.HISTORY_HEADER, cs.CURRENT_HEADER)]
        self.assertEqual(order, sorted(order))
        self.assertTrue(block.endswith("Current question:\nWhat next?"))
        self.assertNotIn("Question 1 about", block)
        self.assertNotIn("Question 2 about", block)
        gap = block[block.index(cs.GAP_HEADER):block.index(cs.HISTORY_HEADER)]
        self.assertIn("Question 3 about", gap)

        history = block[block.index(cs.HISTORY_HEADER):block.index(cs.CURRENT_HEADER)]
        answers = history.split("Assistant: ")[1:]
        self.assertEqual(len(answers), 3)
        self.assertLessEqual(len(answers[0]), cs.answer_chars(latest=False) + 20)
        self.assertLessEqual(len(answers[-1]), cs.answer_chars(latest=True) + 20)
        self.assertGreater(len(answers[-1]), len(answers[0]))

    def test_without_a_summary_older_turns_are_sent_shortened(self):
        turns = [_turn(n) for n in (5, 4, 3, 2, 1)]
        block = cs.render_history("Q", turns_newest_first=turns, summary=None, recent_count=3)
        self.assertNotIn(cs.SUMMARY_HEADER, block)
        self.assertIn("Question 1 about", block[block.index(cs.GAP_HEADER):])

    def test_summary_switched_off_keeps_only_the_latest_turns(self):
        turns = [_turn(n) for n in (5, 4, 3, 2, 1)]
        summary = cs.SummaryRow(summary="- earlier", covered_until=T0)
        block = cs.render_history("Q", turns_newest_first=turns, summary=summary, recent_count=3, use_summary=False)
        self.assertNotIn(cs.SUMMARY_HEADER, block)
        self.assertNotIn(cs.GAP_HEADER, block)
        self.assertNotIn("Question 2 about", block)

    def test_no_turns_returns_the_question_itself(self):
        self.assertEqual(cs.render_history("Q", turns_newest_first=[], summary=None, recent_count=3), "Q")


class BuildHistoryBlockTests(SettingsCase):
    def test_no_session_or_history_switched_off_leaves_the_question_alone(self):
        self.assertEqual(cs.build_history_block(user_id="65", folder_name="F", session_id=None,
                                                query_text="Q", max_history=2), "Q")
        self.assertEqual(cs.build_history_block(user_id="65", folder_name="F", session_id=SESSION,
                                                query_text="Q", max_history=0), "Q")

    def test_database_turns_and_summary_are_used(self):
        state = ([_turn(n) for n in (4, 3, 2)], cs.SummaryRow(summary="- earlier ask", covered_until=T0 + timedelta(minutes=2)))
        with patch.object(cs, "is_db_available", return_value=True), \
                patch.object(cs, "read_history_state", return_value=state) as read:
            block = cs.build_history_block(user_id="65", folder_name="F", session_id=SESSION,
                                           query_text="Q", max_history=2)
        read.assert_called_once_with("F", "65", SESSION, 2 + cs.MAX_GAP_TURNS)
        self.assertIn("- earlier ask", block)
        self.assertIn("Question 4 about", block)

    def test_falls_back_to_the_callers_turns_without_a_database(self):
        pairs = [{"question": "old q", "answer": "old a"}, {"question": "new q", "answer": "new a"}]
        with patch.object(cs, "is_db_available", return_value=False):
            block = cs.build_history_block(user_id="65", folder_name="F", session_id=SESSION,
                                           query_text="Q", max_history=2, fallback_turns=lambda n: pairs)
        self.assertLess(block.index("old q"), block.index("new q"))


class UpdateTests(SettingsCase):
    def _run(self, *, previous=None, pending=(), ask=None, stored=True, user="65"):
        self.store = MagicMock(return_value=stored)
        self.ask = ask or MagicMock(return_value=("- The advocate asked for the FIR date.\n- JuriNex found 12 Aug 2024.", "gemini-3.8-flash"))
        with patch.object(cs, "is_db_available", return_value=True), \
                patch.object(cs, "_read_summary", return_value=previous), \
                patch.object(cs, "_pending_turns", return_value=list(pending)) as self.pending, \
                patch.object(cs, "_saved_rules", return_value=["Answer in English."]), \
                patch.object(cs, "_ask_model", self.ask), \
                patch.object(cs, "_store_summary", self.store):
            return cs.update_session_summary(user_id=user, folder_name="F", session_id=SESSION, max_history=2, case_key="272")

    def test_new_older_turns_are_folded_in(self):
        previous = cs.SummaryRow(summary="- earlier", covered_turns=1, covered_until=T0 + timedelta(minutes=1))
        outcome = self._run(previous=previous, pending=[_turn(2), _turn(3)])
        self.assertEqual(outcome, "updated")
        # Folded from the configured window (3), not the plan's narrower one (2), so a turn
        # is never both summarised and sent in full.
        self.pending.assert_called_with("F", "65", SESSION, offset=3, covered_until=previous.covered_until)
        self.assertEqual(self.ask.call_args[0][0], "- earlier")
        self.assertEqual(self.ask.call_args[0][2], ["Answer in English."])
        kwargs = self.store.call_args.kwargs
        self.assertEqual(kwargs["covered_turns"], 3)
        self.assertEqual(kwargs["covered_until"], _turn(3).created_at)
        self.assertEqual(kwargs["last_chat_id"], "chat-3")
        self.assertEqual(kwargs["expected_covered_until"], previous.covered_until)

    def test_nothing_new_means_no_model_call(self):
        self.assertEqual(self._run(pending=[]), "up_to_date")
        self.ask.assert_not_called()
        self.store.assert_not_called()

    def test_model_failure_stores_nothing(self):
        outcome = self._run(pending=[_turn(1)], ask=MagicMock(side_effect=RuntimeError("down")))
        self.assertEqual(outcome, "model_error")
        self.store.assert_not_called()

    def test_a_concurrent_update_is_not_overwritten(self):
        self.assertEqual(self._run(pending=[_turn(1)], stored=False), "conflict")

    def test_anonymous_users_are_skipped(self):
        self.assertEqual(self._run(pending=[_turn(1)], user="anonymous"), "not_applicable")

    def test_switched_off(self):
        self.settings = _settings(chat_summary_enabled=False)
        self.assertEqual(self._run(pending=[_turn(1)]), "disabled")
        self.assertIsNone(cs.submit_summary_update(user_id="65", folder_name="F", session_id=SESSION, max_history=2))


class RequestAndParseTests(SettingsCase):
    def test_request_carries_previous_summary_rules_and_shortened_turns(self):
        request = cs.build_summary_request("- earlier", [_turn(1, answer_chars=30_000)], ["Answer in English."])
        self.assertIn("- earlier", request)
        self.assertIn("- Answer in English.", request)
        self.assertIn("ADVOCATE: Question 1 about the FIR", request)
        self.assertIn(cs.SHORTENED_MARK, request)
        self.assertLess(len(request), 30_000)

    def test_parse_accepts_json_and_fenced_json(self):
        self.assertEqual(cs.parse_summary('{"summary": "- a"}'), "- a")
        self.assertEqual(cs.parse_summary('```json\n{"summary": "- b"}\n```'), "- b")

    def test_parse_rejects_empty_output(self):
        for bad in ("", '{"summary": ""}', "not json"):
            with self.assertRaises(ValueError):
                cs.parse_summary(bad)


class ReadRecordTests(SettingsCase):
    """What the memory panel shows for a chat. Reading never creates the table."""

    def _read(self, rows):
        cur = MagicMock()
        cur.fetchone.side_effect = list(rows)
        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        with patch.object(cs, "is_db_available", return_value=True), \
                patch.object(cs, "get_db_connection", return_value=conn):
            conn.__enter__.return_value = conn
            return cs.read_summary_record("F", "65", SESSION), cur

    def test_a_stored_summary_comes_back_with_its_details(self):
        row = {"summary": "- The advocate asked for the FIR date.", "covered_turns": 8,
               "model": "gemini-3.8-flash", "updated_at": T0}
        record, cur = self._read([{"present": True}, row])
        self.assertEqual(record["covered_turns"], 8)
        self.assertEqual(record["model"], "gemini-3.8-flash")
        self.assertEqual(record["session_id"], SESSION)
        self.assertEqual(record["chars"], len(row["summary"]))
        self.assertTrue(record["updated_at"].startswith("2026-09-15"))
        self.assertFalse(any("CREATE TABLE" in c[0][0] for c in cur.execute.call_args_list))

    def test_no_table_no_row_and_no_session_all_read_as_nothing(self):
        self.assertIsNone(self._read([{"present": False}])[0])
        self.assertIsNone(self._read([{"present": True}, None])[0])
        self.assertIsNone(cs.read_summary_record("F", "65", ""))
        self.assertEqual(cs.read_summary_text("F", "65", ""), "")

    def test_a_database_error_reads_as_nothing(self):
        with patch.object(cs, "is_db_available", return_value=True), \
                patch.object(cs, "get_db_connection", side_effect=RuntimeError("down")):
            self.assertIsNone(cs.read_summary_record("F", "65", SESSION))


class DeleteTests(unittest.TestCase):
    def _cursor(self, present: bool):
        cur = MagicMock()
        cur.fetchone.return_value = {"present": present}
        cur.rowcount = 2
        return cur

    def test_missing_table_deletes_nothing(self):
        cur = self._cursor(False)
        self.assertEqual(cs.delete_summaries(cur, folder_name="F"), 0)
        self.assertEqual(cur.execute.call_count, 1)

    @staticmethod
    def _delete_call(cur):
        return next(c for c in cur.execute.call_args_list if "DELETE FROM chat_session_summaries" in c[0][0])

    def test_one_chat_or_the_whole_folder(self):
        cur = self._cursor(True)
        self.assertEqual(cs.delete_summaries(cur, folder_name="F", session_or_chat_id=SESSION), 2)
        sql, params = self._delete_call(cur)[0]
        self.assertIn("session_id = %s", sql)
        self.assertEqual(params, ("F", SESSION, "F", SESSION))
        self.assertIn("RELEASE SAVEPOINT", cur.execute.call_args[0][0])

        cur = self._cursor(True)
        cs.delete_summaries(cur, folder_name="F")
        self.assertEqual(self._delete_call(cur)[0][1], ("F",))

    def test_a_failed_delete_rolls_back_to_the_savepoint_only(self):
        cur = self._cursor(True)

        def execute(sql, params=None):
            if sql.lstrip().startswith("DELETE"):
                raise RuntimeError("permission denied")

        cur.execute.side_effect = execute
        self.assertEqual(cs.delete_summaries(cur, folder_name="F"), 0)
        self.assertIn("ROLLBACK TO SAVEPOINT", cur.execute.call_args[0][0])


if __name__ == "__main__":
    unittest.main()
