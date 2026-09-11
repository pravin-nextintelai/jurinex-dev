"""Seeding memory from case creation: what becomes a line, idempotence, dedupe."""
from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

from app.schemas.chronology import ChronologyDateNode, ChronologyEvent, ChronologyTree
from app.services.memory import seed as seed_mod
from app.services.memory.schemas import MemorySettings
from app.services.memory.seed import (
    SEED_KIND,
    candidates_from_case_row,
    candidates_from_chronology,
    candidates_from_files,
    plan_seed,
    seed_case_memory,
)

CASE_ROW = {
    "id": 512,
    "case_title": "State v. Pawar",
    "case_number": "CS-2026-0412",
    "court_name": "Sessions Court Chhatrapati Sambhajinagar",
    "bench_division": "Court No. 4",
    "case_type": "Criminal",
    "sub_type": "Bail",
    "jurisdiction": "Maharashtra",
    "status": "Active",
    "filing_date": date(2026, 8, 25),
    "next_hearing_date": "2026-10-14",
    # Stored as JSON text by the create-case insert.
    "petitioners": '[{"fullName": "Sunil Pawar", "advocateName": "Adv. R. Kulkarni", "role": "Individual"}]',
    "respondents": [{"fullName": "State of Maharashtra"}],
    "judges": None,
}

TREE = {
    "dates": [
        {
            "date": "2019-01-15",
            "displayDate": "15 Jan 2019",
            "events": [{"title": "Agreement executed", "sourceDocument": "plaint.pdf", "sourcePage": "3"}],
        },
        {
            "date": "2020-06-20",
            "displayDate": "20 Jun 2020",
            "events": [{"title": "Demand notice issued", "sourceDocument": ""}],
        },
        {
            "date": "2021-01-10",
            "displayDate": "10 Jan 2021",
            "summary": "Suit filed",
            "events": [{"title": "", "sourceDocument": "Plaint.pdf"}],
        },
    ]
}

FILES = [
    {"id": "f1", "name": "Plaint.pdf", "summary": "Suit for recovery of Rs. 38 lakh. Filed by the plaintiff."},
    {"id": "f2", "name": "Notice.pdf", "summary": ""},
    {"id": "d1", "name": "Evidence", "is_folder": True},
    {"id": "f1", "name": "Plaint.pdf", "summary": "the same file listed twice"},
]


def by_source(candidates):
    return {c.source: c for c in candidates}


class CaseRowTests(unittest.TestCase):
    def test_confirmed_form_fields_seed_as_stated(self) -> None:
        candidates = candidates_from_case_row(CASE_ROW)
        self.assertTrue(candidates)
        self.assertTrue(all(c.tag == "stated" for c in candidates))

    def test_summary_lines_carry_the_case_identity(self) -> None:
        found = by_source(candidates_from_case_row(CASE_ROW))
        self.assertEqual(found["cases_row:case_title"].text, "Case: State v. Pawar")
        self.assertEqual(found["cases_row:case_number"].text, "Case number: CS-2026-0412")
        self.assertEqual(
            found["cases_row:court"].text, "Court: Sessions Court Chhatrapati Sambhajinagar, Court No. 4"
        )
        self.assertEqual(found["cases_row:case_type"].text, "Matter type: Criminal / Bail")
        self.assertEqual(found["cases_row:case_title"].section, "summary")

    def test_parties_parse_from_json_text_and_lists(self) -> None:
        parties = [c for c in candidates_from_case_row(CASE_ROW) if c.section == "parties"]
        texts = sorted(c.text for c in parties)
        self.assertEqual(
            texts,
            ["Petitioner: Sunil Pawar; counsel Adv. R. Kulkarni", "Respondent: State of Maharashtra"],
        )

    def test_dates_are_formatted_whatever_type_the_row_holds(self) -> None:
        found = by_source(candidates_from_case_row(CASE_ROW))
        self.assertEqual(found["cases_row:filing_date"].text, "Filed on 2026-08-25")
        self.assertEqual(found["cases_row:next_hearing_date"].text, "Next hearing: 2026-10-14")
        self.assertEqual(found["cases_row:next_hearing_date"].section, "dates")

    def test_camel_case_rows_are_understood(self) -> None:
        found = by_source(candidates_from_case_row({"caseTitle": "Ambika v. Dwarkadas", "nextHearingDate": "2026-11-02"}))
        self.assertEqual(found["cases_row:case_title"].text, "Case: Ambika v. Dwarkadas")
        self.assertIn("cases_row:next_hearing_date", found)

    def test_blank_and_placeholder_values_are_skipped(self) -> None:
        candidates = candidates_from_case_row({"case_title": "None", "case_number": "  ", "status": "N/A"})
        self.assertEqual(candidates, [])

    def test_no_row_means_no_candidates(self) -> None:
        self.assertEqual(candidates_from_case_row(None), [])


class ChronologyTests(unittest.TestCase):
    def test_grounded_dates_seed_as_extracted_with_their_document(self) -> None:
        found = by_source(candidates_from_chronology(TREE))
        agreement = found["chronology:2019-01-15"]
        self.assertEqual(agreement.tag, "extracted")
        self.assertEqual(agreement.text, "15 Jan 2019: Agreement executed")
        self.assertEqual(agreement.document, "plaint.pdf")
        self.assertEqual(agreement.page, "3")
        self.assertEqual(agreement.source_ref()["kind"], SEED_KIND)

    def test_an_ungrounded_date_is_not_seeded(self) -> None:
        self.assertNotIn("chronology:2020-06-20", by_source(candidates_from_chronology(TREE)))

    def test_node_summary_stands_in_for_an_empty_title(self) -> None:
        found = by_source(candidates_from_chronology(TREE))
        self.assertEqual(found["chronology:2021-01-10"].text, "10 Jan 2021: Suit filed")

    def test_only_the_most_recent_dates_are_kept(self) -> None:
        candidates = candidates_from_chronology(TREE, max_dates=1)
        self.assertEqual([c.source for c in candidates], ["chronology:2021-01-10"])

    def test_a_chronology_model_is_accepted(self) -> None:
        tree = ChronologyTree(
            dates=[
                ChronologyDateNode(
                    date="2026-08-22",
                    displayDate="22 Aug 2026",
                    events=[ChronologyEvent(title="Accused arrested", sourceDocument="FIR.pdf", sourcePage="1")],
                )
            ]
        )
        self.assertEqual(candidates_from_chronology(tree)[0].text, "22 Aug 2026: Accused arrested")

    def test_an_empty_tree_is_safe(self) -> None:
        self.assertEqual(candidates_from_chronology(None), [])
        self.assertEqual(candidates_from_chronology({"dates": []}), [])


class FileTests(unittest.TestCase):
    def test_one_index_line_per_document_with_a_first_sentence_gist(self) -> None:
        candidates = candidates_from_files(FILES)
        self.assertEqual([c.source for c in candidates], ["file:f1", "file:f2"])
        plaint = candidates[0]
        # "Rs. 38" must not be mistaken for the end of the sentence.
        self.assertEqual(plaint.text, "Plaint.pdf: Suit for recovery of Rs. 38 lakh.")
        self.assertEqual(plaint.document, "Plaint.pdf")
        self.assertEqual(plaint.fallback_text, "Plaint.pdf")

    def test_a_document_without_a_summary_is_just_its_name(self) -> None:
        notice = candidates_from_files(FILES)[1]
        self.assertEqual(notice.text, "Notice.pdf")
        self.assertIsNone(notice.fallback_text)

    def test_markdown_in_a_generated_summary_is_stripped(self) -> None:
        candidate = candidates_from_files([{"id": "x", "name": "Order.pdf", "summary": "## **Bail granted** on conditions"}])[0]
        self.assertEqual(candidate.text, "Order.pdf: Bail granted on conditions")


class PlanTests(unittest.TestCase):
    def test_everything_new_is_added_to_its_section(self) -> None:
        candidates = candidates_from_case_row(CASE_ROW) + candidates_from_chronology(TREE) + candidates_from_files(FILES)
        plan = plan_seed(candidates, {}, doc_names=["Plaint.pdf", "Notice.pdf"])
        self.assertEqual(plan.skipped, [])
        self.assertEqual(len(plan.additions["parties"]), 2)
        self.assertEqual(len(plan.additions["documents"]), 2)
        self.assertIn("summary", plan.additions)
        self.assertEqual(plan.added_count, len(candidates))

    def test_an_unchanged_seeded_fact_is_not_written_twice(self) -> None:
        candidates = candidates_from_case_row({"next_hearing_date": "2026-10-14"})
        existing = {
            "dates": [
                {
                    "id": "l1",
                    "tag": "stated",
                    "text": "Next hearing: 2026-10-14",
                    "source_ref": {"kind": SEED_KIND, "source": "cases_row:next_hearing_date"},
                }
            ]
        }
        plan = plan_seed(candidates, existing)
        self.assertEqual(plan.additions, {})
        self.assertEqual(plan.updates, [])
        self.assertEqual(plan.skipped[0]["reason"], "already_seeded")

    def test_a_changed_seeded_fact_is_updated_with_its_earlier_value(self) -> None:
        candidates = candidates_from_case_row({"next_hearing_date": "2026-10-14"})
        existing = {
            "dates": [
                {
                    "id": "l1",
                    "tag": "stated",
                    "text": "Next hearing: 2026-09-01",
                    "source_ref": {"kind": SEED_KIND, "source": "cases_row:next_hearing_date"},
                }
            ]
        }
        plan = plan_seed(candidates, existing, today=date(2026, 9, 11))
        self.assertEqual(plan.additions, {})
        self.assertEqual(len(plan.updates), 1)
        update = plan.updates[0]
        self.assertEqual(update["line_id"], "l1")
        self.assertEqual(
            update["text"], "Next hearing: 2026-10-14 (earlier: Next hearing: 2026-09-01; updated 2026-09-11)"
        )

    def test_history_does_not_nest_on_a_later_reseed(self) -> None:
        candidates = candidates_from_case_row({"next_hearing_date": "2026-10-14"})
        existing = {
            "dates": [
                {
                    "id": "l1",
                    "tag": "stated",
                    "text": "Next hearing: 2026-10-14 (earlier: Next hearing: 2026-09-01; updated 2026-09-11)",
                    "source_ref": {"kind": SEED_KIND, "source": "cases_row:next_hearing_date"},
                }
            ]
        }
        plan = plan_seed(candidates, existing)
        self.assertEqual(plan.updates, [])
        self.assertEqual(plan.skipped[0]["reason"], "already_seeded")

    def test_a_line_the_advocate_wrote_is_never_duplicated(self) -> None:
        candidates = candidates_from_case_row({"case_number": "CS-2026-0412"})
        existing = {"summary": [{"id": "u1", "tag": "stated", "text": "Case number CS-2026-0412", "source_ref": {"kind": "user"}}]}
        plan = plan_seed(candidates, existing)
        self.assertEqual(plan.additions, {})
        self.assertEqual(plan.updates, [])
        self.assertEqual(plan.skipped[0]["reason"], "duplicate")

    def test_adjacent_dates_are_different_facts(self) -> None:
        tree = {
            "dates": [
                {"date": "2020-01-12", "displayDate": "12 Jan 2020", "events": [{"title": "Notice issued", "sourceDocument": "a.pdf"}]},
                {"date": "2020-01-13", "displayDate": "13 Jan 2020", "events": [{"title": "Notice issued", "sourceDocument": "a.pdf"}]},
            ]
        }
        plan = plan_seed(candidates_from_chronology(tree), {})
        self.assertEqual(len(plan.additions["dates"]), 2)

    def test_a_personal_identifier_is_refused(self) -> None:
        candidates = candidates_from_case_row({"petitioners": [{"fullName": "Ravi Kumar PAN ABCDE1234F"}]})
        plan = plan_seed(candidates, {})
        self.assertEqual(plan.additions, {})
        self.assertEqual(plan.skipped[0]["reason"], "pii_pan")

    def test_a_gist_that_reads_like_an_inference_falls_back_to_the_name(self) -> None:
        candidates = candidates_from_files([{"id": "f9", "name": "Reply.pdf", "summary": "The reply likely concedes delay."}])
        plan = plan_seed(candidates, {}, doc_names=["Reply.pdf"])
        self.assertEqual(plan.additions["documents"][0]["text"], "Reply.pdf")

    def test_a_date_naming_a_document_not_in_the_case_is_refused(self) -> None:
        plan = plan_seed(candidates_from_chronology(TREE), {}, doc_names=["Notice.pdf"])
        self.assertNotIn("dates", plan.additions)
        self.assertTrue(all(s["reason"] == "unknown_document" for s in plan.skipped))

    def test_seeded_lines_record_their_source(self) -> None:
        plan = plan_seed(candidates_from_chronology(TREE), {})
        ref = plan.additions["dates"][0]["source_ref"]
        self.assertEqual(ref["kind"], SEED_KIND)
        self.assertEqual(ref["source"], "chronology:2019-01-15")
        self.assertEqual(ref["document"], "plaint.pdf")
        self.assertEqual(ref["page"], "3")


class SeedWriteTests(unittest.TestCase):
    def _patches(self, *, stored=None, settings=None):
        calls: list[tuple] = []

        def append(key, section, lines, actor=None, folder_name=None):
            calls.append((key, section, list(lines)))
            return {"section": section, "version": 2, "added": len(lines)}

        return calls, [
            patch.object(seed_mod.repository, "available", return_value=True),
            patch.object(seed_mod.repository, "effective_settings", return_value=settings or MemorySettings()),
            patch.object(seed_mod.repository, "get_sections", return_value=stored or {}),
            patch.object(seed_mod.repository, "append_lines", side_effect=append),
            patch.object(seed_mod.repository, "apply_op"),
        ]

    def _run(self, patches, **kwargs):
        for p in patches:
            p.start()
        try:
            return seed_case_memory("512", folder_name="State_v_Pawar", user_id="42", **kwargs)
        finally:
            for p in patches:
                p.stop()

    def test_seeding_writes_every_section_under_the_case_key_only(self) -> None:
        calls, patches = self._patches()
        report = self._run(patches, case_row=CASE_ROW, tree=TREE, files=FILES)
        self.assertGreater(report["added"], 0)
        self.assertIsNone(report["skipped_reason"])
        self.assertEqual({key for key, _, _ in calls}, {"512"})
        self.assertEqual(
            [section for _, section, _ in calls],
            [s for s in ("summary", "parties", "documents", "dates") if any(c[1] == s for c in calls)],
        )

    def test_a_second_run_over_the_same_facts_adds_nothing(self) -> None:
        first_calls, patches = self._patches()
        self._run(patches, case_row=CASE_ROW, tree=TREE, files=FILES)
        stored = {
            section: {"version": 2, "lines": [dict(line, id=f"{section}-{i}") for i, line in enumerate(lines)]}
            for _, section, lines in first_calls
        }
        second_calls, patches = self._patches(stored=stored)
        report = self._run(patches, case_row=CASE_ROW, tree=TREE, files=FILES)
        self.assertEqual(report["added"], 0)
        self.assertEqual(report["updated"], 0)
        self.assertEqual(second_calls, [])

    def test_nothing_is_written_while_memory_generation_is_off(self) -> None:
        calls, patches = self._patches(settings=MemorySettings(write_enabled=False))
        report = self._run(patches, case_row=CASE_ROW)
        self.assertEqual(report["skipped_reason"], "disabled_by_user")
        self.assertEqual(calls, [])

    def test_a_write_failure_never_raises(self) -> None:
        patches = [
            patch.object(seed_mod.repository, "available", return_value=True),
            patch.object(seed_mod.repository, "effective_settings", return_value=MemorySettings()),
            patch.object(seed_mod.repository, "get_sections", return_value={}),
            patch.object(seed_mod.repository, "append_lines", side_effect=RuntimeError("db down")),
        ]
        report = self._run(patches, case_row=CASE_ROW)
        self.assertEqual(report["added"], 0)

    def test_no_case_key_or_database_is_a_clean_skip(self) -> None:
        self.assertEqual(seed_case_memory("", case_row=CASE_ROW)["skipped_reason"], "no_case_key")
        with patch.object(seed_mod.repository, "available", return_value=False):
            self.assertEqual(seed_case_memory("512", case_row=CASE_ROW)["skipped_reason"], "db_unavailable")


if __name__ == "__main__":
    unittest.main()
