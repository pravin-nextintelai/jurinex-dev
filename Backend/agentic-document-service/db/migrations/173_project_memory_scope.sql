-- 173: Project-scoped memory — hard isolation per case (the UI calls a case a Project).
--
-- There is no separate project_memory_files table: a "project memory file" IS a row of
-- personalization_memory_topics whose folder_name is set. That column is the project key
-- (cases.folder_id / user_files.folder_path — the case folder this service already routes
-- every chat by). Rows with folder_name IS NULL stay the user's cross-case memory and are
-- NOT project rows.
--
-- Column mapping for the project-scoped store (app/services/memory_service.py):
--   id           -> id
--   project_id   -> folder_name  (always non-NULL for a project row)
--   slug         -> topic_key
--   description  -> description
--   content      -> content
--   version      -> version      (added here)
--   updated_at   -> updated_at
--
-- ISOLATION: every statement in the project store carries
--   WHERE user_id = %s AND folder_name = %s
-- so one project can never read or write another project's rows. Enforced in SQL, not
-- only in the prompt layer. tests/test_project_memory_isolation.py asserts both the
-- behaviour and that no project statement is missing the folder_name predicate.
--
-- Applied lazily (ALTER ... IF NOT EXISTS) by memory_service._ENSURE_SQL as well.

ALTER TABLE personalization_memory_topics
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Project listing + per-slug lookup inside ONE project.
CREATE INDEX IF NOT EXISTS idx_memory_topics_project
    ON personalization_memory_topics (user_id, folder_name, updated_at DESC)
    WHERE folder_name IS NOT NULL;

COMMENT ON COLUMN personalization_memory_topics.version IS
    'Bumped on every content write. Pass the version you read back as expected_version for a safe concurrent edit.';
COMMENT ON COLUMN personalization_memory_topics.folder_name IS
    'Project (case) key. NULL = the user cross-case memory; set = a project row, readable only within that project.';
