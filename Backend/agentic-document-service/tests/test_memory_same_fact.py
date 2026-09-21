"""One fact, one line: a fact memory already holds in other words is merged, not kept twice.

Before, dedupe compared spelling. "25 Aug 2006: Registered sale deed executed" from the
chronology and "Registered Sale Deed No. 4401/2006 was executed on 25/08/2006" from an
answer share too little of it, so both were kept, and one case held a dozen facts twice
and one three times.
"""
from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from app.services.memory import activity
from app.services.memory import repository
from app.services.memory import same_fact
from app.services.memory.repository import VersionConflict
from app.services.memory.same_fact import Judgement
from app.services.memory.schemas import MemorySettings
from app.services.memory.seed import SeedCandidate, plan_seed
from tests import test_memory_writer as writer_tests
from tests.test_memory_writer import answer_facts_mod

DEED_SEED = "25 Aug 2006: Registered sale deed executed in favour of petitioner"
DEED_FACT = "Registered Sale Deed No. 4401/2006 was executed on 25/08/2006."
DEED_MERGED = "25 Aug 2006: Registered Sale Deed No. 4401/2006 executed in favour of petitioner"
SEED_REF = {"kind": "seed", "source": "chronology:2006-08-25", "document": "Petition.pdf", "page": "3"}


def line(line_id: str, text: str, *, section: str = "dates", tag: str = "extracted", ref=None, created: str = "2026-09-15 05:00"):
    return {"id": line_id, "section": section, "tag": tag, "text": text, "source_ref": dict(ref or {}), "created_at": created, "ord": 1}


def judge_that(rules: dict[str, tuple[str, str | None]]):
    """A fake model: a NEW line containing a key repeats the SAVED line containing its value."""
    calls: list = []

    def fake(items):
        calls.append(items)
        verdicts = []
        for text, options in items:
            verdict = Judgement()
            for new_part, (saved_part, merged) in rules.items():
                match = next((o for o in options if saved_part in str(o.get("text"))), None) if new_part in text else None
                if match is not None:
                    verdict = Judgement(same_as=match, merged=merged)
                    break
            verdicts.append(verdict)
        return verdicts

    fake.calls = calls
    return fake


class CandidateTests(unittest.TestCase):
    def test_the_same_date_and_what_happened_make_a_candidate(self) -> None:
        saved = [line("d1", DEED_SEED)]
        self.assertEqual(same_fact.candidates(DEED_FACT, saved), saved)

    def test_a_date_in_devanagari_digits_is_the_same_date(self) -> None:
        saved = [line("d1", DEED_SEED)]
        self.assertEqual(same_fact.candidates("विक्रीखत क्र. ४४०१/२००६ दिनांक २५/०८/२००६ रोजी registered sale deed", saved), saved)

    def test_two_different_dates_are_two_events(self) -> None:
        saved = [line("d1", "12 Jul 2005: Special Civil Suit No. 17/2005 instituted")]
        self.assertEqual(same_fact.candidates("Special Civil Suit No. 17/2005 was decreed on 02/09/2006.", saved), [])

    def test_a_suit_number_in_common_does_not_make_another_event_in_that_suit_the_same(self) -> None:
        saved = [line("d1", "12 Jul 2005: Special Civil Suit No. 17/2005 instituted")]
        for text in (
            "The Written Statement (Exhibit 48) was filed by the defendants in Special Civil Suit No. 17/2005.",
            "Advocate A.G. Gujrathi represented the petitioner in Special Civil Suit No. 17/2005.",
        ):
            with self.subTest(text=text):
                self.assertEqual(same_fact.candidates(text, saved), [])

    def test_the_same_date_with_nothing_else_in_common_is_not_enough(self) -> None:
        saved = [line("d1", "Filed on 2025-05-26", tag="stated")]
        self.assertEqual(same_fact.candidates("26 May 2025: Writ petition verified by petitioner Mirza Baig", saved), [])

    def test_people_are_compared_by_name_only_among_the_parties(self) -> None:
        respondent = line("p1", "Respondent: The Tahsildar, Nandurbar", section="parties", tag="stated")
        self.assertEqual(
            same_fact.candidates("Respondent No. 3 is the Tahsildar, Nandurbar, at the Tahsildar Office", [respondent], section="parties"),
            [respondent],
        )
        self.assertEqual(
            same_fact.candidates("The petitioner paid 2% Nazrana to the Tahsildar, Nandurbar", [respondent], section="facts"), []
        )

    def test_one_shared_place_does_not_make_two_offices_the_same_party(self) -> None:
        collector = line("p1", "Respondent: The Collector, Nandurbar", section="parties", tag="stated")
        self.assertEqual(
            same_fact.candidates("Respondent No. 3 is the Tahsildar, Nandurbar", [collector], section="parties"), []
        )

    def test_at_most_three_candidates_most_likely_first(self) -> None:
        saved = [line(f"d{i}", f"25 Aug 2006: sale deed note {i}") for i in range(5)]
        saved.append(line("best", "25 Aug 2006: Registered Sale Deed No. 4401/2006 executed"))
        found = same_fact.candidates(DEED_FACT, saved)
        self.assertEqual(len(found), 3)
        self.assertEqual(found[0]["id"], "best")


class MergeCheckTests(unittest.TestCase):
    ORIGINALS = [DEED_SEED, DEED_FACT]

    def test_a_merge_that_keeps_everything_passes(self) -> None:
        self.assertTrue(same_fact.keeps_everything(DEED_MERGED, self.ORIGINALS))

    def test_a_merge_that_loses_or_invents_a_number_date_or_name_fails(self) -> None:
        for merged in (
            "25 Aug 2006: Registered sale deed executed in favour of petitioner",  # lost the deed number
            "25 Aug 2006: Registered Sale Deed No. 4401/2007 executed in favour of petitioner",  # changed it
            "26 Aug 2006: Registered Sale Deed No. 4401/2006 executed in favour of petitioner",  # moved the date
            "25 Aug 2006: Registered Sale Deed No. 4401/2006 executed in favour of petitioner for Rs. 90,000",
            "25 Aug 2006: Registered Sale Deed No. 4401/2006 executed in favour of petitioner Ramesh Pawar",
        ):
            with self.subTest(merged=merged):
                self.assertFalse(same_fact.keeps_everything(merged, self.ORIGINALS))

    def test_a_merge_that_adds_a_negation_fails(self) -> None:
        self.assertFalse(
            same_fact.keeps_everything("25 Aug 2006: Registered Sale Deed No. 4401/2006 not executed in favour of petitioner", self.ORIGINALS)
        )

    def test_a_merge_that_drops_most_of_a_lines_words_fails(self) -> None:
        self.assertFalse(same_fact.keeps_everything("25 Aug 2006: No. 4401/2006", self.ORIGINALS))

    def test_a_merge_longer_than_a_line_fails(self) -> None:
        self.assertFalse(same_fact.keeps_everything(DEED_MERGED + " " + "and so on " * 30, self.ORIGINALS))

    def test_the_saved_line_is_kept_when_it_already_says_everything(self) -> None:
        saved = "25 Aug 2006: Registered Sale Deed No. 4401/2006 executed in favour of petitioner"
        self.assertEqual(same_fact.best_merge(saved, DEED_FACT, "something unusable"), saved)

    def test_the_new_line_is_kept_when_it_says_everything(self) -> None:
        self.assertEqual(same_fact.best_merge("25 Aug 2006: Sale deed executed", DEED_FACT, None), DEED_FACT)

    def test_no_merge_when_nothing_safe_is_offered(self) -> None:
        self.assertIsNone(same_fact.best_merge(DEED_SEED, DEED_FACT, "25 Aug 2006: Sale deed"))

    def test_a_saved_lines_earlier_value_stays_on_it(self) -> None:
        saved = DEED_SEED + " (earlier: 24 Aug 2006: Sale deed; updated 2026-09-11)"
        merged = same_fact.best_merge(saved, DEED_FACT, DEED_MERGED)
        self.assertEqual(merged, DEED_MERGED + " (earlier: 24 Aug 2006: Sale deed; updated 2026-09-11)")

    def test_a_saved_line_covers_a_shorter_way_of_saying_it(self) -> None:
        self.assertTrue(same_fact.covers(DEED_MERGED, DEED_SEED))
        self.assertFalse(same_fact.covers(DEED_SEED, DEED_FACT))  # the deed number is not in it


class SourceTests(unittest.TestCase):
    def test_a_merged_seed_line_remembers_what_seeding_wrote_and_every_source(self) -> None:
        added = {"kind": "answer", "document": "Deed.pdf", "page": 2, "chat_id": "c-1", "session_id": "s-1"}
        ref = same_fact.merged_source_ref(SEED_REF, added, saved_text=DEED_SEED)
        self.assertEqual((ref["kind"], ref["source"], ref["document"]), ("seed", "chronology:2006-08-25", "Petition.pdf"))
        self.assertEqual(ref["seed_text"], DEED_SEED)
        self.assertEqual(ref["also"], [added])
        again = same_fact.merged_source_ref(ref, {**added, "chat_id": "c-2"}, saved_text=DEED_MERGED)
        self.assertEqual(again["seed_text"], DEED_SEED)  # set once, from the seeded text
        self.assertEqual(len(again["also"]), 1)  # the same document and page is not listed twice
        self.assertEqual(again["merged"], 2)

    def test_a_line_without_a_document_takes_the_new_one(self) -> None:
        ref = same_fact.merged_source_ref({"kind": "chat"}, {"kind": "answer", "document": "Deed.pdf", "page": 2})
        self.assertEqual((ref["kind"], ref["document"], ref["page"]), ("chat", "Deed.pdf", 2))


class SectionTests(unittest.TestCase):
    def test_something_that_happened_on_a_date_goes_with_the_dates(self) -> None:
        self.assertEqual(same_fact.dated_section("documents", DEED_FACT), "dates")
        self.assertEqual(same_fact.dated_section("facts", "The petitioner deposited Rs. 1,53,600 on 17/04/2015."), "dates")

    def test_a_document_named_by_its_date_stays_with_the_documents(self) -> None:
        text = "The Maharashtra Government Gazette dated 01/01/2016 sets the time for industrial use."
        self.assertEqual(same_fact.dated_section("documents", text), "documents")

    def test_undated_facts_and_parties_stay_where_they_are(self) -> None:
        self.assertEqual(same_fact.dated_section("facts", "Gat No. 111/3 measures 6 H. 40 R."), "facts")
        self.assertEqual(same_fact.dated_section("parties", "Respondent No. 4 died on 12/03/2019"), "parties")


class JudgementTests(unittest.TestCase):
    ITEMS = [(DEED_FACT, [line("d1", "a"), line("d2", "b")]), ("Another fact", [line("d3", "c")])]

    def test_letters_name_the_saved_line(self) -> None:
        payload = json.dumps({"items": [{"item": 1, "same_as": "B", "merged": " 25 Aug  2006: x "}, {"item": 2, "same_as": None}]})
        first, second = same_fact.parse_judgements(payload, self.ITEMS)
        self.assertEqual((first.same_as["id"], first.merged), ("d2", "25 Aug 2006: x"))
        self.assertIsNone(second.same_as)

    def test_an_unknown_letter_or_a_missing_item_is_not_the_same(self) -> None:
        payload = "```json\n" + json.dumps({"items": [{"item": 1, "same_as": "C", "merged": "x"}]}) + "\n```"
        self.assertEqual([j.same_as for j in same_fact.parse_judgements(payload, self.ITEMS)], [None, None])

    def test_output_that_is_not_json_raises(self) -> None:
        with self.assertRaises(ValueError):
            same_fact.parse_judgements("I think they are the same.", self.ITEMS)

    def test_the_request_shows_each_new_line_with_lettered_saved_lines(self) -> None:
        request = same_fact.build_request(self.ITEMS)
        self.assertIn("ITEM 1\nNEW: " + DEED_FACT + "\nSAVED:\nA: a\nB: b", request)
        self.assertIn("ITEM 2\nNEW: Another fact\nSAVED:\nA: c", request)


class TidyPlanTests(unittest.TestCase):
    AGREEMENT = "25 Nov 2004: Agreement of sale executed for Gat No. 111/3"
    CONTRACT = "A contract for sale of land was executed on 25/11/2004 between the petitioner and Ragho Shambhu Jagdev and others."
    CONSIDERATION = (
        "The petitioner entered into an Agreement of Sale for Gat No. 111/3 on 25/11/2004 for a consideration of Rs. 2,13,000/-."
    )
    FIRST_MERGE = (
        "25 Nov 2004: Agreement of sale executed for Gat No. 111/3 between the petitioner and Ragho Shambhu Jagdev and others."
    )
    SECOND_MERGE = (
        "25 Nov 2004: Agreement of sale executed for Gat No. 111/3 between the petitioner and Ragho Shambhu Jagdev and "
        "others for a consideration of Rs. 2,13,000/-."
    )

    def sections(self, *lines):
        out: dict = {}
        for item in lines:
            out.setdefault(item["section"], []).append(item)
        return out

    def test_three_lines_for_one_agreement_become_one(self) -> None:
        sections = self.sections(
            line("seed", self.AGREEMENT, ref={"kind": "seed", "source": "chronology:2004-11-25", "document": "P.pdf", "page": "1"}, created="2026-09-14"),
            line("a1", self.CONTRACT, ref={"kind": "answer", "document": "P.pdf", "page": 3}, created="2026-09-17 12:13"),
            line("a2", self.CONSIDERATION, ref={"kind": "answer", "document": "P.pdf", "page": 22}, created="2026-09-17 12:14"),
        )
        fake = judge_that({"contract for sale": ("Agreement of sale", self.FIRST_MERGE), "consideration": ("Agreement of sale", self.SECOND_MERGE)})
        plan = same_fact.plan_tidy(sections, judge_fn=fake)
        self.assertEqual(len(plan.merges), 1)
        merge = plan.merges[0]
        self.assertEqual((merge["line"]["id"], merge["line"]["text"], merge["text"]), ("seed", self.AGREEMENT, self.SECOND_MERGE))
        self.assertEqual([item["id"] for item in merge["absorbed"]], ["a1", "a2"])
        self.assertEqual(merge["source_ref"]["seed_text"], self.AGREEMENT)
        self.assertEqual([item["page"] for item in merge["source_ref"]["also"]], [3, 22])
        self.assertEqual((plan.removals, plan.moves, plan.unmerged), ([], [], []))

    def test_a_document_fact_repeating_what_the_advocate_stated_is_removed(self) -> None:
        stated = line("p1", "Petitioner: Hitesh s/o Balkrushna Lahoti; counsel A.D. Soman", section="parties", tag="stated", created="2026-09-14")
        repeat = line("p2", "The petitioner is Hitesh s/o Balkrushna Lahoti, aged 45 years", section="parties", ref={"kind": "answer"}, created="2026-09-17")
        plan = same_fact.plan_tidy(self.sections(stated, repeat), judge_fn=judge_that({"aged 45": ("Petitioner:", "unused")}))
        self.assertEqual([(item["line"]["id"], item["kept"]["id"]) for item in plan.removals], [("p2", "p1")])
        self.assertEqual(plan.merges, [])

    def test_two_lines_the_advocate_stated_are_never_sent_to_the_model(self) -> None:
        first = line("s1", "Case: Jadhav & Others vs State of Maharashtra", section="summary", tag="stated")
        second = line("s2", "Petitioner: Jadhav & Others", section="parties", tag="stated")
        fake = judge_that({})
        plan = same_fact.plan_tidy(self.sections(first, second), judge_fn=fake)
        self.assertFalse(plan.changed)
        self.assertEqual(fake.calls, [])

    def test_a_merge_that_fails_the_check_keeps_both_lines(self) -> None:
        sections = self.sections(
            line("d1", DEED_SEED, created="2026-09-14"),
            line("d2", DEED_FACT, section="documents", ref={"kind": "answer"}, created="2026-09-17"),
        )
        plan = same_fact.plan_tidy(sections, judge_fn=judge_that({"4401/2006": ("Registered sale deed", "25 Aug 2006: deed")}))
        self.assertEqual((plan.merges, plan.removals), ([], []))
        self.assertEqual(len(plan.unmerged), 1)
        # Kept apart, the dated fact from an answer still moves to the dates.
        self.assertEqual([(item["line"]["id"], item["to"]) for item in plan.moves], [("d2", "dates")])

    def test_a_later_stated_line_replaces_a_merged_document_fact_and_what_was_merged_into_it(self) -> None:
        sections = self.sections(
            line("d1", DEED_SEED, created="2026-09-14"),
            line("d2", DEED_FACT, section="documents", ref={"kind": "answer"}, created="2026-09-15"),
            line("s1", "The sale deed No. 4401/2006 was registered on 25/08/2006 in my client's name", section="facts", tag="stated", created="2026-09-16"),
        )
        fake = judge_that({"4401/2006 was executed": ("Registered sale deed", DEED_MERGED), "my client": ("Registered Sale Deed No. 4401/2006", None)})
        plan = same_fact.plan_tidy(sections, judge_fn=fake)
        self.assertEqual(plan.merges, [])
        self.assertEqual(sorted(item["line"]["id"] for item in plan.removals), ["d1", "d2"])
        self.assertEqual({item["line"]["id"]: item["line"]["text"] for item in plan.removals}["d1"], DEED_SEED)

    def test_the_plan_reads_as_what_changed(self) -> None:
        sections = self.sections(
            line("d1", DEED_SEED, created="2026-09-14"),
            line("d2", DEED_FACT, section="documents", ref={"kind": "answer"}, created="2026-09-17"),
        )
        plan = same_fact.plan_tidy(sections, judge_fn=judge_that({"4401/2006": ("Registered sale deed", DEED_MERGED)}))
        described = same_fact.describe_plan(plan)
        self.assertEqual(described["merged"], [{"section": "dates", "text": DEED_MERGED, "from": [DEED_SEED, DEED_FACT]}])
        self.assertEqual((described["removed"], described["moved"]), ([], []))


class ApplyTidyTests(unittest.TestCase):
    def test_only_lines_unchanged_since_the_plan_are_rewritten_in_one_call(self) -> None:
        sections = {
            "dates": [line("d1", DEED_SEED, created="2026-09-14")],
            "documents": [line("d2", DEED_FACT, section="documents", ref={"kind": "answer"}, created="2026-09-17")],
        }
        plan = same_fact.plan_tidy(sections, judge_fn=judge_that({"4401/2006": ("Registered sale deed", DEED_MERGED)}))
        with patch.object(repository, "rewrite_lines", return_value={"updated": 1, "deleted": 1, "moved": 0, "skipped": 0}) as rewrite:
            same_fact.apply_tidy("273", plan)
        kwargs = rewrite.call_args.kwargs
        self.assertEqual(
            [(u["id"], u["expected_text"], u["text"]) for u in kwargs["updates"]], [("d1", DEED_SEED, DEED_MERGED)]
        )
        self.assertEqual(kwargs["deletes"], [{"id": "d2", "expected_text": DEED_FACT}])
        self.assertEqual(kwargs["moves"], [])

    def test_a_dry_run_writes_nothing_and_an_applied_tidy_is_logged(self) -> None:
        stored = {
            "dates": {"lines": [line("d1", DEED_SEED, created="2026-09-14")]},
            "documents": {"lines": [line("d2", DEED_FACT, section="documents", ref={"kind": "answer"}, created="2026-09-17")]},
        }
        fake = judge_that({"4401/2006": ("Registered sale deed", DEED_MERGED)})
        with patch.object(repository, "get_sections", return_value=stored), \
                patch.object(repository, "rewrite_lines", return_value={"updated": 1, "deleted": 1, "moved": 0, "skipped": 0}) as rewrite, \
                patch.object(repository, "write_assembly_log") as log:
            dry = same_fact.tidy_case("273", user_id="65", judge_fn=fake)
            rewrite.assert_not_called()
            log.assert_not_called()
            self.assertEqual(dry["merged"][0]["text"], DEED_MERGED)
            done = same_fact.tidy_case("273", user_id="65", apply=True, judge_fn=fake)
        self.assertEqual(done["written"]["deleted"], 1)
        entry = log.call_args.args[0]
        self.assertEqual((entry["mode"], entry["user_id"], entry["writes"]), ("tidy", "65", 2))
        self.assertEqual(entry["details"]["merged"][0]["from"], [DEED_SEED, DEED_FACT])


class FakeCursor:
    """Just enough of a cursor for `rewrite_lines`."""

    def __init__(self, lines: dict[str, dict], executed: list) -> None:
        self.lines, self.executed, self._row = lines, executed, None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None

    def execute(self, sql, params=()):
        text = " ".join(sql.split())
        self.executed.append((text, list(params)))
        low, self._row = text.lower(), None
        if low.startswith("update case_memory_lines set text"):
            body, ref, line_id, key, expected = params
            row = self.lines.get(line_id)
            if row and row["case_key"] == key and row["text"] == expected:
                row["text"], row["source_ref"] = body, json.loads(ref)
                self._row = {"section": row["section"]}
        elif low.startswith("delete from case_memory_lines"):
            line_id, key, expected = params
            row = self.lines.get(line_id)
            if row and row["case_key"] == key and row["text"] == expected:
                del self.lines[line_id]
                self._row = {"section": row["section"]}
        elif low.startswith("select section from case_memory_lines"):
            row = self.lines.get(params[0])
            self._row = {"section": row["section"]} if row and row["case_key"] == params[1] else None
        elif low.startswith("insert into case_memory_sections"):
            self._row = None
        elif "select version from case_memory_sections" in low:
            self._row = {"version": 3}
        elif "coalesce(max(ord), 0) + 1" in low:
            self._row = {"next_ord": 9}
        elif low.startswith("update case_memory_lines set section"):
            section, ord_, line_id, _key = params
            self.lines[line_id].update({"section": section, "ord": ord_})

    def fetchone(self):
        return self._row


class FakeConn:
    def __init__(self, lines, executed):
        self.lines, self.executed, self.commits = lines, executed, 0

    def cursor(self):
        return FakeCursor(self.lines, self.executed)

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


class RewriteLinesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.lines = {
            "d1": {"case_key": "273", "section": "dates", "text": DEED_SEED},
            "d2": {"case_key": "273", "section": "documents", "text": DEED_FACT},
            "f1": {"case_key": "273", "section": "facts", "text": "Paid on 17/04/2015"},
        }
        self.executed: list = []
        self.conn = FakeConn(self.lines, self.executed)

    def test_merge_delete_and_move_happen_together_and_bump_every_section_touched(self) -> None:
        counts = repository.rewrite_lines(
            "273",
            updates=[{"id": "d1", "expected_text": DEED_SEED, "text": DEED_MERGED, "source_ref": {"merged": 1}}],
            deletes=[{"id": "d2", "expected_text": DEED_FACT}],
            moves=[{"id": "f1", "section": "dates"}],
            conn=self.conn,
        )
        self.assertEqual(counts, {"updated": 1, "deleted": 1, "moved": 1, "skipped": 0})
        self.assertEqual((self.lines["d1"]["text"], self.lines["f1"]["section"]), (DEED_MERGED, "dates"))
        self.assertNotIn("d2", self.lines)
        bump = next(params for sql, params in self.executed if sql.startswith("UPDATE case_memory_sections"))
        self.assertEqual(bump, ["273", ["dates", "documents", "facts"]])
        self.assertEqual(self.conn.commits, 1)
        for sql, _ in self.executed:
            if not sql.startswith("INSERT"):
                self.assertIn("case_key = %s", sql)

    def test_a_line_changed_since_the_plan_is_left_alone(self) -> None:
        self.lines["d2"]["text"] = "Edited by the advocate"
        counts = repository.rewrite_lines(
            "273",
            updates=[{"id": "d1", "expected_text": "an older text", "text": DEED_MERGED, "source_ref": {}}],
            deletes=[{"id": "d2", "expected_text": DEED_FACT}],
            conn=self.conn,
        )
        self.assertEqual(counts, {"updated": 0, "deleted": 0, "moved": 0, "skipped": 2})
        self.assertEqual((self.lines["d1"]["text"], self.lines["d2"]["text"]), (DEED_SEED, "Edited by the advocate"))
        self.assertFalse(any(sql.startswith("UPDATE case_memory_sections") for sql, _ in self.executed))


class SeedTests(unittest.TestCase):
    def candidate(self, text: str = DEED_SEED) -> SeedCandidate:
        return SeedCandidate(section="dates", tag="extracted", text=text, source="chronology:2006-08-25", document="Petition.pdf", page="3")

    def test_a_chronology_line_memory_already_holds_in_fuller_words_is_not_added(self) -> None:
        existing = {"documents": [{"id": "a1", "tag": "extracted", "text": DEED_MERGED, "source_ref": {"kind": "answer"}}]}
        plan = plan_seed([self.candidate()], existing)
        self.assertEqual(plan.added_count, 0)
        self.assertEqual(plan.skipped[0]["reason"], "same_fact")

    def test_a_chronology_line_that_says_more_is_still_added(self) -> None:
        existing = {"dates": [{"id": "a1", "tag": "extracted", "text": "25 Aug 2006: Sale deed", "source_ref": {"kind": "answer"}}]}
        plan = plan_seed([self.candidate("25 Aug 2006: Sale deed No. 4401/2006 executed at Nandurbar")], existing)
        self.assertEqual(plan.added_count, 1)

    def test_a_seeded_line_merged_with_an_answer_is_not_written_back(self) -> None:
        merged = {"id": "d1", "tag": "extracted", "text": DEED_MERGED, "source_ref": {**SEED_REF, "seed_text": DEED_SEED}}
        plan = plan_seed([self.candidate()], {"dates": [merged]})
        self.assertEqual((plan.updates, plan.skipped[0]["reason"]), ([], "already_seeded"))

    def test_a_seeded_line_merged_with_an_answer_still_follows_a_real_change(self) -> None:
        merged = {"id": "d1", "tag": "extracted", "text": DEED_MERGED, "source_ref": {**SEED_REF, "seed_text": DEED_SEED}}
        plan = plan_seed([self.candidate("25 Aug 2006: Sale deed cancelled by the Sub-Registrar")], {"dates": [merged]})
        self.assertEqual(len(plan.updates), 1)


class WriterTests(unittest.TestCase):
    """A fact from an answer that memory already holds in other words."""

    FACT = answer_facts_mod.AnswerFact(section="documents", text=DEED_FACT, document="FIR 45-2026.pdf")

    def ask(self, stored, **kwargs):
        facts = kwargs.pop("facts", [self.FACT])
        support = writer_tests.AnswerFactTests.SUPPORT
        return writer_tests.AnswerFactTests().ask(answer_facts=facts, answer_support=support, stored=stored, **kwargs)

    def stored(self, tag="extracted", ref=None):
        return {"dates": {"version": 4, "lines": [{"id": "d1", "tag": tag, "text": DEED_SEED, "source_ref": dict(ref or SEED_REF)}]}}

    def test_it_is_merged_into_the_line_that_holds_it(self) -> None:
        report, mocks = self.ask(self.stored(), same_judge=judge_that({"4401/2006": ("Registered sale deed", DEED_MERGED)}))
        mocks["apply_op"].assert_called_once()
        resolved = mocks["apply_op"].call_args.args[1]
        self.assertEqual((resolved.op, resolved.section, resolved.line_id, resolved.text), ("replace_line", "dates", "d1", DEED_MERGED))
        self.assertEqual(mocks["apply_op"].call_args.args[2], 4)  # under the section's version token
        ref = resolved.source_ref
        self.assertEqual((ref["kind"], ref["source"], ref["seed_text"]), ("seed", "chronology:2006-08-25", DEED_SEED))
        self.assertEqual((ref["also"][0]["document"], ref["also"][0]["page"]), ("FIR 45-2026.pdf", 2))
        note = report.details["lines"][0]
        self.assertEqual((note["updated"], note["merged_from"], note["text"]), (True, DEED_SEED, DEED_MERGED))
        self.assertEqual(report.writes, 1)

    def test_a_line_the_advocate_stated_is_never_rewritten_and_the_repeat_is_not_added(self) -> None:
        report, mocks = self.ask(self.stored(tag="stated", ref={"kind": "chat"}), same_judge=judge_that({"4401/2006": ("Registered sale deed", DEED_MERGED)}))
        mocks["apply_op"].assert_not_called()
        self.assertIn("answer_fact_known", report.rejection_codes)

    def test_a_merge_that_fails_the_check_writes_nothing(self) -> None:
        report, mocks = self.ask(self.stored(), same_judge=judge_that({"4401/2006": ("Registered sale deed", "25 Aug 2006: deed")}))
        mocks["apply_op"].assert_not_called()
        self.assertIn("answer_fact_not_merged", report.rejection_codes)

    def test_when_the_model_cannot_compare_the_fact_is_not_kept(self) -> None:
        report, mocks = self.ask(self.stored(), same_judge=RuntimeError("quota"))
        mocks["apply_op"].assert_not_called()
        self.assertIn("answer_fact_not_merged", report.rejection_codes)

    def test_a_different_fact_is_added_and_a_dated_one_goes_with_the_dates(self) -> None:
        report, mocks = self.ask(self.stored())  # the model says it is not the same fact
        resolved = mocks["apply_op"].call_args.args[1]
        self.assertEqual((resolved.op, resolved.section, resolved.text), ("append_line", "dates", DEED_FACT))
        self.assertEqual(mocks["same_judge"].call_count, 1)

    def test_a_fact_with_nothing_like_it_in_memory_costs_no_model_call(self) -> None:
        stored = {"facts": {"version": 1, "lines": [{"id": "f1", "tag": "extracted", "text": "Gat No. 111/3 measures 6 H. 40 R."}]}}
        _, mocks = self.ask(stored)
        mocks["same_judge"].assert_not_called()
        mocks["apply_op"].assert_called_once()

    def test_a_second_fact_in_the_same_answer_merges_into_the_line_the_first_added(self) -> None:
        first = answer_facts_mod.AnswerFact(section="dates", text="FIR No. 45/2026 was registered on 14/03/2026", document="FIR 45-2026.pdf")
        second = answer_facts_mod.AnswerFact(
            section="dates", text="On 14/03/2026 FIR No. 45/2026 was registered at Kranti Chowk police station", document="FIR 45-2026.pdf"
        )
        merged = "FIR No. 45/2026 was registered on 14/03/2026 at Kranti Chowk police station"
        report, mocks = self.ask({}, facts=[first, second], same_judge=judge_that({"Kranti Chowk": ("FIR No. 45/2026", merged)}))
        calls = [call.args[1] for call in mocks["apply_op"].call_args_list]
        self.assertEqual([(c.op, c.line_id) for c in calls], [("append_line", None), ("replace_line", "new-1")])
        self.assertEqual(calls[1].text, merged)
        self.assertEqual(calls[1].source_ref["document"], "FIR 45-2026.pdf")

    def test_an_earlier_turn_read_again_may_merge_since_nothing_is_lost(self) -> None:
        from tests.test_memory_reread import earlier

        _, mocks = self.ask(self.stored(), same_judge=judge_that({"4401/2006": ("Registered sale deed", DEED_MERGED)}), turn_overrides=earlier())
        self.assertEqual(mocks["apply_op"].call_args.args[1].op, "replace_line")

    def test_a_line_changed_meanwhile_is_left_alone(self) -> None:
        def conflict(key, resolved, expected=None, actor=None, folder_name=None, source_ref_extra=None):
            raise VersionConflict("dates", expected, 5, [{"id": "d1", "tag": "extracted", "text": "Edited by the advocate"}])

        report, mocks = self.ask(self.stored(), apply=conflict, same_judge=judge_that({"4401/2006": ("Registered sale deed", DEED_MERGED)}))
        self.assertEqual(mocks["apply_op"].call_count, 1)
        self.assertIn("version_conflict", report.rejection_codes)

    def test_another_line_of_the_section_changing_does_not_stop_the_merge(self) -> None:
        attempts = []

        def busy(key, resolved, expected=None, actor=None, folder_name=None, source_ref_extra=None):
            attempts.append(expected)
            if len(attempts) == 1:
                raise VersionConflict("dates", expected, 5, [{"id": "d1", "tag": "extracted", "text": DEED_SEED}, {"id": "d9", "text": "new"}])
            return {"section": "dates", "version": 6, "line_id": "d1"}

        report, _ = self.ask(self.stored(), apply=busy, same_judge=judge_that({"4401/2006": ("Registered sale deed", DEED_MERGED)}))
        self.assertEqual(attempts, [4, 5])
        self.assertEqual(report.writes, 1)

    def test_a_sensitive_fact_is_dropped_before_anything_is_compared(self) -> None:
        fact = answer_facts_mod.AnswerFact(section="facts", text="The accused was treated at Civil Hospital on 12/03/2026", document="FIR 45-2026.pdf", sensitive=True)
        report, mocks = self.ask(self.stored(), facts=[fact], settings=MemorySettings(sensitive_enabled=False))
        mocks["same_judge"].assert_not_called()
        mocks["answer_support"].assert_not_called()
        self.assertIn("sensitive_disabled", report.rejection_codes)


class ActivityTests(unittest.TestCase):
    def test_a_tidy_reads_as_combining_repeats(self) -> None:
        entry = activity.describe({
            "id": "t1", "mode": "tidy", "created_at": None,
            "details": {
                "merged": [{"section": "dates", "text": DEED_MERGED, "from": [DEED_SEED, DEED_FACT]}],
                "removed": [{"section": "parties", "text": "The petitioner is Hitesh", "kept": "Petitioner: Hitesh"}],
                "moved": [{"text": "Paid on 17/04/2015", "from": "facts", "to": "dates"}],
            },
        })
        self.assertEqual((entry["outcome"], entry["headline"]), ("saved", "Combined facts memory held more than once"))
        self.assertEqual([item["kind"] for item in entry["items"]], ["merged", "removed_repeat", "moved"])
        self.assertEqual((entry["items"][0]["count"], entry["items"][0]["section_label"]), (2, "Dates"))
        self.assertEqual(entry["items"][2]["to_label"], "Dates")

    def test_a_fact_merged_during_a_turn_says_what_it_joined(self) -> None:
        entry = activity.describe({
            "id": "l1", "mode": "chat", "created_at": None,
            "details": {"lines": [{"section": "dates", "text": DEED_MERGED, "updated": True, "merged_from": DEED_SEED, "document": "Deed.pdf", "page": 2}]},
        })
        self.assertEqual(entry["items"][0]["merged_from"], DEED_SEED)
        self.assertEqual(entry["headline"], "Saved 1 fact")


if __name__ == "__main__":
    unittest.main()
