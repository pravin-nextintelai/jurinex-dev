-- 178: Remember which chunks have already been through OCR repair.
--
-- Retrieval queues fragmented-looking chunks for a background LLM repair
-- (app/services/chunk_autoheal.py). The fragmentation check is a heuristic, so some
-- chunks it flags are ordinary legal text ("s/o", dotted leaders): the repair cannot
-- change them, the check flags them again, and every later question paid for another
-- model call on the same chunk.
--
-- healed_at is set once a chunk has been through repair, whatever the outcome —
-- repaired and saved, or left as it was because there was nothing to fix. A chunk with
-- healed_at set is never queued again, so a false alarm costs one call in total.
-- A repair that failed (quota, network) leaves it null, so it is tried again later.
--
-- Nullable with no default: adding it rewrites no rows and takes a brief lock only.
-- Also added on first use by app/services/chunk_autoheal.py.

ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS healed_at TIMESTAMPTZ;

COMMENT ON COLUMN file_chunks.healed_at IS
    'When this chunk went through OCR repair (app/services/chunk_autoheal.py). Set chunks are never repaired again.';
