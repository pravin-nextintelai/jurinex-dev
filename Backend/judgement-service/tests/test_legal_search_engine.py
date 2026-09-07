"""The ES-primary legal search engine: query parser, paragraph splitting,
strict phrase qualification, proximity ranking, judgment grouping — the
spec's test matrix at unit level (fallback/threshold cases live in
test_library_first.py)."""

import pytest

import stores
import tools
from tools import (_min_covering_span, build_paragraph_rows, es_legal_search,
                   extract_citations, extract_sections, parse_legal_query,
                   split_judgment_paragraphs)


# ─── Parser ──────────────────────────────────────────────────────────────────

def test_parser_quoted_phrases_are_required_phrases():
    parsed = parse_legal_query('"Section 482" "mala fide" "ulterior motive"')
    assert parsed["phrases"] == ["Section 482", "mala fide", "ulterior motive"]
    assert parsed["terms"] == []
    assert parsed["sections"] == ["482"]


def test_parser_recognises_unquoted_sections_and_bare_terms():
    parsed = parse_legal_query("quashing under Section 482 mala fide")
    assert "Section 482" in parsed["phrases"]  # exact legal term → phrase
    assert "quashing" in parsed["terms"] and "mala" in parsed["terms"]
    assert parsed["sections"] == ["482"]


def test_parser_recognises_citations():
    parsed = parse_legal_query('(2019) 4 SCC 123 "abuse of process"')
    assert parsed["citations"] == ["(2019) 4 SCC 123"]
    assert parsed["phrases"] == ["abuse of process"]


def test_extractors_never_invent():
    assert extract_sections("plain text with no provisions") == []
    assert extract_citations("no citations here") == []
    assert extract_sections("Section 482 and Sections 138") == ["482", "138"]


# ─── Paragraph splitting ─────────────────────────────────────────────────────

def test_split_blank_line_blocks_and_numbered_paras():
    text = ("1. " + "The petitioner filed a suit. " * 12 + "\n"
            + "2. " + "The respondent replied in detail. " * 12 + "\n"
            + "3. " + "We are of the considered view. " * 12)
    paras = split_judgment_paragraphs(text)
    assert len(paras) == 3
    assert paras[0].startswith("1.") and paras[2].startswith("3.")


def test_split_packs_flat_text_and_bounds_sizes():
    paras = split_judgment_paragraphs("A long sentence here. " * 400)
    assert len(paras) > 1
    assert all(len(p) <= 2600 for p in paras)


def test_paragraph_rows_carry_metadata_not_inventions():
    body = {"title": "T vs S", "docsource": "Bombay High Court",
            "publishdate": "2024-01-01",
            "text": ("The FIR under Section 482 CrPC is challenged. " * 10
                     + "\n\n" + "Reliance on (2019) 4 SCC 123 is misplaced. " * 10)}
    rows = build_paragraph_rows("42", body)
    assert [r["paragraph_no"] for r in rows] == [1, 2]
    assert rows[0]["sections"] == ["482"]
    assert rows[1]["citations"] == ["(2019) 4 SCC 123"]
    assert all("paragraph_type" not in r for r in rows)  # never invented


# ─── Proximity math ──────────────────────────────────────────────────────────

def test_min_covering_span():
    a, b, c = frozenset({"ph:0"}), frozenset({"ph:1"}), frozenset({"ph:2"})
    wanted = frozenset({"ph:0", "ph:1", "ph:2"})
    assert _min_covering_span([(5, a | b | c)], wanted) == 0        # same para
    assert _min_covering_span([(5, a), (6, b), (7, c)], wanted) == 2
    assert _min_covering_span([(5, a), (80, b), (190, c)], wanted) == 185
    assert _min_covering_span([(5, a), (6, b)], wanted) is None     # not covered


# ─── Engine (ES mocked) ──────────────────────────────────────────────────────

@pytest.fixture
def es_stub(monkeypatch):
    """Pretend ES is up; capture step-1/step-2 queries; serve canned hits."""
    state = {"qualification": None, "evidence": None,
             "judgment_hits": [], "paragraph_hits": []}
    monkeypatch.setattr(type(stores.elastic), "available",
                        property(lambda self: True))

    def fake_judgments(query, sort, pagenum, size=10):
        state["qualification"] = query
        return {"hits": {"total": {"value": len(state["judgment_hits"])},
                         "hits": state["judgment_hits"]}}

    def fake_paragraphs(query, size=200):
        state["evidence"] = query
        return {"hits": {"hits": state["paragraph_hits"]}}

    monkeypatch.setattr(stores.elastic, "search_judgments", fake_judgments)
    monkeypatch.setattr(stores.elastic, "search_paragraphs", fake_paragraphs)
    return state


def _jhit(jid, score):
    return {"_id": jid, "_score": score,
            "_source": {"tid": jid, "title": f"Case {jid}", "docsource":
                        "Bombay High Court", "publishdate": "2024-01-01",
                        "numcitedby": 1}}


def _phit(jid, para_no, names, score=1.0, sections=None):
    return {"_score": score, "matched_queries": list(names),
            "_source": {"judgment_id": jid, "paragraph_no": para_no,
                        "sections": sections or [], "paragraph_type": ""}}


def test_strict_mode_requires_every_phrase(es_stub):
    parsed = parse_legal_query('"Section 482" "mala fide" "ulterior motive"')
    es_stub["judgment_hits"] = [_jhit("J1", 10.0)]
    es_legal_search(parsed, mode="strict")
    must = es_stub["qualification"]["bool"]["must"]
    phrase_musts = [c for c in must if "match_phrase" in c]
    assert len(phrase_musts) == 3  # ALL quoted phrases are bool.must clauses
    assert {c["match_phrase"]["text"]["query"] for c in phrase_musts} == {
        "Section 482", "mala fide", "ulterior motive"}


def test_proximity_outranks_scatter_at_equal_bm25(es_stub):
    parsed = parse_legal_query('"Section 482" "mala fide" "ulterior motive"')
    es_stub["judgment_hits"] = [_jhit("NEAR", 10.0), _jhit("FAR", 10.0)]
    es_stub["paragraph_hits"] = [
        _phit("NEAR", 82, {"ph:0", "ph:1"}), _phit("NEAR", 83, {"ph:2"}),
        _phit("FAR", 10, {"ph:0"}), _phit("FAR", 80, {"ph:1"}),
        _phit("FAR", 190, {"ph:2"}),
    ]
    ranked = es_legal_search(parsed, mode="strict")
    assert [d["tid"] for d in ranked] == ["NEAR", "FAR"]
    assert ranked[0]["finalScore"] > ranked[1]["finalScore"]


def test_paragraphs_group_into_one_judgment(es_stub):
    parsed = parse_legal_query('"abuse of process"')
    es_stub["judgment_hits"] = [_jhit("J1", 5.0)]
    es_stub["paragraph_hits"] = [
        _phit("J1", 82, {"ph:0"}), _phit("J1", 83, {"ph:0"}),
        _phit("J1", 84, {"ph:0"})]
    ranked = es_legal_search(parsed, mode="strict")
    assert len(ranked) == 1  # one judgment, never duplicates
    assert ranked[0]["matchedParagraphs"] == [82, 83, 84]


def test_section_metadata_boosts_when_query_names_a_section(es_stub):
    parsed = parse_legal_query('"Section 482" "mala fide"')
    es_stub["judgment_hits"] = [_jhit("WITH", 10.0), _jhit("WITHOUT", 10.0)]
    es_stub["paragraph_hits"] = [
        _phit("WITH", 5, {"ph:0", "ph:1"}, sections=["482"]),
        _phit("WITHOUT", 5, {"ph:0", "ph:1"}, sections=[]),
    ]
    ranked = es_legal_search(parsed, mode="strict")
    assert [d["tid"] for d in ranked] == ["WITH", "WITHOUT"]


def test_es_down_returns_empty_for_ik_fallback(monkeypatch):
    monkeypatch.setattr(type(stores.elastic), "available",
                        property(lambda self: False))
    parsed = parse_legal_query('"Section 482"')
    assert es_legal_search(parsed, mode="strict") == []


def test_search_timeout_is_reported_not_read_as_empty_library(es_stub, monkeypatch):
    """A timed-out ES search must NOT look like "nothing matched" — the
    caller has to be able to tell the two apart (api raises 503)."""
    es_stub["judgment_hits"] = []
    parsed = parse_legal_query('"Section 482"')
    ok_stats: dict = {}
    assert es_legal_search(parsed, mode="strict", stats=ok_stats) == []
    assert not ok_stats.get("failed")  # genuinely empty library

    def timed_out(query, sort, pagenum, size=10):
        return None

    monkeypatch.setattr(stores.elastic, "search_judgments", timed_out)
    failed_stats: dict = {}
    assert es_legal_search(parsed, mode="strict", stats=failed_stats) == []
    assert failed_stats["failed"] is True


def test_flexible_mode_does_not_require_all_words(es_stub):
    parsed = parse_legal_query(
        "cases where proceedings under Section 482 were quashed")
    es_stub["judgment_hits"] = [_jhit("J1", 4.0)]
    es_legal_search(parsed, mode="flexible")
    bool_q = es_stub["qualification"]["bool"]
    assert "should" in bool_q and bool_q.get("minimum_should_match") == 1
    assert not bool_q.get("must")  # BM25, not strict AND
