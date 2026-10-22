# JuriNex Agent Draft Service — Complete Architecture

> **Last updated:** March 2026
> A FastAPI-based multi-agent orchestration platform that transforms uploaded legal documents
> into fully formatted, AI-generated HTML drafts using a RAG-augmented LLM pipeline.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Directory Structure](#3-directory-structure)
4. [Database Architecture](#4-database-architecture)
5. [Authentication and Security](#5-authentication-and-security)
6. [API Layer — All Endpoints](#6-api-layer--all-endpoints)
7. [Agents — Deep Dive](#7-agents--deep-dive)
8. [Services Layer](#8-services-layer)
9. [Configuration Layer](#9-configuration-layer)
10. [Complete Data Flows](#10-complete-data-flows)
11. [Agent Configuration System](#11-agent-configuration-system)
12. [Key Design Patterns](#12-key-design-patterns)
13. [Environment Variables Reference](#13-environment-variables-reference)

---

## 1. System Overview

The Agent Draft Service is one microservice in the JuriNex platform. Its responsibility is:

- **Receive** uploaded legal documents (PDFs, DOCX, images)
- **Process** them: OCR → chunk → embed → store in vector DB
- **Generate** legal document sections by combining template structure + chunk context + field values via LLM
- **Assemble** all sections into a final document, convert to DOCX, and sync to Google Docs
- **Expose** all of this through a REST API consumed by the JuriNex React frontend

### High-Level Architecture

```
+---------------------------------------------------------------------------+
|                           React Frontend                                  |
|  (upload files, trigger generation, view/edit sections, assemble doc)     |
+--------------------------------------+------------------------------------+
                                       | HTTPS REST (JWT Bearer)
                                       v
+---------------------------------------------------------------------------+
|                    FastAPI Application  (port 8000)                       |
|                                                                           |
|  Ingestion  |  Librarian  |  Section  |  Draft  |  Template  |  Assemble |
|  Routes     |  Routes     |  Routes   |  Routes |  Routes    |  Routes   |
|      |            |             |          |          |            |       |
+------v------------v-------------v----------v----------v------------v------+
       |                         AGENT LAYER                                |
       |                                                                    |
  Ingestion --> Librarian --> Drafter --> Critic --> Assembler              |
      ^                          ^                                          |
  Injection                  Citation                                       |
  (auto-fill)               (legal refs)                                    |
       |                         SERVICES LAYER                             |
  LLM (Gemini/Claude) | Draft_DB | Document_DB | GCS | Document AI         |
+---------------------------------------------------------------------------+
```

### Two Separate Databases

| Database | Env Var | Purpose |
|---|---|---|
| Document_DB | DATABASE_URL | Raw documents, file chunks, pgvector embeddings, cases |
| Draft_DB | DRAFT_DATABASE_URL | Templates, drafts, sections, agent prompts, field values |

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Framework | FastAPI + Uvicorn |
| Auth | PyJWT (HS256, user_id in payload.id) |
| LLM — Gemini | google-genai SDK (client.models.generate_content) |
| LLM — Claude | anthropic SDK (via services/claude_client.py) |
| Embeddings | Google Gemini embedding-001 (768 dimensions) |
| Vector Search | PostgreSQL + pgvector (cosine distance operator <=>) |
| OCR | Google Cloud Document AI |
| File Storage | Google Cloud Storage (GCS) |
| Schema Validation | Pydantic v2 |
| Database | psycopg2-binary (PostgreSQL) |
| DOCX Export | python-docx + htmldocx + premailer |
| HTML Parsing | BeautifulSoup4 |

---

## 3. Directory Structure

```
agent-draft-service/
|
+-- main.py                         # ASGI entry point (imports api.app:app)
|
+-- api/
|   +-- app.py                      # FastAPI init, CORS, router registration, load_dotenv
|   +-- deps.py                     # JWT auth dependencies (require_user_id, optional_user_id)
|   +-- section_routes.py           # Section generation and refinement endpoints
|   +-- draft_routes.py             # Draft CRUD + field values + section prompts
|   +-- template_routes.py          # Template gallery endpoints
|   +-- librarian_routes.py         # Chunk retrieval endpoints
|   +-- assemble_routes.py          # Final document assembly + DOCX export
|   +-- ingestion_routes.py         # Document upload + field extraction
|   +-- agent_routes.py             # Agent config CRUD
|   +-- universal_sections_routes.py# Universal section templates (JSON-based)
|   \-- orchestrator_helpers.py     # Shared helpers for orchestrator API flow
|
+-- agents/
|   +-- draft_pipeline.py           # NEW: 3-agent HTML draft pipeline with self-repair loop
|   +-- librarian/
|   |   +-- agent.py                # run_librarian_agent()
|   |   \-- tools.py                # fetch_relevant_chunks(), fetch_template(), TemplateData
|   +-- drafter/
|   |   +-- agent.py                # run_drafter_agent(), run_html_draft_generator()
|   |   \-- tools.py                # draft_section(), generate_html_draft(), validate_generated_html()
|   +-- critic/
|   |   +-- agent.py                # run_critic_agent(), run_html_draft_critic()
|   |   \-- tools.py                # review_section(), review_html_draft(), CriticReport
|   +-- assembler/
|   |   \-- agent.py                # run_assembler_agent()
|   +-- citation/
|   |   +-- agent.py                # run_citation_agent()
|   |   +-- tools.py                # extract_claims, match_to_sources, format_citations
|   |   \-- legal_citation_validator.py
|   +-- ingestion/
|   |   +-- agent.py                # run_ingestion_agent()
|   |   +-- pipeline.py             # run_ingestion() full pipeline
|   |   +-- chunker.py              # chunk_structured_content()
|   |   \-- injection_agent.py      # run_injection_agent() — auto-extract template fields
|   \-- orchestrator/
|       +-- agent.py                # OrchestratorAgent class
|       +-- flow_controller.py      # FlowController — state machine
|       \-- state_manager.py        # StateManager + DocumentState
|
+-- services/
|   +-- llm_service.py              # call_llm() — unified Gemini/Claude interface
|   +-- draft_db.py                 # All Draft_DB queries
|   +-- db.py                       # All Document_DB queries
|   +-- agent_config_service.py     # get_agent_by_type() — fetch+cache agent prompts
|   +-- embedding_service.py        # generate_embeddings()
|   +-- template_format.py          # Extract CSS format from template HTML
|   +-- document_ai.py              # Google Document AI OCR
|   +-- storage.py                  # GCS upload
|   +-- gcs_signed_url.py           # Time-limited GCS access URLs
|   +-- claude_client.py            # Anthropic API wrapper
|   +-- docx_export.py              # HTML to DOCX conversion
|   +-- assembled_doc_clean.py      # Strip citations from assembled output
|   \-- ingestion_queue.py          # Async queue + background worker
|
+-- config/
|   \-- gemini_models.py            # Model registry, is_claude_model(), is_valid_model()
|
+-- workers/
|   \-- ingestion_worker.py         # Background worker for multi-file ingestion
|
+-- .env                            # Environment variables
\-- requirements.txt                # Python dependencies
```

---

## 4. Database Architecture

### 4.1 Draft_DB — Templates, Drafts, Agent Config

```
templates
  template_id (UUID, PK)
  template_name, description, category, sub_category, language
  status: "active" | "finalized" | "draft"
  created_by (int, user_id)

template_assets                     -- HTML/PDF files uploaded for each template
  asset_id, template_id (FK)
  asset_type: "html" | "pdf" | "image"
  original_file_name, gcs_bucket, gcs_path, mime_type

template_css                        -- CSS for section preview formatting
  css_id, template_id (FK), version
  css_content (full CSS string), is_active

template_analysis_sections          -- Section definitions with LLM prompts
  id (UUID, PK), template_id (FK)
  section_name, section_key         -- e.g. "title_page"
  section_purpose, section_intro
  section_prompts (JSONB[])         -- [{prompt: "...", variant: "..."}, ...]
  order_index, is_active

user_drafts                         -- One draft = one user instance of a template
  draft_id (UUID, PK)
  user_id (int, from JWT), template_id (FK)
  draft_title, status

draft_field_data                    -- Draft-level field values + metadata
  draft_id (FK), user_id
  field_values (JSONB)              -- {field_key: value} — user-edited values
  metadata (JSONB):
    case_id                         -- Attached case for context
    case_title
    is_fresh                        -- True until user makes first edit
    uploaded_file_ids (str[])       -- Files uploaded directly to this draft
    assembled_cache:                -- Cached assembled document
      sections_hash                 -- SHA256 of all section HTMLs
      final_document                -- Cached HTML output
      template_css
      assembled_at
      metadata: {google_file_id, iframe_url}

dt_draft_section_prompts            -- Per-section prompt config stored per draft
  draft_id, section_id (UUID)
  section_name, custom_prompt
  is_deleted, detail_level          -- "detailed" | "concise" | "short"
  language, sort_order

section_versions                    -- Full version history per section
  version_id (UUID, PK)
  draft_id, section_key
  version_number (auto-incremented per section per draft)
  content_html                      -- Generated HTML
  user_prompt_override              -- Only if user edited the prompt
  rag_context_used                  -- Context chunks used for tracing
  generation_metadata (JSONB)       -- {drafter: {}, critic: {}, rag_query}
  created_by_agent                  -- "drafter" | "html_draft_generator"

template_user_field_values          -- Auto-populated field values (InjectionAgent output)
  template_id, user_id, draft_session_id
  field_values (JSONB)              -- {field_key: extracted_value}
  user_edited_fields (JSONB[])      -- Keys user has manually changed (never removed)
  filled_by: "agent" | "user"
  extraction_status: "completed" | "partial" | "terminated"

agent_prompts                       -- System prompts + model config per agent type
  id (int, PK)
  name: "Drafter Agent", "Critic Agent", etc.
  agent_type: "drafting" | "critic" | "citation" | "assembler"
  prompt (text)                     -- System instruction (HOW to behave)
  model_ids (int[])                 -- References llm_models.id
  temperature (float)
  llm_parameters (JSONB)            -- Extra config
```

### 4.2 Document_DB — Files, Chunks, Vectors

```
user_files
  id (UUID, PK), user_id (int)
  originalname, gcs_path, folder_path, mimetype, size
  status: "uploaded" | "processing" | "processed" | "failed"
  processing_progress (float, 0-100)
  current_operation (text)          -- e.g. "Extracting text..."
  full_text_content (text)          -- Concatenated OCR text

file_chunks                         -- Overlapping text windows from each document
  id (UUID, PK), file_id (FK)
  chunk_index, content (text)       -- ~1200 chars, 150 char overlap
  token_count, page_start, page_end
  heading (text)                    -- Section heading if detected

chunk_vectors                       -- pgvector embeddings for semantic search
  id (UUID, PK), chunk_id (FK)
  embedding (vector(768))           -- Gemini embedding-001

cases
  id (UUID, PK), user_id (int)
  case_name, case_number, court_name

llm_models                          -- Model name registry
  id (int, PK)
  name (text)                       -- e.g. "claude-sonnet-4-5", "gemini-2.5-pro"
```

---

## 5. Authentication and Security

Every API endpoint (except `/` and `/health`) requires a JWT:

```
Authorization: Bearer <jwt_token>
```

**`require_user_id`** in `api/deps.py`:
1. Extracts token from `Authorization: Bearer <token>` header
2. Decodes with `JWT_SECRET` using HS256 algorithm
3. Returns `decoded["id"]` as integer `user_id`
4. Raises HTTP 401 if header is missing or token is invalid

**User isolation enforced at every DB query:**
- `find_nearest_chunks(user_id=...)` — only this user's vectors
- `get_user_draft(draft_id, user_id)` — only this user's draft
- `list_user_drafts(user_id)` — only this user's drafts
- All template field values keyed by `(template_id, user_id, draft_session_id)`

---

## 6. API Layer — All Endpoints

### Core (api/app.py)

| Method | Path | Description |
|---|---|---|
| GET | / | Service info and all endpoint paths |
| GET | /health | {"status": "ok"} |
| GET | /api/endpoints | Test endpoint list with request formats |

### Template Routes (api/template_routes.py)

| Method | Path | Description |
|---|---|---|
| GET | /api/templates | List all templates (filters: category, is_active, finalized_only) |
| GET | /api/templates/{template_id} | Template details + fields + sections + preview URL |
| GET | /api/templates/{template_id}/preview-image | GCS signed URL for preview image |
| GET | /api/templates/{template_id}/fields | Template field schema |
| GET | /api/templates/{template_id}/analysis-sections | Section prompts from DB |
| GET | /api/templates/{template_id}/url | Signed URL for template HTML file |

**Template resolution:** Admin templates (UUID in Draft_DB) are fetched from DB directly.
User-uploaded templates (UUID format not in DB) are fetched from the external Template Analyzer
service at `TEMPLATE_ANALYZER_URL` (default localhost:5017).

### Draft Routes (api/draft_routes.py)

| Method | Path | Description |
|---|---|---|
| POST | /api/drafts | Create draft from template |
| GET | /api/drafts | List user's drafts |
| GET | /api/drafts/{draft_id} | Get draft with merged field_values |
| PUT | /api/drafts/{draft_id} | Update draft field_values |
| DELETE | /api/drafts/{draft_id} | Delete draft |
| PATCH | /api/drafts/{draft_id}/rename | Rename draft title |
| GET | /api/drafts/{draft_id}/template-css | CSS for section formatting |
| POST | /api/drafts/{draft_id}/attach-case | Link case_id → triggers field auto-population |
| POST | /api/drafts/{draft_id}/uploaded-file | Register uploaded file to draft |
| POST | /api/drafts/{draft_id}/link-file | Link existing file to draft |
| GET | /api/drafts/{draft_id}/sections/prompts | Per-section prompt config |
| POST | /api/drafts/{draft_id}/sections/prompts | Save section prompt config |
| POST | /api/drafts/{draft_id}/sections/order | Save section display order |
| GET | /api/template-user-field-values | Get auto-populated field values |
| POST | /api/template-user-field-values | Save field values (with merge logic) |

**Field value merge rule:**
```
Final = InjectionAgent extracted values
      <-- OVERLAY --> draft_field_data.field_values (user-edited)

user_edited_fields list only grows (never shrinks).
User edits always win over agent-extracted values.
```

### Section Routes (api/section_routes.py)

| Method | Path | Description |
|---|---|---|
| POST | /api/drafts/{id}/sections/{key}/generate | Generate section (Librarian → Drafter → optional Critic) |
| POST | /api/drafts/{id}/sections/{key}/generate-html | Full HTML pipeline (3-agent + self-repair loop) |
| POST | /api/drafts/{id}/sections/{key}/refine | Refine with user feedback |
| GET | /api/drafts/{id}/sections | All active sections (latest version each) |
| GET | /api/drafts/{id}/sections/{key} | Specific section latest version |
| GET | /api/drafts/{id}/sections/{key}/versions | Full version history |
| PUT | /api/drafts/{id}/sections/{key}/versions/{vid} | Manual content edit |

**Section prompt resolution order (highest priority first):**
1. `section_prompt` in request body (user override for this call)
2. Custom prompt in `dt_draft_section_prompts` (user saved previously)
3. Default prompt in `template_analysis_sections` (template-defined)
4. Fallback from universal_sections JSON (generic built-in)
5. Auto-generated from section name (last resort)

### Librarian Routes (api/librarian_routes.py)

| Method | Path | Description |
|---|---|---|
| POST | /api/retrieve | Embed query → vector search → chunks |
| POST | /api/orchestrate/retrieve | Orchestrator → Librarian (includes agent_tasks trace) |
| GET | /api/test/librarian | Test endpoint with sample request/response |

**Context scoping (`_resolve_retrieve_file_ids`):**
```
Draft has case_id?          → get all files in that case folder
Draft has uploaded_file_ids? → include those files too
Result: union of [case files] + [uploaded files]

If result is [] (nothing attached to draft) → returns zero chunks
                                              (strict isolation, no cross-contamination)
```

### Assembly Routes (api/assemble_routes.py)

| Method | Path | Description |
|---|---|---|
| POST | /api/drafts/{id}/assemble | Assemble sections → DOCX → Google Docs |
| POST | /api/drafts/{id}/export/docx | Export HTML as downloadable DOCX file |

**Assembly cache check:**
```
1. SHA256 hash of all current section HTMLs
2. Compare with draft_field_data.metadata.assembled_cache.sections_hash
3. Hash match → return cached final_document instantly (no LLM, no DOCX, no API call)
4. Hash mismatch → run assembly, update cache
Cache is cleared whenever any section is re-generated or edited.
```

### Ingestion Routes (api/ingestion_routes.py)

| Method | Path | Description |
|---|---|---|
| POST | /api/ingest | Single file ingestion (synchronous) |
| POST | /api/orchestrate/upload | Upload + Orchestrator (links file to draft) |
| POST | /api/orchestrate/upload-multiple | Enqueue N files for parallel background processing |
| GET | /api/ingestion/jobs/{job_id} | Single job status |
| GET | /api/ingestion/draft-jobs/{draft_job_id} | Parent draft job status |
| GET | /api/ingestion/batches/{batch_id} | Batch job status |
| POST | /api/extract-fields | Trigger InjectionAgent for field extraction |

---

## 7. Agents — Deep Dive

### 7.1 Librarian Agent

**Purpose:** Retrieve the most relevant document chunks for a query using semantic vector search.

**Files:** `agents/librarian/agent.py`, `agents/librarian/tools.py`

```
run_librarian_agent(payload)
|
+-- Validate user_id (must be numeric int from JWT)
|
+-- fetch_relevant_chunks(query, user_id, file_ids, top_k)
|   +-- generate_embeddings([query])  -->  768-dim vector
|   +-- find_nearest_chunks(embedding, limit, file_ids, user_id)
|   |     SQL: SELECT ... FROM file_chunks
|   |          JOIN chunk_vectors ON chunk_id = file_chunks.id
|   |          WHERE user_files.user_id = %s
|   |          AND file_id = ANY(%s)          (if file_ids provided)
|   |          ORDER BY embedding <=> query_vec  LIMIT %s
|   \-- Return [{chunk_id, content, file_id, page_start, heading, similarity}, ...]
|
+-- Fetch originalname for each file_id  (for source attribution in context)
|
+-- Build context string:
|   "[Source: filename1.pdf]\ncontent...\n\n---\n\n[Source: filename2.pdf]\ncontent..."
|
+-- Optional: if payload has template_url  -->  fetch_template(url)
|   +-- HTTP GET template_url
|   +-- BeautifulSoup parse
|   +-- Detect layout_type (single-column / two-column / grid / report / card-based)
|   +-- Extract sections (by id, data-section attribute, semantic tags)
|   +-- Extract placeholders (class="draft-placeholder", data-field="...", {{mustache}})
|   +-- Extract css_classes, color_tokens (:root CSS vars), fonts (@import URLs)
|   \-- Return: TemplateData model
|
\-- Return:
    {
      chunks: [{chunk_id, content, file_id, page_start, heading, similarity}, ...],
      context: "...",         -- source-attributed concatenation
      raw_text: "...",        -- same as context (orchestrator compatibility)
      embeddings: [...],      -- query embedding vector
      // if template_url in payload:
      template_raw_html: "...",
      layout_type: "...",
      placeholders: [...],
      css_classes: [...],
      color_tokens: {...},
      fonts: [...]
    }
```

**Default top_k:** `LIBRARIAN_TOP_K` env var, default 80, capped at 80.

---

### 7.2 Drafter Agent

**Purpose:** Generate the HTML content for one legal document section using RAG context, template structure, and field values.

**Files:** `agents/drafter/agent.py`, `agents/drafter/tools.py`

#### Standard Section Generation (run_drafter_agent)

```
run_drafter_agent(payload)
|
+-- Fetch agent config from DB (agent_type = "drafting")
|   +-- name:             "Drafter Agent"
|   +-- prompt:           system instruction (HOW to write — legal tone, HTML only, no markdown)
|   +-- resolved_model:   "claude-sonnet-4-5"  (or any Gemini model from DB)
|   \-- temperature:      0.3
|
+-- Resolve model: payload['model'] > DB resolved_model > "gemini-flash-lite-latest"
|
\-- draft_section(section_key, section_prompt, rag_context, field_values, mode, ...)
    |
    +-- Build system_prompt:
    |   +-- DB agent prompt    (HOW to behave: legal tone, HTML only, fill all placeholders)
    |   \-- + Language block   (MANDATORY: "Every word MUST be in {lang}")
    |
    +-- Fetch template HTML  (cached per URL in _TEMPLATE_HTML_CACHE dict, lifetime of process)
    |   +-- fetch_template_html(template_url)         -->  full HTML string
    |   +-- extract_section_fragment(html, key)       -->  section-specific HTML subtree
    |   \-- get_template_format_for_section(url, key) -->  CSS spec string for this section
    |
    +-- Build user message (LLM Parts list, in order):
    |   +-- Template HTML fragment for this section (structure reference)
    |   +-- Template format spec (font-family, font-size, margin, text-align, etc.)
    |   \-- Mode-specific prompt block:
    |       mode="generate"  --> section_prompt + field_values + rag_context + output rules
    |       mode="continue"  --> append new content to previous batches (large doc batching)
    |       mode="refine"    --> surgical edit: apply user_feedback to previous_content only
    |
    +-- call_llm(user_message, system_prompt=system_prompt, model, temperature)
    |
    \-- _clean_html_response(output):
        +-- Strip [cite: ...] and [Source: ...] markers
        +-- Strip markdown fences (```html...```)
        +-- Fix excessive &nbsp; runs and <br> stacking
        \-- Return clean HTML string
```

**Output rules enforced via the user prompt:**
- Fill EVERY placeholder: [PETITIONER_NAME], [COURT_NAME], [DATE], etc.
- Use Field Data first, then RAG context, then safe fallback
- Court name, petitioner name, respondent name MUST never be blank
- Output raw HTML only — no markdown, no code fences, no prose outside HTML tags
- Do NOT include [cite: ...], [Source: ...] in output

#### Batch-Wise Generation (for large documents)

When a draft has more than `CHUNKS_PER_BATCH` (30) chunks retrieved:

```
Chunks 1–30:   mode="generate"  --> batch_html_1
Chunks 31–60:  mode="continue"  --> batch_html_2  (appended to batch_html_1)
Chunks 61–90:  mode="continue"  --> batch_html_3  (appended to batch_html_1+2)
...
Final content_html = batch_html_1 + "\n" + batch_html_2 + "\n" + ...
```

#### HTML Draft Generator — 2-Pass LLM Pipeline (run_html_draft_generator)

Newer pipeline for producing a complete, fully self-contained HTML document:

```
run_html_draft_generator(payload)
|
+-- PASS 1: Template Analysis  (LLM Call 1)
|   +-- System: "You are an expert HTML/CSS template analyst..."
|   +-- User:   "Analyse this HTML template: {template_raw_html}"
|   \-- Returns JSON:
|       {
|         layout_description: "...",
|         sections: [{selector, role, content_type, max_words_estimate, css_classes_to_preserve}],
|         typography: {heading_class, body_class, accent_class},
|         interactivity_needed: ["tab switching", "chart render", "none"],
|         data_tables_present: true/false,
|         charts_present: true/false
|       }
|
+-- PASS 2: Content Generation  (LLM Call 2)
|   +-- System: "You are an expert technical writer and frontend developer..."
|   |   Content rules:
|   |     Every factual claim MUST cite a chunk:  <!-- CHUNK-N -->
|   |     Gaps -> <div class="draft-gap" data-gap="true"><p>[NOT AVAILABLE]</p></div>
|   |     Never fabricate statistics, dates, names
|   |   HTML/CSS rules:
|   |     Preserve ALL original CSS classes exactly
|   |     Carry forward Google Fonts @import links
|   |     Chart.js from CDN for chart placeholders
|   |     Vanilla JS for tabs/accordions (no jQuery)
|   |     All <script> blocks at end of <body>
|   +-- User: section_title + section_prompt +
|   |         template_analysis_json + template_raw_html +
|   |         [CHUNK-1] doc:uuid page:3 score:0.92 \n chunk_text ...
|   |         [CHUNK-2] ...
|   |         + (if repair pass) repair_instructions + previous_draft
|   \-- Returns: complete <!DOCTYPE html>...</html>
|
\-- validate_generated_html(html, template_raw_html, chunks)
    +-- Check 1: Unfilled placeholders (lorem ipsum, {{var}}, TBD, TODO, placeholder, ...)
    +-- Check 2: Missing CSS classes (BeautifulSoup parse template vs generated HTML)
    +-- Check 3: Count <div class="draft-gap"> markers
    +-- Check 4: Script brace balance guard (|open_braces - close_braces| > 5 = warning)
    +-- Check 5: Uncited sentence blocks (3+ sentences without <!-- CHUNK-N --> comment)
    \-- Return: HTMLValidation {is_valid, unfilled_placeholders, missing_classes,
                                uncited_blocks, gaps_count, warnings}
```

---

### 7.3 Critic Agent

**Purpose:** Validate generated sections for legal accuracy, completeness, and quality.

**Files:** `agents/critic/agent.py`, `agents/critic/tools.py`

#### Standard Section Review (run_critic_agent)

```
run_critic_agent(payload)
|
+-- Fetch agent config (agent_type = "critic")
|
\-- review_section(section_content, section_key, rag_context, field_values, section_prompt)
    +-- Build validation prompt:
    |   +-- Generated HTML content to review
    |   +-- Original section_prompt (what the draft was supposed to cover)
    |   +-- RAG context (source facts it should be grounded in)
    |   \-- Scoring guide: matches template + uses context correctly = score 92-98
    |
    +-- call_llm(prompt, response_mime_type="application/json")
    |
    \-- Parse JSON -->  CriticReview(status, score, feedback, issues, suggestions, sources)

Returns: {
  status: "PASS" | "FAIL",
  score: 0-100,
  feedback: "...",
  issues: ["issue 1", ...],
  suggestions: ["..."],
  sources: ["..."]
}
```

**Auto-retry logic in section_routes.py:**
```
If auto_validate=true AND critic returns FAIL:
  -> Retry Drafter once with user_feedback = "Critic feedback: " + critic.feedback
  -> Re-run Critic on retried output
  -> Save final result regardless of second score
```

#### HTML Draft Critic — 5-Dimension Report (run_html_draft_critic)

```
run_html_draft_critic(payload)
|
\-- review_html_draft(generated_html, chunks, section_prompt)
    |
    +-- Format up to 40 chunks (capped to fit prompt context)
    +-- Truncate HTML to 12,000 chars for review prompt
    |
    +-- ONE LLM call with 5-dimension scoring:
    |   factual_grounding:      Are all claims cited via <!-- CHUNK-N -->?
    |   completeness:           Does it cover the section_prompt fully?
    |   template_fidelity:      Are all CSS classes/layout preserved?
    |   content_quality:        Clear, professional, properly formatted?
    |   technical_correctness:  JS components (charts, tabs) work correctly?
    |
    +-- Enforce verdict thresholds:
    |   overall_confidence >= 0.82  -->  "approved"
    |   overall_confidence >= 0.60  -->  "needs_revision"
    |   overall_confidence <  0.60  -->  "rejected"
    |
    \-- Return: CriticReport {
          scores: {factual_grounding, completeness, template_fidelity,
                   content_quality, technical_correctness},
          overall_confidence: 0.0-1.0,
          verdict: "approved" | "needs_revision" | "rejected",
          critical_issues: ["issue 1", "issue 2", "issue 3"],  (max 3)
          one_line_summary: "< 15 words"
        }
```

---

### 7.4 Assembler Agent

**Purpose:** Combine all section HTMLs into one final document procedurally, convert to DOCX, upload to Google Docs.

**File:** `agents/assembler/agent.py`

```
run_assembler_agent(payload)
|
+-- _procedural_assembly(sections, template_css)
|   +-- Embed template CSS in <style> block at top
|   +-- Add A4 page-break styles
|   +-- For each section (in order):
|   |   +-- strip_citations_for_assembled(content_html)
|   |   |   \-- Remove [cite: ...], [Source: ...], footnote markers
|   |   \-- Wrap in <div class="document-section">
|   \-- Join sections with <!-- SECTION_BREAK -->
|
+-- assembled_html_to_docx_bytes(final_html, template_css)
|   +-- premailer: inline all CSS
|   +-- htmldocx: convert to python-docx Document object
|   \-- Return DOCX bytes (A4, margins, template-styled)
|
+-- POST to Drafting Service (DRAFTING_SERVICE_URL): /api/drafts/finish-assembled
|   +-- Multipart upload of DOCX bytes
|   +-- If existing_google_file_id: update existing Google Doc (preserves URL)
|   \-- Response: {googleFileId, iframeUrl, webViewLink}
|
\-- Return: {
    final_document: HTML string,
    format: "html",
    sections_assembled: int,
    google_docs: {googleFileId, iframeUrl, webViewLink},
    metadata: {...}
  }
```

**Assembly-only threshold (no AI calls):**
- Total char count > 150,000 (~40-50 pages), OR more than 8 sections

---

### 7.5 Ingestion Agent

**Purpose:** Full pipeline to process an uploaded file: OCR → chunk → embed → store in PostgreSQL.

**Files:** `agents/ingestion/agent.py`, `agents/ingestion/pipeline.py`, `agents/ingestion/chunker.py`

```
run_ingestion_agent(payload)
|
\-- run_ingestion(IngestionInput)
    |
    +-- Step 1: upload_to_gcs(filename, buffer, folder, mimetype)
    |   \-- Returns (gcs_uri, gcs_path)
    |       e.g. ("gs://bucket/uploads/case.pdf", "uploads/case.pdf")
    |
    +-- Step 2: ensure_file_record(user_id, originalname, gcs_path, ..., file_id)
    |   \-- INSERT INTO user_files ... ON CONFLICT DO NOTHING
    |
    +-- Step 3: extract_text_from_document(file_content, mimetype)
    |   +-- Send to Google Document AI processor
    |   \-- Returns [{text, page_start, page_end}, ...] per page
    |
    +-- Step 4: chunk_structured_content(page_texts, chunk_size=1200, overlap=150)
    |   +-- Recursive window chunking with character overlap
    |   \-- Returns [{content, page_start, page_end, heading}, ...]
    |
    +-- Step 5: generate_embeddings([chunk.content for chunk in chunks])
    |   +-- Gemini embedding-001 API (batch)
    |   \-- Returns [[float, ...], ...] — 768-dim vector per chunk
    |
    +-- Step 6: save_chunks(file_id, chunks)
    |   \-- INSERT INTO file_chunks (file_id, chunk_index, content, page_start, page_end, heading)
    |       Returns [(chunk_id, chunk_index), ...]
    |
    +-- Step 7: save_chunk_vectors([(chunk_id, embedding), ...])
    |   \-- INSERT INTO chunk_vectors (chunk_id, embedding)
    |
    \-- Step 8: update_file_processed(file_id)
        \-- UPDATE user_files SET status='processed', processing_progress=100

Returns: IngestionResult {file_id, raw_text, chunks, embeddings, gcs_uri, gcs_path}
```

---

### 7.6 Injection Agent (Field Auto-Population)

**Purpose:** Automatically extract template field values (party names, court name, dates, etc.)
from uploaded document text so the frontend form is pre-filled.

**File:** `agents/ingestion/injection_agent.py`

```
run_injection_agent(payload)
|
+-- Fetch template schema: get_template_fields_with_fallback(template_id)
|   \-- [{field_key, field_label, field_type, required}, ...]
|
+-- Fetch source document text
|   \-- From raw_text in payload, or from user_files.full_text_content in DB
|
+-- _build_extraction_prompt(fields_schema, document_text)
|   +-- "Extract ONLY these fields: field_key (field_type): field_label [REQUIRED/optional]"
|   +-- "Return JSON object with ONLY the listed field keys"
|   \-- "If a field is not found in the document, omit it from JSON entirely"
|
+-- call_llm(prompt, model)  -->  JSON response
|
+-- Parse extracted_fields from JSON
|
+-- _merge_with_existing(extracted_fields, existing_values, user_edited_fields)
|   \-- NEVER overwrite any key in user_edited_fields
|
+-- UPSERT into template_user_field_values:
|   field_values = existing_values || new_extracted_values
|   extraction_status = "completed" | "partial"
|
\-- Return: {
    status: "completed" | "partial" | "terminated",
    reason: (if terminated) "schema_missing" | "document_empty" | "ai_failure" | "json_parse_error" | "db_failure",
    extracted_fields: {field_key: value, ...},
    skipped_fields: ["field_key", ...],
    errors: [...]
  }
```

---

### 7.7 Orchestrator Agent

**Purpose:** Master coordinator that decides which agent to run next based on document state.

**Files:** `agents/orchestrator/agent.py`, `agents/orchestrator/flow_controller.py`,
           `agents/orchestrator/state_manager.py`

```
OrchestratorAgent.run(user_input, upload_payload, query_payload, assemble_payload)
|
+-- If upload_payload  -->  _run_ingestion_only()   --> return
+-- If query_payload   -->  _run_librarian_only()   --> return
+-- If assemble_payload --> _run_assembler_direct() --> return
|
\-- Full orchestration loop:
    |
    loop:
      decision = flow_controller.decide_next(state)
      if decision.next_agent is None: break (complete)
      |
      +-- INGESTION  --> run_ingestion_agent(...)
      |   state.set_ingestion(raw_text, file_id)
      |   state.set_embeddings(embeddings, chunks)
      |
      +-- LIBRARIAN  --> run_librarian_agent(...)
      |   state.chunks = librarian_result.chunks
      |
      +-- DRAFTER    --> run_drafter_agent(...)
      |   state.set_draft(content_html)
      |
      +-- CITATION   --> run_citation_agent(...)
      |   state.draft = cited_html
      |
      +-- CRITIC     --> run_critic_agent(...)
      |   If issues AND retry_count < max_redraft_attempts:
      |     state.reset_validation() --> loop re-runs Drafter
      |   state.set_validation(issues)
      |
      \-- ASSEMBLER  --> run_assembler_agent(...)
          state.set_final_document(html)

Return: {final_document, state.snapshot(), chunks, context, agent_tasks}
```

**FlowController state machine:**
```
DocumentState flags: ingested, embedded, drafted, cited, validated, completed

Decision rules:
  NOT ingested           -->  INGESTION
  NOT embedded           -->  LIBRARIAN
  NOT drafted            -->  DRAFTER
  drafted AND NOT cited  -->  CITATION
  cited AND NOT validated-->  CRITIC
  validated              -->  ASSEMBLER
  all complete           -->  None (done)
```

---

### 7.8 HTML Draft Pipeline (3-Agent + Self-Repair Loop)

**Purpose:** Produce a complete, pixel-perfect, self-contained HTML draft with automatic quality repair.

**File:** `agents/draft_pipeline.py`

```
run_html_draft_pipeline(HtmlDraftRequest)
|
+-- Step 1: Librarian
|   run_librarian_agent({user_id, query, file_ids, top_k, template_url})
|   Returns: chunks[] + template_raw_html + layout_type + css_classes + ...
|
+-- Guard: template_raw_html empty?  -->  return DraftResponse(status="rejected", error="...")
|
+-- Step 2: Draft Generator (2-pass LLM)
|   run_html_draft_generator({section_title, section_prompt, template_raw_html, chunks})
|   Returns: {status, html, template_analysis, validation}
|
+-- Step 3: Critic (5-dimension evaluation)
|   run_html_draft_critic({generated_html, chunks, section_prompt})
|   Returns: {report: {scores, overall_confidence, verdict, critical_issues}}
|
+-- Self-Repair Loop (MAX_RETRIES = 3):
|   while verdict != "approved" AND retry_count < 3:
|     build repair_instruction = verdict + confidence + critical_issues
|     run_html_draft_generator({...repair_context, previous_draft})
|     run_html_draft_critic(new_draft)
|     retry_count++
|
\-- Return DraftResponse:
    {
      html:          "<!DOCTYPE html>...</html>",
      critic_report: {scores, overall_confidence, verdict,
                      critical_issues, one_line_summary},
      retries_used:  int,
      gaps:          ["gap text 1", ...],  <-- from <div class="draft-gap">
      template_url:  str,
      status:        "approved" | "needs_revision" | "rejected",
      validation:    {is_valid, unfilled_placeholders, missing_classes, ...}
    }
```

---

## 8. Services Layer

### llm_service.py — Unified LLM Interface

```python
call_llm(
    prompt: str,
    system_prompt: str = "",
    model: str = "gemini-flash-lite-latest",
    temperature: float = 0.7,
    response_mime_type: Optional[str] = None,   # "application/json" for structured output
    thinking_budget: int = 0,                    # For Gemini reasoning models
    use_google_search: bool = False,             # Gemini grounding with Google Search
) -> Optional[str]
# Raises RuntimeError with descriptive message on failure
```

**Routing logic:**
- `is_claude_model(model)` is True  -->  `_call_claude()` via Anthropic SDK
- otherwise                         -->  `_call_gemini()` via google-genai SDK

**Error handling (after recent fix):**
- `ANTHROPIC_API_KEY` missing  -->  raises `RuntimeError("ANTHROPIC_API_KEY is not set...")`
- Gemini API exception          -->  raises `RuntimeError(f"Gemini API error (model={model!r}): {e}")`
- Both raise instead of returning `None` so the real error reaches the user interface

### agent_config_service.py — Agent Configuration

```python
get_agent_by_type(agent_type: str) -> Optional[Dict]
# Fetches from agent_prompts WHERE agent_type = %s ORDER BY updated_at DESC LIMIT 1
# Returns: {id, name, prompt, resolved_model, temperature, llm_parameters, ...}
```

- **5-minute in-process cache** (`_AGENT_CACHE`) to avoid DB round-trip on every section generation
- **Model resolution:** `model_ids` (int[]) are resolved to names via `llm_models` table in Document_DB

### template_format.py — CSS Extraction for Drafter

```
get_template_format_for_section(template_url, section_key, html)
|
+-- fetch_template_html(template_url)   (HTTP GET, cached per URL)
+-- extract_section_fragment(html, section_key)
|   \-- Find element by id="section_key" OR data-section="..." OR class containing key
|       and extract its full HTML subtree
|
\-- extract_format_from_html(fragment)
    +-- _extract_inline_styles(html)     -> [{font-family, font-size, ...}, ...]
    +-- _extract_tag_styles(html)        -> [(h1, {font-size: 18px}), ...]
    +-- _extract_style_blocks(html)      -> CSS from <style> blocks
    +-- _parse_css_rules(css)            -> [(selector, {prop: val}), ...]
    +-- _merge_format(...)               -> {default: {...}, headings: {h1: {...}}}
    \-- _format_spec_to_text(merged)     -> Human-readable string for LLM prompt
        "Default / body / paragraphs:
          font-family: Times New Roman, serif
          font-size: 16px
         Headings:
          h1: font-size: 24px; font-weight: bold"
```

### Key draft_db.py Functions

| Function | What it does |
|---|---|
| get_merged_field_values_for_draft | Union of InjectionAgent values + user edits |
| get_draft_field_data_for_retrieve | field_values + metadata (case_id, file_ids, assembled_cache) |
| save_section_version | Insert new version, auto-increment version_number per section |
| get_all_active_sections | Latest version per section_key, ordered by sort_order |
| get_template_sections | Section definitions with prompts from template_analysis_sections |
| get_template_primary_asset | First template HTML asset (used for signed URL) |
| attach_case_to_draft | Store case_id in draft_field_data.metadata |
| add_uploaded_file_id_to_draft | Append file_id to metadata.uploaded_file_ids |

### Key db.py Functions

| Function | What it does |
|---|---|
| find_nearest_chunks | pgvector cosine search, user-scoped + file-scoped |
| save_chunks | Batch INSERT into file_chunks |
| save_chunk_vectors | Batch INSERT into chunk_vectors |
| ensure_file_record | INSERT OR IGNORE into user_files |
| get_file_ids_for_case | All file_ids in a case folder |
| get_filenames_by_ids | {file_id: originalname} lookup map |

---

## 9. Configuration Layer

### config/gemini_models.py — Model Registry

**Supported Gemini models:**
- `gemini-flash-lite-latest` (default for drafting, fastest)
- `gemini-2.0-flash-lite`
- `gemini-2.5-flash`
- `gemini-2.5-pro` (most capable reasoning model)
- `gemini-embedding-001` (embeddings only, not for generation)

**Supported Claude models:**
- `claude-opus-4-6` (most capable)
- `claude-sonnet-4-5` (balanced — current default in DB config)
- `claude-haiku-4-5` (fastest, cheapest)

**Key functions:**
```python
is_claude_model(name)    # True if name starts with "claude-"
is_valid_model(name)     # True if in Gemini or Claude list
claude_api_model_id(name)# Map display name to full Anthropic API ID
```

---

## 10. Complete Data Flows

### Flow A: First-Time Document Upload + Section Generation

```
User uploads PDF + selects a template
       |
       v
POST /api/orchestrate/upload  (multipart: file, draft_id, template_id)
       |
       +-- Ingestion Agent (synchronous)
       |   +-- GCS upload
       |   +-- Document AI OCR  -->  page_texts
       |   +-- chunk_structured_content  -->  chunks (1200 chars, 150 overlap)
       |   +-- generate_embeddings  -->  768-dim vectors per chunk
       |   +-- save_chunks + save_chunk_vectors
       |   \-- update_file_processed (status=processed, progress=100)
       |
       +-- Link file to draft
       |   add_uploaded_file_id_to_draft(draft_id, file_id)
       |
       \-- Background: Injection Agent
           +-- Get template field schema
           +-- Build extraction prompt for Gemini/Claude
           +-- Parse JSON response  -->  extracted_fields
           \-- UPSERT template_user_field_values
               (field values visible on next GET /api/drafts/{id})

Response: {success: true, file_id, state, agent_tasks}

       |
       v
User clicks "Generate" for section_key = "title_page"
       |
       v
POST /api/drafts/{draft_id}/sections/title_page/generate
       |
       +-- Verify draft ownership (get_user_draft)
       +-- Resolve template_id, field_values (merged), template_url (GCS signed URL)
       |
       +-- Resolve section_prompt:
       |   Check dt_draft_section_prompts (custom)
       |   --> Check template_analysis_sections (template-defined)
       |   --> Found: "Generate the title page and opening of the petition..."
       |
       +-- Librarian Agent
       |   +-- _resolve_retrieve_file_ids: case files + uploaded files
       |   +-- generate_embeddings(section_prompt)
       |   +-- find_nearest_chunks (pgvector, user-scoped, file-scoped)
       |   \-- Return 30 chunks + context string
       |
       +-- Drafter Agent
       |   +-- get_agent_by_type("drafting")  --> model="claude-sonnet-4-5", temp=0.3
       |   +-- Fetch template HTML (cached), extract title_page fragment
       |   +-- Build user message: template_html + format_spec + rag_context + field_values
       |   +-- call_llm  -->  HTML section
       |   \-- _clean_html_response  -->  final HTML
       |
       +-- save_section_version(draft_id, "title_page", version=1, content_html)
       +-- Invalidate assembled_cache (sections have changed)
       |
       \-- Response: {success, section_content_html, metadata}

(Repeat for each section in the document)

       |
       v
POST /api/drafts/{draft_id}/assemble
       |
       +-- Get all active sections (latest version per section_key)
       +-- SHA256 hash of sections  -->  check assembled_cache  -->  MISS
       |
       +-- Assembler Agent
       |   +-- _procedural_assembly:
       |   |   embed CSS + A4 styles + strip_citations + join sections
       |   +-- assembled_html_to_docx_bytes (premailer + htmldocx)
       |   +-- POST to Drafting Service  -->  Google Docs upload
       |   \-- Response: {googleFileId, iframeUrl}
       |
       +-- Cache result in draft_field_data.metadata.assembled_cache
       |
       \-- Response: {final_document, template_css, google_docs: {iframe_url}}
```

### Flow B: HTML Draft Pipeline (generate-html endpoint)

```
POST /api/drafts/{draft_id}/sections/{key}/generate-html
       |
       v
run_html_draft_pipeline(HtmlDraftRequest)
       |
       +-- Librarian
       |   query + file_ids + template_url  -->  chunks (30) + template_raw_html
       |
       +-- Draft Generator Pass 1  (LLM Call 1 — Template Analysis)
       |   "Analyse this HTML template" --> JSON with sections, typography, interactivity
       |
       +-- Draft Generator Pass 2  (LLM Call 2 — Content Generation)
       |   template_analysis + raw_template + CHUNK-1...CHUNK-30
       |   --> <!DOCTYPE html>...</html> with <!-- CHUNK-N --> citations
       |
       +-- validate_generated_html  -->  HTMLValidation
       |
       +-- Critic  (LLM Call 3 — 5-Dimension Scoring)
       |   factual_grounding + completeness + template_fidelity +
       |   content_quality + technical_correctness
       |   --> CriticReport {scores, overall_confidence, verdict}
       |
       +-- Repair Loop (max 3 iterations if verdict != "approved"):
       |   build repair_instruction from critical_issues
       |   --> re-run Draft Generator (Pass 1 skipped, Pass 2 with repair context)
       |   --> re-run Critic
       |   retry_count++
       |
       +-- save_section_version
       |
       \-- Response: {html, critic_report, retries_used, gaps, status, validation}
```

### Flow C: Multi-Document Background Upload

```
POST /api/orchestrate/upload-multiple  (files[10], draft_id)
       |
       +-- Create parent DraftJob (draft_job_id)
       +-- For each file: create DocumentJob  -->  enqueue in ingestion_queue
       \-- Response: {draft_job_id, job_ids: ["job1", ..., "job10"]}

Background workers (ingestion_worker.py):
  For each DocumentJob:
    run_ingestion_agent --> GCS + Doc AI + chunk + embed + DB
    add_uploaded_file_id_to_draft
    Update job: queued --> started --> finished | failed

Frontend polls:
  GET /api/ingestion/draft-jobs/{draft_job_id}
  --> {status: "processing", total: 10, completed: 7, failed: 0}
  --> {status: "completed", total: 10, completed: 10, failed: 0}
```

---

## 11. Agent Configuration System

Every agent is fully configurable via the `agent_prompts` table in Draft_DB.
No code change or redeployment is needed to update an agent's behavior.

### How it works

```
agent_prompts table row (example):
  id = 27
  agent_type = "drafting"
  name = "Drafter Agent"
  prompt = "You are an expert legal document drafter for Indian law..."
           (this is the system instruction — HOW to write)
  model_ids = [15]          (int[] references llm_models.id)
  temperature = 0.3
  llm_parameters = {thinking_mode: false, grounding_google_search: false}

At runtime (every section generation call):
  1. get_agent_by_type("drafting")       <-- cached for 5 min
  2. resolve model_ids [15]  -->  llm_models WHERE id=15  -->  "claude-sonnet-4-5"
  3. prompt  -->  system_instruction (Gemini) / system (Claude)
  4. payload['model'] can override DB model for that single call

To change the Drafter model:
  UPDATE agent_prompts SET model_ids = [<new_id>] WHERE agent_type = 'drafting';
  (Takes effect within 5 minutes due to cache TTL)

To update the system prompt:
  UPDATE agent_prompts SET prompt = '...' WHERE agent_type = 'drafting';
```

### Separation of Concerns

| What | Source | Passed to LLM as |
|---|---|---|
| HOW to draft (tone, rules, format) | agent_prompts.prompt (DB) | system_instruction |
| WHAT to generate (section content) | section_prompt from template or user | user message |
| WHO the content is about | field_values (merged InjectionAgent + user) | user message |
| CONTEXT facts | RAG chunks from Librarian | user message |
| Template structure | template_url resolved to HTML | user message |

---

## 12. Key Design Patterns

### 1. User-Scoped Isolation
Every DB query is filtered by `user_id` from the JWT.
A user can never access another user's documents, drafts, or chunks.

### 2. Draft-Scoped Context Isolation
The Librarian only retrieves chunks from files explicitly attached to the current draft
(`case_id` + `uploaded_file_ids` in `draft_field_data.metadata`).
If a draft has no attached files, the Librarian returns zero chunks — no cross-draft contamination.

### 3. Agent Config from DB (Not from Code)
System prompts, models, and temperatures live in `agent_prompts` table.
Changing behavior = DB update. No deployment needed.
5-minute in-process cache avoids DB round-trips on every call.

### 4. Template HTML Process-Lifetime Cache
`_TEMPLATE_HTML_CACHE` (dict in drafter/tools.py) caches fetched template HTML per URL
for the lifetime of the process. Avoids repeated GCS HTTP calls on every section generation.

### 5. Field Value Merge Strategy
```
Final value = InjectionAgent auto-extracted value
            <-- OVERLAY with --> user-edited values
user_edited_fields list only grows, never shrinks.
User's own edits always take precedence over agent extraction.
```

### 6. Assembled Document Caching
SHA256 of all section HTMLs is stored in `draft_field_data.metadata.assembled_cache.sections_hash`.
Subsequent assemble calls with unchanged sections return the cached HTML instantly
(no DOCX conversion, no Google Docs API call).
Cache is invalidated automatically when any section is re-generated or manually edited.

### 7. Batch-Wise Drafting for Large Documents
Documents with more than 30 retrieved chunks are drafted in batches.
Each batch appends to the previous output via `mode="continue"`.
Avoids exceeding LLM context window limits on large cases.

### 8. Citation Stripping on Assembly
All citation markers (`[cite: ...]`, `[Source: ...]`) are stripped when assembling.
These markers exist only in intermediate draft HTML; the final exported document is clean.

### 9. Language Enforcement (Mandatory Override)
A language directive is appended to the system prompt at runtime and cannot be softened:
`"Every word of your output MUST be written in {lang} only."`
This ensures correct multilingual output without needing language-specific DB prompts.

### 10. Error Propagation (Transparent Failures)
`call_llm()` raises `RuntimeError` with a specific descriptive message on failure.
The real error ("ANTHROPIC_API_KEY is not set", "Gemini API error: 404 model not found")
propagates to the user interface instead of the generic "LLM returned no content".

---

## 13. Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| DATABASE_URL | Yes | Document_DB PostgreSQL connection string |
| DRAFT_DATABASE_URL | Yes | Draft_DB PostgreSQL connection string |
| GEMINI_API_KEY or GOOGLE_API_KEY | Yes | Gemini API key |
| ANTHROPIC_API_KEY | Yes* | Claude API key (*required when any agent uses Claude) |
| GCS_BUCKET_NAME | Yes | GCS bucket for uploaded documents |
| GCS_INPUT_BUCKET_NAME | Yes | GCS input bucket |
| GCS_OUTPUT_BUCKET_NAME | Yes | GCS output bucket |
| GCS_KEY_BASE64 | Yes | Base64-encoded GCP service account JSON |
| GCLOUD_PROJECT_ID | Yes | GCP project ID |
| DOCUMENT_AI_LOCATION | Yes | Document AI region (e.g. "us") |
| DOCUMENT_AI_PROCESSOR_ID | Yes | Document AI processor ID |
| JWT_SECRET | Yes | HS256 secret for JWT token verification |
| DRAFTING_SERVICE_URL | Yes | External Google Docs integration service URL |
| CORS_ORIGINS | No | Comma-separated allowed origins (default: localhost:5173,3000) |
| LIBRARIAN_TOP_K | No | Max chunks from Librarian (default: 80, capped at 80) |
| GEMINI_EMBEDDING_MODEL | No | Embedding model (default: gemini-embedding-001) |
| GEMINI_EMBEDDING_DIMENSIONS | No | Vector dimensions (default: 768) |
| GEMINI_EMBEDDING_MAX_CHARS | No | Max chars per chunk for embedding (default: 8000) |
| TEMPLATE_ANALYZER_URL | No | External template analysis service (default: localhost:5017) |
| PORT | No | Server port (default: 8000) |

---

*This document reflects the full state of the Agent Draft Service as of March 2026,
including the HTML Draft Pipeline (3-agent + self-repair loop) introduced in the latest
development cycle.*
