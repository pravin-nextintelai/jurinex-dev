"""Past-session recall: when to look back, what to search, and how hits are shown."""
from __future__ import annotations

import unittest
from datetime import datetime
from unittest.mock import patch

from app.services.memory import recall as recall_mod
from app.services.memory.recall import (
    ANSWER_CHARS,
    HISTORY_MARKER,
    RECALL_FOOTER,
    RECALL_HEADER,
    RecallHit,
    format_recall_block,
    has_recall_cue,
    merge_recall_into_query,
    query_terms,
    recent_turns,
    search_past_sessions,
)
from app.services.memory.scope import CaseScope

SCOPE = CaseScope(
    case_key="512",
    folder_name="State_v_Pawar",
    user_id="42",
    case_id="512",
    accessible_user_ids=("42", "43"),
)

CHAT_A = "11111111-1111-1111-1111-111111111111"
CHAT_B = "22222222-2222-2222-2222-222222222222"


def hit(**overrides) -> RecallHit:
    base = dict(
        chat_id=CHAT_A,
        session_id="old-session",
        created_at="2026-09-08T10:00:00",
        question="The medical ground is his cardiac condition",
        answer="Noted: the cardiac condition will be pleaded as the medical ground.",
        prompt_label=None,
        used_saved_prompt=False,
        rank=0.5,
    )
    base.update(overrides)
    return RecallHit(**base)


class CueTests(unittest.TestCase):
    POINTS_BACK = (
        "Draft the bail application, add the medical ground we discussed.",
        "As decided earlier, drop the alibi ground.",
        "What did we decide about the prayer clause?",
        "Use the previous draft and tighten paragraph 6.",
        "You suggested a different heading, go with that.",
        "Remind me which grounds we are pressing.",
        "Let's pick up where we left off.",
        "As discussed, file the reply by Friday.",
        "The custody point mentioned earlier needs a citation.",
        "Continue from our last conversation.",
    )
    ABOUT_THE_RECORD = (
        "What are the facts of the case?",
        "Draft a bail application.",
        "The accused was previously arrested in 2019.",
        "Summarise the earlier order dated 24-08-2026.",
        "As mentioned in the FIR, the incident occurred at night.",
        "When was the complaint filed?",
        "",
    )

    def test_backward_references_are_cues(self) -> None:
        for question in self.POINTS_BACK:
            with self.subTest(question=question):
                self.assertTrue(has_recall_cue(question))

    def test_references_to_the_record_are_not(self) -> None:
        for question in self.ABOUT_THE_RECORD:
            with self.subTest(question=question):
                self.assertFalse(has_recall_cue(question))

    def test_none_is_safe(self) -> None:
        self.assertFalse(has_recall_cue(None))


class TermTests(unittest.TestCase):
    def test_topic_words_remain_without_the_reference(self) -> None:
        self.assertEqual(
            query_terms("Draft the bail application, add the medical ground we discussed."),
            ["bail", "application", "medical", "ground"],
        )

    def test_a_pure_backward_reference_has_no_topic(self) -> None:
        self.assertEqual(query_terms("What did we decide last time?"), [])

    def test_section_numbers_survive(self) -> None:
        self.assertEqual(query_terms("Section 318 of BNS, as we discussed"), ["section", "318", "bns"])

    def test_short_tokens_and_repeats_are_dropped(self) -> None:
        self.assertEqual(query_terms("BA 12 ground ground we discussed"), ["ground"])

    def test_terms_are_capped(self) -> None:
        terms = query_terms("ground cardiac medical bail custody hearing notice remand warrant", max_terms=5)
        self.assertEqual(terms, ["ground", "cardiac", "medical", "bail", "custody"])


class RenderTests(unittest.TestCase):
    def test_a_hit_is_labelled_with_who_said_what(self) -> None:
        block, shown = format_recall_block([hit()], 3_000)
        self.assertTrue(block.startswith(RECALL_HEADER))
        self.assertTrue(block.endswith(RECALL_FOOTER))
        self.assertIn('ADVOCATE SAID: "The medical ground is his cardiac condition"', block)
        self.assertIn('ASSISTANT ANSWERED: "Noted: the cardiac condition will be pleaded', block)
        self.assertIn("(2026-09-08)", block)
        self.assertEqual(shown, [CHAT_A])

    def test_an_assistant_answer_is_framed_as_a_suggestion_not_a_decision(self) -> None:
        block, _ = format_recall_block([hit()], 3_000)
        self.assertIn("never as a decision the advocate made", block)

    def test_a_saved_prompt_is_not_passed_off_as_the_advocates_words(self) -> None:
        block, _ = format_recall_block(
            [hit(question="Bail Checklist", prompt_label="Bail Checklist", used_saved_prompt=True)], 3_000
        )
        # Only the hit lines: the usage note below them names every label.
        entry_lines = block[len(RECALL_HEADER) : block.index(RECALL_FOOTER)].splitlines()
        self.assertIn('ADVOCATE RAN A SAVED PROMPT: "Bail Checklist"', entry_lines)
        self.assertFalse(any(line.startswith("ADVOCATE SAID") for line in entry_lines))

    def test_the_usage_note_explains_every_label(self) -> None:
        for label in ("ADVOCATE SAID", "ADVOCATE RAN A SAVED PROMPT", "ASSISTANT ANSWERED"):
            with self.subTest(label=label):
                self.assertIn(f'"{label}"', RECALL_FOOTER)

    def test_a_long_answer_is_clipped(self) -> None:
        block, _ = format_recall_block([hit(answer="word " * 2_000)], 5_000)
        answered = [line for line in block.splitlines() if line.startswith("ASSISTANT ANSWERED")][0]
        self.assertLessEqual(len(answered), ANSWER_CHARS + len('ASSISTANT ANSWERED: ""') + 1)
        self.assertIn("…", answered)

    def test_rendering_stops_at_the_budget(self) -> None:
        long_hits = [hit(chat_id=f"id-{i}", answer="word " * 2_000) for i in range(3)]
        block, shown = format_recall_block(long_hits, 1_500)
        self.assertLessEqual(len(block), 1_500)
        self.assertGreaterEqual(len(shown), 1)
        self.assertLess(len(shown), 3)

    def test_only_rendered_hits_are_reported_as_shown(self) -> None:
        long_hits = [hit(chat_id=CHAT_A, answer="word " * 2_000), hit(chat_id=CHAT_B, answer="word " * 2_000)]
        block, shown = format_recall_block(long_hits, 1_200)
        for chat_id in (CHAT_A, CHAT_B):
            if chat_id in shown:
                self.assertIn("Earlier session", block)
        self.assertEqual(len(shown), block.count("Earlier session"))

    def test_a_budget_too_small_for_any_hit_renders_nothing(self) -> None:
        self.assertEqual(format_recall_block([hit()], 400), ("", []))

    def test_no_hits_render_nothing(self) -> None:
        self.assertEqual(format_recall_block([], 3_000), ("", []))

    def test_double_quotes_inside_a_turn_do_not_break_the_labels(self) -> None:
        block, _ = format_recall_block([hit(question='He said "no bail"')], 3_000)
        self.assertIn("ADVOCATE SAID: \"He said 'no bail'\"", block)


class MergeTests(unittest.TestCase):
    RECALL = f"{RECALL_HEADER}\n[1] Earlier session\nADVOCATE SAID: \"x\"\n\n{RECALL_FOOTER}"

    def test_recall_goes_ahead_of_the_conversation_history(self) -> None:
        query = (
            "Use the prior conversation only as supporting context.\n\n"
            "Conversation history:\nUser: hi\nAssistant: hello\n\n"
            f"{HISTORY_MARKER}add the ground we discussed"
        )
        merged = merge_recall_into_query(query, self.RECALL)
        self.assertTrue(merged.startswith(RECALL_HEADER))
        self.assertLess(merged.index(RECALL_HEADER), merged.index("Conversation history:"))
        self.assertTrue(merged.endswith(f"{HISTORY_MARKER}add the ground we discussed"))
        self.assertEqual(merged.count(HISTORY_MARKER), 1)

    def test_without_history_the_question_is_still_marked_and_last(self) -> None:
        merged = merge_recall_into_query("add the ground we discussed", self.RECALL)
        self.assertTrue(merged.startswith(RECALL_HEADER))
        tail = merged[merged.rfind(HISTORY_MARKER):]
        self.assertEqual(tail, f"{HISTORY_MARKER}add the ground we discussed")

    def test_no_recall_leaves_the_query_alone(self) -> None:
        self.assertEqual(merge_recall_into_query("unchanged", ""), "unchanged")


class FakeCursor:
    """Answers the three statements recall issues."""

    def __init__(self, *, folders: int = 1, rows=(), fail_on_search: bool = False) -> None:
        self.folders = folders
        self.rows = list(rows)
        self.fail_on_search = fail_on_search
        self.executed: list[tuple[str, list]] = []
        self._one = None
        self._all: list[dict] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc) -> None:
        return None

    def execute(self, sql: str, params=None) -> None:
        flat = " ".join(sql.split())
        self.executed.append((flat, list(params or [])))
        lowered = flat.lower()
        self._one, self._all = None, []
        if "count(*)" in lowered:
            self._one = {"folders": self.folders}
        elif "from folder_chats" in lowered:
            if self.fail_on_search:
                raise RuntimeError("canceling statement due to statement timeout")
            self._all = list(self.rows)

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._all


class FakeConn:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor
        self.rollbacks = 0

    def cursor(self) -> FakeCursor:
        return self._cursor

    def rollback(self) -> None:
        self.rollbacks += 1


ROW = {
    "chat_id": CHAT_A,
    "session_id": "33333333-3333-3333-3333-333333333333",
    "question": "The medical ground is his cardiac condition",
    "answer": "Noted.",
    "prompt_label": None,
    "used_secret_prompt": False,
    "created_at": datetime(2026, 9, 8, 10, 0),
    "rank": 0.4,
}


class SearchTests(unittest.TestCase):
    def _search(self, cursor: FakeCursor, question: str, **kwargs):
        conn = FakeConn(cursor)
        hits = search_past_sessions(SCOPE, question_raw=question, conn=conn, **kwargs)
        return hits, conn

    def test_topic_words_run_a_text_search_in_this_folder_for_this_advocate(self) -> None:
        cursor = FakeCursor(rows=[ROW])
        hits, conn = self._search(
            cursor,
            "Draft the bail application, add the medical ground we discussed.",
            current_session_id="aaaaaaaabbbbccccddddeeeeeeeeeeee",
        )
        self.assertEqual([h.chat_id for h in hits], [CHAT_A])
        self.assertEqual(hits[0].created_at, "2026-09-08T10:00:00")

        timeout_sql, timeout_params = cursor.executed[0]
        self.assertIn("set_config('statement_timeout'", timeout_sql)
        self.assertEqual(timeout_params, ["1500ms"])

        count_sql, count_params = cursor.executed[1]
        self.assertIn("FROM user_files", count_sql)
        self.assertEqual(count_params, ["State_v_Pawar", ["42", "43"]])

        search_sql, search_params = cursor.executed[2]
        self.assertIn("websearch_to_tsquery", search_sql)
        self.assertEqual(
            search_params,
            [
                "bail or application or medical or ground",
                "State_v_Pawar",
                "42",
                "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                3,
            ],
        )
        self.assertEqual(conn.rollbacks, 1)

    def test_every_history_query_is_scoped_to_the_folder_the_advocate_and_other_sessions(self) -> None:
        for question in ("add the medical ground we discussed", "what did we decide last time?"):
            with self.subTest(question=question):
                cursor = FakeCursor(rows=[ROW])
                self._search(cursor, question, current_session_id=None)
                history = [sql for sql, _ in cursor.executed if "from folder_chats" in sql.lower()]
                self.assertEqual(len(history), 1)
                self.assertIn("folder_name = %s", history[0])
                self.assertIn("user_id::text = %s", history[0])
                self.assertIn("session_id::text <> %s", history[0])

    def test_no_topic_words_fall_back_to_the_most_recent_earlier_turns(self) -> None:
        cursor = FakeCursor(rows=[ROW])
        self._search(cursor, "What did we decide last time?")
        sql, params = cursor.executed[2]
        self.assertNotIn("websearch_to_tsquery", sql)
        self.assertIn("ORDER BY created_at DESC", sql)
        self.assertEqual(params, ["State_v_Pawar", "42", "", 3])

    def test_an_ambiguous_folder_name_returns_nothing_and_reads_no_history(self) -> None:
        cursor = FakeCursor(folders=2, rows=[ROW])
        hits, conn = self._search(cursor, "add the medical ground we discussed")
        self.assertEqual(hits, [])
        self.assertFalse(any("from folder_chats" in sql.lower() for sql, _ in cursor.executed))
        self.assertEqual(conn.rollbacks, 1)

    def test_turns_without_an_answer_are_dropped(self) -> None:
        cursor = FakeCursor(rows=[ROW, dict(ROW, chat_id=CHAT_B, answer="  ")])
        hits, _ = self._search(cursor, "add the medical ground we discussed")
        self.assertEqual([h.chat_id for h in hits], [CHAT_A])

    def test_saved_prompt_turns_are_recognised(self) -> None:
        rows = [
            dict(ROW, chat_id=CHAT_A, used_secret_prompt="true", question="Bail Checklist", prompt_label="Bail Checklist"),
            dict(ROW, chat_id=CHAT_B, used_secret_prompt=None, question="My Grounds Prompt", prompt_label="My Grounds Prompt"),
        ]
        hits, _ = self._search(FakeCursor(rows=rows), "add the medical ground we discussed")
        self.assertTrue(all(h.used_saved_prompt for h in hits))

    def test_the_limit_is_bounded(self) -> None:
        cursor = FakeCursor(rows=[])
        self._search(cursor, "add the medical ground we discussed", limit=50)
        self.assertEqual(cursor.executed[2][1][-1], 10)

    def test_a_failing_search_still_ends_the_transaction(self) -> None:
        cursor = FakeCursor(fail_on_search=True)
        conn = FakeConn(cursor)
        with self.assertRaises(RuntimeError):
            search_past_sessions(SCOPE, question_raw="add the medical ground we discussed", conn=conn)
        self.assertEqual(conn.rollbacks, 1)

    def test_missing_scope_user_or_database_is_a_clean_empty_result(self) -> None:
        self.assertEqual(search_past_sessions(None, question_raw="we discussed"), [])
        nameless = CaseScope(case_key="x", folder_name="State_v_Pawar", user_id="")
        self.assertEqual(search_past_sessions(nameless, question_raw="we discussed"), [])
        with patch.object(recall_mod, "is_db_available", return_value=False):
            self.assertEqual(search_past_sessions(SCOPE, question_raw="we discussed"), [])


class RecentTurnsTests(unittest.TestCase):
    def test_this_advocates_latest_turns_in_this_folder_without_the_current_one(self) -> None:
        cursor = FakeCursor(rows=[ROW])
        conn = FakeConn(cursor)
        turns = recent_turns(SCOPE, exclude_chat_id=CHAT_B, limit=5, conn=conn)
        self.assertEqual([t.chat_id for t in turns], [CHAT_A])
        sql, params = cursor.executed[2]
        self.assertIn("folder_name = %s", sql)
        self.assertIn("user_id::text = %s", sql)
        self.assertIn("id::text <> %s", sql)
        self.assertIn("ORDER BY created_at DESC", sql)
        self.assertEqual(params, ["State_v_Pawar", "42", CHAT_B, 5])
        self.assertEqual(conn.rollbacks, 1)

    def test_an_ambiguous_folder_name_reads_no_history(self) -> None:
        cursor = FakeCursor(folders=2, rows=[ROW])
        self.assertEqual(recent_turns(SCOPE, conn=FakeConn(cursor)), [])
        self.assertFalse(any("from folder_chats" in sql.lower() for sql, _ in cursor.executed))

    def test_the_limit_is_bounded_and_a_missing_scope_is_empty(self) -> None:
        cursor = FakeCursor(rows=[])
        recent_turns(SCOPE, limit=500, conn=FakeConn(cursor))
        self.assertEqual(cursor.executed[2][1][-1], 25)
        self.assertEqual(recent_turns(None), [])


if __name__ == "__main__":
    unittest.main()
