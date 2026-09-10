-- Migration 170: Controlled memory system (JRNX-ENG-2026-008).
--
-- Four context layers, three of which are stored here:
--   L1 user_standing_preferences  — advocate working style, tenant-wide, human-written
--   L2 case_instructions          — standing orders for ONE case, human-written
--   L3 case_memory_sections/lines — facts about ONE case, pipeline-written, tagged
-- (L4 presets already live in preset_prompts / secret_manager.)
--
-- Keying: case_key TEXT, resolved by app/services/memory/scope.py as
--   str(cases.id)  >  "folder:" || user_files.id  >  raw temp-* intake folder name
-- exactly like case_chronology.case_key (migration 163). cases.id is INTEGER in
-- production but UUID in some deployments, so no FK is declared; deletion is
-- handled explicitly by folder_service.delete_case via purge_case_keys().
--
-- Every case-scoped read and write carries case_key. Isolation is a data-layer
-- property, never a prompt instruction.

-- ── L1: advocate standing preferences (tenant-wide, injected in every case) ───
CREATE TABLE IF NOT EXISTS user_standing_preferences (
    user_id     TEXT PRIMARY KEY,
    content     TEXT        NOT NULL DEFAULT '',
    version     INTEGER     NOT NULL DEFAULT 1,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_standing_preferences_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT        NOT NULL,
    version    INTEGER     NOT NULL,
    content    TEXT        NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_standing_preferences_history_user
    ON user_standing_preferences_history (user_id, version DESC);

COMMENT ON TABLE user_standing_preferences IS
    'Layer 1: advocate/firm working-style preferences. Human-written, never model-written. No case data.';

-- ── L2: case instructions (one case, human-written standing orders) ──────────
CREATE TABLE IF NOT EXISTS case_instructions (
    case_key    TEXT PRIMARY KEY,
    folder_name TEXT,
    content     TEXT        NOT NULL DEFAULT '',
    version     INTEGER     NOT NULL DEFAULT 1,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_instructions_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key   TEXT        NOT NULL,
    version    INTEGER     NOT NULL,
    content    TEXT        NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_instructions_history_case
    ON case_instructions_history (case_key, version DESC);

COMMENT ON TABLE case_instructions IS
    'Layer 2: standing orders for one matter. Human-written; the pipeline may propose but never writes here.';

-- ── L3: case memory — sections carry the version token, lines carry the facts ─
CREATE TABLE IF NOT EXISTS case_memory_sections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key    TEXT        NOT NULL,
    folder_name TEXT,
    section     TEXT        NOT NULL,
    version     INTEGER     NOT NULL DEFAULT 1,
    seed_meta   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT case_memory_sections_section_check
        CHECK (section IN ('summary','facts','parties','documents','drafting_log','decisions','dates')),
    CONSTRAINT case_memory_sections_case_section_key UNIQUE (case_key, section)
);

CREATE INDEX IF NOT EXISTS idx_case_memory_sections_case
    ON case_memory_sections (case_key);

CREATE TABLE IF NOT EXISTS case_memory_lines (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key   TEXT        NOT NULL,
    section    TEXT        NOT NULL,
    ord        INTEGER     NOT NULL DEFAULT 1,
    tag        TEXT        NOT NULL,
    text       TEXT        NOT NULL,
    source_ref JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT case_memory_lines_tag_check
        CHECK (tag IN ('stated','extracted','status')),
    CONSTRAINT case_memory_lines_text_len_check
        CHECK (char_length(text) <= 300),
    CONSTRAINT case_memory_lines_section_fk
        FOREIGN KEY (case_key, section)
        REFERENCES case_memory_sections (case_key, section)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_memory_lines_case_section_ord
    ON case_memory_lines (case_key, section, ord);

COMMENT ON TABLE case_memory_lines IS
    'Layer 3: one fact per line. tag=stated (user said) | extracted (document shows) | status (pipeline state). [inferred] is never written.';

-- ── Settings: memory toggles at firm / user / case scope ─────────────────────
-- Effective value of a flag = AND across the firm, user and case rows.
-- A missing row means TRUE (memory is on by default).
CREATE TABLE IF NOT EXISTS memory_settings (
    scope_type           TEXT        NOT NULL,
    scope_id             TEXT        NOT NULL,
    enabled              BOOLEAN     NOT NULL DEFAULT TRUE,
    write_enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    recall_enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
    instructions_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
    sensitive_enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
    updated_by           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_settings_scope_type_check
        CHECK (scope_type IN ('user','case','firm')),
    CONSTRAINT memory_settings_pkey PRIMARY KEY (scope_type, scope_id)
);

-- ── Assembly log: what was loaded into each generation ───────────────────────
CREATE TABLE IF NOT EXISTS memory_assembly_log (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key             TEXT        NOT NULL,
    user_id              TEXT,
    session_id           UUID,
    chat_id              UUID,
    mode                 TEXT,
    prefs_version        INTEGER,
    instructions_version INTEGER,
    sections_loaded      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    preset_ref           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    past_chat_ids        UUID[]      NOT NULL DEFAULT ARRAY[]::UUID[],
    model                TEXT,
    budget               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    writes               INTEGER     NOT NULL DEFAULT 0,
    rejected             INTEGER     NOT NULL DEFAULT 0,
    proposals            INTEGER     NOT NULL DEFAULT 0,
    skipped_reason       TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_assembly_log_case_created
    ON memory_assembly_log (case_key, created_at DESC);

COMMENT ON TABLE memory_assembly_log IS
    'One row per generation: which layer versions and sections were loaded, and what the writer did afterwards.';

-- ── Proposals: the model may propose an instruction/preference, never save one ─
CREATE TABLE IF NOT EXISTS memory_proposals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key    TEXT        NOT NULL,
    user_id     TEXT,
    kind        TEXT        NOT NULL,
    text        TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'pending',
    source_ref  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT memory_proposals_kind_check
        CHECK (kind IN ('instruction','preference')),
    CONSTRAINT memory_proposals_status_check
        CHECK (status IN ('pending','accepted','rejected'))
);

CREATE INDEX IF NOT EXISTS idx_memory_proposals_case_status
    ON memory_proposals (case_key, status, created_at DESC);
