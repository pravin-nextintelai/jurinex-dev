"""Library-first fetching: each ground's FIRST round searches the local
Elasticsearch dataset ONLY. A ground whose library round verifies at
least library_first_min (3) usable judgments spends ZERO Indian Kanoon
calls; fewer than 3 verified → one normal IK round tops it up (and grows
the library)."""

import asyncio
from types import SimpleNamespace

import pytest

import tools
from schemas import CaseContext, Issue, KeywordSet
from tools import ik_client


def _lib_doc(tid: int):
    return {"tid": str(tid), "title": f"Library Case {tid} vs State",
            "headline": "…from the local dataset…",
            "docsource": "Bombay High Court", "publishdate": "2025-01-10",
            "numcitedby": 4}


def _kw() -> KeywordSet:
    return KeywordSet(anchor_queries=['"civil dispute" quash', '"Section 482" quash'],
                      statutory=["Section 482 CrPC"])


def test_enough_library_candidates_skip_ik_entirely(monkeypatch):
    monkeypatch.setattr(tools, "es_wire_search",
                        lambda wire, size=10, pagenum=0: [_lib_doc(1), _lib_doc(2), _lib_doc(3)])

    async def ik_must_not_run(query, pagenum=0):  # pragma: no cover
        raise AssertionError("IK searched although the library had enough")

    monkeypatch.setattr(ik_client, "search", ik_must_not_run)
    page_map: dict[str, int] = {}
    pool = asyncio.run(ik_client.fanout_and_fetch(_kw(), page_map=page_map))
    assert {c.doc_id for c in pool} == {"1", "2", "3"}
    assert all(c.from_library for c in pool)
    assert page_map == {}  # no IK pages spent, no ES paging ledger


def test_repeat_runs_keep_serving_the_library_never_ik(monkeypatch):
    """THE RULE: while the library has anything for a query, EVERY run
    serves it locally — IK is never consulted, run after run."""
    def fake_es(wire, size=10, pagenum=0):
        assert pagenum == 0  # library always serves its best matches
        return [_lib_doc(1), _lib_doc(2)]

    monkeypatch.setattr(tools, "es_wire_search", fake_es)

    async def ik_must_not_run(query, pagenum=0):  # pragma: no cover
        raise AssertionError("IK searched although the library had judgments")

    monkeypatch.setattr(ik_client, "search", ik_must_not_run)
    # Legacy es: ledger entries from the removed ES-paging design must not
    # push the library past its depth.
    kw = _kw()
    page_map = {f"es:{tools.build_ik_query(q)}": 1 for q in kw.anchor_queries}
    for _ in range(3):  # three consecutive runs
        pool = asyncio.run(ik_client.fanout_and_fetch(kw, page_map=page_map))
        assert {c.doc_id for c in pool} == {"1", "2"}
        assert all(c.from_library for c in pool)


def test_zero_library_hits_fall_back_to_ik(monkeypatch):
    # Default (mixed) mode: ANY library hit serves a query; a zero-hit
    # query falls through to IK in the same call. The production first
    # round instead passes library_only=True (tested below) and defers the
    # IK decision to the issue-level verified count.
    monkeypatch.setattr(tools, "es_wire_search",
                        lambda wire, size=10, pagenum=0: [])
    sent: list[str] = []

    async def fake_ik(query, pagenum=0):
        sent.append(query)
        return [{"tid": "9", "title": "IK Case vs State", "headline": "…",
                 "docsource": "Supreme Court of India", "publishdate": "2024-05-05",
                 "numcitedby": 2}]

    monkeypatch.setattr(ik_client, "search", fake_ik)
    page_map: dict[str, int] = {}
    pool = asyncio.run(ik_client.fanout_and_fetch(_kw(), page_map=page_map))
    assert len(sent) == 2                      # one IK call per display query
    assert {c.doc_id for c in pool} == {"9"}
    assert all(page == 0 for page in page_map.values())


def test_library_only_round_never_touches_ik_even_when_empty(monkeypatch):
    """The pure-ES first round: an empty library fetches NOTHING — no IK
    call, no IK page burned. The fallback happens at the issue level."""
    monkeypatch.setattr(tools, "es_wire_search",
                        lambda wire, size=10, pagenum=0: [])

    async def ik_must_not_run(query, pagenum=0):  # pragma: no cover
        raise AssertionError("IK searched during a library-only round")

    monkeypatch.setattr(ik_client, "search", ik_must_not_run)
    page_map: dict[str, int] = {}
    pool = asyncio.run(ik_client.fanout_and_fetch(_kw(), page_map=page_map,
                                                  library_only=True))
    assert pool == []
    assert page_map == {}  # IK pages stay unburned for the fallback round


def test_library_only_round_serves_partial_hits_without_ik(monkeypatch):
    """library_only: a query the library CAN satisfy serves; one it can't
    contributes nothing — and still no IK call for either."""
    def fake_es(wire, size=10, pagenum=0):
        return [_lib_doc(5)] if "quash" in wire and "482" not in wire else []

    monkeypatch.setattr(tools, "es_wire_search", fake_es)

    async def ik_must_not_run(query, pagenum=0):  # pragma: no cover
        raise AssertionError("IK searched during a library-only round")

    monkeypatch.setattr(ik_client, "search", ik_must_not_run)
    pool = asyncio.run(ik_client.fanout_and_fetch(_kw(), page_map={},
                                                  library_only=True))
    assert {c.doc_id for c in pool} == {"5"}
    assert all(c.from_library for c in pool)


def test_wire_translation_mirrors_ik_grammar():
    q = tools._es_query_from_wire(
        '"civil dispute" quash doctypes:supremecourt,bombay fromdate:1-1-2020 todate:31-12-2023')
    musts = q["bool"]["must"]
    assert {"multi_match": {"query": "civil dispute", "type": "phrase",
                            "fields": ["text", "title^2"]}} in musts
    # cross_fields: the words may span text AND title (a case name matches
    # its own judgment) — the same clause the popup's library search sends.
    assert {"multi_match": {"query": "quash", "operator": "and",
                            "type": "cross_fields",
                            "fields": ["text", "title^2"]}} in musts
    filters = q["bool"]["filter"]
    assert any("range" in f and f["range"]["publishdate"] ==
               {"gte": "2020-01-01", "lte": "2023-12-31"} for f in filters)
    assert any("bool" in f for f in filters)  # the doctypes → docsource clause


def test_exact_repeat_query_served_from_search_cache(monkeypatch):
    """The 'same keyword twice' guarantee: a wire query IK answered before
    is served the SAME judgments from ES — even below the 3-hit threshold,
    and without any IK call."""
    monkeypatch.setattr(tools, "es_search_cache_get",
                        lambda wire: [_lib_doc(21), _lib_doc(22)])

    async def ik_must_not_run(query, pagenum=0):  # pragma: no cover
        raise AssertionError("IK re-asked a query it already answered")

    monkeypatch.setattr(ik_client, "search", ik_must_not_run)
    page_map: dict[str, int] = {}
    pool = asyncio.run(ik_client.fanout_and_fetch(_kw(), page_map=page_map))
    assert {c.doc_id for c in pool} == {"21", "22"}
    assert all(c.from_library for c in pool)
    assert not any(not k.startswith("es:") for k in page_map)  # no IK pages spent


@pytest.mark.asyncio
async def test_thin_library_serve_tops_up_from_ik(monkeypatch):
    """The user's guarantee: a library-served ground with too few USABLE
    judgments consults Indian Kanoon after all (one normal round)."""
    import agents
    calls: list[bool] = []

    async def fake_round(issue_arg, ctx_arg, kw_arg, exclude=None,
                         page_map=None, use_library=True):
        calls.append(use_library)
        if use_library:
            # Library served candidates but verification left ZERO usable.
            return {"candidates": {"L1": "c"}, "scored": [], "fromLibrary": True}
        assert exclude == {"L1"}  # never re-fetch what the library gave
        return {"candidates": {"K1": "c"},
                "scored": [SimpleNamespace(doc_id="K1")], "fromLibrary": False}

    monkeypatch.setattr(agents, "_issue_round", fake_round)
    ctx = CaseContext(document_type="note")
    out = await agents._process_issue(Issue(id=1, issue="Whether X?"), ctx,
                                      pre_keywords=_kw())
    assert calls == [True, False]  # library first, then the IK top-up
    assert {r.doc_id for r in out["scored"]} == {"K1"}
    assert set(out["candidates"]) == {"L1", "K1"}  # closed world holds


@pytest.mark.asyncio
async def test_sufficient_library_serve_never_calls_ik(monkeypatch):
    import agents
    calls: list[bool] = []

    async def fake_round(issue_arg, ctx_arg, kw_arg, exclude=None,
                         page_map=None, use_library=True):
        calls.append(use_library)
        scored = [SimpleNamespace(doc_id=f"L{i}") for i in range(3)]
        return {"candidates": {r.doc_id: "c" for r in scored},
                "scored": scored, "fromLibrary": True}

    monkeypatch.setattr(agents, "_issue_round", fake_round)
    ctx = CaseContext(document_type="note")
    out = await agents._process_issue(Issue(id=2, issue="Whether Y?"), ctx,
                                      pre_keywords=_kw())
    assert calls == [True]  # 3 usable library judgments → IK never consulted
    assert len(out["scored"]) == 3


@pytest.mark.asyncio
async def test_two_verified_library_judgments_still_fall_back_to_ik(monkeypatch):
    """THE 3-JUDGMENT RULE: 2 verified from ES is below library_first_min
    (3) — Indian Kanoon is consulted and both rounds combine."""
    import agents
    calls: list[bool] = []

    async def fake_round(issue_arg, ctx_arg, kw_arg, exclude=None,
                         page_map=None, use_library=True):
        calls.append(use_library)
        if use_library:
            scored = [SimpleNamespace(doc_id="L1"), SimpleNamespace(doc_id="L2")]
            return {"candidates": {r.doc_id: "c" for r in scored},
                    "scored": scored, "fromLibrary": True}
        assert exclude == {"L1", "L2"}
        return {"candidates": {"K1": "c"},
                "scored": [SimpleNamespace(doc_id="K1")], "fromLibrary": False}

    monkeypatch.setattr(agents, "_issue_round", fake_round)
    ctx = CaseContext(document_type="note")
    out = await agents._process_issue(Issue(id=3, issue="Whether Z?"), ctx,
                                      pre_keywords=_kw())
    assert calls == [True, False]  # 2 < 3 verified → IK fallback round
    assert [r.doc_id for r in out["scored"]] == ["L1", "L2", "K1"]


@pytest.mark.asyncio
async def test_empty_library_round_reports_from_library(monkeypatch):
    """Wiring check on the REAL _issue_round: an empty pure-ES round makes
    no IK call and still reports fromLibrary, so _process_issue owes the
    IK fallback."""
    import agents

    async def ik_must_not_run(query, pagenum=0):  # pragma: no cover
        raise AssertionError("IK searched during the library-only round")

    monkeypatch.setattr(ik_client, "search", ik_must_not_run)
    ctx = CaseContext(document_type="note")
    out = await agents._issue_round(Issue(id=4, issue="Whether W?"), ctx, _kw())
    assert out == {"candidates": {}, "scored": [], "fromLibrary": True}


def test_doc_read_prefers_library_text(monkeypatch):
    """fetch_doc_bundle serves an ES-stored judgment without any IK call."""
    monkeypatch.setattr(tools, "es_get_judgment", lambda doc_id: {
        "tid": "77", "title": "Stored Case vs State", "text": "the full stored text",
        "publishdate": "2024-02-02", "numcites": 2, "numcitedby": 5,
        "casesCited": [{"title": "A vs B", "docId": "1"}], "citedBy": []})

    async def ik_must_not_run(path, params=None):  # pragma: no cover
        raise AssertionError("IK /doc called although the library had the text")

    monkeypatch.setattr(ik_client, "_request", ik_must_not_run)
    text, info = asyncio.run(ik_client.fetch_doc_bundle("77"))
    assert text == "the full stored text"
    assert info["citedByTotal"] == 5 and info["casesCitedSample"]
