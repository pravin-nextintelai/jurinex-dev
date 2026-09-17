"""Telling real OCR fragmentation from the ordinary features of legal writing.

Every flagged chunk costs a model call, so the check must not mistake a cause title, an
exhibit index or a court stamp for broken text. These cases come from real chunks.
"""
from __future__ import annotations

import unittest

from app.services.adapters.document_ai import (
    _FRAGMENT_MIN_CHARS,
    _FRAGMENT_MIN_LATIN_CHARS,
    _looks_fragmented,
)

# Real OCR damage: words split, spaces before punctuation, numbers broken.
BROKEN = (
    "this has the approvat of ihe competent authoriiy fr.e. identifi cation/review com mittee. "
    "A non-whole-time director, including an independent director/ nominec director, shall not "
    "be eonsidered as wilful defaulter unless it is conclusively estab lished that he was aware "
    "of the fact of wilful default by the borrower . The Krish n aji Sug riv of L atur paid "
    "Rs . 25 , 00 , 000 at 18 % p .a . on 12 . 05 . 202 5 to the Ltd . under receipt 805 7 . "
    "The Occ u Service of the peti tioner was confirmed by the Ta hsil dar on 202 4 , and the "
    "b ank records show the a mount was paid in f ull by the r espondent ."
)


def padded(text: str, filler: str = "The petitioner submits the following facts for consideration. ") -> str:
    """Grow a short real snippet into a chunk long enough to be judged, with clean prose."""
    out = text
    while len(out) < _FRAGMENT_MIN_CHARS + 50:
        out += " " + filler
    return out


class RealFragmentationTests(unittest.TestCase):
    def test_broken_ocr_is_still_caught(self) -> None:
        self.assertTrue(_looks_fragmented(BROKEN))

    def test_each_kind_of_damage_counts(self) -> None:
        for damage in (
            "Krish n aji Sug riv L atur b ank f ull r espondent peti tioner Ta hsil dar " * 6,
            "Ltd . p .a . 18 % year , Rs . 25 , 00 , 000 received . paid . " * 7,
            "dated 202 5 receipt 805 7 on 202 4 and 201 9 amount 150 0 and 300 5 " * 7,
        ):
            with self.subTest(damage=damage[:30]):
                self.assertTrue(_looks_fragmented(damage))


class FalseAlarmTests(unittest.TestCase):
    """Each of these was flagged by the old check and sent to the model on every question."""

    def assertClean(self, text: str) -> None:
        self.assertGreaterEqual(len(text), _FRAGMENT_MIN_CHARS, "test text must be long enough to be judged")
        self.assertFalse(_looks_fragmented(text), text[:120])

    def test_relationship_abbreviations(self) -> None:
        self.assertClean(padded(
            "Hitesh s/o Balkrushna Lahoti, Sunita d/o Ramesh Patil, Meena w/o Suresh Jadhav, "
            "care c/o the Tahsildar, charged u/s 420 r/w 34 IPC, paid from A/c No. 1234. " * 3
        ))

    def test_dotted_leaders_in_a_cause_title(self) -> None:
        self.assertClean(padded(
            "Hitesh Balkrushna Lahoti,\n.....PETITIONER\nVERSUS\nThe State of Maharashtra & Others\n"
            "...RESPONDENTS\n" * 4
        ))

    def test_initials_and_dotted_abbreviations(self) -> None:
        self.assertClean(padded(
            "Before Hon'ble S. K. Sharma J. and A. U. Somay, the Govt. of Maharashtra by G.R. dated "
            "05/12/2005 granted the land in Aurangabad (M.S.), i.e. for industrial use, e.g. a township. " * 3
        ))

    def test_an_exhibit_index(self) -> None:
        self.assertClean(padded(
            'Copy of Order passed by the CJSD "A" 1-5\nCopy of Sale Deed "B" 6-10\n'
            'Challan copy "C" 12-14-C\nApplication to the Collector "D" 41-41-A\n'
            'Letter to the Tahsildar "E" 42-45\nReply of the respondent "F" 46-50\n' * 2
        ))

    def test_clause_markers(self) -> None:
        self.assertClean(padded(
            "The petitioner prays that (a) the order be quashed; (b) the respondents be directed; "
            "(c) costs be awarded; (d) interim relief be granted; (iv) any other relief. " * 3
        ))

    def test_a_court_stamp(self) -> None:
        self.assertClean(padded(
            "Presented on: 12-07-2005\nRegistered on: 12-07-2005\nDecided on : 02-09-2006\n"
            "Duration : 1 Y 1 M 21 D\nExhibit 14-A\nRegd. No. 7907/2010\n" * 3
        ))

    def test_table_column_letters(self) -> None:
        self.assertClean(padded(
            "Description\nNo. of persons\n" + "\n".join(["A", "B", "C", "D", "E", "F", "G", "H"]) + "\n"
            "Skilled Employee - Operator\nUnskilled Employee - Helper\n" * 2
        ))

    def test_form_labels_with_a_space_before_the_colon(self) -> None:
        self.assertClean(padded("Date : 15/4/2015\nPlace : Nandurbar\nAmount : 153600\nName : Hitesh\n" * 6))


class NotJudgedTests(unittest.TestCase):
    def test_a_short_chunk_is_never_flagged(self) -> None:
        short = BROKEN[: _FRAGMENT_MIN_CHARS - 1]
        self.assertFalse(_looks_fragmented(short))

    def test_a_mostly_marathi_chunk_is_never_flagged(self) -> None:
        marathi = (
            "दस्त क्रमांक : 3345/2005 दस्त गोषवारा भाग - 2 माजार मुल्य : गोबदला भरलेले मुद्रांक शुल्क : 100 "
            "दस्त हजर केल्याचा दिनांक : 07/07/2005 निष्पादनाचा दिनांक : 07/07/2005 दस्त हजर करणा-याची सही : "
        ) * 4 + " p .a . 202 5 Ltd . "
        self.assertGreaterEqual(len(marathi), _FRAGMENT_MIN_CHARS)
        self.assertLess(sum(ch.isascii() and ch.isalnum() for ch in marathi), _FRAGMENT_MIN_LATIN_CHARS)
        self.assertFalse(_looks_fragmented(marathi))

    def test_empty_and_none_are_safe(self) -> None:
        self.assertFalse(_looks_fragmented(""))
        self.assertFalse(_looks_fragmented(None))  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
