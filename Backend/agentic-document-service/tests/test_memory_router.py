"""Section routing: which memory bodies a question should pull in."""
from __future__ import annotations

import unittest

from app.services.memory.assembly import route_sections


class RoutingTests(unittest.TestCase):
    def test_each_cue_group_selects_its_section(self) -> None:
        cases = {
            "facts": "What are the facts of the incident?",
            "parties": "Who is the complainant in this matter?",
            "documents": "Which document has the annexure?",
            "drafting_log": "Show me the previous draft wording",
            "decisions": "What strategy did we agree on?",
            "dates": "When is the next hearing listed?",
        }
        for section, question in cases.items():
            with self.subTest(section=section):
                self.assertIn(section, route_sections(question, max_sections=2))

    def test_at_most_max_sections_are_returned(self) -> None:
        question = "What are the facts, who are the parties, which documents, and when is the hearing?"
        self.assertEqual(len(route_sections(question, max_sections=2)), 2)
        self.assertEqual(len(route_sections(question, max_sections=1)), 1)

    def test_zero_budget_returns_nothing(self) -> None:
        self.assertEqual(route_sections("What are the facts?", max_sections=0), [])

    def test_more_hits_rank_higher(self) -> None:
        # Two 'dates' cues against one 'parties' cue.
        picked = route_sections("What is the hearing date for the complainant?", max_sections=1)
        self.assertEqual(picked, ["dates"])

    def test_ties_break_by_general_usefulness(self) -> None:
        # One cue each: facts should outrank drafting_log.
        picked = route_sections("Give the background and the wording", max_sections=1)
        self.assertEqual(picked, ["facts"])

    def test_draft_mode_forces_its_two_sections(self) -> None:
        picked = route_sections("Anything at all", draft_mode=True, max_sections=2)
        self.assertEqual(picked, ["drafting_log", "decisions"])

    def test_draft_mode_respects_a_single_slot_budget(self) -> None:
        self.assertEqual(route_sections("x", draft_mode=True, max_sections=1), ["drafting_log"])

    def test_a_greeting_pulls_nothing(self) -> None:
        for greeting in ("hi", "hello there", "thanks!"):
            with self.subTest(greeting=greeting):
                self.assertEqual(route_sections(greeting, max_sections=2), [])

    def test_summary_is_never_routed(self) -> None:
        # summary always loads, so it is never one of the lazy choices.
        picked = route_sections("Summarise the facts and dates for me", max_sections=3)
        self.assertNotIn("summary", picked)

    def test_empty_question_is_safe(self) -> None:
        self.assertEqual(route_sections("", max_sections=2), [])
        self.assertEqual(route_sections(None, max_sections=2), [])


if __name__ == "__main__":
    unittest.main()
