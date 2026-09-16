"""Choosing which remembered facts go with a question, instead of dropping the oldest."""
from __future__ import annotations

import unittest

from app.services.memory import relevance

FACTS = [
    {"id": "f1", "category": "practice", "text": "Mostly appears before the Aurangabad Bench"},
    {"id": "f2", "category": "clients", "text": "Usually acts for borrowers, not banks"},
    {"id": "f3", "category": "work_style", "text": "Wants the prayer clause settled last"},
    {"id": "f4", "category": "background", "text": "Twelve years at the bar"},
]


def render(rows):
    return "\n".join(f"- {row['text']}" for row in rows)


def select(question, limit, lines=FACTS):
    return relevance.select(lines, question=question, limit_chars=limit, render=render)


class TermTests(unittest.TestCase):
    def test_filler_and_short_words_are_not_subject_words(self) -> None:
        self.assertEqual(relevance.terms("What is the way to do this for me"), set())

    def test_subject_words_survive(self) -> None:
        self.assertEqual(relevance.terms("Draft the prayer clause"), {"draft", "prayer", "clause"})

    def test_a_question_can_name_more_than_one_subject(self) -> None:
        self.assertEqual(relevance.category_hits("Draft a reply for my client"), {"work_style", "clients"})
        self.assertEqual(relevance.category_hits("Hello"), set())


class ScoreTests(unittest.TestCase):
    def test_a_shared_word_outranks_everything_else(self) -> None:
        best = relevance.score_facts(FACTS, "What did the borrowers agree?")[0]
        self.assertEqual(best.line["id"], "f2")
        self.assertEqual(best.overlap, 1)

    def test_subject_wins_when_no_word_is_shared(self) -> None:
        best = relevance.score_facts(FACTS, "Please redraft this")[0]
        self.assertEqual(best.line["id"], "f3")
        self.assertEqual(best.overlap, 0)
        self.assertTrue(best.on_subject)

    def test_with_nothing_to_go_on_the_newest_fact_leads(self) -> None:
        self.assertEqual(relevance.score_facts(FACTS, "")[0].line["id"], "f4")

    def test_one_fact_and_no_facts_are_both_safe(self) -> None:
        self.assertEqual(len(relevance.score_facts(FACTS[:1], "anything")), 1)
        self.assertEqual(relevance.score_facts([], "anything"), [])


class SelectTests(unittest.TestCase):
    def test_the_best_facts_that_fit_are_kept(self) -> None:
        chosen = select("Which bench hears this?", limit=45)
        self.assertEqual(chosen.kept_ids, ["f1"])
        self.assertEqual(len(chosen.dropped), 3)

    def test_kept_facts_stay_in_their_stored_order(self) -> None:
        """The question moves who is in the block, never the order of the block."""
        chosen = select("Draft the reply, and who are my clients?", limit=120)
        self.assertEqual(chosen.kept_ids, sorted(chosen.kept_ids))

    def test_a_short_fact_still_fits_after_a_long_one_did_not(self) -> None:
        lines = [
            {"id": "long", "category": "practice", "text": "x" * 200},
            {"id": "short", "category": "practice", "text": "Filed in the district court"},
        ]
        chosen = relevance.select(lines, question="district court filing", limit_chars=40, render=render)
        self.assertEqual(chosen.kept_ids, ["short"])

    def test_everything_fits_when_there_is_room(self) -> None:
        chosen = select("anything at all", limit=5_000)
        self.assertEqual(len(chosen.kept), 4)
        self.assertEqual(chosen.dropped, [])

    def test_no_budget_keeps_nothing_and_says_so(self) -> None:
        none_fit = select("anything", limit=0)
        self.assertEqual(none_fit.kept, [])
        self.assertEqual(len(none_fit.dropped), 4)

    def test_a_blank_fact_is_not_a_fact_that_was_dropped(self) -> None:
        blank = relevance.select(
            [{"id": "b", "category": "practice", "text": "  "}],
            question="anything", limit_chars=500, render=render,
        )
        self.assertEqual((blank.kept, blank.dropped), ([], []))

    def test_facts_without_an_id_are_still_scored(self) -> None:
        lines = [{"category": "practice", "text": "Files in the High Court"}]
        chosen = relevance.select(lines, question="High Court", limit_chars=500, render=render)
        self.assertEqual(len(chosen.kept), 1)
        self.assertEqual(list(chosen.scores), ["#0"])

    def test_the_log_line_says_what_happened(self) -> None:
        chosen = select("Draft the reply", limit=45)
        self.assertIn("kept=1", relevance.describe(chosen, "Draft the reply"))
        self.assertIn("subject=work_style", relevance.describe(chosen, "Draft the reply"))


if __name__ == "__main__":
    unittest.main()
