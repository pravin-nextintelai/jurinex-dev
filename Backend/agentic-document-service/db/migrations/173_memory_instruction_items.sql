-- 173: Instructions as switchable items, at two levels.
--
-- Until now an advocate's standing preferences and each case's instructions
-- were one text box each. This stores them one instruction per row so each can
-- be switched on or off, overridden for one case (a universal instruction that
-- does not suit one matter) or muted for one chat session.
--
--   memory_instruction_sets       one row per (scope, id) carrying the version token
--   memory_instructions           the items; scope_type 'user' = every case, 'case' = one case
--   memory_instruction_overrides  per-case or per-session on/off for one item
--
-- Existing text is moved across on first use: app/services/memory/repository.py
-- splits the old text into items (origin 'migrated') the first time a scope's
-- instructions are read. The old tables are left in place, unread.

CREATE TABLE IF NOT EXISTS memory_instruction_sets (
    scope_type  TEXT        NOT NULL,
    scope_id    TEXT        NOT NULL,
    version     INTEGER     NOT NULL DEFAULT 1,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_instruction_sets_scope_check CHECK (scope_type IN ('user','case')),
    CONSTRAINT memory_instruction_sets_pkey PRIMARY KEY (scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS memory_instructions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type  TEXT        NOT NULL,
    scope_id    TEXT        NOT NULL,
    ord         INTEGER     NOT NULL DEFAULT 1,
    text        TEXT        NOT NULL,
    enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    origin      TEXT        NOT NULL DEFAULT 'user',
    source_ref  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_instructions_text_len_check CHECK (char_length(text) <= 400),
    CONSTRAINT memory_instructions_origin_check
        CHECK (origin IN ('user','chat','learned','import','migrated')),
    CONSTRAINT memory_instructions_set_fk
        FOREIGN KEY (scope_type, scope_id)
        REFERENCES memory_instruction_sets (scope_type, scope_id)
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_instructions_scope
    ON memory_instructions (scope_type, scope_id, ord);

CREATE TABLE IF NOT EXISTS memory_instruction_overrides (
    instruction_id UUID        NOT NULL REFERENCES memory_instructions (id) ON DELETE CASCADE,
    override_type  TEXT        NOT NULL,
    override_id    TEXT        NOT NULL,
    enabled        BOOLEAN     NOT NULL,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_instruction_overrides_type_check CHECK (override_type IN ('case','session')),
    CONSTRAINT memory_instruction_overrides_pkey PRIMARY KEY (instruction_id, override_type, override_id)
);
CREATE INDEX IF NOT EXISTS idx_memory_instruction_overrides_target
    ON memory_instruction_overrides (override_type, override_id);
