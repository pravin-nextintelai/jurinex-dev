# Agentic Document Service Table Plan

This service should reuse the existing PostgreSQL tables already used by `Backend/document-service` wherever possible.

## Existing Tables To Reuse

### 1. `cases`
Source:
- `Backend/document-service/db/migrations/create_cases_table.sql`

Use in new service:
- phase 1 intake output
- case-level metadata
- link between a legal case and its root folder in `user_files`

Key columns already present:
- `id`
- `user_id`
- `folder_id`
- `case_title`
- `case_number`
- `filing_date`
- `case_type`
- `sub_type`
- `court_name`
- `court_level`
- `bench_division`
- `jurisdiction`
- `state`
- `judges`
- `petitioners`
- `respondents`
- `category_type`
- `primary_category`
- `sub_category`
- `complexity`
- `monetary_value`
- `priority_level`
- `status`

Assessment:
- This is the primary table for phase 1 form auto-population.
- Reuse directly.

### 2. `user_files`
Source:
- actively used by `Backend/document-service/models/File.js`
- actively used by `Backend/document-service/models/documentModel.js`
- create migration is not present in the visible migration folder

Use in new service:
- original document storage metadata
- folder structure per case
- upload status tracking
- full text summary linkage

Columns inferred from code usage:
- `id`
- `user_id`
- `originalname`
- `gcs_path`
- `gcs_output_path`
- `folder_path`
- `mimetype`
- `size`
- `is_folder`
- `status`
- `processing_progress`
- `current_operation`
- `summary`
- `full_text_content`
- `processed_at`
- `edited_docx_path`
- `edited_pdf_path`
- `created_at`
- `updated_at`

Assessment:
- This is the core document registry table.
- Reuse directly.
- We should not create a parallel `case_documents` table unless you explicitly want a clean schema split.

### 3. `processing_jobs`
Source:
- `Backend/document-service/models/ProcessingJob.js`
- referenced in `Backend/document-service/controllers/FileController.js`
- create migration is not present in the visible migration folder

Use in new service:
- async ingestion tracking
- Document AI job status
- Eventarc/background processing state

Columns inferred from code usage:
- `job_id`
- `file_id`
- `type`
- `gcs_input_uri`
- `gcs_output_uri_prefix`
- `document_ai_operation_name`
- `status`
- `error_message`
- `secret_id`
- `created_at`
- `updated_at`

Assessment:
- Reuse directly for phase 2 pipeline state.

### 4. `file_chunks`
Source:
- `Backend/document-service/models/FileChunk.js`
- `Backend/document-service/db/migrations/fix_file_chunks_id_default.sql`

Use in new service:
- phase 3 chunk storage
- grounded retrieval source chunks

Columns inferred from code usage:
- `id`
- `file_id`
- `chunk_index`
- `content`
- `token_count`
- `page_start`
- `page_end`
- `heading`

Assessment:
- Reuse directly.
- This is the right table for legal semantic chunks.

### 5. `chunk_vectors`
Source:
- `Backend/document-service/models/ChunkVector.js`
- `Backend/document-service/db/migrations/update_chunk_vectors_chunk_id_to_uuid.sql`

Use in new service:
- vector embeddings for chunk retrieval

Columns inferred from code usage:
- `id`
- `chunk_id`
- `embedding`
- `file_id`
- `created_at`
- `updated_at`

Assessment:
- Reuse directly if you stay on pgvector.
- If you move fully to Vertex AI Vector Search, keep this either as:
  - a cache/index shadow table, or
  - deprecated after migration.

### 6. `chunk_embedding_cache`
Source:
- `Backend/document-service/models/ChunkEmbeddingCache.js`
- create migration not present in visible migration folder

Use in new service:
- deduplicate repeated embeddings across identical content

Columns inferred from code usage:
- `content_hash`
- `embedding`
- `model`
- `token_count`
- `updated_at`

Assessment:
- Optional but strongly useful for production cost control.
- Reuse if it already exists in your database.

### 7. `folder_chats`
Source:
- `Backend/document-service/db/migrations/create_folder_chats_table.sql`
- `add_used_chunk_ids_to_folder_chats.sql`
- `add_secret_prompt_fields_to_folder_chats.sql`
- `add_citations_to_folder_chats.sql`
- `update_folder_chats_used_chunk_ids_to_uuid.sql`

Use in new service:
- phase 4 case/folder grounded Q&A history
- stored citations and used chunk lineage

Effective columns after migrations:
- `id`
- `user_id`
- `folder_name`
- `question`
- `answer`
- `session_id`
- `summarized_file_ids`
- `used_chunk_ids`
- `used_secret_prompt`
- `prompt_label`
- `secret_id`
- `chat_history`
- `citations`
- `created_at`

Assessment:
- Reuse if the new service should persist case-level chat exactly like the current folder chat behavior.

### 8. `file_chats`
Source:
- `Backend/document-service/models/FileChat.js`
- referenced by controllers
- create migration not present in visible migration folder

Use in new service:
- single-document chat history if you support file-scoped queries

Columns inferred from code usage:
- `id`
- `file_id`
- `user_id`
- `question`
- `answer`
- `session_id`
- `used_chunk_ids`
- `used_secret_prompt`
- `prompt_label`
- `secret_id`
- `chat_history`
- `chat_type`
- `created_at`
- `updated_at`

Assessment:
- Optional for the agentic case service.
- Not required if you are only supporting case/folder chat.

### 9. `document_ai_extractions`
Source:
- `Backend/document-service/db/migrations/create_document_ai_extractions_table.sql`

Use in new service:
- phase 1 OCR/entity extraction audit trail
- phase 2 OCR output persistence
- form parser and structured extraction results

Key columns already present:
- `id`
- `template_file_id`
- `file_type`
- `document_ai_processor_id`
- `document_ai_processor_version`
- `document_ai_operation_name`
- `document_ai_request_id`
- `extracted_text`
- `extracted_text_hash`
- `page_count`
- `total_characters`
- `total_words`
- `total_paragraphs`
- `entities`
- `form_fields`
- `tables`
- `confidence_score`
- `average_confidence`
- `min_confidence`
- `max_confidence`
- `processing_status`
- `processing_error`
- `processing_duration_ms`
- `metadata`
- `processed_at`
- `raw_response`
- `structured_schema`

Assessment:
- Very useful, but currently tied to `template_file_id`.
- For the new service this should either:
  - be extended to support normal uploaded file ids, or
  - be cloned into a more general extraction table.

Recommendation:
- Add `file_id UUID NULL REFERENCES user_files(id)` to this table instead of creating a brand-new extraction table.

### 10. `input_templates`
Source:
- `Backend/document-service/db/migrations/create_input_templates_table.sql`

Use in new service:
- user-selectable structured extraction prompts

Assessment:
- Reusable if your presets remain generic user prompts.
- Not ideal for hidden system presets by itself.

### 11. `prompt_extractions`
Source:
- `Backend/document-service/db/migrations/create_prompt_extractions_table.sql`
- `alter_prompt_extractions_user_id_nullable.sql`

Use in new service:
- extracted structured JSON generated from a template/prompt

Assessment:
- Reusable for prompt-driven extraction flows.
- Current FK naming is inconsistent because `input_template_id` references `template_files(id)` in SQL while the model treats it as an `input_templates` id.
- This should be corrected before relying on it heavily.

### 12. `system_prompts`
Source:
- `Backend/document-service/db/migrations/create_system_prompts_table.sql`

Use in new service:
- global system prompt for ADK or LLM behavior

Assessment:
- Reusable for shared system-level instructions.

### 13. `prompt_cache`
### 14. `user_metadata`
Source:
- `Backend/document-service/db/migrations/create_prompt_cache_tables.sql`
- `update_prompt_cache_add_context.sql`

Use in new service:
- cache grounded responses per user and context
- invalidate on new uploads

Assessment:
- Reuse directly.

### 15. `user_usage`
Source:
- `Backend/document-service/db/migrations/create_user_usage_table.sql`

Use in new service:
- per-user plan/resource accounting

Assessment:
- Reuse if this service contributes to the same limits.

### 16. `citation_attached_cases`
Source:
- `Backend/document-service/db/migrations/create_citation_attached_cases_table.sql`

Use in new service:
- optional if citation workflows remain integrated with case context

Assessment:
- Not required for the core agentic document pipeline, but already useful for cross-service citation context.

### 17. `user_documents`
Source:
- `Backend/document-service/db/migrations/create_user_documents_table.sql`

Use in new service:
- only if Google Docs editor integration is needed

Assessment:
- Optional, not core to the pipeline you requested.

## Minimum Required Tables For The New Agentic Service

If we want the new Python service to operate on the same data model as `document-service`, the minimum required tables are:

1. `cases`
2. `user_files`
3. `processing_jobs`
4. `file_chunks`
5. `chunk_vectors`
6. `folder_chats`
7. `document_ai_extractions`
8. `prompt_cache`
9. `user_metadata`

## Strongly Recommended Supporting Tables

1. `chunk_embedding_cache`
2. `system_prompts`
3. `input_templates`
4. `prompt_extractions`
5. `user_usage`

## Gaps / Inconsistencies Found

### A. Missing visible create migrations
The following tables are used in code but their create migrations were not found in `Backend/document-service/db/migrations`:

1. `user_files`
2. `processing_jobs`
3. `file_chunks`
4. `chunk_vectors`
5. `file_chats`
6. `chunk_embedding_cache`

### B. `document_ai_extractions` is template-centric
It currently references `template_files(id)` instead of general uploaded files.

Recommended fix:
- add `file_id UUID NULL REFERENCES user_files(id) ON DELETE CASCADE`
- keep `template_file_id` nullable for template workflows

### C. `prompt_extractions` FK looks inconsistent
Migration says:
- `input_template_id UUID REFERENCES template_files(id)`

Model usage implies:
- `input_template_id` should refer to `input_templates(id)`

Recommended fix:
- correct the foreign key to match `input_templates(id)`

## Recommendation For The Python FastAPI Service

The new `agentic-document-service` should be wired to reuse these existing tables instead of inventing replacements:

1. store uploaded case docs in `user_files`
2. store case metadata in `cases`
3. track async processing in `processing_jobs`
4. store OCR and structured extraction in `document_ai_extractions`
5. store semantic chunks in `file_chunks`
6. store embeddings in `chunk_vectors`
7. store case chat history and citations in `folder_chats`
8. reuse `prompt_cache` and `user_metadata` for response caching

## What Still Needs To Be Added

If you want this service to be fully production-ready against the current shared schema, the next DB work should be:

1. recover or recreate the missing create migrations for `user_files`, `processing_jobs`, `file_chunks`, `chunk_vectors`, `file_chats`, and `chunk_embedding_cache`
2. extend `document_ai_extractions` with `file_id`
3. fix the `prompt_extractions.input_template_id` foreign key
4. optionally add a dedicated `preset_prompts` table if hidden presets should be DB-managed instead of code-managed

Suggested `preset_prompts` table:

- `id UUID PRIMARY KEY`
- `name TEXT NOT NULL`
- `prompt_template TEXT NOT NULL`
- `required_doc_types JSONB DEFAULT '[]'::jsonb`
- `output_format TEXT NOT NULL`
- `is_active BOOLEAN DEFAULT TRUE`
- `created_by INTEGER NULL`
- `created_at TIMESTAMPTZ DEFAULT NOW()`
- `updated_at TIMESTAMPTZ DEFAULT NOW()`
