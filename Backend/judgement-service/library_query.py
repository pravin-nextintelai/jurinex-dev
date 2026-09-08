"""Indian Kanoon's keyword grammar, for the local judgment library.

The IK path already understands the readable operators — `bail OR parole`,
`bail NOT anticipatory` — and translates them to IK's wire forms (ORR /
NOTT) at fetch time. The library used to see none of that: `OR` became the
word "or" (harmless, present in every judgment) and `NOT` became a REQUIRED
word, the opposite of its meaning. Every library query — the popup's, the
refine bar's and the pipeline's library-first wire queries — now goes
through this one parser, so a keyword search means the same thing on both
sources.

Grammar (IK's, flat and left-to-right):
    words           every word must appear            (AND is implicit)
    "quoted words"  the phrase must appear verbatim
    A OR B OR C     at least one of the members must appear
    NOT X / A NOT X X must not appear
Operators are the uppercase words AND / OR / NOT or IK's wire ANDD / ORR /
NOTT; lowercase "or" and "not" are ordinary words, exactly as on IK.
Parentheses are dropped (IK does not document them either).
"""

from __future__ import annotations

import re
from typing import Any

_OPERATORS = {"AND": "and", "ANDD": "and", "OR": "or", "ORR": "or",
              "NOT": "not", "NOTT": "not"}
_TOKEN_RE = re.compile(r'"[^"]*"|\S+')
_OPERATOR_WORDS = frozenset(_OPERATORS)


def normalize_quotes(text: str) -> str:
    return (text or "").replace("“", '"').replace("”", '"')


def split_boolean(query: str) -> tuple[str, list[list[str]], list[str]]:
    """(and_text, or_groups, excluded).

    and_text  — the tokens that must ALL match, re-joined (quotes kept), for
                the existing phrase / citation / section handling.
    or_groups — lists of tokens where any one member suffices.
    excluded  — tokens that must not appear.
    Tokens are bare words or "quoted phrases" with their quotes.
    """
    text = normalize_quotes(query)
    if text.count('"') % 2:
        text = text[::-1].replace('"', "", 1)[::-1]     # drop a stray quote
    # Parentheses stay attached to their token: "(2019) 4 SCC 123" is a
    # citation and must survive intact (the analyzer ignores the brackets
    # when matching). Only a token with no letters or digits at all — a
    # bare "(" — is dropped, so it can never become a required "word".
    tokens = [t for t in _TOKEN_RE.findall(text)
              if any(ch.isalnum() for ch in t)]

    and_parts: list[str] = []
    or_groups: list[list[str]] = []
    excluded: list[str] = []
    expect_member = False        # an OR was just seen: next token joins it
    open_group: list[str] | None = None
    pending_not = False

    for tok in tokens:
        op = _OPERATORS.get(tok)
        if op == "and":
            expect_member = False
            continue
        if op == "not":
            pending_not = True
            expect_member = False
            continue
        if op == "or":
            if open_group is None:
                if not and_parts:
                    continue                  # leading OR: nothing to join
                open_group = [and_parts.pop()]
                or_groups.append(open_group)
            expect_member = True
            continue
        # a term
        if pending_not:
            excluded.append(tok)
            pending_not = False
            open_group = None
            expect_member = False
            continue
        if expect_member and open_group is not None:
            open_group.append(tok)
            expect_member = False
            continue
        and_parts.append(tok)
        open_group = None

    # A group with one member is just a required term.
    real_groups: list[list[str]] = []
    for group in or_groups:
        if len(group) == 1:
            and_parts.append(group[0])
        elif group:
            real_groups.append(group)
    return " ".join(and_parts), real_groups, excluded


def is_operator(token: str) -> bool:
    return token in _OPERATOR_WORDS


def term_clause(token: str, fields: list[str] | None = None) -> dict[str, Any]:
    """The ES clause for ONE token: a quoted phrase matches verbatim, a
    bare word must appear (across the fields — a case name spans text and
    title)."""
    fields = fields or ["text", "title^2"]
    text = token.strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return {"multi_match": {"query": text[1:-1].strip(), "type": "phrase",
                                "fields": fields}}
    return {"multi_match": {"query": text, "operator": "and",
                            "type": "cross_fields", "fields": fields}}


def group_clause(members: list[str], fields: list[str] | None = None) -> dict[str, Any]:
    """Any one of these members must match."""
    return {"bool": {"should": [term_clause(m, fields) for m in members],
                     "minimum_should_match": 1}}


def boolean_clauses(query: str, fields: list[str] | None = None,
                    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(must, must_not) for a keyword query under the grammar above. The
    AND part becomes one phrase clause per quoted phrase plus one all-words
    clause for the rest; OR groups become should-blocks; NOT terms go to
    must_not."""
    fields = fields or ["text", "title^2"]
    and_text, or_groups, excluded = split_boolean(query)
    must: list[dict[str, Any]] = []
    for phrase in re.findall(r'"([^"]+)"', and_text):
        if phrase.strip():
            must.append({"multi_match": {"query": phrase.strip(), "type": "phrase",
                                         "fields": fields}})
    rest = " ".join(re.sub(r'"[^"]*"', " ", and_text).split())
    if rest:
        must.append({"multi_match": {"query": rest, "operator": "and",
                                     "type": "cross_fields", "fields": fields}})
    for group in or_groups:
        must.append(group_clause(group, fields))
    must_not = [term_clause(t, fields) for t in excluded]
    return must, must_not
