# Agentic Document Service

Python FastAPI backend for the multi-phase legal case management flow. The service is split into:

- `app/`: API routes, schemas, settings, and pipeline logic
- `agents/legal_case_management/`: Google ADK agent package using the official `agent.py` plus `root_agent` pattern
- `main.py`: FastAPI entrypoint that mounts the ADK runtime at `/adk` when `google-adk` is installed

The ADK agents use structured professional system prompts with explicit rules for:

- conservative legal extraction
- evidence-grounded answering
- hidden preset protection
- exact workflow discipline instead of open-ended assistant behavior

## Covered Workflow

1. Phase 1 intake:
   - stores uploaded intake documents to a Cloud Storage-style URI
   - extracts candidate case fields **and a grounded chronology** in the same `form_population_agent` call
   - auto-fills form fields (first-wins); unique dates are merged into a phase tree (see `docs/CHRONOLOGY.md`)
2. Phase 2 ingestion:
   - processes uploaded case documents in parallel
   - classifies uploaded case documents
   - captures extracted text and quality score
3. Phase 3 chunking:
   - performs semantic, section-aware chunking for legal text
   - preserves headings and paragraph boundaries
   - uses overlapping windows for context retention
   - targets 500-1000 token chunks
   - generates embeddings with `gemini-embedding-001`
   - indexes chunks in a vector store adapter for hybrid retrieval
4. Phase 4 query:
   - classifies intent
   - performs hybrid lexical plus vector retrieval
   - returns grounded answer segments with citations
5. Phase 5 presets:
   - exposes named presets
   - keeps prompt templates server-side

## Run Locally

```bash
cd Backend/agentic-document-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
uvicorn main:app --reload --port 8092
```

Branded PDF export (`POST /api/branding/export-pdf`) requires Chromium via Playwright (same print engine as Puppeteer).

By default the service now loads environment values from:

1. `Backend/document-service/.env`
2. `Backend/agentic-document-service/.env`

That means it can reuse the existing document-service configuration without duplicating secrets. If you create a local `.env` in `agentic-document-service`, its values override the shared ones.

Important:

- The new service does not reuse the old `PORT` setting for its own listener.
- To run it beside `document-service`, set `AGENTIC_DOCUMENT_SERVICE_PORT=8092` if you want to override the default.
- The old `PORT` value from `Backend/document-service/.env` is used as a fallback to locate the legacy Node service for compatibility proxying.

## API Surface

- `GET /health`
- `POST /api/v1/intake`
- `POST /api/files/{folderName}/extract-case-fields` (form fields + chronology)
- `GET /api/files/{folderName}/chronology`
- `GET /api/files/cases/{caseId}` (case payload includes `chronology`)
- `POST /api/v1/cases/{case_id}/documents:process`
- `POST /api/v1/cases/{case_id}/query`
- `GET /api/v1/presets`
- `POST /api/v1/cases/{case_id}/presets/{preset_id}:execute`
- `GET|POST|PUT|DELETE /api/files/*` via legacy compatibility proxy
- `GET|POST|PUT|DELETE /api/content/*` via legacy compatibility proxy
- `GET|POST|PUT|DELETE /api/mindmap/*` via legacy compatibility proxy
- `GET /api/llm-models` via legacy compatibility proxy
- `GET /adk` when the ADK runtime mounts successfully

## Example Intake Payload

```json
{
  "user_id": "user-123",
  "document": {
    "document_name": "bail-petition.pdf",
    "mime_type": "application/pdf",
    "inline_text": "Case No: BA-102/2026 John Doe vs State of X 12 March 2026 High Court"
  }
}
```

## Production Notes

- The current adapters are safe defaults that keep the service runnable even without cloud credentials.
- Replace the heuristic `DocumentAIAdapter` with live Document AI processor calls once project-specific processor IDs are available.
- Replace the in-memory vector store with Vertex AI Vector Search or Elasticsearch by swapping the adapter in `app/services/adapters/`.
- Ingestion is parallelized across documents, and chunking is handled by a legal-aware semantic chunker in `app/services/adapters/chunking.py`.
- The FastAPI routes and ADK agent tools call the same pipeline service, which keeps behavior aligned across both interfaces.
- `ENABLE_LEGACY_PROXY=true` lets this service sit in front of the existing Node `document-service`, so the frontend can point to the new service first while legacy routes are still being ported.
- Set `LEGACY_DOCUMENT_SERVICE_URL` to your current Node `document-service` base URL if it is not running on the port defined in the shared `document-service/.env`.
- In the frontend, set `VITE_APP_AGENTIC_DOCUMENT_SERVICE_URL` to this service URL to make it the default document backend entrypoint.
- The settings loader understands existing `document-service` variable names such as `DATABASE_URL`, `GCLOUD_PROJECT_ID`, `GCS_BUCKET_NAME`, `GCS_BUCKET`, `DOCUMENT_AI_LOCATION`, `GEMINI_API_KEY`, `JWT_SECRET`, `REDIS_URL`, `AUTH_SERVICE_URL`, and `PAYMENT_SERVICE_URL`.
- The ADK agents default to `gemini-2.5-pro` through the shared `ADK_MODEL` setting unless you explicitly override it.
- Intake auto-fill + chronology use `form_population_agent` (admin-selected model; currently `gemini-3.7-flash`, `thinking_level=low`). OCR is stamped `[PAGE n]`, extract budget is 900k characters, and pin cites / OCR year votes run in Python. Details: [`docs/AUTO_FILL.md`](docs/AUTO_FILL.md) and [`docs/CHRONOLOGY.md`](docs/CHRONOLOGY.md).
- Large uploads (a 2,000-page PDF in 2–3 minutes): born-digital pages are read from their text layer with PyMuPDF and only scanned pages go to Document AI, 30 pages per imageless request, 24 in flight. Measured, knobs and tests: [`docs/LARGE_DOCUMENTS.md`](docs/LARGE_DOCUMENTS.md).
- The embedding model default is `gemini-embedding-001`, and chunk metadata records both the embedding model and vector backend used during indexing.
