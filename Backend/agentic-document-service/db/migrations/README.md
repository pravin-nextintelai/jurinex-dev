# SQL Migrations

These migrations align the new Python `agentic-document-service` with the shared PostgreSQL schema already used by `Backend/document-service`.

## What This Set Does

1. enables required extensions:
   - `uuid-ossp`
   - `pgcrypto`
   - `vector`
2. creates missing shared tables if they are absent:
   - `user_files`
   - `processing_jobs`
   - `file_chunks`
   - `chunk_vectors`
   - `file_chats`
   - `chunk_embedding_cache`
3. patches existing shared tables:
   - adds `file_id` to `document_ai_extractions`
   - fixes `prompt_extractions.input_template_id` to reference `input_templates(id)`
4. adds `preset_prompts` for hidden named workflows
5. adds the controlled memory system (migration `170`): standing preferences,
   case instructions, case memory sections/lines, memory settings, the assembly
   log and proposals. See `app/services/memory/` for the code that owns them.
6. indexes `folder_chats` for past-session recall (migration `171`): a full-text
   index over each turn's question and answer, and a folder/user/recency index.
7. records what each chat turn did to memory (migration `172`): a `details`
   column on `memory_assembly_log` and a case/chat index for looking a turn up.
8. stores instructions as switchable items (migration `173`): universal and
   per-case instruction sets, one row per instruction, with per-case and
   per-chat overrides. Old free-text instructions are moved across on first use.
9. keeps a rolling summary of each case chat (migration `174`): older turns of a
   chat are folded into `chat_session_summaries` after each answer, and the chat
   prompt sends that summary plus the latest turns. See `app/services/chat_summary.py`.
10. remembers the advocate across cases (migration `175`): facts the advocate states
    about themselves (practice, clients, way of working, background) in
    `advocate_memory_lines`, loaded into every case, and an `advocate_enabled`
    switch on `memory_settings`. Created on first use too.

## Suggested Run Order

Apply the files in filename order. `node db/migrate.js` (from the service root)
does this and records applied files in `schema_migrations`, but it needs the `pg`
package, which this service does not install. Run `npm install --no-save pg` in
the service root first, or apply the files with `psql` as below.

The memory tables in `170` and `173` are also created on first use by
`app/services/memory/repository.py`, and so is the `details` column from `172`.
The recall indexes in `171` and the turn index in `172` never are, so apply those
files explicitly.

Example:

```bash
psql -d your_database -f 001_enable_extensions.sql
psql -d your_database -f 010_create_user_files_table.sql
psql -d your_database -f 020_create_processing_jobs_table.sql
psql -d your_database -f 030_create_file_chunks_table.sql
psql -d your_database -f 040_create_chunk_vectors_table.sql
psql -d your_database -f 050_create_file_chats_table.sql
psql -d your_database -f 060_create_chunk_embedding_cache_table.sql
psql -d your_database -f 070_patch_document_ai_extractions_add_file_id.sql
psql -d your_database -f 080_patch_prompt_extractions_fix_template_fk.sql
psql -d your_database -f 090_create_preset_prompts_table.sql
psql -d your_database -f 100_backfill_folder_chats_and_file_chats_uuid_arrays.sql
psql -d your_database -f 163_create_case_chronology_table.sql
psql -d your_database -f 170_create_memory_tables.sql
psql -d your_database -f 171_folder_chats_fts.sql
psql -d your_database -f 172_memory_turn_details.sql
psql -d your_database -f 173_memory_instruction_items.sql
```

## Notes

- These migrations are idempotent where practical.
- They assume the shared `users` table already exists.
- `chunk_vectors.embedding` and `chunk_embedding_cache.embedding` use `vector(768)` to match the current pgvector-oriented document service pattern.
- `171` builds its indexes inside the runner's transaction, which blocks writes to
  `folder_chats` until they finish. On a large table, build them `CONCURRENTLY` by
  hand first; the file's header has the exact statements.
