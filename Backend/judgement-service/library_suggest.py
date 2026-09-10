"""Did-you-mean for the local judgment library.

Library search requires every word (Indian Kanoon's rule), so a single
misspelt word — "queshing of fir" — is a dead end. This module turns that
into an offer: the misspelt bare words are looked up against the judgment
text itself (Elasticsearch's term suggester in `missing` mode, so a word the
library contains is never "corrected"), the query is rewritten, and the
rewrite is returned only when it actually finds something.

What is never touched: quoted phrases (verbatim by contract), numbers
(section numbers, years, citations — a nearest-neighbour "fix" would be
wrong, not helpful) and very short tokens.
"""

from __future__ import annotations

import re
from typing import Any, Callable

# Odd-indexed pieces of this split are the quoted phrases, kept verbatim.
_QUOTED_SPLIT = re.compile(r'("[^"]*")')


def correctable_words(terms: list[str]) -> list[str]:
    """The bare words worth asking the suggester about."""
    out: list[str] = []
    for term in terms:
        word = (term or "").strip().lower()
        if len(word) > 2 and not word.isdigit() and word not in out:
            out.append(word)
    return out


def rewrite_query(query: str, fixes: dict[str, str]) -> str:
    """Apply {wrong: right} to the bare (unquoted) part of the query only,
    whole words, case-insensitively. Quoted phrases pass through untouched."""
    if not fixes:
        return query
    pieces = _QUOTED_SPLIT.split(query or "")
    for i in range(0, len(pieces), 2):          # even = outside quotes
        for wrong, right in fixes.items():
            pieces[i] = re.sub(r"(?<!\w)" + re.escape(wrong) + r"(?!\w)",
                               right, pieces[i], flags=re.IGNORECASE)
    return "".join(pieces)


def did_you_mean(query: str, terms: list[str], *,
                 suggest: Callable[[list[str]], dict[str, str]],
                 count: Callable[[str], int]) -> dict[str, Any] | None:
    """{"query": corrected, "total": n} when a spelling fix finds judgments,
    else None. `suggest` maps misspelt words to corrections (ES); `count`
    says how many judgments the rewritten query finds."""
    words = correctable_words(terms)
    if not words:
        return None
    fixes = {w: r for w, r in (suggest(words) or {}).items()
             if r and r.lower() != w.lower()}
    if not fixes:
        return None
    corrected = rewrite_query(query, fixes)
    if corrected.strip().lower() == (query or "").strip().lower():
        return None
    total = int(count(corrected) or 0)
    if total <= 0:
        return None
    return {"query": corrected, "total": total, "fixes": fixes}
