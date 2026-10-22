# Ingestion Queue & Draft Job (Multi-Document Upload)

Flow:

```
User uploads N documents
    ↓
Ingestion Agent (API)
    ↓
Create 1 Draft Job (parent)
Create N Document Jobs (queue)
    ↓
Worker pool (parallel workers)
    ↓
Process each document: OCR → Chunking → Embeddings → Store chunks
    ↓
When ALL document jobs complete
    ↓
Mark Draft Job COMPLETE
    ↓
Draft Generation: retrieve ALL chunks across ALL docs → generate final draft
```

## Architecture

- **Draft Job** (1 per upload batch): parent record with `draft_job_id`, `draft_id`, `document_job_ids[]`, `status` (`processing` | `complete`). When all document jobs finish, status is set to `complete`.
- **Document Jobs** (N): one per file. Each is processed by the worker pool (OCR → Document AI → chunk → embed → DB), and the file is linked to the draft via `add_uploaded_file_id_to_draft`.
- **Worker pool**: fixed-size thread pool (default 4) processes document jobs in **parallel**. No Redis; in-memory queue.

## Requirements

- **No Redis.** Job state is in memory; lost on server restart. Single-instance only.
- `draft_id` is **required** for `POST /api/orchestrate/upload-multiple`.

## API

1. **Upload N documents**
   - `POST /api/orchestrate/upload-multiple` (form-data: `files`, `draft_id` required, optional `case_id`, `template_id`).
   - Response: `{ "draft_job_id": "...", "job_ids": ["id1", "id2", ...], "batch_id": "...", "draft_id", "total": N }`.

2. **Poll draft job status (recommended)**
   - `GET /api/ingestion/draft-jobs/{draft_job_id}`
   - Response: `{ "draft_job_id", "draft_id", "status", "document_job_ids", "jobs": [...], "all_done", "file_ids", "finished_count", "failed_count", "total" }`.
   - When `status === "complete"`, all document jobs are done; all chunks are stored and linked to the draft. Proceed to draft generation.

3. **Poll batch status (optional, backward compatible)**
   - `GET /api/ingestion/batches/{batch_id}` — `batch_id` is the same as `draft_job_id`; `job_ids` query param is optional.

4. **Single document job**
   - `GET /api/ingestion/jobs/{job_id}`

## Draft generation

When the draft job is **complete**, the draft’s `uploaded_file_ids` contains all ingested file IDs. Section generation (Librarian → Drafter) already retrieves chunks from all those files, so no API change is needed: run section generate as usual after the draft job is complete.

## Single-file behaviour

- `POST /api/orchestrate/upload` (single file): synchronous ingestion, no queue.
- `POST /api/orchestrate/upload-multiple`: creates 1 draft job + N document jobs; parallel workers; poll `GET /api/ingestion/draft-jobs/{draft_job_id}` until complete.
