-- 181: Past chats indexed by meaning, for past-session recall.
--
-- Recall searched chat history with English full-text search only (migration 171), so an
-- earlier discussion was found only when the advocate reused its words, and a question
-- in Marathi or Hindi found nothing. Each saved turn now also gets embeddings
-- (gemini-embedding-001, 768 dimensions): one for the advocate's own words, and one per
-- overlapping passage of the answer. Recall ranks by meaning, by English words, and by
-- the advocate's topic words matched across scripts (app/services/memory/recall.py).
--
-- The table holds no folder, case or user. Every search joins folder_chats for them, so
-- scoping stays exactly as it was, and a turn deleted from history takes its vectors
-- with it (ON DELETE CASCADE).
--
-- start_char / end_char locate an answer passage in the answer with its whitespace
-- collapsed, so recall can show the part that matched. content_hash covers the model,
-- the dimensions and the embedded text; a turn is re-embedded only when one changes.
-- A case has at most a few hundred turns, so searches are exact and need no ANN index.
--
-- Also created on first use by app/services/memory/chat_index.py.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS folder_chat_vectors (
    chat_id      UUID        NOT NULL REFERENCES folder_chats(id) ON DELETE CASCADE,
    kind         TEXT        NOT NULL CHECK (kind IN ('question', 'answer')),
    piece        INTEGER     NOT NULL CHECK (piece >= 0),
    start_char   INTEGER     NOT NULL DEFAULT 0,
    end_char     INTEGER     NOT NULL DEFAULT 0,
    embedding    vector(768) NOT NULL,
    model        TEXT        NOT NULL,
    content_hash TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, kind, piece)
);

COMMENT ON TABLE folder_chat_vectors IS
    'Embeddings of saved chat turns for past-session recall (app/services/memory/chat_index.py). Scoped through folder_chats.';
