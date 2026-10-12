-- 170: Personalization — prompt log, cumulative user profile, generated instructions.
--
-- Flow (agentic-document-service, app/services/personalization_service.py):
--   1. Every document-chat prompt -> personalization_prompts
--        prompt_no = per-user running counter (1-based)
--        batch_no  = (prompt_no - 1) / PERSONALIZATION_BATCH_SIZE + 1   (default 10)
--   2. When prompt_no % BATCH == 0 a background job runs the Profile Builder:
--        previous profile JSON + that batch's prompts -> personalization_profiles
--        (version + 1, prompts_covered = last prompt_no folded in). Cumulative.
--   3. "Generate instruction" -> latest profile (or default) + session prompts
--        -> instruction markdown shown to the user.
--   4. "Add to system" -> personalization_instructions (is_active = TRUE, older
--        rows deactivated). The active text is appended to the chat system prompt.
--
-- The service also runs this DDL lazily (CREATE TABLE IF NOT EXISTS) on first
-- use, so applying this file manually is optional but recommended.

CREATE TABLE IF NOT EXISTS personalization_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    session_id TEXT,
    folder_name TEXT,
    prompt_text TEXT NOT NULL,
    prompt_no INTEGER NOT NULL,
    batch_no INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_personalization_prompts_user_no
    ON personalization_prompts (user_id, prompt_no);

CREATE INDEX IF NOT EXISTS idx_personalization_prompts_user_batch
    ON personalization_prompts (user_id, batch_no);

CREATE INDEX IF NOT EXISTS idx_personalization_prompts_session
    ON personalization_prompts (session_id);

-- Old chats imported into the log ("Past chat" pick / "Learn from my chat history")
-- carry source_ref = 'folder_chats:<id>' so the import is idempotent.
ALTER TABLE personalization_prompts ADD COLUMN IF NOT EXISTS source_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_personalization_prompts_source_ref
    ON personalization_prompts (user_id, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS personalization_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    batch_no INTEGER NOT NULL DEFAULT 0,
    prompts_covered INTEGER NOT NULL DEFAULT 0,
    profile_json JSONB NOT NULL,
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_personalization_profiles_user_version
    ON personalization_profiles (user_id, version);

CREATE TABLE IF NOT EXISTS personalization_instructions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    instruction_text TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    source_profile_version INTEGER,
    source_session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personalization_instructions_user_active
    ON personalization_instructions (user_id, is_active);

-- 'manual' (typed by the user) | 'generated' (profile + session) | 'polished' (typed, then AI-rewritten)
ALTER TABLE personalization_instructions ADD COLUMN IF NOT EXISTS origin TEXT;
-- The generator's behaviour analysis (tone, response shape, depth, language, expertise,
-- communication style, priorities, dislikes — each with confidence + evidence).
ALTER TABLE personalization_instructions ADD COLUMN IF NOT EXISTS behaviour_json JSONB;
-- Scope: folder_name set = applies only to that case (each case keeps its own
-- instruction); NULL = the user's global instruction, used by cases without one.
ALTER TABLE personalization_instructions ADD COLUMN IF NOT EXISTS folder_name TEXT;
CREATE INDEX IF NOT EXISTS idx_personalization_instructions_user_folder_active
    ON personalization_instructions (user_id, folder_name, is_active);

COMMENT ON TABLE personalization_prompts IS 'Per-user log of document-chat prompts (batched every N for profile building).';
COMMENT ON TABLE personalization_profiles IS 'Versioned cumulative user expectation profile JSON built from prompt batches.';
COMMENT ON TABLE personalization_instructions IS 'Generated personal instructions; the is_active row is appended to the chat system prompt.';
