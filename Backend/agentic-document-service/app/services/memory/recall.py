"""Past-session retrieval: find what was discussed earlier in this case.

Memory holds the short, durable summary. The detail of earlier discussions lives
in the case's chat history, and this module searches it on demand, only when the
advocate's own words point backwards: "the ground we discussed", "as decided
earlier", "the previous draft".

Three rules from the guide shape it.

**Scoped to the case.** Every query filters on this folder and on the advocate
asking. Chat history is keyed by folder *name*, not by case, and folder names are
not unique, so recall also refuses to run when the name matches more than one
folder the advocate can see. Returning nothing is always preferable to returning
another case's discussion.

**Provenance is preserved.** Each hit says who produced it: what the advocate
said, which saved prompt they ran, what the assistant answered. The model is told
that an earlier answer is something previously suggested, never a decision the
advocate made.

**The current session wins.** Hits never come from the current session, which the
conversation history already carries, and the block is placed ahead of that
history so it is the first thing trimmed when a prompt runs long.
"""
from __future__ import annotations

import logging
import re
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterator, Sequence

from app.services.db import get_db_connection, is_db_available
from app.services.memory.scope import CaseScope

logger = logging.getLogger("agentic_document_service.memory.recall")

MAX_HITS = 3
MAX_TERMS = 8
QUESTION_CHARS = 300
ANSWER_CHARS = 700
SHORT_ANSWER_CHARS = 250
# Recall runs inside the chat's memory time box. A slow search must give up on
# its own rather than cost the advocate their preferences and instructions too.
STATEMENT_TIMEOUT = "1500ms"
# The marker the chat route's history block ends with; the Gemma input clamp
# preserves everything after it.
HISTORY_MARKER = "Current question:\n"


# ── When to look back ────────────────────────────────────────────────────────
# Linguistic cues, not keywords (guide section 8). Bare "earlier" or "previously"
# are deliberately not cues: "the earlier order" and "previously arrested" are
# about the record, not about a past conversation.

_VERB = (
    r"(?:discussed|decided|agreed|mentioned|said|talked\s+about|covered|raised|"
    r"went\s+over|finali[sz]ed|settled\s+on)"
)
_WHEN = r"(?:earlier|previously|last\s+time|the\s+other\s+day|yesterday|last\s+week)"

RECALL_CUE = re.compile(
    r"\b(?:"
    rf"we\s+(?:had\s+|have\s+)?{_VERB}"
    # "as discussed" yes; "as mentioned in the FIR" no — that points at a document.
    rf"|as\s+(?:we\s+|i\s+|you\s+)?{_VERB}(?!\s+(?:in|by|under|at|on|within|per|to)\b)"
    rf"|{_VERB}\s+{_WHEN}"
    rf"|(?:earlier|previously)\s+{_VERB}"
    r"|you\s+(?:said|told\s+me|mentioned|suggested|explained|recommended|drafted|wrote)"
    r"|i\s+(?:told|asked)\s+you"
    r"|(?:last|previous|earlier)\s+(?:session|chat|conversation|discussion)"
    r"|(?:the|our|my|your|that)\s+(?:previous|last|earlier|old|first)\s+"
    r"(?:draft|answer|reply|response|version|analysis|summary|opinion)"
    r"|remind\s+me|refresh\s+my\s+memory|pick\s+up\s+where|where\s+we\s+left\s+off"
    r"|what\s+did\s+(?:we|you|i)\s+(?:say|discuss|decide|agree|conclude|draft|suggest)"
    r")\b",
    re.IGNORECASE,
)


def has_recall_cue(question_raw: str | None) -> bool:
    """True when the advocate's own words refer back to an earlier discussion."""
    return bool(RECALL_CUE.search(str(question_raw or "")))


# ── What to search for ───────────────────────────────────────────────────────

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'-]*")

_STOPWORDS = frozenset(
    """
    a an the and or but if then than that this these those there here is are was were be been being am
    i me my we our us you your he she it they them their his her its of to in on at by for with from as
    about into over after under again further once when where why how all any both each few more most
    other some such no nor not only own same so too very can will just should now do does did done have
    has had having would could shall may must let lets like want need please also what which who whom
    add draft make write give show tell use include put get go take keep bring
    case matter client document documents file
    last time earlier previously previous session chat conversation discussion before ago yesterday
    week day today discussed decided agreed mentioned said told talked covered raised suggested
    """.split()
)


def query_terms(question_raw: str | None, max_terms: int = MAX_TERMS) -> list[str]:
    """Topic words from the question, without the backward reference itself.

    "Add the medical ground we discussed" searches for "medical" and "ground",
    not for "we discussed", which every earlier chat would match.
    """
    text = RECALL_CUE.sub(" ", str(question_raw or "")).lower()
    terms: list[str] = []
    for token in _TOKEN_RE.findall(text):
        token = token.strip("'-")
        if len(token) < 3 or token in _STOPWORDS or token in terms:
            continue
        terms.append(token)
        if len(terms) >= max_terms:
            break
    return terms


# ── Searching ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class RecallHit:
    """One earlier turn of this case."""

    chat_id: str
    session_id: str
    created_at: str
    question: str
    answer: str
    prompt_label: str | None
    used_saved_prompt: bool
    rank: float = 0.0


# Chat history is keyed by folder name. If the advocate can see more than one
# folder with this name, earlier chats cannot be attributed to one case.
_AMBIGUITY_SQL = """
SELECT COUNT(*) AS folders
FROM user_files
WHERE is_folder = true
  AND originalname = %s
  AND user_id::text = ANY(%s::text[])
"""

# The tsvector expression must stay identical to idx_folder_chats_fts
# (migration 171) for the index to be used.
_SEARCH_SQL = """
SELECT id::text AS chat_id,
       session_id::text AS session_id,
       question,
       answer,
       prompt_label,
       used_secret_prompt,
       created_at,
       ts_rank_cd(to_tsvector('english', coalesce(question, '') || ' ' || coalesce(answer, '')), query) AS rank
FROM folder_chats, websearch_to_tsquery('english', %s) AS query
WHERE folder_name = %s
  AND user_id::text = %s
  AND session_id IS NOT NULL
  AND session_id::text <> %s
  AND to_tsvector('english', coalesce(question, '') || ' ' || coalesce(answer, '')) @@ query
ORDER BY rank DESC, created_at DESC
LIMIT %s
"""

# No topic words ("what did we decide last time?"): the most recent earlier turns.
_RECENT_SQL = """
SELECT id::text AS chat_id,
       session_id::text AS session_id,
       question,
       answer,
       prompt_label,
       used_secret_prompt,
       created_at,
       0.0 AS rank
FROM folder_chats
WHERE folder_name = %s
  AND user_id::text = %s
  AND session_id IS NOT NULL
  AND session_id::text <> %s
ORDER BY created_at DESC
LIMIT %s
"""


@contextmanager
def _connection(existing: Any = None) -> Iterator[Any]:
    if existing is not None:
        yield existing
        return
    with get_db_connection() as conn:
        yield conn


def _normalize_session(session_id: str | None) -> str:
    """Stored session ids are dashed UUIDs; a request may send 32 bare hex digits."""
    raw = str(session_id or "").strip()
    if not raw:
        return ""
    try:
        return str(uuid.UUID(raw))
    except (ValueError, AttributeError, TypeError):
        return raw


def folder_is_ambiguous(cur: Any, scope: CaseScope) -> bool:
    """True when this folder name identifies more than one folder the advocate can see."""
    owners = [str(uid) for uid in (scope.accessible_user_ids or ()) if str(uid).strip()]
    cur.execute(_AMBIGUITY_SQL, (scope.folder_name, owners or [str(scope.user_id)]))
    row = cur.fetchone() or {}
    try:
        return int(row.get("folders") or 0) > 1
    except (TypeError, ValueError):
        return True


def search_past_sessions(
    scope: CaseScope | None,
    *,
    question_raw: str,
    current_session_id: str | None = None,
    limit: int = MAX_HITS,
    conn: Any = None,
) -> list[RecallHit]:
    """Earlier turns of this case that match the advocate's question.

    Returns [] whenever it cannot be sure the results belong to this case: no
    scope, no user, no database, or a folder name shared by more than one folder
    the advocate can see. Only the advocate's own chats are searched, and never
    the current session.
    """
    if scope is None:
        return []
    user_id = str(scope.user_id or "").strip()
    folder_name = str(scope.folder_name or "").strip()
    if not user_id or not folder_name:
        return []
    if conn is None and not is_db_available():
        return []

    terms = query_terms(question_raw)
    excluded = _normalize_session(current_session_id)
    cap = max(1, min(int(limit or MAX_HITS), 10))

    with _connection(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute("SELECT set_config('statement_timeout', %s, true)", (STATEMENT_TIMEOUT,))
            if folder_is_ambiguous(cur, scope):
                logger.info(
                    "[Memory] recall skipped: the folder name matches more than one folder for user_id=%s",
                    user_id,
                )
                return []
            if terms:
                cur.execute(_SEARCH_SQL, (" or ".join(terms), folder_name, user_id, excluded, cap))
            else:
                cur.execute(_RECENT_SQL, (folder_name, user_id, excluded, cap))
            rows = list(cur.fetchall() or [])
        finally:
            # Read-only work. Ending the transaction keeps the local statement
            # timeout from outliving this search on a reused connection.
            connection.rollback()

    hits = [hit for hit in (_to_hit(row) for row in rows) if hit is not None]
    logger.info(
        "[Memory] recall case_key=%s topic_terms=%s hits=%s",
        scope.case_key,
        len(terms),
        len(hits),
    )
    return hits


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"true", "t", "1", "yes", "y"}


def _collapse(value: Any) -> str:
    return " ".join(str(value or "").split())


def _to_hit(row: dict[str, Any]) -> RecallHit | None:
    chat_id = _collapse(row.get("chat_id"))
    answer = _collapse(row.get("answer"))
    if not chat_id or not answer:
        return None
    question = _collapse(row.get("question"))
    label = _collapse(row.get("prompt_label")) or None
    # A saved prompt stores its name, not the advocate's words, as the question.
    saved = _truthy(row.get("used_secret_prompt")) or bool(label and question and question == label)
    created = row.get("created_at")
    created_text = created.isoformat() if isinstance(created, (datetime, date)) else _collapse(created)
    try:
        rank = float(row.get("rank") or 0.0)
    except (TypeError, ValueError):
        rank = 0.0
    return RecallHit(
        chat_id=chat_id,
        session_id=_collapse(row.get("session_id")),
        created_at=created_text,
        question=question,
        answer=answer,
        prompt_label=label,
        used_saved_prompt=saved,
        rank=rank,
    )


# ── Rendering ────────────────────────────────────────────────────────────────

RECALL_HEADER = (
    "=== EARLIER SESSIONS IN THIS CASE (retrieved because the advocate referred back to an "
    "earlier discussion; the current conversation overrides anything here) ==="
)
RECALL_FOOTER = (
    'How to use these: "ADVOCATE SAID" is the advocate\'s own words. "ASSISTANT ANSWERED" is an '
    "earlier AI answer: treat it as something previously suggested, never as a decision the advocate "
    "made, and never as a source to cite. If none of these is what the advocate means, say so and ask."
)


def _clip(text: str, limit: int) -> str:
    body = _collapse(text)
    if len(body) <= limit:
        return body
    cut = body[: max(1, limit - 1)]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:") + "…"


def _quote(text: str, limit: int) -> str:
    return _clip(text, limit).replace('"', "'")


def _render_hit(index: int, hit: RecallHit, answer_chars: int) -> str:
    when = f" ({hit.created_at[:10]})" if hit.created_at else ""
    if hit.used_saved_prompt:
        asked = f'ADVOCATE RAN A SAVED PROMPT: "{_quote(hit.prompt_label or hit.question, QUESTION_CHARS)}"'
    elif hit.question:
        asked = f'ADVOCATE SAID: "{_quote(hit.question, QUESTION_CHARS)}"'
    else:
        asked = "ADVOCATE SAID: [not recorded]"
    answered = f'ASSISTANT ANSWERED: "{_quote(hit.answer, answer_chars)}"'
    return f"[{index}] Earlier session{when}\n{asked}\n{answered}"


def format_recall_block(hits: Sequence[RecallHit], max_chars: int) -> tuple[str, list[str]]:
    """The recall block and the ids of the chats actually shown in it.

    Hits are added in rank order while they fit; a hit that does not fit with its
    full answer is tried once with a shorter one before rendering stops.
    """
    if not hits or max_chars <= 0:
        return "", []
    room = max_chars - len(RECALL_HEADER) - len(RECALL_FOOTER) - 4
    if room < 200:
        return "", []

    entries: list[str] = []
    shown: list[str] = []
    for hit in hits:
        index = len(entries) + 1
        for answer_chars in (ANSWER_CHARS, SHORT_ANSWER_CHARS):
            entry = _render_hit(index, hit, answer_chars)
            if len("\n\n".join([*entries, entry])) <= room:
                entries.append(entry)
                shown.append(hit.chat_id)
                break
        else:
            break

    if not entries:
        return "", []
    return f"{RECALL_HEADER}\n" + "\n\n".join(entries) + f"\n\n{RECALL_FOOTER}", shown


def merge_recall_into_query(query_text: str, recall_block: str) -> str:
    """Put recall ahead of everything else in the query, keeping the question last.

    The chat route's history block ends with "Current question:", and its Gemma
    clamp trims from the left while preserving what follows that marker. Recall
    placed first is therefore dropped before any history, and the advocate's
    question is never cut. When there is no history yet, the marker is added so
    the same guarantee holds.
    """
    if not recall_block:
        return query_text
    body = str(query_text or "")
    if HISTORY_MARKER in body:
        return f"{recall_block}\n\n{body}"
    return f"{recall_block}\n\n{HISTORY_MARKER}{body}"
