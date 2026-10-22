# JuriNex Agent Flow — Complete Documentation

This document describes the **complete flow** for templates, drafts, file upload, case attachment, and how agents work when the user provides a file or selects a case. The design follows **Google ADK-style** orchestration: the Orchestrator delegates to specialized agents; agents use tools and report back; the Orchestrator then decides the next step.

---

## 1. User flow (templates and drafts)

### 1.1 Fetch templates → select template → edit → close → draft in recent drafts

1. **Fetch all templates**  
   Frontend calls `GET /api/templates` (optional: category, limit, offset). The service returns the template list (with preview image URLs).

2. **User selects a template**  
   - Frontend calls `GET /api/templates/{template_id}/drafts/latest` to get the user’s latest draft for that template.  
   - If a draft exists: navigate to `/draft-form/{draft_id}` and load that draft’s data (Word/Google Docs style: show last saved state until the user edits).  
   - If no draft exists: call `POST /api/drafts` with `template_id` and optional `draft_title`, then navigate to `/draft-form/{draft_id}`.

3. **User edits and closes**  
   - Form fields are auto-saved (after first user edit) via `PUT /api/drafts/{draft_id}`.  
   - When the user leaves the page, the draft is already stored; listing drafts shows it under “Recent drafts.”

4. **Recent drafts**  
   - `GET /api/drafts` returns the user’s drafts (recent first).  
   - Each draft can be opened from the list; opening loads the draft’s saved `field_values` and metadata (including attached case).

### 1.2 Open template → upload file **or** use case (context)

When the user is on the draft form (`/draft-form/{draft_id}`):

- **Upload file**  
  User selects a file → frontend calls `POST /api/orchestrate/upload` with the file and optional `draft_id`. The **Orchestrator** runs and delegates to the **Ingestion** agent (see §2). After ingestion completes, the Orchestrator is informed (task done). The uploaded file is stored in the DB (GCS, chunks, embeddings) and can be used later by the Librarian for retrieval.

- **Use case files**  
  User clicks “Use case data” → fetches cases via document service → selects a case → frontend calls `POST /api/drafts/{draft_id}/attach-case` with `case_id` (and optional `case_title`). The draft’s `metadata` stores `case_id`/`case_title`. Downstream agents (e.g. when generating a document) can use this to fetch that case’s files and context from the document service. Case files that are already ingested (e.g. via upload in this flow or elsewhere) are searchable by the Librarian.

---

## 2. Flow when user uploads a file

End-to-end: **User uploads file → Orchestrator → Ingestion agent (tools, DB) → task done → Orchestrator**.

### 2.1 API

- **Endpoint:** `POST /api/orchestrate/upload`  
- **Auth:** `Authorization: Bearer <JWT>` (required). `user_id` is taken from the JWT.  
- **Body (form-data):**  
  - `file` (required): PDF/DOCX/image.  
  - `folder_path` (optional): string.  
  - `draft_id` (optional): link upload to a draft.  
  - `case_id` (optional): link upload to a case.

### 2.2 Orchestrator

1. Receives the upload request (with decoded `user_id`, file content, optional `draft_id`/`case_id`).  
2. Builds an **upload payload** and calls **Ingestion** (see §2.3).  
3. Does **not** talk to the user; only delegates and receives the agent result.

### 2.3 Ingestion agent

- **Role:** Turn the uploaded document into normalized text and vector data; **use tools** (GCS, Document AI, chunking, embedding, DB); **do not** generate content.  
- **Input (from Orchestrator):**  
  - `user_id`, `file_content` (base64), `originalname`, `mimetype`, `size`, `folder_path`; optional `draft_id`, `case_id`.  
- **Steps:**  
  1. Upload file to GCS (or use existing reference).  
  2. Run Document AI (OCR) on the document.  
  3. Extract and normalize text.  
  4. Chunk text (e.g. recursive/semantic chunking).  
  5. Generate embeddings for each chunk.  
  6. Store raw text, chunks, and embeddings in the database (user-scoped).  
- **Output (to Orchestrator):**  
  - `raw_text`, `chunks`, `embeddings`, `file_id`; optional `error`.  
- When finished, the Ingestion agent **reports back** to the Orchestrator (task done). The Orchestrator can then delegate to the Librarian or other agents (e.g. when the user later asks for retrieval or drafting).

### 2.4 Data storage

- **GCS:** Uploaded file (path/URI stored in DB).  
- **DB (user_files, file_chunks, chunk_vectors):** File metadata, full text, chunks, and vectors — all scoped by `user_id` so retrieval is user-specific.

---

## 3. Flow when user uses “case” (context)

- User attaches a case to the draft via `POST /api/drafts/{draft_id}/attach-case` with `case_id`.  
- Draft `metadata` holds `case_id` (and optional `case_title`).  
- **Case files:** If those files have been ingested (e.g. via `/api/orchestrate/upload` or document service integration), they already exist in the same DB (chunks/vectors). The Librarian can then fetch relevant content for the user’s request (see §4).  
- When the Orchestrator later runs the Drafter (or another agent), it can pass draft context (e.g. `draft_id`, `case_id`) so the agent can use case-linked data (e.g. via document service or `file_ids` from ingestion).

### 3.1 Retrieve when case is selected — no need to pass file_ids

Once a case is attached to the draft, **the client does not need to send `file_ids`** for retrieve. The backend uses the **cases** and **user_files** tables only:

1. **Resolve case:** If the request has `draft_id`, read `metadata.case_id` from the draft (attached case). Otherwise use optional `case_id` from the request body.
2. **Case → folder:** From **cases** table get `folder_id` for that case (and user).
3. **Folder → path:** From **user_files** get the folder row (`id = folder_id`, `is_folder = true`) and its `folder_path`.
4. **Fetch all files in folder:** From **user_files** select all rows where `is_folder = false` and `folder_path` equals or is under that path. These are the file IDs for the case folder.
5. **Chunks and filter:** Pass those file IDs to the Librarian. The Librarian embeds the query, runs vector search over chunks for those files, and returns top-k chunks (filter by similarity).

So for **POST /api/orchestrate/retrieve** or **POST /api/retrieve**, when the draft has a case attached, send only **query** and **draft_id** (and optional **top_k**). No `file_ids` or `case_id` in the body is required; the backend resolves the case from the draft and uses all files in that case's folder for chunk retrieval.

---

## 4. Librarian agent: fetch relevant content from DB

When the Orchestrator needs relevant content for a user request (e.g. “evidence for X”, “key terms”), it delegates to the **Librarian**.

### 4.1 Orchestrator → Librarian

1. Orchestrator decides: “fetch relevant chunks for query/evidence.”  
2. Builds payload: `user_id` (from JWT), `query`, optional `file_ids`, `top_k`.  
3. Calls the Librarian agent.  
4. Librarian **uses tools** (see §4.2), then **reports** the result back to the Orchestrator (task done).  
5. Orchestrator receives `chunks` and `context`; it can then delegate to the next agent (e.g. Drafter).

### 4.2 Librarian agent

- **Role:** Fetch relevant chunks from the vector DB; **do not** generate content.  
- **Tool:** `fetch_relevant_chunks(query, user_id, file_ids?, top_k)`.  
  - Embeds the query.  
  - Runs vector search (user-scoped; optional `file_ids`).  
  - Returns top-k chunks with metadata (content, file_id, page_start, page_end, heading, similarity).  
- **Input (from Orchestrator):**  
  - `user_id` (required), `query` or `raw_text`, optional `file_ids`, `top_k`.  
- **Output (to Orchestrator):**  
  - `chunks`, `context` (concatenated chunk content), optional `raw_text`/`embeddings` for state.  
- **Constraints:** User- and document-specific only (JWT `user_id`; no chunks from other users).

### 4.3 API (direct or via Orchestrator)

- **Via Orchestrator:** `POST /api/orchestrate/retrieve` with JSON body: `query` (required), optional `draft_id`, `top_k`, `file_ids`, `case_id`.  
- **Direct (no Orchestrator):** `POST /api/retrieve` with same body.  
- Both require JWT; `user_id` is taken from the token.  
- **When a case is attached to the draft:** Send only `query` and `draft_id`; the backend uses `cases.folder_id` and `user_files` to fetch all files in that folder and runs chunk search over them (no need to pass `file_ids`).

---

## 5. Full pipeline order (Orchestrator)

- **Upload flow:**  
  Ingestion → (task done) → optionally Librarian → Drafter → Critic → Assembler.  
- **Retrieve-only flow:**  
  Librarian → (task done) → optionally Drafter → Critic → Assembler.  

The Orchestrator delegates one agent at a time and waits for the result before deciding the next step (ADK-style).

---

## 6. Agent summary (production-ready, ADK-style)

| Agent        | Role                          | Tools / actions                                      | Talks to user? |
|-------------|-------------------------------|------------------------------------------------------|----------------|
| Orchestrator| Coordinate order, delegate     | None (delegates to agents)                           | No            |
| Ingestion   | Upload → GCS, Document AI, chunk, embed, DB | GCS upload, Document AI, chunking, embedding, DB write | No            |
| Librarian   | Fetch relevant chunks         | `fetch_relevant_chunks` (embed query, vector search)| No            |
| Drafter     | Draft from chunks             | (LLM/tools as implemented)                           | No            |
| Critic      | Validate draft                | (validation tools)                                   | No            |
| Assembler   | Assemble final document       | (assembly tools)                                     | No            |

- All agents receive instructions and payloads from the Orchestrator (or API that invokes the Orchestrator).  
- User communication is done by the API/frontend, not by the agents.  
- **References:** Google ADK patterns: agent as coordinator, specialized agents with tools, clear input/output contracts.  
- **Security:** All ingestion and retrieval are scoped by `user_id` from the JWT; no cross-user data.

---

## 7. Quick reference: endpoints

| Method | Endpoint                     | Purpose |
|--------|------------------------------|--------|
| GET    | /api/templates               | List templates (optional category, pagination) |
| GET    | /api/templates/{id}/drafts/latest | Latest draft for template (open or create) |
| POST   | /api/drafts                  | Create draft from template |
| GET    | /api/drafts                  | List user’s drafts (recent first) |
| GET    | /api/drafts/{id}             | Get draft (fields + field_values + metadata) |
| PUT    | /api/drafts/{id}             | Update draft field_values |
| POST   | /api/drafts/{id}/attach-case | Attach case to draft (metadata) |
| POST   | /api/orchestrate/upload      | Upload file → Orchestrator → Ingestion → DB (optional draft_id, case_id) |
| POST   | /api/orchestrate/retrieve    | Query → Orchestrator → Librarian → chunks |
| POST   | /api/ingest                  | Direct ingestion (no Orchestrator) |
| POST   | /api/retrieve                | Direct Librarian (no Orchestrator) |

All POST/GET draft and orchestration endpoints require `Authorization: Bearer <JWT>`.
