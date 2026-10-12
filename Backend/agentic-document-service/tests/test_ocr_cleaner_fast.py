"""normalize_ocr_artifacts must produce exactly what it did before the speed-up.

The cleaner runs five times over the text of every ingested document (once per
structured element type, once per page, once per batch). On a 2,000-page file that
was ~30 s of CPU. The speed-up only *skips* regex passes that a substring test
proves cannot match, and skips candidate joins for fragments that cannot start an
accepted word — so the output must be byte-identical to the original algorithm,
which is reproduced here as the reference.
"""
from __future__ import annotations

import random
import re
import unittest

from app.services.adapters import document_ai as da


def _reference_rejoin(text: str) -> str:
    if not text:
        return text

    def _try(match: re.Match) -> str:
        phrase = match.group(1)
        if " " not in phrase:
            return phrase
        parts = phrase.split(" ")
        out: list[str] = []
        i = 0
        n = len(parts)
        while i < n:
            merged = None
            for span in (5, 4, 3, 2):
                if i + span <= n:
                    cand = "".join(parts[i : i + span])
                    if cand.lower() in da._REJOIN_WORD_SET:
                        merged = cand[:1].upper() + cand[1:] if parts[i][:1].isupper() else cand
                        i += span
                        break
            if merged is not None:
                out.append(merged)
            else:
                out.append(parts[i])
                i += 1
        return " ".join(out)

    return da._LEGAL_WORD_BOUNDARY_RE.sub(_try, str(text))


def _reference_normalize(text: str) -> str:
    if not text:
        return text
    result = da._merge_split_numbers(str(text))
    for pattern, replacement, _needle in da._OCR_PHRASE_FIXES:
        result = pattern.sub(replacement, result)
    result = re.sub(
        r"\b(\d{1,2})\s*([/\-])\s*(\d{1,2})\s*([/\-])\s*(\d{2,4}(?:\s+\d)?)\b",
        lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}{m.group(4)}{m.group(5).replace(' ', '')}",
        result,
    )
    result = re.sub(r"\bwithdrawalcanbe\b", "withdrawal can be", result, flags=re.IGNORECASE)
    result = re.sub(r"\bissuednotice\b", "issued notice", result, flags=re.IGNORECASE)
    result = re.sub(r"\binitiallyrefused\b", "initially refused", result, flags=re.IGNORECASE)
    result = re.sub(r"\binitiallyref\s+used\b", "initially refused", result, flags=re.IGNORECASE)
    result = re.sub(r"\bcourtre\s+jected\b", "court rejected", result, flags=re.IGNORECASE)
    result = re.sub(r"\bArticle\s+227filed\b", "Article 227 filed", result, flags=re.IGNORECASE)
    result = re.sub(r"\bdefendon\b", "defend on", result, flags=re.IGNORECASE)
    result = re.sub(r"(\d{1,2})\s*\)se\s+eking", r"\1) seeking", result, flags=re.IGNORECASE)
    return _reference_rejoin(result)


_FILLER = (
    "the learned trial court erred in law and on facts while passing the impugned order "
    "without appreciating the evidence on record and the agreement between the parties "
    "in court to do so New York High Court Krish naji Aur ang abad Def endant com pliance"
).split()


def _split_word(word: str, rng: random.Random) -> str:
    if len(word) < 4:
        return word
    cuts = sorted(rng.sample(range(1, len(word)), k=min(len(word) - 1, rng.randint(1, 4))))
    parts, prev = [], 0
    for cut in cuts:
        parts.append(word[prev:cut])
        prev = cut
    parts.append(word[prev:])
    return " ".join(parts)


class CleanerEquivalenceTests(unittest.TestCase):
    CASES = [
        "",
        "Con stitution of India, Aur ang abad bench, Mah arashtra",
        "The St amps were Def endant com pliance rep ayment",
        "Suit No. 201 6 of 100 72 dated 04 / 04 / 2024 and 12 - 03 - 2021",
        "withdrawalcanbe issuednotice initiallyref used courtre jected Article 227filed defendon 3 )se eking",
        "The  compliance  has   double spaces and\nnew\nlines com\npliance",
        "Krish n aji Sug nv Jad hav D adas a heb su o mot u",
        "HIGH COURT OF JUDICATURE AT BOMBAY — CIVIL APPEAL NO. 1234 OF 2021",
        "Rs. 25,00,000 payable 18 % p .a . Ltd . 805 7 202 5",
        "Under lying Pro ceeding initially ref used strong ly den ying",
        "a b c d e f g h i j k l m n o p q r s t u v w x y z",
        "Pet itioner Res pondent Plain tiff App ellant Tri bunal",
        "प्रतिवादी ने कहा कि Con stitution लागू है",
    ]

    def test_curated_cases_match_reference(self) -> None:
        for case in self.CASES:
            with self.subTest(case=case):
                self.assertEqual(da.normalize_ocr_artifacts(case), _reference_normalize(case))

    def test_random_split_corpus_matches_reference(self) -> None:
        rng = random.Random(2026)
        vocabulary = sorted(da._REJOIN_WORD_SET)
        for _ in range(300):
            words: list[str] = []
            for _w in range(rng.randint(3, 40)):
                roll = rng.random()
                if roll < 0.25:
                    word = rng.choice(vocabulary)
                    if rng.random() < 0.5:
                        word = word.capitalize()
                    words.append(_split_word(word, rng) if rng.random() < 0.7 else word)
                elif roll < 0.35:
                    words.append(f"{rng.randint(10, 9999)} {rng.randint(0, 99)}")
                elif roll < 0.42:
                    words.append(f"{rng.randint(1, 28)} / {rng.randint(1, 12)} / {rng.randint(1990, 2026)}")
                elif roll < 0.47:
                    words.append(rng.choice(["\n", "  ", " \t "]))
                else:
                    words.append(rng.choice(_FILLER))
            text = " ".join(words)
            with self.subTest(text=text[:80]):
                self.assertEqual(da.normalize_ocr_artifacts(text), _reference_normalize(text))

    def test_known_repairs_still_happen(self) -> None:
        self.assertEqual(da.normalize_ocr_artifacts("Con stitution"), "Constitution")
        self.assertEqual(da.normalize_ocr_artifacts("com pliance"), "compliance")
        self.assertEqual(da.normalize_ocr_artifacts("Def endant"), "Defendant")
        self.assertEqual(da.normalize_ocr_artifacts("Suit No. 201 6"), "Suit No. 2016")
        self.assertEqual(da.normalize_ocr_artifacts("04 / 04 / 2024"), "04/04/2024")
        self.assertEqual(da.normalize_ocr_artifacts("courtre jected"), "court rejected")
        self.assertEqual(da.normalize_ocr_artifacts("High Court"), "High Court")
        self.assertEqual(da.normalize_ocr_artifacts("in court to do"), "in court to do")


if __name__ == "__main__":
    unittest.main()
