"""Did-you-mean for the library: a misspelt word must become an offer, and
the offer must never touch quoted phrases, numbers, or words the library
already contains — and must never suggest a query that also finds nothing."""

from library_suggest import correctable_words, did_you_mean, rewrite_query


def test_only_bare_words_worth_correcting_are_considered():
    assert correctable_words(["queshing", "of", "fir", "482", "2019", "IPC"]) == [
        "queshing", "fir", "ipc"]


def test_rewrite_replaces_whole_words_outside_quotes_only():
    out = rewrite_query('queshing of fir "queshing petition"', {"queshing": "quashing"})
    assert out == 'quashing of fir "queshing petition"'


def test_rewrite_is_case_insensitive_and_whole_word():
    assert rewrite_query("Queshing squeshing", {"queshing": "quashing"}) == "quashing squeshing"


def test_offer_made_when_the_fix_finds_judgments():
    offer = did_you_mean("queshing of fir", ["queshing", "of", "fir"],
                         suggest=lambda ws: {"queshing": "quashing"},
                         count=lambda q: 210 if q == "quashing of fir" else 0)
    assert offer == {"query": "quashing of fir", "total": 210,
                     "fixes": {"queshing": "quashing"}}


def test_no_offer_when_nothing_is_misspelt():
    assert did_you_mean("quashing of fir", ["quashing", "of", "fir"],
                        suggest=lambda ws: {}, count=lambda q: 210) is None


def test_no_offer_when_the_fix_also_finds_nothing():
    """Suggesting a query that is itself a dead end would be worse than none."""
    assert did_you_mean("queshing xylophone", ["queshing", "xylophone"],
                        suggest=lambda ws: {"queshing": "quashing"},
                        count=lambda q: 0) is None


def test_numbers_are_never_corrected():
    seen = {}
    did_you_mean("section 483 quashing", ["section", "483", "quashing"],
                 suggest=lambda ws: seen.setdefault("asked", ws) and {},
                 count=lambda q: 0)
    assert "483" not in seen["asked"]
