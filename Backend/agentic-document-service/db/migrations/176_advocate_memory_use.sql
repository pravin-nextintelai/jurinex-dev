
-- 176: Record which remembered facts about the advocate actually get used.
--
-- Since the relevance pass (app/services/memory/relevance.py), each turn picks the
-- facts that suit the question instead of sending the newest that fit. These two
-- columns record what that pass chose, so the system can tell a fact that shapes
-- answers from one that has never once been sent:
--
--   used_count    how many turns have carried this fact
--   last_used_at  when it was last carried
--
-- Two things read them. Eviction: when the set is full and the chat writer wants to
-- save a new fact, the least useful fact JuriNex learned by itself makes room —
-- never one the advocate typed or edited. The panel: the advocate can see which
-- facts are working and which are dead weight before deciding what to remove.
--
-- Counting happens on the writer's thread after the answer, never in the chat's
-- critical path. The columns are also added on first use by
-- app/services/memory/repository.py.

ALTER TABLE advocate_memory_lines
    ADD COLUMN IF NOT EXISTS used_count   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Least-useful-first, for eviction: never-used facts come out before well-used ones.
CREATE INDEX IF NOT EXISTS idx_advocate_memory_lines_use
    ON advocate_memory_lines (user_id, used_count, last_used_at NULLS FIRST);

COMMENT ON COLUMN advocate_memory_lines.used_count IS
    'Turns that have carried this fact. Never-used facts are evicted first when the set is full.';
