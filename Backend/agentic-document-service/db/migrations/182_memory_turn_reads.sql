-- 182: Which chat turns memory has read, and with which version of the writer.
--
-- Memory learns from each turn as it is answered. Turns saved before memory could read
-- them, or read by an older writer (before facts from cited answers, Marathi, or reviews
-- of whole chats), were never read that way. app/services/memory/reread.py reads a
-- case's unread turns again, oldest first, and records each one here so it is read once
-- per writer version. The live writer records the turns it reads too.
--
-- A turn whose reading failed (model unavailable) is not recorded, so it is read later.
-- Deleting a turn deletes its row; deleting a case's memory deletes its rows, so reading
-- again after "forget everything" (which the advocate must ask for) starts afresh.
--
-- Also created on first use by app/services/memory/repository.py.

CREATE TABLE IF NOT EXISTS memory_turn_reads (
    chat_id         UUID        PRIMARY KEY REFERENCES folder_chats (id) ON DELETE CASCADE,
    case_key        TEXT        NOT NULL,
    reader_version  INTEGER     NOT NULL,
    outcome         TEXT,
    read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_turn_reads_case ON memory_turn_reads (case_key);

COMMENT ON TABLE memory_turn_reads IS
    'Chat turns read by the memory writer, and the writer version that read them (app/services/memory/reread.py).';
