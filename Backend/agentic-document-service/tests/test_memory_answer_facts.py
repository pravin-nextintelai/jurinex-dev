"""Case facts from answers: extracted by a model, kept only when the cited document backs them."""
from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.memory import answer_facts as af

PETITION = af.CitedDocument(name="Hitesh Lahoti PETITION_LT.pdf", file_id="file-1")
ORDER = af.CitedDocument(name="Order dated 02.09.2006.pdf", file_id="file-2")

# Real wording from the petition, as stored.
SALE_CHUNK = (
    "[PAGE 22] in the \"Deshdut\" newspaper and made an appeal to the public at large not to purchase "
    "the suit land in pursuance of the Agreement of Sale dated 25/11/2004 for Rs. 2,13,000 in respect of "
    "Gat No. 111/3 at Village Vavad, Taluka and District Nandurbar, purchased by Hitesh Balkrushna Lahoti."
)


class CitedDocumentTests(unittest.TestCase):
    def test_only_documents_that_can_be_looked_up_count(self) -> None:
        docs = af.cited_documents([
            {"document_name": PETITION.name, "file_id": "file-1"},
            {"document_name": PETITION.name, "file_id": "file-1"},  # repeated
            {"filename": "no-id.pdf"},                               # cannot be looked up
            {"document_name": ORDER.name, "document_id": "file-2"},  # older shape
            "not a dict",
        ])
        self.assertEqual(docs, [PETITION, ORDER])
        self.assertEqual(af.cited_documents(None), [])


class ParseTests(unittest.TestCase):
    def test_facts_naming_a_cited_document_and_allowed_section_are_read(self) -> None:
        payload = """```json
        {"facts": [
          {"section": "dates", "text": "Agreement of Sale dated 25/11/2004", "document": "Hitesh Lahoti PETITION_LT.pdf"},
          {"section": "decisions", "text": "Press the extension ground", "document": "Hitesh Lahoti PETITION_LT.pdf"},
          {"section": "facts", "text": "Something", "document": "A document nobody cited.pdf"},
          {"section": "parties", "text": "Hitesh Balkrushna Lahoti is the petitioner", "document": "PETITION_LT", "sensitive": true}
        ]}
        ```"""
        facts = af.parse_facts(payload, [PETITION, ORDER])
        self.assertEqual([fact.section for fact in facts], ["dates", "parties"])
        self.assertEqual(facts[1].document, PETITION.name)  # a partial name resolves to the cited one
        self.assertTrue(facts[1].sensitive)

    def test_decisions_and_the_summary_never_come_from_an_answer(self) -> None:
        self.assertNotIn("decisions", af.ANSWER_SECTIONS)
        self.assertNotIn("summary", af.ANSWER_SECTIONS)
        self.assertNotIn("drafting_log", af.ANSWER_SECTIONS)

    def test_one_turn_keeps_at_most_six_and_none_too_long(self) -> None:
        rows = [{"section": "facts", "text": f"Fact {n} about Gat No. 111/3", "document": PETITION.name} for n in range(10)]
        rows.append({"section": "facts", "text": "x" * (af.MAX_FACT_CHARS + 1), "document": PETITION.name})
        facts = af.parse_facts(json.dumps({"facts": rows}), [PETITION])
        self.assertEqual(len(facts), af.MAX_FACTS_PER_TURN)

    def test_a_single_cited_document_is_assumed_when_none_is_named(self) -> None:
        facts = af.parse_facts('{"facts": [{"section": "facts", "text": "Gat No. 111/3", "document": ""}]}', [PETITION])
        self.assertEqual(facts[0].document, PETITION.name)

    def test_unusable_output_raises(self) -> None:
        for bad in ("", "no json here", '{"other": []}'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                af.parse_facts(bad, [PETITION])


class SupportTests(unittest.TestCase):
    """What a wrong fact gets wrong is checked: its numbers and its names."""

    def test_a_fact_the_document_states_is_backed(self) -> None:
        self.assertTrue(af.supports(
            "The original landholders executed an Agreement of Sale for Gat No. 111/3 on 25/11/2004 "
            "for a consideration of Rs. 2,13,000.",
            SALE_CHUNK,
        ))

    def test_a_misread_date_is_not(self) -> None:
        self.assertFalse(af.supports("Agreement of Sale for Gat No. 111/3 dated 29/11/2004", SALE_CHUNK))

    def test_an_invented_reference_number_is_not(self) -> None:
        self.assertFalse(af.supports("Government Resolution No. NAP-1002/CR-216/L-9 governs Gat No. 111/3", SALE_CHUNK))

    def test_a_wrong_name_is_not(self) -> None:
        self.assertFalse(af.supports("Gat No. 111/3 was purchased by Ramesh Kulkarni Patil", SALE_CHUNK))

    def test_indian_digit_grouping_matches_either_way(self) -> None:
        self.assertTrue(af.supports("The consideration was Rs. 213000 for Gat No. 111/3", SALE_CHUNK))
        self.assertTrue(af.supports("Rs. 1,53,600 was deposited at Nandurbar", "Deposited 153600 at Nandurbar on 17.04.2015"))

    def test_the_answers_own_phrasing_does_not_have_to_be_there(self) -> None:
        self.assertTrue(af.supports(
            "Hitesh Balkrushna Lahoti is the aggrieved purchaser who acquired the subject agricultural parcel",
            SALE_CHUNK,
        ))

    def test_a_fact_with_too_little_to_check_is_not_kept(self) -> None:
        self.assertFalse(af.supports("It was sold", SALE_CHUNK))


class SearchAndPageTests(unittest.TestCase):
    def test_distinctive_numbers_are_searched_before_years(self) -> None:
        patterns = af._search_patterns("Power of Attorney No. 4345/2006 executed on 22/08/2006")
        self.assertEqual(patterns, ["%4345%", "%४३४५%"])  # and as a Marathi document writes it

    def test_years_are_used_when_nothing_else_identifies_the_fact(self) -> None:
        self.assertEqual(af._search_patterns("The suit was filed in 2005"), ["%2005%", "%२००५%"])

    def test_names_are_searched_when_there_is_no_number(self) -> None:
        self.assertIn("%balkrushna%", af._search_patterns("Hitesh Balkrushna Lahoti is the petitioner"))

    def test_the_page_is_the_chunks_own_when_it_has_one(self) -> None:
        self.assertEqual(af.page_of("Gat No. 111/3", {"page_start": 7, "window": SALE_CHUNK}), 7)

    def test_otherwise_the_last_page_marker_before_the_fact(self) -> None:
        window = "[PAGE 21] parties listed here. [PAGE 22] the Agreement of Sale dated 25/11/2004 for Gat No. 111/3"
        self.assertEqual(af.page_of("Agreement of Sale for Gat No. 111/3", {"page_start": None, "window": window}), 22)
        self.assertIsNone(af.page_of("Gat No. 111/3", {"page_start": None, "window": "no markers"}))

    def test_support_is_looked_up_in_the_named_document_only(self) -> None:
        fact = af.AnswerFact(section="dates", text="Agreement of Sale dated 25/11/2004 for Gat No. 111/3", document=PETITION.name)
        hit = {"id": "chunk-57", "chunk_index": 57, "page_start": None, "window": SALE_CHUNK}
        with patch.object(af, "is_db_available", return_value=True), \
                patch.object(af, "_candidate_chunks", return_value=[hit]) as search:
            found = af.find_support(fact, [PETITION, ORDER])
        self.assertEqual(search.call_args.args[0], "file-1")
        self.assertEqual((found.document, found.chunk_id, found.page), (PETITION.name, "chunk-57", 22))

    def test_no_backing_chunk_means_no_support(self) -> None:
        fact = af.AnswerFact(section="dates", text="Sale deed dated 29/11/2004 for Gat No. 111/3", document=PETITION.name)
        with patch.object(af, "is_db_available", return_value=True), \
                patch.object(af, "_candidate_chunks", return_value=[{"id": "c", "window": SALE_CHUNK}]):
            self.assertIsNone(af.find_support(fact, [PETITION]))


class ExtractTests(unittest.TestCase):
    def test_the_request_shows_documents_memory_question_and_answer(self) -> None:
        request = af.build_request("who is the petitioner", "Hitesh Balkrushna Lahoti.", [PETITION], [{"text": "Case number: WP/10568/2024"}])
        for part in ("DOCUMENTS:", PETITION.name, "CURRENT CASE MEMORY:", "WP/10568/2024", "who is the petitioner", "Hitesh Balkrushna Lahoti."):
            self.assertIn(part, request)

    def test_extraction_uses_the_configured_model_and_thinking(self) -> None:
        client = MagicMock()
        client.models.generate_content.return_value = SimpleNamespace(text='{"facts": []}')
        settings = SimpleNamespace(memory_answer_facts_model="gemini-3.1-flash-lite", memory_answer_facts_thinking_level="minimal")
        with patch.object(af, "get_settings", return_value=settings), \
                patch("app.services.adapters.document_ai._gemini_client", return_value=client), \
                patch("app.services.adapters.document_ai._build_gemini_config", return_value=SimpleNamespace()) as config:
            self.assertEqual(af.extract("q", "a", [PETITION], []), [])
        self.assertEqual(client.models.generate_content.call_args.kwargs["model"], "gemini-3.1-flash-lite")
        self.assertEqual(config.call_args.args[1], {"thinking_level": "minimal"})

    def test_no_client_raises_so_the_writer_can_say_so(self) -> None:
        with patch("app.services.adapters.document_ai._gemini_client", return_value=None), self.assertRaises(RuntimeError):
            af.extract("q", "a", [PETITION], [])


if __name__ == "__main__":
    unittest.main()
