"""Words written in Devanagari (Marathi, Hindi), matched against English and each other.

Memory checks every line against its source before keeping it: a fact the advocate
stated must be in their message, and a fact read out of an answer must be in the
document. Those checks compared English words, so anything in Marathi failed them:

* an advocate types "सुनील पवार यांना हृदयविकार आहे" and the extractor writes
  "Client: Sunil Pawar", whose words are not in the message;
* a Marathi deed numbers itself "दस्त क्र. ४१४४/२०११" and names "रमेश जाधव", where the
  answer says "Document No. 4144/2011" and "Ramesh Jadhav";
* a message typed on a Marathi keyboard spells English in Devanagari ("समरी इन डिटेल").

Nothing here translates. Digits are the same number in either script, and two words
match only when they are one word written in two scripts, compared by their consonants:
"Pawar" and "पवार" are both pvr. Words that differ between the languages ("heart",
"हृदयविकार") never match, so a translated line can be traced only through its names,
numbers and borrowed words.
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Iterable

# Letters, vowel signs and marks; not the danda (।, ॥), the digits or the abbreviation sign.
LETTERS = "ऀ-ॣॱ-ॿ"

_DEVANAGARI_DIGITS = "०१२३४५६७८९"
_TO_ASCII = str.maketrans(_DEVANAGARI_DIGITS, "0123456789")
_TO_DEVANAGARI = str.maketrans("0123456789", _DEVANAGARI_DIGITS)
# Joiners sit inside Marathi words ("र्‍य") and would split them.
_JOINERS = str.maketrans("", "", "‌‍")

_WORD_RE = re.compile(f"[{LETTERS}]+")
_ANY_WORD_RE = re.compile(f"[A-Za-z]+|[{LETTERS}]+")
_LETTER_RE = re.compile(f"[{LETTERS}]")
_LATIN_LETTER_RE = re.compile(r"[A-Za-z]")

# Two words are compared only when they have at least this many consonants.
MIN_SOUNDS = 3
# The consonants of the endings a Marathi word takes: ला, ना, चा/ची/चे/च्या, ने, त/तील,
# स, वर, मध्ये, साठी, कडे/कडून/कडील, पासून, ांचा, ांना, ांत, ांस, and verb endings (णार, ले).
# "पवारांचा" is "Pawar" with "nc"; "निष्कर्ष" is not "Nashik" with "rs". "v" is the
# "गांव" of place names that English writes "gaon" ("Jalgaon", "जळगांव").
MARATHI_ENDINGS = frozenset(
    "c l n r s t v cn kd md nc nl nn nr ns nt st tl vr kdl kdn ntl psn".split()
)

# Marathi and Hindi words that carry no fact: auxiliaries, pronouns, postpositions.
STOPWORDS = frozenset(
    """
    आहे आहेत होते होता होती होतो नाही नाहीत आणि किंवा पण परंतु तसेच म्हणून त्यामुळे
    हा ही हे तो ती ते या त्या जे जो जी की का व न
    मी आम्ही तुम्ही आपण मला आम्हाला तुम्हाला त्यांना यांना त्याला तिला
    माझा माझी माझे माझ्या आमचा आमची आमचे आमच्या तुमचा तुमची तुमचे तुमच्या
    त्याचा त्याची त्याचे त्याच्या त्यांचा त्यांची त्यांचे त्यांच्या
    मध्ये साठी कडे कडून पासून पर्यंत वर खाली बाबत संदर्भात रोजी
    सर्व काही फक्त खूप अधिक कमी आता नंतर आधी पुन्हा
    कर करा करू करणे केले केला केली करतो करते करतात करावे करावी
    दे द्या देणे दिले दिला दिली सांग सांगा हवे हवा हवी पाहिजे
    झाले झाला झाली असे अशी असा असून असेल
    है हैं था थी थे और या का की के को से में पर ने भी तो यह वह इस उस कि जो
    मैं हम आप मेरा मेरी मेरे हमारा हमारी हमारे आपका आपकी आपके
    नहीं कर करना करें किया दिया रहा रही रहे गया गई गए होना हो दे दो देना
    बताओ बताइए बताएं चाहिए लिए साथ बाद पहले अब सब कुछ
    """.split()
)


# ── Digits and words ─────────────────────────────────────────────────────────

def ascii_digits(text: str | None) -> str:
    """"४१४४/२०११" -> "4144/2011"."""
    return str(text or "").translate(_TO_ASCII)


def devanagari_digits(text: str | None) -> str:
    """"4144" -> "४१४४"."""
    return str(text or "").translate(_TO_DEVANAGARI)


def has_devanagari(text: str | None) -> bool:
    return bool(_LETTER_RE.search(str(text or "")))


def devanagari_share(text: str | None) -> float:
    """The share of a text's letters that are Devanagari (0.0 for no letters)."""
    body = str(text or "")
    devanagari = len(_LETTER_RE.findall(body))
    latin = len(_LATIN_LETTER_RE.findall(body))
    return devanagari / (devanagari + latin) if devanagari + latin else 0.0


def devanagari_words(text: str | None) -> list[str]:
    return _WORD_RE.findall(str(text or "").translate(_JOINERS))


def content_words(text: str | None) -> set[str]:
    """The Devanagari words of a text that can carry a fact."""
    return {word for word in devanagari_words(text) if word not in STOPWORDS and len(skeleton(word)) >= 2}


# ── Consonant skeletons ──────────────────────────────────────────────────────

_CONSONANTS: dict[str, str] = {}
for _letters, _sounds in (
    ("कखगघङ", "kkggn"),
    ("चछजझञ", "ccjjn"),
    ("टठडढण", "ttddn"),
    ("तथदधनऩ", "ttddnn"),
    ("पफबभम", "ppbbm"),
    ("रऱलळऴव", "rrlllv"),
    ("शषस", "sss"),
    ("क़ख़ग़ज़ड़ढ़फ़", "kkgjddp"),  # the nukta letters
):
    _CONSONANTS.update(zip(_letters, _sounds))
_NASAL_SIGNS = "ँं"  # candrabindu, anusvara
_VOCALIC_R = "ऋॠृॄ"  # ऋ ॠ and their vowel signs
_VOCALIC_L = "ऌॡॢॣ"

# Latin spellings of one Devanagari sound, longest first. "h" and "y" are left out
# altogether: aspiration is written inconsistently ("Chavan" / "चव्हाण"), and a "y" is
# a vowel in English where Devanagari writes a glide ("summary" / "समरी", "real" / "रियल").
_LATIN_GROUPS: tuple[tuple[str, str], ...] = (
    ("tion", "sn"), ("sion", "sn"), ("ture", "cr"),
    ("chh", "c"), ("dny", "jn"), ("ksh", "ks"),
    ("ch", "c"), ("sh", "s"), ("kh", "k"), ("gh", "g"), ("jh", "j"), ("th", "t"),
    ("dh", "d"), ("ph", "p"), ("bh", "b"), ("ck", "k"),
)
_LATIN_LETTERS = {
    "b": "b", "d": "d", "g": "g", "j": "j", "k": "k", "l": "l", "m": "m", "n": "n", "p": "p",
    "r": "r", "s": "s", "t": "t", "v": "v", "w": "v", "f": "p", "z": "j", "q": "k", "x": "ks",
}


def _latin_sounds(word: str) -> str:
    text = word.lower()
    out: list[str] = []
    index = 0
    while index < len(text):
        for spelling, sound in _LATIN_GROUPS:
            if text.startswith(spelling, index):
                out.append(sound)
                index += len(spelling)
                break
        else:
            letter = text[index]
            if letter == "c":
                out.append("s" if text[index + 1 : index + 2] in ("e", "i", "y") else "k")
            else:
                out.append(_LATIN_LETTERS.get(letter, ""))  # vowels, h
            index += 1
    return "".join(out)


def _devanagari_sounds(word: str) -> str:
    out: list[str] = []
    for char in word:
        if char in _CONSONANTS:
            out.append(_CONSONANTS[char])
        elif char in _NASAL_SIGNS:
            out.append("n")
        elif char in _VOCALIC_R:
            out.append("r")
        elif char in _VOCALIC_L:
            out.append("l")
    return "".join(out)


def _finish(sounds: str) -> str:
    letters = list(sounds)
    # A nasal before b or p is "m" in English and an anusvara in Devanagari: "Sambhaji", "संभाजी".
    letters = ["n" if letter == "m" and following in ("b", "p") else letter
               for letter, following in zip(letters, letters[1:] + [""])]
    collapsed: list[str] = []
    for letter in letters:
        if not collapsed or collapsed[-1] != letter:
            collapsed.append(letter)
    return "".join(collapsed)


@lru_cache(maxsize=65_536)
def skeleton(word: str) -> str:
    """A word's consonants, the same for its English and Devanagari spellings: "Pawar" -> "pvr"."""
    text = str(word or "").translate(_JOINERS)
    return _finish(_devanagari_sounds(text) if has_devanagari(text) else _latin_sounds(text))


def sound_alike(
    first: str,
    second: str,
    *,
    min_sounds: int = MIN_SOUNDS,
    cross_script_endings: bool = True,
) -> bool:
    """Whether two words are one word, where at least one of them is in Devanagari.

    English words are never compared this way with each other: their own spelling says
    more than their consonants. A Devanagari word may carry a Marathi ending the other
    lacks ("पवारांचा" for "Pawar"), but only when the shared part is long enough to mean
    something. `cross_script_endings=False` allows an ending only between two Devanagari
    words: for ordinary words, "प्रश्न" (question) is not "press" with an ending.
    """
    if not (has_devanagari(first) or has_devanagari(second)):
        return False
    one, two = skeleton(first), skeleton(second)
    shorter, longer = (one, two) if len(one) <= len(two) else (two, one)
    if len(shorter) < max(2, min_sounds):
        return False
    if shorter == longer:
        return True
    longer_word = second if longer is two else first
    if not cross_script_endings and has_devanagari(first) != has_devanagari(second):
        return False
    return (
        len(shorter) >= MIN_SOUNDS
        and has_devanagari(longer_word)
        and longer.startswith(shorter)
        and longer[len(shorter):] in MARATHI_ENDINGS
    )


def alike_any(
    word: str,
    words: Iterable[str],
    *,
    min_sounds: int = MIN_SOUNDS,
    cross_script_endings: bool = True,
) -> bool:
    return any(
        sound_alike(word, other, min_sounds=min_sounds, cross_script_endings=cross_script_endings) for other in words
    )


def find_alike(word: str, text: str | None, *, min_sounds: int = MIN_SOUNDS) -> int | None:
    """Where a word appears in a text in the other script, or with a Marathi ending: its index."""
    target = str(word or "").strip()
    if not target:
        return None
    for match in _ANY_WORD_RE.finditer(str(text or "")):
        if sound_alike(target, match.group(0), min_sounds=min_sounds):
            return match.start()
    return None


# ── Database search ──────────────────────────────────────────────────────────

_SOUND_LETTERS: dict[str, str] = {}
for _char, _sound in _CONSONANTS.items():
    _SOUND_LETTERS[_sound] = _SOUND_LETTERS.get(_sound, "") + _char
_SOUND_LETTERS["n"] += _NASAL_SIGNS + "म"  # "संभाजी": an anusvara or म where English has m
_SOUND_LETTERS["r"] += _VOCALIC_R
# What may sit between two consonants of one word: vowel signs, virama, nukta, anusvara,
# and the letters that make no sound here (ह, य, य़).
_BETWEEN = "[ऀ-ःऺ-ॏॕ-ॗॢॣहयय़]*"


def devanagari_pattern(word: str) -> str | None:
    """A POSIX regular expression finding an English word's Devanagari spelling, or None.

    Only a first pass for the database: it finds candidates, and `sound_alike` decides.
    """
    if has_devanagari(word):
        return None
    sounds = skeleton(word)
    if len(sounds) < MIN_SOUNDS or any(sound not in _SOUND_LETTERS for sound in sounds):
        return None
    return "".join(f"(?:[{_SOUND_LETTERS[sound]}]{_BETWEEN})+" for sound in sounds)
