"""Reading a case's earlier chats again, without undoing what newer turns taught memory.

Before, only turns answered after memory existed were ever read: 549 of 572 saved chats
had never been read, so a case with a long history had an almost empty memory. Reading
them now must not overwrite a newer value with an older one, bring back what the
advocate deleted, save rules the advocate never saw counted, or fill memory with the
same fact restated by every answer.
"""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.routes import memory as memory_routes
from app.services.memory import activity
from app.services.memory import answer_facts as af
from app.services.memory import reread
from app.services.memory import writer as writer_mod
from app.services.memory.schemas import AdvocateFact, MemorySettings
from app.services.memory.writer import READER_VERSION, Extraction, RereadGuard, WriteReport
from tests.test_memory_api import SCOPE as API_SCOPE, make_client
from tests.test_memory_writer import (
    CHAT,
    HEART,
    SCOPE,
    AnswerFactTests,
    noticed,
    op,
    proposal,
    run,
)

ASKED = datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc)


def earlier(**guard) -> dict:
    return {"reread": RereadGuard(**guard), "created_at": ASKED}


class NewerMemoryWinsTests(unittest.TestCase):
    def test_an_earlier_turn_never_overwrites_a_newer_line(self) -> None:
        stored = {"dates": {"version": 3, "lines": [{"id": "d1", "tag": "stated", "text": "Next hearing is on 20 October 2026"}]}}
        report, mocks = run(
            "The next hearing is on 14 October 2026.",
            stored=stored,
            extraction=Extraction(ops=[op("Next hearing is on 14 October 2026", section="dates")]),
            turn=earlier(),
        )
        mocks["apply_op"].assert_not_called()
        self.assertIn("reread_keeps_newer", report.rejection_codes)

    def test_the_same_turn_answered_now_does_update_it(self) -> None:
        stored = {"dates": {"version": 3, "lines": [{"id": "d1", "tag": "stated", "text": "Next hearing is on 20 October 2026"}]}}
        report, mocks = run(
            "The next hearing is on 14 October 2026.",
            stored=stored,
            extraction=Extraction(ops=[op("Next hearing is on 14 October 2026", section="dates")]),
        )
        self.assertEqual(mocks["apply_op"].call_args.args[1].op, "replace_line")

    def test_a_line_added_earlier_in_the_same_run_may_still_be_updated(self) -> None:
        stored = {"dates": {"version": 3, "lines": [{"id": "d1", "tag": "stated", "text": "Next hearing is on 20 October 2026"}]}}
        report, mocks = run(
            "The next hearing is on 14 October 2026.",
            stored=stored,
            extraction=Extraction(ops=[op("Next hearing is on 14 October 2026", section="dates")]),
            turn=earlier(added_ids={"d1"}),
        )
        self.assertEqual(report.writes, 1)

    def test_a_line_deleted_or_replaced_before_is_not_brought_back(self) -> None:
        report, mocks = run(
            HEART,
            extraction=Extraction(ops=[op("Client Sunil Pawar has a heart condition")]),
            turn=earlier(written_before=[{"text": "Client Sunil Pawar has a heart condition"}]),
        )
        mocks["apply_op"].assert_not_called()
        self.assertIn("reread_written_before", report.rejection_codes)

    def test_new_lines_are_added_and_remembered_by_the_run(self) -> None:
        turn = earlier()
        report, mocks = run(HEART, extraction=Extraction(ops=[op("Client Sunil Pawar has a heart condition")]), turn=turn)
        self.assertEqual(report.writes, 1)
        self.assertEqual(turn["reread"].added_ids, {"new-1"})


class RulesAndAboutYouTests(unittest.TestCase):
    RULE = "Always cite SCC first in this matter"

    def test_a_rule_asked_for_again_in_an_earlier_turn_is_only_suggested(self) -> None:
        history = {"512": [noticed(self.RULE, explicit=True, hidden=False)]}
        _, mocks = run("Always cite SCC first in this matter.", history=history, extraction=proposal(self.RULE), turn=earlier())
        mocks["add_instruction"].assert_not_called()

    def test_what_is_remembered_about_the_advocate_is_not_changed_by_an_earlier_turn(self) -> None:
        lines = [{"id": "a1", "category": "practice", "text": "Mostly appears before the Aurangabad Bench"}]
        facts = [AdvocateFact(category="practice", text="Mostly appears before the Aurangabad Bench of the High Court", replaces="a1")]
        report, mocks = run(
            "I mostly appear before the Aurangabad Bench of the High Court.",
            advocate_lines=lines,
            extraction=Extraction(advocate=facts),
            turn=earlier(),
        )
        mocks["update_advocate_line"].assert_not_called()
        self.assertIn("reread_keeps_newer", report.rejection_codes)

    def test_nothing_is_dropped_to_make_room_for_something_said_long_ago(self) -> None:
        facts = [AdvocateFact(category="practice", text="Mostly appears before the Aurangabad Bench")]
        full = SimpleNamespace(code="set_full", detail="full")
        with patch.object(writer_mod, "advocate_set_room", return_value=full), \
                patch.object(writer_mod, "_make_room") as make_room, \
                patch.object(writer_mod, "consolidate_if_full") as consolidate:
            report, mocks = run(
                "I mostly appear before the Aurangabad Bench.", extraction=Extraction(advocate=facts), turn=earlier()
            )
        make_room.assert_not_called()
        consolidate.assert_not_called()
        mocks["add_advocate_line"].assert_not_called()
        self.assertIn("advocate_full", report.rejection_codes)


class ContextTests(unittest.TestCase):
    def test_an_earlier_turn_is_read_with_the_turns_before_it_and_nothing_after(self) -> None:
        _, mocks = run(HEART, extraction=Extraction(nothing_durable=True), turn=earlier())
        self.assertEqual(mocks["recent_turns"].call_args.kwargs["before"], ASKED)
        mocks["conversation_summary"].assert_not_called()
        mocks["refresh_seed"].assert_not_called()


class LiveTurnTests(unittest.TestCase):
    def test_the_turn_just_answered_is_marked_read_and_earlier_ones_scheduled(self) -> None:
        _, mocks = run(HEART, extraction=Extraction(nothing_durable=True))
        call = mocks["mark_turns_read"].call_args
        self.assertEqual(call.args, ("512", [CHAT], READER_VERSION))
        mocks["reread_schedule"].assert_called_once_with(SCOPE)

    def test_a_turn_the_model_could_not_read_is_left_to_be_read_again(self) -> None:
        _, mocks = run(HEART, extract_error=RuntimeError("quota exceeded"))
        mocks["mark_turns_read"].assert_not_called()

    def test_a_turn_read_while_memory_is_switched_off_is_not_marked(self) -> None:
        _, mocks = run(HEART, settings=MemorySettings(write_enabled=False))
        mocks["mark_turns_read"].assert_not_called()
        mocks["reread_schedule"].assert_not_called()


class RestatedFactTests(unittest.TestCase):
    MEMORY = [
        "25 Aug 2006: Registered sale deed executed in favour of petitioner",
        "Registered Sale Deed No. 4401/2006 was executed on 25/08/2006.",
        "Gat No. 111/3 at Village Vavad measures 6 H. 40 R.",
    ]

    def test_a_fact_restated_in_other_words_adds_nothing(self) -> None:
        for fact in (
            "The sale deed No. 4401/2006 was registered in favour of the petitioner on 25.08.2006",
            "Registered Sale Deed No. 4401/2006 was executed on 25 August 2006 for Gat No. 111/3",
        ):
            with self.subTest(fact=fact):
                self.assertFalse(af.adds_to(fact, self.MEMORY))

    def test_a_new_number_date_or_name_is_worth_keeping(self) -> None:
        for fact in (
            "General Power of Attorney No. 3345/2005 was executed",
            "The petitioner applied for an extension of time on 25/03/2010",
            "Balkrushna Lahoti held a power of attorney for Gat No. 111/3",
        ):
            with self.subTest(fact=fact):
                self.assertTrue(af.adds_to(fact, self.MEMORY))

    def test_a_year_alone_is_not_new_information(self) -> None:
        self.assertFalse(af.adds_to("The sale deed No. 4401 was executed in 2006", self.MEMORY))

    def test_a_fact_with_nothing_to_compare_is_left_to_the_wording_check(self) -> None:
        self.assertTrue(af.adds_to("the petitioner purchased agricultural land", self.MEMORY))

    def test_a_number_memory_holds_in_devanagari_is_known(self) -> None:
        self.assertFalse(af.adds_to("Document No. 4144/2011 was registered", ["दस्त क्र ४१४४/२०११ नोंदणीकृत"]))

    def test_the_writer_skips_a_restated_fact_from_an_answer(self) -> None:
        stored = {"dates": {"version": 2, "lines": [{"id": "d1", "tag": "extracted", "text": "14 Mar 2026: FIR No. 45/2026 registered"}]}}
        report, mocks = AnswerFactTests().ask(
            answer_facts=[AnswerFactTests.FACT], answer_support=AnswerFactTests.SUPPORT, stored=stored
        )
        mocks["apply_op"].assert_not_called()
        self.assertIn("answer_fact_known", report.rejection_codes)


def row(chat_id: str, *, minutes: int, question: str = HEART, preset: bool = False, **extra) -> dict:
    return {
        "chat_id": chat_id,
        "session_id": "s-old",
        "question": question,
        "answer": "Answer.",
        "prompt_label": "Case Summary" if preset else None,
        "used_secret_prompt": preset,
        "preset": preset,
        "citations": [{"document_name": "FIR.pdf", "file_id": "f-1"}],
        "created_at": ASKED + timedelta(minutes=minutes),
        **extra,
    }


class RunTests(unittest.TestCase):
    def setUp(self) -> None:
        self.reads: dict[str, list] = {"unread": [], "sessions": [], "latest": []}
        self.patches = {
            "settings": patch.object(reread, "get_settings", return_value=SimpleNamespace(memory_write_enabled=True, memory_reread_max_turns=40, memory_reread_max_reviews=5)),
            "available": patch.object(reread.repository, "available", return_value=True),
            "effective": patch.object(reread.repository, "effective_settings", return_value=MemorySettings()),
            "written": patch.object(reread.repository, "written_line_texts", return_value=["An old fact"]),
            "mark": patch.object(reread.repository, "mark_turns_read", return_value=1),
            "read": patch.object(reread, "_read", side_effect=self._fake_read),
            "log": patch.object(reread.writer, "_write_log", return_value="log-1"),
            "session_turns": patch.object(reread.writer, "session_turns", return_value=[row("c1", minutes=0), row("c2", minutes=1)]),
            "review": patch.object(reread.writer, "_run_review"),
            "synthesis": patch("app.services.memory.synthesis.enabled", return_value=True),
        }
        self.mocks = {name: patcher.start() for name, patcher in self.patches.items()}
        for patcher in self.patches.values():
            self.addCleanup(patcher.stop)

    def _fake_read(self, scope, sql, params):
        if sql is reread._UNREAD_SQL:
            return list(self.reads["unread"])
        if sql is reread._UNREVIEWED_SQL:
            return list(self.reads["sessions"])
        return list(self.reads["latest"])

    def run_with(self, outcomes: dict[str, dict]) -> tuple[reread.RereadStatus, list]:
        seen = []

        def fake_run(turn, report, *, today=None):
            seen.append((turn, today))
            for key, value in outcomes.get(turn.chat_id, {}).items():
                setattr(report, key, value) if key != "codes" else report.rejection_codes.extend(value)

        with patch.object(reread.writer, "_run", side_effect=fake_run):
            status = reread.run(SCOPE, max_reviews=0)
        return status, seen

    def test_turns_are_read_oldest_first_and_each_is_marked_read(self) -> None:
        self.reads["unread"] = [row("c1", minutes=0), row("c2", minutes=5)]
        status, seen = self.run_with({"c1": {"writes": 2}})
        self.assertEqual([turn.chat_id for turn, _ in seen], ["c1", "c2"])
        self.assertEqual([call.args[1] for call in self.mocks["mark"].call_args_list], [["c1"], ["c2"]])
        self.assertEqual((status.state, status.turns_read, status.saved), ("done", 2, 2))
        # Only a turn that changed something gets a row in the Activity tab.
        self.assertEqual(self.mocks["log"].call_count, 1)

    def test_each_turn_is_read_as_it_was_asked_under_one_guard(self) -> None:
        self.reads["unread"] = [row("c1", minutes=0), row("c2", minutes=5, preset=True, question="Case Summary")]
        _, seen = self.run_with({})
        (first, day), (second, _) = seen
        self.assertIs(first.reread, second.reread)
        self.assertEqual(first.reread.written_before, [{"text": "An old fact"}])
        self.assertEqual((first.created_at, day), (ASKED, ASKED.date()))
        self.assertEqual(first.citations, [{"document_name": "FIR.pdf", "file_id": "f-1"}])
        self.assertEqual((second.saved_prompt, second.question_raw), (True, ""))
        self.assertEqual(first.log_entry["mode"], "reread")

    def test_a_turn_the_model_could_not_read_stays_unread_and_three_in_a_row_stop_the_run(self) -> None:
        self.reads["unread"] = [row(f"c{n}", minutes=n) for n in range(5)]
        failing = {f"c{n}": {"skipped_reason": "extractor_error"} for n in range(5)}
        status, seen = self.run_with(failing)
        self.mocks["mark"].assert_not_called()
        self.assertEqual(len(seen), 3)
        self.assertEqual((status.state, status.stopped_reason), ("stopped", "model_unavailable"))

    def test_nothing_is_read_while_memory_generation_is_off(self) -> None:
        self.mocks["effective"].return_value = MemorySettings(write_enabled=False)
        status, seen = self.run_with({})
        self.assertEqual((status.state, status.stopped_reason, seen), ("stopped", "disabled_by_user", []))
        self.mocks["read"].assert_not_called()

    def test_only_the_cases_latest_chat_may_update_the_summary(self) -> None:
        self.reads["sessions"] = [{"session_id": "s-old"}, {"session_id": "s-new"}]
        self.reads["latest"] = [{"session_id": "s-new"}]
        with patch.object(reread.writer, "_run"):
            reread.run(SCOPE, max_turns=0, max_reviews=5)
        calls = self.mocks["review"].call_args_list
        self.assertEqual([(call.args[4], call.kwargs["summary_allowed"]) for call in calls], [("s-old", False), ("s-new", True)])
        self.assertTrue(all(isinstance(call.kwargs["guard"], RereadGuard) for call in calls))


class ScheduleTests(unittest.TestCase):
    def setUp(self) -> None:
        reread._jobs.clear()
        reread._last_automatic.clear()
        patchers = [
            patch.object(reread, "automatic_enabled", return_value=True),
            patch.object(reread, "every_seconds", return_value=3600.0),
            patch.object(reread, "_EXECUTOR", SimpleNamespace(submit=lambda fn, *a, **k: fn(*a, **k))),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(reread._jobs.clear)
        self.addCleanup(reread._last_automatic.clear)

    def test_a_case_with_unread_turns_is_read_once_per_interval(self) -> None:
        with patch.object(reread, "paused", return_value=False), patch.object(reread, "has_work", return_value=True), \
                patch.object(reread, "run", return_value=None) as run_case:
            self.assertTrue(reread.schedule_case(SCOPE))
            self.assertFalse(reread.schedule_case(SCOPE))
        run_case.assert_called_once_with(SCOPE, automatic=True)

    def test_a_case_whose_memory_was_forgotten_is_not_refilled_by_itself(self) -> None:
        with patch.object(reread, "paused", return_value=True), patch.object(reread, "has_work", return_value=True), \
                patch.object(reread, "run") as run_case:
            reread.schedule_case(SCOPE)
        run_case.assert_not_called()

    def test_but_the_advocate_may_ask_for_it(self) -> None:
        with patch.object(reread, "paused", return_value=True), patch.object(reread, "run") as run_case:
            reread.start(SCOPE)
        run_case.assert_called_once_with(SCOPE, automatic=False)

    def test_nothing_runs_twice_at_once(self) -> None:
        reread._jobs[SCOPE.case_key] = reread.RereadStatus(case_key=SCOPE.case_key, state="running")
        with patch.object(reread, "run") as run_case:
            self.assertFalse(reread.schedule_case(SCOPE))
            self.assertEqual(reread.start(SCOPE).state, "running")
        run_case.assert_not_called()

    def test_automatic_reading_can_be_switched_off(self) -> None:
        with patch.object(reread, "automatic_enabled", return_value=False), patch.object(reread, "run") as run_case:
            self.assertFalse(reread.schedule_case(SCOPE))
        run_case.assert_not_called()


class ActivityTests(unittest.TestCase):
    def test_a_turn_read_again_says_when_it_was_asked(self) -> None:
        entry = activity.describe({"id": "l1", "mode": "reread", "created_at": datetime.now(timezone.utc), "asked_at": ASKED,
                                   "details": {"lines": [{"section": "facts", "tag": "stated", "text": "x"}]}})
        self.assertTrue(entry["reread"])
        self.assertEqual(entry["asked_at"], ASKED.isoformat())


class ApiTests(unittest.TestCase):
    def test_starting_needs_memory_generation_on(self) -> None:
        with patch.object(memory_routes, "resolve_case_scope", return_value=API_SCOPE), \
                patch.object(memory_routes.repository, "effective_settings", return_value=MemorySettings(write_enabled=False)), \
                patch.object(reread, "start") as start:
            response = make_client().post("/api/memory/cases/State_v_Pawar/reread")
        self.assertEqual(response.status_code, 409)
        start.assert_not_called()

    def test_starting_queues_a_run_and_returns_its_status(self) -> None:
        status = {"case_key": "512", "unread": 12, "job": {"state": "queued"}}
        with patch.object(memory_routes, "resolve_case_scope", return_value=API_SCOPE), \
                patch.object(memory_routes.repository, "effective_settings", return_value=MemorySettings()), \
                patch.object(reread, "start") as start, patch.object(reread, "status", return_value=status):
            response = make_client().post("/api/memory/cases/State_v_Pawar/reread")
        self.assertEqual(response.json(), status)
        start.assert_called_once_with(API_SCOPE)


if __name__ == "__main__":
    unittest.main()
