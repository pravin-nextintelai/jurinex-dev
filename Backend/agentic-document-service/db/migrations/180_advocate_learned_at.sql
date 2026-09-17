-- 180: When JuriNex last looked across an advocate's cases to learn about them.
--
-- app/services/memory/profile.py reads an advocate's own cases and the rules they kept
-- in each, and suggests (never saves):
--   * facts about their practice the cases show, e.g. "Mostly handles Writ Petition
--     matters (8 of 12 cases)", for "What JuriNex knows about you";
--   * ways of working they asked for in two or more cases, as standing instructions for
--     every case.
-- It runs at most once a day per advocate (MEMORY_PROFILE_INTERVAL_HOURS) and on request.
-- learned_at records the last run. Added on first use too.

ALTER TABLE advocate_memory_sets
    ADD COLUMN IF NOT EXISTS learned_at TIMESTAMPTZ;

COMMENT ON COLUMN advocate_memory_sets.learned_at IS
    'When JuriNex last looked across this advocate''s cases for suggestions about them (app/services/memory/profile.py).';
