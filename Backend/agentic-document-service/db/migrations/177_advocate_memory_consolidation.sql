-- 177: Keep the set as it was before a consolidation, so the advocate can put it back.
--
-- Near its ceiling, what JuriNex remembers about the advocate is rewritten once as
-- fewer, sharper lines (app/services/memory/consolidate.py) instead of stopping at
-- "full". The merge is grounded in the words already stored and every merged line
-- faces the same rules as a typed one, but it is still a rewrite of the advocate's
-- own notes, so it has to be reversible.
--
-- last_consolidation holds one record:
--   {"at": "<iso timestamp>", "model": "...", "lines_before": n, "lines_after": m,
--    "before": [{"category": "...", "text": "...", "source_ref": {...}}, ...]}
--
-- Only the most recent merge is kept: undo puts the set back to the state before it.
-- Cleared when the advocate forgets everything, or when they undo.
--
-- The column is also added on first use by app/services/memory/repository.py.

ALTER TABLE advocate_memory_sets
    ADD COLUMN IF NOT EXISTS last_consolidation JSONB;

COMMENT ON COLUMN advocate_memory_sets.last_consolidation IS
    'The set as it stood before the last consolidation, for undo. Null when there is nothing to undo.';
