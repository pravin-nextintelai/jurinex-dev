-- 175: What JuriNex remembers about the advocate, across all of their cases.
--
-- Case memory (170) holds facts about one matter. This holds facts the advocate
-- states about themselves in any case chat, or types in Settings, and loads them
-- into every case they open: their practice, the clients they act for, how they
-- work, their background. Case details are refused at write time
-- (app/services/memory/validator.py validate_advocate_line).
--
--   advocate_memory_sets   one row per advocate carrying the version token, and the
--                          facts they deleted after JuriNex learned them from chat
--                          (so the writer does not learn them again)
--   advocate_memory_lines  one fact per row
--
-- memory_settings gains advocate_enabled: remember and use these facts (on by default).
--
-- The tables and the column are also created on first use by
-- app/services/memory/repository.py.

CREATE TABLE IF NOT EXISTS advocate_memory_sets (
    user_id     TEXT PRIMARY KEY,
    version     INTEGER     NOT NULL DEFAULT 1,
    forgotten   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS advocate_memory_lines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT        NOT NULL,
    category    TEXT        NOT NULL,
    ord         INTEGER     NOT NULL DEFAULT 1,
    text        TEXT        NOT NULL,
    source_ref  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT advocate_memory_lines_category_check
        CHECK (category IN ('practice','clients','work_style','background')),
    CONSTRAINT advocate_memory_lines_text_len_check CHECK (char_length(text) <= 300),
    CONSTRAINT advocate_memory_lines_set_fk
        FOREIGN KEY (user_id) REFERENCES advocate_memory_sets (user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_advocate_memory_lines_user
    ON advocate_memory_lines (user_id, ord);

ALTER TABLE memory_settings ADD COLUMN IF NOT EXISTS advocate_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON TABLE advocate_memory_lines IS
    'Facts the advocate stated about themselves (practice, clients, way of working, background). Loaded into every case; never case data.';
