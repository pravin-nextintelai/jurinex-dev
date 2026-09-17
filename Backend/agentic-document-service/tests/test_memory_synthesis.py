"""Reviewing a stretch of conversation: when, what it may propose, and what stops it inventing."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.services.memory import synthesis as syn

NOW = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)


def settings(**overrides):
    values = {
        "memory_synthesis_enabled": True,
        "memory_synthesis_every_turns": 5,
        "memory_synthesis_idle_minutes": 30,
        "memory_synthesis_model": "gemini-3.7-flash",
        "memory_synthesis_thinking_level": "medium",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class Case(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = settings()
        patcher = patch.object(syn, "get_settings", side_effect=lambda: self.settings)
        patcher.start()
        self.addCleanup(patcher.stop)


class WhenTests(Case):
    def test_a_chat_is_reviewed_once_enough_turns_pile_up(self) -> None:
        self.assertFalse(syn.due_by_count(4))
        self.assertTrue(syn.due_by_count(5))

    def test_the_count_is_configurable_but_never_below_two(self) -> None:
        self.settings = settings(memory_synthesis_every_turns=1)
        self.assertEqual(syn.every_turns(), 2)

    def test_an_earlier_chat_is_reviewed_once_it_has_sat_long_enough(self) -> None:
        self.assertTrue(syn.due_after_break(3, NOW - timedelta(minutes=45), now=NOW))
        self.assertFalse(syn.due_after_break(3, NOW - timedelta(minutes=10), now=NOW))

    def test_a_single_leftover_turn_is_not_worth_a_review(self) -> None:
        self.assertFalse(syn.due_after_break(1, NOW - timedelta(hours=5), now=NOW))

    def test_switched_off_means_never(self) -> None:
        self.settings = settings(memory_synthesis_enabled=False)
        self.assertFalse(syn.due_by_count(50))
        self.assertFalse(syn.due_after_break(50, NOW - timedelta(days=1), now=NOW))

    def test_the_model_and_its_thinking_come_from_settings(self) -> None:
        self.assertEqual(syn.model_settings(), ("gemini-3.7-flash", "medium"))
        self.settings = settings(memory_synthesis_thinking_level="minimal")
        self.assertEqual(syn.model_settings(), ("gemini-3.7-flash", "low"))  # 3.7 has no minimal


class RequestTests(Case):
    def test_the_request_carries_memory_rules_and_numbered_turns(self) -> None:
        turns = [
            syn.Turn(1, "c1", "tell me in detail about the petitioner", "Hitesh is the petitioner.", False, NOW),
            syn.Turn(2, "c2", "SECRET PRESET BODY", "A case summary.", True, NOW),
        ]
        request = syn.build_request(
            turns,
            summary_lines=[{"text": "Case number: WP/10568/2024"}],
            decision_lines=[],
            saved_rules=["Answer in simple language"],
            noticed_rules=["Use a table"],
            chat_summary="- asked about the parties",
        )
        for part in ("WP/10568/2024", "Answer in simple language", "Use a table", "[Turn 1]", "asked about the parties"):
            self.assertIn(part, request)
        self.assertIn("ADVOCATE: (a saved prompt)", request)
        self.assertNotIn("SECRET PRESET BODY", request)


class ParseTests(Case):
    def test_items_citing_real_turns_are_read(self) -> None:
        payload = """```json
        {"stage": "Preparing the reply", "last_action": "Asked for a draft", "open_items": ["File by Monday", ""],
         "decisions": [{"text": "Press the extension ground", "turns": [2, "3", 99]},
                       {"text": "A decision citing nothing", "turns": []}],
         "preferences": [{"text": "Give detailed answers", "turns": [1, 4]}]}
        ```"""
        review = syn.parse_review(payload, [1, 2, 3, 4])
        self.assertEqual((review.stage, review.last_action, review.open_items), ("Preparing the reply", "Asked for a draft", ["File by Monday"]))
        self.assertEqual(review.decisions, [{"text": "Press the extension ground", "turns": [2, 3]}])
        self.assertEqual(review.preferences[0]["turns"], [1, 4])

    def test_nulls_and_placeholders_are_nothing(self) -> None:
        review = syn.parse_review('{"stage": "null", "last_action": null, "open_items": "N/A"}', [1])
        self.assertEqual((review.stage, review.last_action, review.open_items), (None, None, []))

    def test_limits_hold(self) -> None:
        many = ", ".join(f'{{"text": "Decision {n}", "turns": [1]}}' for n in range(9))
        review = syn.parse_review(f'{{"decisions": [{many}]}}', [1])
        self.assertEqual(len(review.decisions), syn.MAX_DECISIONS)

    def test_unusable_output_raises(self) -> None:
        for bad in ("", "no json", "[1, 2]"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                syn.parse_review(bad, [1])


class GroundingTests(Case):
    EVIDENCE = "The hearing is on 14 October 2026 before the Aurangabad Bench. Case number: WP/10568/2024"

    def test_a_status_line_with_known_numbers_and_names_is_kept(self) -> None:
        self.assertTrue(syn.grounded_status("Stage: Preparing for the 14 October 2026 hearing at Aurangabad", self.EVIDENCE))

    def test_a_date_nobody_wrote_is_not(self) -> None:
        self.assertFalse(syn.grounded_status("Stage: Preparing for the 21 October 2026 hearing", self.EVIDENCE))

    def test_a_name_nobody_wrote_is_not(self) -> None:
        self.assertFalse(syn.grounded_status("Open items: Serve notice on Ramesh Kulkarni", self.EVIDENCE))

    def test_plain_status_words_need_no_evidence(self) -> None:
        self.assertTrue(syn.grounded_status("Last action: Asked for an analysis of why the petition is weak", self.EVIDENCE))


class PatternTests(Case):
    def test_a_way_of_working_asked_for_twice_is_a_pattern(self) -> None:
        messages = ["tell me in detailed about petitioner", "in detailed why it is weak", "tell me about respondent"]
        self.assertTrue(syn.is_manner("Give detailed answers"))
        self.assertTrue(syn.shows_pattern("Give detailed answers", messages))

    def test_asked_once_is_not(self) -> None:
        self.assertFalse(syn.shows_pattern("Give detailed answers", ["in detailed why it is weak", "tell me about respondent"]))

    def test_a_shared_ordinary_word_does_not_make_a_pattern(self) -> None:
        """"answers" appears in both, but only one asks for detail."""
        messages = ["give me a simple answer", "give detailed answers please"]
        self.assertFalse(syn.shows_pattern("Give detailed answers", messages))

    def test_what_to_talk_about_is_not_a_way_of_working(self) -> None:
        self.assertFalse(syn.is_manner("Talk about the respondents"))

    def test_tables_and_language_count_as_ways_of_working(self) -> None:
        self.assertTrue(syn.shows_pattern("Present events in a table", ["list events in a table", "give dates as a table"]))


if __name__ == "__main__":
    unittest.main()
