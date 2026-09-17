"""Memory learns from Marathi and Hindi, with the same checks it applies to English.

Before this, every check compared English letters only. A Marathi message had no words
to compare, so each fact, decision and rule the extractor read from it was refused as
"not in the advocate's message"; facts in Marathi documents failed the document check
because "4144" is "४१४४" and "Jadhav" is "जाधव" there; and comparing two Marathi texts
stripped their vowel signs ("मराठीत" became "मर ठ त").

The messages and outputs below are the extractor's real ones (gemini-3.1-flash-lite),
and the deed text is from a stored Marathi document.
"""
from __future__ import annotations

import re
import unittest

from app.services.memory import answer_facts as af
from app.services.memory import script
from app.services.memory import synthesis as syn
from app.services.memory.schemas import MemoryProposal
from app.services.memory.validator import (
    find_duplicate,
    find_same_rule,
    is_negative,
    normalize_for_compare,
    party_name_in,
    repeats_rule,
    validate_advocate_line,
    validate_line,
)
from app.services.memory.writer import (
    Extraction,
    describes_manner,
    has_standing_rule,
    has_universal_cue,
    is_grounded,
    turn_skip_reason,
)
from tests.test_memory_writer import op, run, turn

CLIENT = "माझ्या अशिलाचे नाव सुनील पवार आहे आणि त्यांना हृदयविकार आहे, हाच आमचा वैद्यकीय मुद्दा आहे."
HEARING = "पुढील सुनावणी १४ ऑक्टोबर २०२६ रोजी औरंगाबाद खंडपीठात आहे."
DECISION = "आम्ही अलिबीचा मुद्दा मांडणार नाही, फक्त गुन्हेगारी हेतू नसल्यावर भर देऊ."
TYPED_ENGLISH = "द सेल डीड वॉज साइन्ड ऑन ट्वेंटी फिफ्थ ऑगस्ट टू थाउजंड सिक्स बाय रमेश जाधव."
RULE = "यापुढे मला सगळी उत्तरे मराठीत दे."

# From a stored Marathi deed ("Green Eye Infrastructure.pdf").
DEED = (
    "अर्जदार :- ग्रीन आय इंफ्रास्ट्रक्चर प्रा.लि. ४०३, क्रिस्ट्रल टॉवर, मिलट्री रोड, मरोल, अंधेरी, (पुर्व), "
    "मुंबई-४०००२१. तर्फे डायरेक्टर, श्री. विजय रामकृष्णन यांच्या तर्फे संजय डी. चौधरी.\n"
    "दस्त क्र ४१४४/२०११\nसह जिल्हा निबंधक वर्ग-१, जळगांव यांचे कार्यालय\nदिनांक: २८/०७/२०११\n"
    "१. संलेखाचाः प्रकार व मोबदला भाडेकरु असलेल्या जागेचे खरेदीखत रु.३९,६०,०९६/-"
)


class SoundTests(unittest.TestCase):
    def test_a_name_is_the_same_word_in_either_script(self) -> None:
        for english, marathi in (
            ("Sunil", "सुनील"), ("Pawar", "पवार"), ("Jadhav", "जाधव"), ("Aurangabad", "औरंगाबाद"),
            ("October", "ऑक्टोबर"), ("Chavan", "चव्हाण"), ("Kulkarni", "कुलकर्णी"), ("Sambhaji", "संभाजी"),
            ("Dnyaneshwar", "ज्ञानेश्वर"), ("Krishna", "कृष्ण"), ("Chaudhari", "चौधरी"),
            ("Infrastructure", "इंफ्रास्ट्रक्चर"), ("Priyanka", "प्रियांका"), ("summary", "समरी"),
        ):
            with self.subTest(english=english):
                self.assertTrue(script.sound_alike(english, marathi))

    def test_a_marathi_ending_is_allowed_and_other_letters_are_not(self) -> None:
        self.assertTrue(script.sound_alike("Pawar", "पवारांचा"))
        self.assertTrue(script.sound_alike("Jalgaon", "जळगांव"))
        self.assertFalse(script.sound_alike("Nashik", "निष्कर्ष"))

    def test_different_words_do_not_match(self) -> None:
        for english, marathi in (("Pawar", "पाटील"), ("Sunil", "सुनावणी"), ("Ramesh", "रमेशचंद्र"), ("Joshi", "जास्त")):
            with self.subTest(english=english):
                self.assertFalse(script.sound_alike(english, marathi, min_sounds=2))

    def test_short_names_match_only_when_asked_and_only_exactly(self) -> None:
        self.assertFalse(script.sound_alike("Joshi", "जोशी"))
        self.assertTrue(script.sound_alike("Joshi", "जोशी", min_sounds=2))

    def test_english_words_are_never_compared_by_sound(self) -> None:
        self.assertFalse(script.sound_alike("court", "cart"))

    def test_digits_read_the_same_in_either_script(self) -> None:
        self.assertEqual(script.ascii_digits("दस्त क्र ४१४४/२०११"), "दस्त क्र 4144/2011")
        self.assertEqual(script.devanagari_digits("4144"), "४१४४")

    def test_marathi_words_that_carry_no_fact_are_left_out(self) -> None:
        words = script.content_words(CLIENT)
        self.assertTrue({"सुनील", "पवार", "हृदयविकार"} <= words)
        self.assertFalse({"आहे", "आणि", "त्यांना"} & words)

    def test_the_database_pattern_finds_the_devanagari_spelling(self) -> None:
        pattern = script.devanagari_pattern("Jadhav")
        self.assertIsNotNone(re.search(pattern, "विक्रेता रमेश जाधव यांनी"))
        self.assertIsNone(re.search(pattern, "विक्रेता रमेश पाटील यांनी"))
        self.assertIsNone(script.devanagari_pattern("जाधव"))


class ComparisonTests(unittest.TestCase):
    def test_vowel_signs_survive_normalising(self) -> None:
        self.assertEqual(normalize_for_compare(RULE), "यापुढे मला सगळी उत्तरे मराठीत दे")

    def test_the_same_marathi_fact_in_either_digits_is_a_duplicate(self) -> None:
        self.assertIsNotNone(find_duplicate("पुढील सुनावणी 14 ऑक्टोबर 2026 रोजी आहे", [{"text": HEARING}], 0.8))

    def test_a_marathi_hedge_is_an_inference(self) -> None:
        for text in ("कदाचित सुनावणी पुढे ढकलली जाईल", "आरोपीचा हेतू चोरीचा असावा", "शायद गवाह मुकर जाएगा"):
            with self.subTest(text=text):
                self.assertEqual(validate_line("stated", text, section="facts").code, "inference_language")

    def test_marathi_transient_context_is_refused(self) -> None:
        self.assertEqual(validate_line("stated", "आत्ता मी कोर्टात आहे", section="facts").code, "transient")

    def test_a_plain_marathi_fact_may_be_stored(self) -> None:
        self.assertIsNone(validate_line("stated", HEARING, section="dates"))

    def test_marathi_and_hindi_negations(self) -> None:
        self.assertTrue(is_negative("मराठीत उत्तर देऊ नको"))
        self.assertTrue(is_negative("टेबल में जवाब नहीं चाहिए"))
        self.assertFalse(is_negative("मराठीत उत्तर दे"))
        self.assertIsNone(find_same_rule("मराठीत उत्तर देऊ नको", [{"text": "मराठीत उत्तर दे"}]))

    def test_a_reworded_marathi_request_repeats_the_rule(self) -> None:
        self.assertTrue(repeats_rule("नेहमी मराठीत उत्तर दे", RULE))
        self.assertFalse(repeats_rule("नेहमी मराठीत उत्तर देऊ नको", RULE))

    def test_case_details_in_marathi_stay_out_of_what_is_remembered_everywhere(self) -> None:
        for text, code in (
            ("पवार विरुद्ध महाराष्ट्र राज्य हे प्रकरण चालवतो", "case_data_party"),
            ("१४ ऑक्टोबर २०२६ रोजी खंडपीठात हजर राहतो", "case_data_date"),
            ("गु.र.नं. ४५/२०२० मध्ये बचाव करतो", "case_data_fir"),
            ("दावा क्र. ४५/२०२० चालवतो", "case_data_case_number"),
        ):
            with self.subTest(text=text):
                self.assertEqual(validate_advocate_line(text, category="practice").code, code)
        self.assertIsNone(validate_advocate_line("मुख्यतः औरंगाबाद खंडपीठात काम करतात", category="practice"))

    def test_a_party_named_in_devanagari_is_recognised(self) -> None:
        self.assertEqual(party_name_in("सुनील पवार यांच्यासाठी काम करतो", ["Sunil Pawar"]), "Sunil Pawar")


class GroundingTests(unittest.TestCase):
    def test_what_the_extractor_wrote_from_marathi_messages_is_grounded(self) -> None:
        for line, message in (
            ("अशिलाचे नाव सुनील पवार आहे", CLIENT),
            ("सुनील पवार यांना हृदयविकार आहे", CLIENT),
            (HEARING, HEARING),
            (DECISION, DECISION),
            ("The sale deed was signed on 25 August 2006 by Ramesh Jadhav.", TYPED_ENGLISH),
            ("Client: Sunil Pawar", CLIENT),
        ):
            with self.subTest(line=line):
                self.assertTrue(is_grounded(line, message))

    def test_a_claim_the_marathi_message_does_not_make_is_not(self) -> None:
        self.assertFalse(is_grounded("The remand order says the investigation is complete", CLIENT))
        self.assertFalse(is_grounded("जामीन अर्ज फेटाळला गेला", CLIENT))


class RuleWordTests(unittest.TestCase):
    def test_marathi_and_hindi_rule_words(self) -> None:
        for text in (RULE, "नेहमी तक्त्यात उत्तर दे", "कधीच इंग्रजीत उत्तर देऊ नको", "हमेशा हिंदी में जवाब दो"):
            with self.subTest(text=text):
                self.assertTrue(has_standing_rule(text))
        self.assertFalse(has_standing_rule("मला या केसचा सारांश दे"))

    def test_marathi_ways_of_writing(self) -> None:
        for text in ("मराठीत उत्तर दे", "तक्त्यात दाखव", "थोडक्यात सांग", "मुद्देसूद उत्तर दे"):
            with self.subTest(text=text):
                self.assertTrue(describes_manner(text))
        self.assertFalse(describes_manner("सुनील पवार कोण आहे"))

    def test_marathi_words_for_every_case(self) -> None:
        for text in ("माझ्या सर्व केसेसमध्ये मराठीत उत्तर दे", "प्रत्येक केसमध्ये तक्ता दे", "फक्त या केससाठी नाही, नेहमी मराठीत"):
            with self.subTest(text=text):
                self.assertTrue(has_universal_cue(text))
        self.assertFalse(has_universal_cue("या केसमध्ये मराठीत उत्तर दे"))

    def test_marathi_greetings_are_skipped(self) -> None:
        for message in ("नमस्कार", "धन्यवाद!", "ठीक आहे", "हो"):
            with self.subTest(message=message):
                self.assertEqual(turn_skip_reason(turn(message)), "greeting")
        self.assertIsNone(turn_skip_reason(turn(HEARING)))


class WriterTests(unittest.TestCase):
    """The whole post-turn path with the database mocked."""

    def test_a_fact_stated_in_marathi_is_written(self) -> None:
        report, mocks = run(HEARING, extraction=Extraction(ops=[op(HEARING, section="dates")]))
        self.assertEqual(report.writes, 1)
        self.assertEqual(mocks["apply_op"].call_args.args[1].text, HEARING)

    def test_a_name_written_in_english_from_a_marathi_message_is_written(self) -> None:
        report, _ = run(CLIENT, extraction=Extraction(ops=[op("Client: Sunil Pawar", section="parties")]))
        self.assertEqual(report.writes, 1)

    def test_a_claim_only_the_answer_made_is_still_refused(self) -> None:
        report, mocks = run(CLIENT, extraction=Extraction(ops=[op("जामीन अर्ज फेटाळला गेला")]))
        self.assertEqual(report.writes, 0)
        self.assertIn("not_in_advocate_message", report.rejection_codes)
        mocks["apply_op"].assert_not_called()

    def test_a_marathi_rule_is_suggested(self) -> None:
        extraction = Extraction(proposals=[MemoryProposal(kind="instruction", text=RULE)])
        report, mocks = run(RULE, extraction=extraction)
        self.assertNotIn("proposal_not_in_advocate_message", report.rejection_codes)
        self.assertNotIn("proposal_not_a_way_of_working", report.rejection_codes)
        mocks["add_proposal"].assert_called_once()
        self.assertEqual(mocks["add_proposal"].call_args.args[3], RULE)


class DocumentTests(unittest.TestCase):
    """A fact from an answer, checked against a Marathi document."""

    def test_facts_the_marathi_deed_states_are_backed(self) -> None:
        for fact in (
            "Document No. 4144/2011 was registered at Jalgaon on 28/07/2011",
            "Document No. 4144/2011 was registered on 28 July 2011",
            "The sale deed for Rs. 39,60,096 was executed by Sanjay D. Chaudhari for Green Eye Infrastructure Pvt. Ltd.",
        ):
            with self.subTest(fact=fact):
                self.assertTrue(af.supports(fact, DEED))

    def test_what_an_answer_got_wrong_is_not(self) -> None:
        for fact in (
            "Document No. 4145/2011 was registered at Jalgaon",
            "Document No. 4144/2011 was registered on 17/03/2011",
            "The sale deed for Rs. 39,60,096 was executed by Ramesh Patil",
            "The sale deed was for Rs. 39,60,069",
        ):
            with self.subTest(fact=fact):
                self.assertFalse(af.supports(fact, DEED))

    def test_a_date_counts_only_as_a_whole_date(self) -> None:
        passage = "Paid Rs. 17 on 03.04.2015 against 2011 dues."
        self.assertFalse(af.supports("Rs. 17 was paid on 17/03/2011", passage))
        self.assertTrue(af.supports("Rs. 17 was paid on 3 April 2015 against dues", passage))

    def test_a_name_only_fact_is_searched_by_its_devanagari_spelling(self) -> None:
        patterns = af._name_patterns("Ramesh Jadhav is the vendor")
        self.assertTrue(any(re.search(pattern, "विक्रेता रमेश जाधव") for pattern in patterns))
        self.assertEqual(af._name_patterns("Document No. 4144/2011 names Ramesh Jadhav"), [])

    def test_the_page_is_found_from_a_devanagari_name(self) -> None:
        window = "[PAGE 3] अनुक्रमणिका [PAGE 4] विक्रेता रमेश जाधव यांनी खरेदीखत करून दिले"
        self.assertEqual(af.page_of("Ramesh Jadhav is the vendor", {"page_start": None, "window": window}), 4)


class ReviewTests(unittest.TestCase):
    def test_a_summary_line_may_name_what_the_advocate_wrote_in_marathi(self) -> None:
        evidence = "सुनील पवार यांच्या जामिनाबद्दल विचारले. १४ ऑक्टोबर पर्यंत उत्तर दाखल करायचे आहे."
        self.assertTrue(syn.grounded_status("Open items: file the reply for Sunil Pawar by 14 October", evidence))
        self.assertFalse(syn.grounded_status("Open items: file the reply for Suresh Patil by 14 October", evidence))
        self.assertFalse(syn.grounded_status("Open items: file the reply by 16 October", evidence))

    def test_a_way_of_working_asked_for_in_marathi_backs_a_suggestion(self) -> None:
        self.assertTrue(syn.shows_pattern("Give detailed answers", ["मला सविस्तर उत्तर दे", "सविस्तरपणे सांग"]))
        self.assertTrue(syn.shows_pattern("Present answers in a table", ["तक्त्यात दाखव", "टेबल मध्ये दे"]))
        self.assertFalse(syn.shows_pattern("Give detailed answers", ["मला सविस्तर उत्तर दे", "थोडक्यात सांग"]))


if __name__ == "__main__":
    unittest.main()
