"""A rule and its opposite are never counted, saved, dismissed or shared as one.

Replays the bug found in a real case: "do not ask for tabular output" was pending, the
advocate later asked for "summary in text as well as the tabular format", the extractor
said that repeated the pending rule, and the two were counted together and suggested
with the table request's wording under the no-tables rule.
"""
from __future__ import annotations

import unittest

from app.services.memory import profile as prof
from app.services.memory import synthesis as syn
from app.services.memory.schemas import MemoryProposal
from app.services.memory.validator import find_same_rule, is_negative, repeats_rule, same_polarity
from app.services.memory.writer import Extraction
from tests.test_memory_writer import noticed, run

NO_TABLES = "do not ask for tabular output"
TABLES = "give me summary in text as well as the tabular format in detailed"


class DirectionTests(unittest.TestCase):
    def test_negations_are_recognised(self) -> None:
        for text in ("do not use tables", "never cite unreported cases", "don't answer in Marathi",
                     "avoid footnotes", "answer without citations", "no tables please"):
            with self.subTest(text=text):
                self.assertTrue(is_negative(text))

    def test_a_number_abbreviation_is_not_a_negation(self) -> None:
        for text in ("refer to FIR No. 45", "Survey no 12 is disputed", "use Gat No.111/3"):
            with self.subTest(text=text):
                self.assertFalse(is_negative(text))

    def test_opposites_point_different_ways(self) -> None:
        self.assertFalse(same_polarity("Give answers in Marathi", "Do not give answers in Marathi"))
        self.assertTrue(same_polarity("never cite unreported cases", "do not cite unreported cases"))

    def test_the_spelling_match_for_rules_skips_the_opposite(self) -> None:
        self.assertIsNone(find_same_rule("Do not give answers in Marathi", [{"text": "Give answers in Marathi"}]))
        self.assertIsNotNone(find_same_rule("Give answers in Marathi.", [{"text": "Give answers in Marathi"}]))


class RepeatTests(unittest.TestCase):
    def test_the_real_bug_is_not_a_repeat(self) -> None:
        self.assertFalse(repeats_rule(TABLES, NO_TABLES))

    def test_a_reworded_request_for_the_same_thing_is(self) -> None:
        self.assertTrue(repeats_rule(TABLES, "tell me about this case in detailed in text as well as in tabular format"))
        self.assertTrue(repeats_rule("From now on use tables for the events", "Give event lists as tables"))

    def test_unrelated_rules_are_not(self) -> None:
        self.assertFalse(repeats_rule("use a table for dates", "answer in simple English"))
        self.assertFalse(repeats_rule("", "answer in simple English"))


class WriterTests(unittest.TestCase):
    """The writer's rule counting, saving and dismissal, end to end with the database mocked."""

    def test_an_opposite_request_the_extractor_calls_a_repeat_starts_its_own_count(self) -> None:
        history = {"512": [noticed(NO_TABLES, count=1, hidden=False, pid="p1")]}
        extraction = Extraction(proposals=[MemoryProposal(kind="instruction", text=TABLES, repeats="p1")])
        _, mocks = run(TABLES, history=history, extraction=extraction)
        self.assertNotIn(("512", "p1"), [call.args for call in mocks["update_proposal"].call_args_list])
        mocks["add_proposal"].assert_called_once()
        self.assertEqual(mocks["add_proposal"].call_args.args[3], TABLES)

    def test_a_genuine_repeat_the_extractor_links_is_still_counted(self) -> None:
        earlier = "tell me about this case in detailed in text as well as in tabular format"
        history = {"512": [noticed(earlier, count=1, hidden=True, pid="p2")]}
        extraction = Extraction(proposals=[MemoryProposal(kind="instruction", text=TABLES, repeats="p2")])
        _, mocks = run(TABLES, history=history, extraction=extraction)
        self.assertIn(("512", "p2"), [call.args[:2] for call in mocks["update_proposal"].call_args_list])
        mocks["add_proposal"].assert_not_called()

    def test_a_saved_rule_does_not_swallow_its_opposite(self) -> None:
        items = {"case": [{"id": "i1", "text": "Always answer in Marathi", "enabled": True}]}
        text = "From now on never answer in Marathi"
        extraction = Extraction(proposals=[MemoryProposal(kind="instruction", text=text)])
        _, mocks = run(f"{text}.", instruction_items=items, extraction=extraction)
        self.assertTrue(mocks["add_proposal"].called or mocks["add_instruction"].called)

    def test_dismissing_a_rule_does_not_block_its_opposite(self) -> None:
        dismissed = dict(noticed("give answers in a table", pid="p3", hidden=False), status="rejected")
        text = "do not give answers in a table"
        extraction = Extraction(proposals=[MemoryProposal(kind="instruction", text=text)])
        report, mocks = run(text, history={"512": [dismissed]}, extraction=extraction)
        self.assertNotIn("proposal_dismissed_before", report.rejection_codes)
        mocks["add_proposal"].assert_called_once()


class AcrossCasesTests(unittest.TestCase):
    def test_opposite_rules_in_two_cases_do_not_make_a_shared_rule(self) -> None:
        rules = [{"case_key": "1", "text": "give answers in a table"}, {"case_key": "2", "text": "no tables in answers"}]
        self.assertEqual(prof.cases_backing(prof.SharedRule("Give answers in a table", ("1", "2")), rules), {"1"})

    def test_opposite_requests_in_a_chat_do_not_make_a_pattern(self) -> None:
        messages = ["give it to me in a table", "no tables please, just text"]
        self.assertFalse(syn.shows_pattern("Present answers in a table", messages))


if __name__ == "__main__":
    unittest.main()
