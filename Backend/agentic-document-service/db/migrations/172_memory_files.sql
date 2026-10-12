-- 172: Memory files — subject-scoped notes with listing-first retrieval.
--
-- Each row is one memory file (/profile.md, /preferences.md, /topics/x.md,
-- /areas/x.md, /people/x.md). Settings split generate vs search vs sensitive
-- consent. Applied lazily in memory_service._ENSURE_SQL as well.

ALTER TABLE personalization_memory_settings
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE personalization_memory_settings
    ADD COLUMN IF NOT EXISTS sensitive_data BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE personalization_memory_settings
   SET enabled = TRUE
 WHERE generate_from_chats = TRUE AND enabled = FALSE;

ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'topics';
ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS sensitive BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '["chat"]'::jsonb;

DROP INDEX IF EXISTS uq_memory_topics_user_scope_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_topics_user_scope_kind_key
    ON personalization_memory_topics (user_id, COALESCE(folder_name, ''), kind, topic_key);

COMMENT ON COLUMN personalization_memory_settings.enabled IS
    'Master Memory switch: tab visible, manual remember, listing/read of files.';
COMMENT ON COLUMN personalization_memory_settings.generate_from_chats IS
    'Background extractor after a turn. Off = no implicit writes.';
COMMENT ON COLUMN personalization_memory_settings.search_past_chats IS
    'Keyword search / inject of raw past conversations (separate from files).';
COMMENT ON COLUMN personalization_memory_settings.sensitive_data IS
    'Consent to store health/politics/religion/orientation/financial/union facts.';
COMMENT ON COLUMN personalization_memory_topics.kind IS
    'profile | preferences | topics | areas | people';
