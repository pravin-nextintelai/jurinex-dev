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

## Suggested Run Order

Apply the files in filename order.

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
```

## Notes

- These migrations are idempotent where practical.
- They assume the shared `users` table already exists.
- `chunk_vectors.embedding` and `chunk_embedding_cache.embedding` use `vector(768)` to match the current pgvector-oriented document service pattern.
