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

**Found however it was worded.** Three rankings are fused: meaning (embeddings of
each earlier turn, app/services/memory/chat_index.py), English full-text search, and
the advocate's topic words found in their earlier messages, matched across scripts
("ग्राउंड" is "ground"). Meaning alone cannot tell an unrelated question from a real
one, since every chat in a case is about the case, so only turns close to its best
match take part; the words keep an exact reference on top.
"""
from __future__ import annotations

import logging
import re
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterator, Sequence

from app.services.db import get_db_connection, is_db_available
from app.services.memory import chat_index, script
from app.services.memory.scope import CaseScope

logger = logging.getLogger("agentic_document_service.memory.recall")

MAX_HITS = 3
MAX_TERMS = 8
# How many turns each ranking offers the fusion, and how the ranks are combined.
POOL = 10
RRF_K = 60
# Turns found by meaning take part only when this close to the best match. Measured on a
# real case: the right turn led by 0.02–0.08, and an unrelated question scored as high as
# a related one, so no absolute threshold separates them.
SEMANTIC_BAND = 0.06
MIN_SIMILARITY = 0.5
# The advocate's earlier messages read for topic words, newest first.
ASKED_TURNS = 200
ASKED_CHARS = 600
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
    # "which ground did we agree to drop", "the point did we settle on"
    r"|did\s+we\s+(?:discuss|decide|agree|conclude|settle|finali[sz]e)"
    r")\b",
    re.IGNORECASE,
)

# The same, in Marathi and Hindi. A few words may sit between the subject and the verb
# ("आपण या मुद्द्यावर चर्चा केली", "हमने कौन सा ग्राउंड छोड़ने का फैसला किया था").
# "सांगितलेले" alone is not a cue: "FIR मध्ये सांगितलेले" points at the record.
_GAP = r"(?:[^\s.?!।]+\s+){0,5}"
RECALL_CUE_DEVANAGARI = re.compile(
    rf"(?<![{script.LETTERS}])(?:"
    # Marathi: we discussed / decided / agreed; the point we discussed; you said
    rf"(?:आपण|आम्ही)\s+{_GAP}(?:चर्चा\s+केल|ठरवल|बोलल|मान्य\s+केल|निश्चित\s+केल)"
    r"|चर्चा\s+केलेल"
    rf"|(?:तू|तुम्ही)\s+{_GAP}(?:सांगितल|सुचवल|लिहिल)"
    # last time, the last chat, the previous draft or answer
    r"|(?:मागच्या|मागील|आधीच्या|पूर्वीच्या|गेल्या)\s+(?:वेळी|वेळेस|चॅट|चर्चे|संभाषण|सत्र)"
    r"|(?:मागचा|मागील|आधीचा|पूर्वीचा)\s+(?:ड्राफ्ट|मसुदा|उत्तर)"
    r"|आठवण\s+करू?न\s+(?:दे|द्या)|जिथे\s+(?:थांबलो|सोडले)"
    # Hindi: we discussed / decided; as we said; last time; you said; remind me
    rf"|(?:हमने|हम\s+ने)\s+{_GAP}(?:चर्चा|बात\s+की|तय\s+किया|फैसला\s+किया|निर्णय\s+लिया)"
    r"|जैसा\s+(?:कि\s+)?(?:हमने|आपने|पहले)"
    r"|(?:पिछली|पिछले|पिछला)\s+(?:बार|चैट|सत्र|बातचीत|ड्राफ्ट|मसौदा|जवाब|उत्तर)"
    rf"|(?:आपने|तुमने)\s+{_GAP}(?:कहा|बताया|सुझाया|लिखा)\s+था"
    r"|याद\s+(?:दिलाओ|दिलाइए|दिलाएं|दिला\s+दो)|जहां\s+(?:हमने\s+)?छोड़ा\s+था"
    r")"
)


def has_recall_cue(question_raw: str | None) -> bool:
    """True when the advocate's own words refer back to an earlier discussion."""
    text = str(question_raw or "")
    return bool(RECALL_CUE.search(text) or RECALL_CUE_DEVANAGARI.search(text))


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


# Marathi and Hindi words of a backward reference, which every earlier chat would match.
_DEVANAGARI_CUE_WORDS = frozenset(
    """
    चर्चा केली केलेला केलेले केलेल्या केलेली ठरवले ठरवलं ठरवलेला ठरवलेले बोललो बोलले मान्य निश्चित
    मागच्या मागील मागचा आधीच्या आधीचा पूर्वीच्या पूर्वीचा गेल्या वेळी वेळेस आठवण करून करुन द्या
    सांगितले सांगितलेले सुचवले लिहिले तू तुम्ही आपण आम्ही काय कोणती कोणता कोणते थांबलो सोडले जिथे
    हमने बात तय किया फैसला निर्णय लिया जैसा पिछली पिछले पिछला बार आपने तुमने कहा बताया सुझाया लिखा
    याद दिलाओ दिलाइए दिलाएं कौन कौनसा किस क्या जहां छोड़ा
    """.split()
)
_STEM_SUFFIXES = ("ing", "ed", "es", "s")


def _stem(word: str) -> str:
    for suffix in _STEM_SUFFIXES:
        if len(word) > 5 and word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[: -len(suffix)]
    return word


def topic_words(question_raw: str | None) -> set[str]:
    """What the question is about, in English and Devanagari, for matching earlier messages.

    A Devanagari reference can wrap its topic ("हमने कौन सा ग्राउंड छोड़ने का फैसला किया"),
    so its words are dropped one by one rather than the whole phrase.
    """
    text = str(question_raw or "")
    english = {_stem(term) for term in query_terms(text) if not term.isdigit()}
    devanagari = {word for word in script.content_words(text) if word not in _DEVANAGARI_CUE_WORDS}
    return english | devanagari


def _asked_words(text: str) -> set[str]:
    body = str(text or "")[:ASKED_CHARS]
    english = {
        _stem(token.strip("'-"))
        for token in _TOKEN_RE.findall(body.lower())
        if len(token.strip("'-")) >= 3 and token.strip("'-") not in _STOPWORDS and not token.isdigit()
    }
    return english | script.content_words(body)


def words_in_common(topic: set[str], asked: str) -> int:
    """How many topic words an earlier message has, as written or in the other script."""
    if not topic:
        return 0
    words = _asked_words(asked)
    return sum(1 for word in topic if word in words or script.alike_any(word, words, cross_script_endings=False))


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
    # The part of a long answer that matched, when it was not the start.
    passage: str = ""


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


# The advocate's earlier messages in this case, for their topic words. A saved prompt's
# stored question is the prompt; its name stands in for it.
_ASKED_SQL = """
SELECT id::text AS chat_id,
       question,
       prompt_label,
       used_secret_prompt
FROM folder_chats
WHERE folder_name = %s
  AND user_id::text = %s
  AND session_id IS NOT NULL
  AND session_id::text <> %s
  AND coalesce(answer, '') <> ''
ORDER BY created_at DESC
LIMIT %s
"""

# The chosen turns, scoped again: an id alone never reaches another case.
_TURNS_SQL = """
SELECT id::text AS chat_id,
       session_id::text AS session_id,
       question,
       answer,
       prompt_label,
       used_secret_prompt,
       created_at,
       0.0 AS rank
FROM folder_chats
WHERE id::text = ANY(%s::text[])
  AND folder_name = %s
  AND user_id::text = %s
  AND session_id IS NOT NULL
  AND session_id::text <> %s
"""


def fuse(
    semantic: Sequence[chat_index.VectorHit],
    by_text: Sequence[str],
    by_words: Sequence[str],
    limit: int,
) -> list[str]:
    """Turn ids best first, by reciprocal rank fusion of the three rankings.

    A turn found by meaning takes part only when close to the best meaning match, so a
    case full of similar summaries does not fill recall with near-misses.
    """
    best = semantic[0].similarity if semantic else 0.0
    by_meaning = [
        hit.chat_id
        for hit in semantic
        if hit.similarity >= MIN_SIMILARITY and hit.similarity >= best - SEMANTIC_BAND
    ][:POOL]
    scores: dict[str, float] = {}
    first_seen: dict[str, int] = {}
    for ranking in (by_meaning, list(by_text)[:POOL], list(by_words)[:POOL]):
        for position, chat_id in enumerate(ranking):
            scores[chat_id] = scores.get(chat_id, 0.0) + 1.0 / (RRF_K + position + 1)
            first_seen.setdefault(chat_id, len(first_seen))
    ordered = sorted(scores, key=lambda chat_id: (-scores[chat_id], first_seen[chat_id]))
    return ordered[: max(1, int(limit))]


def _saved_prompt_row(row: dict[str, Any]) -> bool:
    label = _collapse(row.get("prompt_label"))
    return _truthy(row.get("used_secret_prompt")) or bool(label and _collapse(row.get("question")) == label)


_EMBEDDER = ThreadPoolExecutor(max_workers=4, thread_name_prefix="recall-embed")
_EMBED_NOW = object()


def start_query_embedding(question_raw: str | None) -> Future | None:
    """Start embedding a question that refers back, so it runs alongside the rest of memory.

    Returns None when recall will not search by meaning. Never raises.
    """
    if not has_recall_cue(question_raw) or not topic_words(question_raw) or not chat_index.enabled():
        return None
    try:
        future = _EMBEDDER.submit(chat_index.embed_query, question_raw)
    except Exception as exc:  # noqa: BLE001 — e.g. shutting down
        logger.debug("[Memory] recall embedding not started: %s", exc)
        return None
    future.started_at = time.monotonic()  # type: ignore[attr-defined]
    return future


def _resolve_vector(query_vector: Any, question_raw: str) -> Sequence[float] | None:
    if query_vector is _EMBED_NOW:
        return chat_index.embed_query(question_raw)
    if isinstance(query_vector, Future):
        # The allowance runs from when the embedding started, not from now: the other
        # layers were read meanwhile, and the whole of memory shares one time box.
        started = getattr(query_vector, "started_at", time.monotonic())
        remaining = chat_index.query_timeout_ms() / 1000 - (time.monotonic() - started)
        try:
            return query_vector.result(timeout=max(0.0, remaining))
        except Exception:  # noqa: BLE001 — slow or failed: search by words
            return None
    return query_vector


def search_past_sessions(
    scope: CaseScope | None,
    *,
    question_raw: str,
    current_session_id: str | None = None,
    limit: int = MAX_HITS,
    conn: Any = None,
    query_vector: Any = _EMBED_NOW,
) -> list[RecallHit]:
    """Earlier turns of this case that match the advocate's question.

    Returns [] whenever it cannot be sure the results belong to this case: no
    scope, no user, no database, or a folder name shared by more than one folder
    the advocate can see. Only the advocate's own chats are searched, and never
    the current session.

    `query_vector` is the question's embedding, a Future of it from
    `start_query_embedding`, or None to search by words only; by default the
    question is embedded here.
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
    topic = topic_words(question_raw)
    excluded = _normalize_session(current_session_id)
    cap = max(1, min(int(limit or MAX_HITS), 10))
    # The embedding is a network call: made before the transaction, never inside it.
    query_vector = _resolve_vector(query_vector, question_raw) if topic else None

    semantic: list[chat_index.VectorHit] = []
    by_text: list[str] = []
    by_words: list[str] = []
    with _connection(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute("SELECT set_config('statement_timeout', %s, true)", (STATEMENT_TIMEOUT,))
            if folder_is_ambiguous(cur, scope):
                logger.info(
                    "[Memory] recall skipped: the folder name matches more than one folder for user_id=%s",
                    user_id,
                )
                return []
            if not topic:
                cur.execute(_RECENT_SQL, (folder_name, user_id, excluded, cap))
                rows = list(cur.fetchall() or [])
            else:
                if terms:
                    cur.execute(_SEARCH_SQL, (" or ".join(terms), folder_name, user_id, excluded, POOL))
                    by_text = [str(row.get("chat_id")) for row in cur.fetchall() or [] if row.get("chat_id")]
                cur.execute(_ASKED_SQL, (folder_name, user_id, excluded, ASKED_TURNS))
                counted = []
                for row in cur.fetchall() or []:
                    asked = row.get("prompt_label") if _saved_prompt_row(row) else row.get("question")
                    common = words_in_common(topic, str(asked or ""))
                    if common:
                        counted.append((common, len(counted), str(row.get("chat_id"))))
                by_words = [chat_id for _, _, chat_id in sorted(counted, key=lambda item: (-item[0], item[1]))]
                if query_vector is not None:
                    semantic = chat_index.search(
                        cur,
                        folder_name=folder_name,
                        user_id=user_id,
                        exclude_session=excluded,
                        query_vector=query_vector,
                    )
                chosen = fuse(semantic, by_text, by_words, cap)
                rows = []
                if chosen:
                    cur.execute(_TURNS_SQL, (chosen, folder_name, user_id, excluded))
                    found = {str(row.get("chat_id")): row for row in cur.fetchall() or []}
                    rows = [found[chat_id] for chat_id in chosen if chat_id in found]
        finally:
            # Read-only work. Ending the transaction keeps the local statement
            # timeout from outliving this search on a reused connection.
            connection.rollback()

    matched = {hit.chat_id: hit for hit in semantic}
    hits = [hit for hit in (_to_hit(row, matched.get(str(row.get("chat_id")))) for row in rows) if hit is not None]
    if topic:
        # Turns saved before the index existed are indexed in the background.
        chat_index.schedule_case(folder_name, user_id)
    logger.info(
        "[Memory] recall case_key=%s topic_words=%s meaning=%s text=%s words=%s hits=%s",
        scope.case_key,
        len(topic),
        len(semantic) if query_vector is not None else "off",
        len(by_text),
        len(by_words),
        len(hits),
    )
    return hits


# The advocate's latest turns in this folder, across sessions, newest first.
_RECENT_TURNS_SQL = """
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
  AND id::text <> %s
ORDER BY created_at DESC
LIMIT %s
"""


# The same, as they stood when an earlier turn was asked.
_TURNS_BEFORE_SQL = """
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
  AND id::text <> %s
  AND created_at < %s::timestamptz
ORDER BY created_at DESC
LIMIT %s
"""


def recent_turns(
    scope: CaseScope | None,
    *,
    exclude_chat_id: str | None = None,
    limit: int = 10,
    before: Any = None,
    conn: Any = None,
) -> list[RecallHit]:
    """This advocate's latest turns in this case, newest first, without the current one.

    The memory writer reads them for context: the question the assistant asked
    just before a short reply, and requests the advocate keeps repeating. The same
    guards as recall apply: only the advocate's own chats, and nothing at all when
    the folder name is shared by more than one folder they can see. With `before`,
    only turns asked before then: the context an earlier turn had.
    """
    if scope is None:
        return []
    user_id = str(scope.user_id or "").strip()
    folder_name = str(scope.folder_name or "").strip()
    if not user_id or not folder_name:
        return []
    if conn is None and not is_db_available():
        return []

    cap = max(1, min(int(limit or 10), 25))
    excluded = str(exclude_chat_id or "").strip()
    with _connection(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute("SELECT set_config('statement_timeout', %s, true)", (STATEMENT_TIMEOUT,))
            if folder_is_ambiguous(cur, scope):
                return []
            if before is not None:
                cur.execute(_TURNS_BEFORE_SQL, (folder_name, user_id, excluded, before, cap))
            else:
                cur.execute(_RECENT_TURNS_SQL, (folder_name, user_id, excluded, cap))
            rows = list(cur.fetchall() or [])
        finally:
            connection.rollback()
    return [hit for hit in (_to_hit(row) for row in rows) if hit is not None]


_SESSION_TURNS_SQL = """
SELECT id::text AS chat_id,
       question,
       answer,
       (secret_id IS NOT NULL) AS preset,
       created_at
FROM folder_chats
WHERE folder_name = %s
  AND user_id::text = %s
  AND session_id::text = %s
  AND (%s::timestamptz IS NULL OR created_at > %s::timestamptz)
ORDER BY created_at ASC
LIMIT %s
"""

_LATEST_OTHER_SESSION_SQL = """
SELECT session_id::text AS session_id, MAX(created_at) AS last_at
FROM folder_chats
WHERE folder_name = %s
  AND user_id::text = %s
  AND session_id IS NOT NULL
  AND session_id::text <> %s
GROUP BY session_id
ORDER BY MAX(created_at) DESC
LIMIT 1
"""


def session_turns(
    scope: CaseScope | None,
    session_id: str | None,
    *,
    since: Any = None,
    limit: int = 40,
    conn: Any = None,
) -> list[dict[str, Any]]:
    """One chat's turns after `since`, oldest first, for a review of the conversation.

    The same guards as recall: only this advocate's chats, and nothing when the folder
    name is shared by more than one folder they can see. A saved prompt's text is not
    returned; `preset` says the turn was one.
    """
    session = str(session_id or "").strip()
    if scope is None or not session:
        return []
    user_id = str(scope.user_id or "").strip()
    folder_name = str(scope.folder_name or "").strip()
    if not user_id or not folder_name or (conn is None and not is_db_available()):
        return []
    cap = max(1, min(int(limit or 40), 100))
    with _connection(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute("SELECT set_config('statement_timeout', %s, true)", (STATEMENT_TIMEOUT,))
            if folder_is_ambiguous(cur, scope):
                return []
            cur.execute(_SESSION_TURNS_SQL, (folder_name, user_id, session, since, since, cap))
            rows = [dict(row) for row in cur.fetchall() or []]
        finally:
            connection.rollback()
    for row in rows:
        if row.get("preset"):
            row["question"] = ""
    return rows


def latest_other_session(
    scope: CaseScope | None,
    exclude_session_id: str | None,
    *,
    conn: Any = None,
) -> dict[str, Any] | None:
    """The advocate's most recent other chat in this case: {session_id, last_at}, or None."""
    if scope is None:
        return None
    user_id = str(scope.user_id or "").strip()
    folder_name = str(scope.folder_name or "").strip()
    if not user_id or not folder_name or (conn is None and not is_db_available()):
        return None
    with _connection(conn) as connection, connection.cursor() as cur:
        try:
            cur.execute("SELECT set_config('statement_timeout', %s, true)", (STATEMENT_TIMEOUT,))
            if folder_is_ambiguous(cur, scope):
                return None
            cur.execute(_LATEST_OTHER_SESSION_SQL, (folder_name, user_id, str(exclude_session_id or "")))
            row = cur.fetchone()
        finally:
            connection.rollback()
    return dict(row) if row else None


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"true", "t", "1", "yes", "y"}


def _collapse(value: Any) -> str:
    return " ".join(str(value or "").split())


def _to_hit(row: dict[str, Any], matched: "chat_index.VectorHit | None" = None) -> RecallHit | None:
    chat_id = _collapse(row.get("chat_id"))
    answer = _collapse(row.get("answer"))
    if not chat_id or not answer:
        return None
    # A match deep in a long answer is shown, rather than the answer's opening.
    passage = ""
    if matched is not None and matched.kind == "answer" and matched.piece > 0 and matched.end > matched.start:
        passage = answer[matched.start : matched.end]
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
        passage=passage,
    )


# ── Rendering ────────────────────────────────────────────────────────────────

RECALL_HEADER = (
    "=== EARLIER SESSIONS IN THIS CASE (retrieved because the advocate referred back to an "
    "earlier discussion; the current conversation overrides anything here) ==="
)
RECALL_FOOTER = (
    'How to use these: "ADVOCATE SAID" is the advocate\'s own words. "ADVOCATE RAN A SAVED PROMPT" '
    'names a stored prompt they ran, not words they wrote. "ASSISTANT ANSWERED" is an earlier AI '
    "answer: treat it as something previously suggested, never as a decision the advocate made, and "
    "never as a source to cite. If none of these is what the advocate means, say so and ask."
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
    if hit.passage:
        answered = f'ASSISTANT ANSWERED (the part that matches): "…{_quote(hit.passage, answer_chars)}"'
    else:
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
