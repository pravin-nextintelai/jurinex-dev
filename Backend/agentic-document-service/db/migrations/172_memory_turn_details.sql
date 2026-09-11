-- 172: Record what each chat turn did to memory.
--
-- The post-turn writer logs one memory_assembly_log row per turn with counts.
-- `details` adds what was actually written: lines filed, instructions saved from
-- an explicit request, suggestions made, lines seeded from the case details, and
-- the codes of anything refused. The case chat reads it to tell the advocate what
-- changed, and a memory-quality review can read outcomes rather than counts.
--
-- app/services/memory/repository.py also adds the column on first use, with a
-- two-second lock timeout. The index is only created here.

ALTER TABLE memory_assembly_log
    ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_memory_assembly_log_case_chat
    ON memory_assembly_log (case_key, chat_id)
    WHERE chat_id IS NOT NULL;
