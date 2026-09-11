-- Migration 171: indexes for past-session recall (memory phase 4).
--
-- app/services/memory/recall.py searches earlier turns of a case when the
-- advocate refers back to them ("add the ground we discussed"). The tsvector
-- expression below must stay identical to the one in recall.py (_SEARCH_SQL),
-- otherwise the planner cannot use the index.
--
-- Locking. db/migrate.js runs every file inside a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside one. The statements below
-- therefore block writes to folder_chats (new chat saves wait) while each index
-- builds. On a large production table, build them by hand first, off peak and
-- without that lock:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folder_chats_fts ON folder_chats
--     USING GIN (to_tsvector('english', coalesce(question, '') || ' ' || coalesce(answer, '')));
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folder_chats_folder_user_created
--     ON folder_chats (folder_name, user_id, created_at DESC);
--
-- then run the migration as usual; IF NOT EXISTS turns it into a no-op that just
-- records 171 as applied. A failed concurrent build leaves an INVALID index with
-- the same name, which IF NOT EXISTS would silently keep: drop it before retrying.

CREATE INDEX IF NOT EXISTS idx_folder_chats_fts
    ON folder_chats
    USING GIN (to_tsvector('english', coalesce(question, '') || ' ' || coalesce(answer, '')));

-- Recall, the chat sidebar and session history all filter by folder, then by
-- user, newest first.
CREATE INDEX IF NOT EXISTS idx_folder_chats_folder_user_created
    ON folder_chats (folder_name, user_id, created_at DESC);
