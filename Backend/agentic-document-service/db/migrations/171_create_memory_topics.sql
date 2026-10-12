-- 171: Claude-style memory — topic notes, per-user settings, just-in-time retrieval.
--
-- Flow (app/services/memory_service.py):
--   1. After each document-chat prompt, a background extractor upserts/updates
--      short topic notes (working style, standing preferences, case notes).
--   2. Chat turns retrieve ONLY relevant / pinned topics into the system prompt
--      (not the whole store). Optional keyword search of folder_chats.
--   3. The Memory UI lists topics for view / edit / delete; toggles control
--      auto-generate and past-chat search.
--
-- Applied lazily (CREATE TABLE IF NOT EXISTS) on first use as well.

CREATE TABLE IF NOT EXISTS personalization_memory_settings (
    user_id TEXT PRIMARY KEY,
    generate_from_chats BOOLEAN NOT NULL DEFAULT FALSE,
    search_past_chats BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS personalization_memory_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    folder_name TEXT,
    topic_key TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'auto',
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_topics_user
    ON personalization_memory_topics (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_topics_user_folder
    ON personalization_memory_topics (user_id, folder_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_topics_user_scope_key
    ON personalization_memory_topics (user_id, COALESCE(folder_name, ''), topic_key);

COMMENT ON TABLE personalization_memory_topics IS
    'Claude-style memory notes: one short file per topic. folder_name NULL = global; set = this case only.';
COMMENT ON TABLE personalization_memory_settings IS
    'Per-user toggles: generate memory from chats, search and reference past chats.';
