"""
search_documents — vector similarity search backing the chatbot tool.

Generates a RETRIEVAL_QUERY embedding for the user's query, then runs a
cosine-distance scan against chunk_embeddings joined with document_chunks
and documents.  Only chunks from 'active' documents are returned.
"""
from __future__ import annotations

import logging
import re

from app.services.db import get_db_connection
from app.services.embeddings import embed_query

logger = logging.getLogger("ai_chatbot.search")

_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
    "in", "is", "it", "of", "on", "or", "the", "to", "what", "when", "where",
    "which", "who", "why", "with",
}


def _query_terms(query: str) -> list[str]:
    return [
        term
        for term in re.findall(r"[a-zA-Z0-9]+", query.lower())
        if len(term) > 2 and term not in _STOPWORDS
    ]


def _keyword_score(query: str, chunk: dict) -> int:
    content = (chunk.get("content") or "").lower()
    file_name = (chunk.get("file_name") or "").lower()
    terms = _query_terms(query)
    if not terms:
        return 0

    score = 0
    normalized_query = " ".join(re.findall(r"[a-zA-Z0-9]+", query.lower()))
    normalized_content = " ".join(re.findall(r"[a-zA-Z0-9]+", content))
    phrase_pos = normalized_content.find(normalized_query)
    if len(normalized_query) > 3 and phrase_pos >= 0:
        score += 500
        score += max(0, 300 - (phrase_pos // 10))
    for term in terms:
        score += content.count(term) * 3
        score += file_name.count(term)
    return score


def _keyword_search(query: str, top_k: int) -> list[dict]:
    terms = _query_terms(query)
    if not terms:
        return []

    where_parts = []
    params: list[str | int] = []
    for term in terms[:8]:
        pattern = f"%{term}%"
        where_parts.append("(dc.content ILIKE %s OR d.file_name ILIKE %s)")
        params.extend([pattern, pattern])

    params.append(200)
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                        dc.content,
                        dc.page_number,
                        d.file_name,
                        d.document_type,
                        dc.chunk_index,
                        NULL::numeric AS similarity
                    FROM document_chunks dc
                    JOIN documents d ON d.id = dc.document_id
                    -- Include partially-processed docs too: operators may upload
                    -- platform guides where chunking succeeded but status wasn't
                    -- promoted to 'active' yet.
                    WHERE (d.processing_status IN ('active', 'failed') OR d.processing_status IS NULL)
                      AND ({' OR '.join(where_parts)})
                    ORDER BY dc.chunk_index
                    LIMIT %s
                    """,
                    params,
                )
                rows = [dict(row) for row in cur.fetchall()]
        rows.sort(key=lambda row: _keyword_score(query, row), reverse=True)
        return rows[:top_k]
    except Exception as exc:
        logger.warning("keyword search failed: %s", exc)
        return []


def search_documents(query: str, top_k: int = 5) -> list[dict]:
    """
    Tool implementation called by the Gemini agent.

    Returns a list of dicts with keys:
      content, page_number, file_name, document_type, similarity
    """
    logger.info("SEARCH QUERY: %r  (top_k=%d)", query, top_k)
    query_vec = embed_query(query)
    if not query_vec:
        logger.warning("Embedding failed — falling back to keyword-only search")
        return _keyword_search(query, top_k)

    logger.info("EMBEDDING: dim=%d  first5=%s", len(query_vec), query_vec[:5])

    # pgvector expects a literal like '[0.1,0.2,...]'
    vec_literal = "[" + ",".join(f"{v:.8f}" for v in query_vec) + "]"

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        dc.content,
                        dc.page_number,
                        d.file_name,
                        d.document_type,
                        ROUND(
                            (1 - (ce.embedding <=> %s::vector))::numeric, 4
                        ) AS similarity
                    FROM chunk_embeddings ce
                    JOIN document_chunks dc ON dc.id = ce.chunk_id
                    JOIN documents       d  ON d.id  = dc.document_id
                    -- Vector search only applies to chunks that have embeddings.
                    -- Allow non-active docs too so operators can test content even
                    -- if processing status wasn't updated.
                    WHERE (d.processing_status IN ('active', 'failed') OR d.processing_status IS NULL)
                    ORDER BY ce.embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (vec_literal, vec_literal, top_k),
                )
                rows = cur.fetchall()
        vector_chunks = [dict(row) for row in rows]
        keyword_chunks = _keyword_search(query, top_k)

        # Hybrid ranking:
        # - Vector similarity captures semantics when embeddings exist
        # - Keyword score rescues partially-processed docs (e.g., guides without embeddings yet)
        # We rank by a combined score rather than always trusting vector-first ordering.
        merged = vector_chunks + keyword_chunks
        for c in merged:
            kw = _keyword_score(query, c)
            try:
                sim = float(c.get("similarity") or 0.0)
            except Exception:
                sim = 0.0
            dtype = (c.get("document_type") or "").lower()
            dtype_bonus = 200 if dtype in ("technical", "guide", "product", "platform") else 0
            c["_kw_score"] = kw
            c["_hybrid_score"] = (sim * 1000.0) + kw + dtype_bonus

        merged.sort(key=lambda c: float(c.get("_hybrid_score") or 0.0), reverse=True)

        seen: set[tuple[str, int | None, str]] = set()
        chunks: list[dict] = []
        for chunk in merged:
            key = (
                chunk.get("file_name") or "",
                chunk.get("page_number"),
                chunk.get("content") or "",
            )
            if key in seen:
                continue
            seen.add(key)
            chunk.pop("_kw_score", None)
            chunk.pop("_hybrid_score", None)
            chunks.append(chunk)
            if len(chunks) >= top_k:
                break

        for i, c in enumerate(chunks, 1):
            logger.info(
                "CHUNK #%d  file=%r  page=%s  similarity=%s  preview=%r",
                i,
                c.get("file_name"),
                c.get("page_number"),
                c.get("similarity"),
                c.get("content", "")[:120],
            )
        return chunks
    except Exception as exc:
        logger.error("search_documents DB error: %s", exc)
        return []


def format_chunks_for_context(chunks: list[dict]) -> str:
    """Renders retrieved chunks as a numbered context block for the LLM."""
    if not chunks:
        # Tell the model explicitly to fall back — a bare "not found" makes it apologise
        # instead of answering when the knowledge base is empty or has no match.
        return (
            "No matching documents in the knowledge base. Do NOT tell the user you could not "
            "find information. Answer from your own knowledge: general legal information for "
            "legal questions, the CURRENT PAGE context for platform questions."
        )
    parts = []
    for i, chunk in enumerate(chunks, 1):
        source = (
            f"{chunk.get('file_name', 'Unknown')}"
            + (f", page {chunk['page_number']}" if chunk.get("page_number") else "")
        )
        parts.append(f"[{i}] {source}\n{chunk['content']}")
    return "\n\n---\n\n".join(parts)
