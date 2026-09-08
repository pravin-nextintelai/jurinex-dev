"""Indian Kanoon's keyword grammar in the local library: every word required,
"phrases" verbatim, A OR B either, NOT X excluded — and the same meaning
whether the query is typed in the popup, added in the refine bar, or arrives
as one of the pipeline's ORR/NOTT wire queries."""

import stores
from library_query import boolean_clauses, split_boolean
from tools import _es_query_from_wire, es_legal_search, parse_legal_query


# ── The parser ───────────────────────────────────────────────────────────────

def test_plain_words_are_all_required():
    assert split_boolean("quashing of fir") == ("quashing of fir", [], [])


def test_or_joins_neighbours_into_one_group():
    and_text, groups, excluded = split_boolean("quashing bail OR parole")
    assert and_text == "quashing"
    assert groups == [["bail", "parole"]]
    assert excluded == []


def test_or_chains():
    assert split_boolean("bail OR parole OR remission")[1] == [["bail", "parole", "remission"]]


def test_not_excludes_the_next_term():
    and_text, groups, excluded = split_boolean("bail NOT anticipatory")
    assert (and_text, groups, excluded) == ("bail", [], ["anticipatory"])


def test_wire_forms_mean_the_same_as_readable_ones():
    """The pipeline sends ANDD / ORR / NOTT; the popup sends AND / OR / NOT."""
    assert split_boolean("bail ORR parole NOTT anticipatory") == \
           split_boolean("bail OR parole NOT anticipatory")


def test_lowercase_or_and_not_are_ordinary_words():
    """Exactly as on Indian Kanoon: only the uppercase forms are operators."""
    assert split_boolean("whether or not liable") == ("whether or not liable", [], [])


def test_quoted_phrases_may_be_or_members_or_excluded():
    and_text, groups, excluded = split_boolean('"Section 482" OR "Section 528" NOT "civil dispute"')
    assert groups == [['"Section 482"', '"Section 528"']]
    assert excluded == ['"civil dispute"']
    assert and_text == ""


def test_dangling_operators_are_harmless():
    assert split_boolean("OR bail OR") == ("bail", [], [])
    assert split_boolean("bail NOT") == ("bail", [], [])


# ── ES clauses ───────────────────────────────────────────────────────────────

def test_clauses_put_or_in_should_and_not_in_must_not():
    must, must_not = boolean_clauses('quashing "abuse of process" bail OR parole NOT anticipatory')
    kinds = [list(c)[0] for c in must]
    assert kinds.count("multi_match") == 2          # phrase + all-words
    assert any("bool" in c and c["bool"]["minimum_should_match"] == 1 for c in must)
    assert len(must_not) == 1
    assert must_not[0]["multi_match"]["query"] == "anticipatory"


def test_parse_legal_query_keeps_or_and_not_out_of_required_terms():
    parsed = parse_legal_query("quashing bail OR parole NOT anticipatory")
    assert parsed["terms"] == ["quashing"]
    assert parsed["or_groups"] == [["bail", "parole"]]
    assert parsed["excluded"] == ["anticipatory"]


def test_engine_qualification_carries_or_and_not(monkeypatch):
    seen = {}

    def fake_search(query, sort, pagenum, size=10):
        seen["q"] = query
        return {"hits": {"total": {"value": 0}, "hits": []}}

    monkeypatch.setattr(stores.elastic, "search_judgments", fake_search)
    monkeypatch.setattr(stores.elastic, "search_paragraphs", lambda *a, **k: {"hits": {"hits": []}})
    monkeypatch.setattr(type(stores.elastic), "available", property(lambda self: True))
    es_legal_search(parse_legal_query("bail OR parole NOT anticipatory"), mode="strict")
    q = seen["q"]["bool"]
    assert any("bool" in c for c in q["must"]), "OR group missing from must"
    assert q["must_not"] and q["must_not"][0]["multi_match"]["query"] == "anticipatory"


def test_or_only_query_is_not_treated_as_empty(monkeypatch):
    """`bail OR parole` has no required word, but it is a real query."""
    monkeypatch.setattr(stores.elastic, "search_judgments",
                        lambda *a, **k: {"hits": {"total": {"value": 0}, "hits": []}})
    monkeypatch.setattr(stores.elastic, "search_paragraphs", lambda *a, **k: {"hits": {"hits": []}})
    monkeypatch.setattr(type(stores.elastic), "available", property(lambda self: True))
    parsed = parse_legal_query("bail OR parole")
    assert parsed["terms"] == [] and parsed["or_groups"]
    assert es_legal_search(parsed, mode="strict") == []      # ran, found nothing


def test_pipeline_wire_query_honours_orr_and_nott():
    """Before this, an ORR query required the literal word 'orr', matched
    nothing in the library, and fell through to a billed IK search."""
    q = _es_query_from_wire('"Section 482" quash ORR quashing NOTT civil doctypes:supremecourt')["bool"]
    assert any("bool" in c for c in q["must"])
    assert q["must_not"][0]["multi_match"]["query"] == "civil"
    assert q["filter"], "doctypes filter must survive"


# ── Citations survive the operator parser ────────────────────────────────────

def test_citation_parentheses_are_not_stripped():
    """The IK wire translator drops parentheses; the library parser must
    not, or '(2019) 4 SCC 123' stops being recognised as a citation."""
    and_text, groups, excluded = split_boolean("(2019) 4 SCC 123 bail")
    assert and_text == "(2019) 4 SCC 123 bail"
    assert parse_legal_query("(2019) 4 SCC 123 bail")["citations"] == ["(2019) 4 SCC 123"]


def test_a_bare_bracket_never_becomes_a_required_word():
    assert split_boolean("( bail )") == ("bail", [], [])
