-- 174: rolling summary of each case chat (app/services/chat_summary.py).
--
-- A case-chat prompt carries the latest turns of the chat and, for anything older, this
-- summary. It is updated in the background after each answer and deleted with its chat
-- or its folder. The service also creates the table lazily on first use.

CREATE TABLE IF NOT EXISTS chat_session_summaries (
    folder_name   TEXT        NOT NULL,
    user_id       TEXT        NOT NULL,
    session_id    TEXT        NOT NULL,
    summary       TEXT        NOT NULL DEFAULT '',
    covered_turns INTEGER     NOT NULL DEFAULT 0,
    covered_until TIMESTAMPTZ,
    last_chat_id  TEXT,
    model         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (folder_name, user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_session_summaries_folder
    ON chat_session_summaries (folder_name);
