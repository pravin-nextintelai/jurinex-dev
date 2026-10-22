# JuriNex Agent Draft Service

Backend service for JuriNex document drafting: **templates**, **drafts**, **orchestrator**, and **agents** (Ingestion, Librarian, Drafter, Critic, Assembler). Follows **Google ADK-style** orchestration: the Orchestrator delegates to specialized agents; agents use tools and report back.

## Features

- **Templates:** List and get templates (with preview images); form fields with category fallback; section configuration.
- **Drafts:** Create draft from template, list/get/update drafts, attach case to draft; recent drafts and latest-draft-per-template.
- **Section-wise Generation:** 🚀 Generate legal document sections with AI agents, versioning, and intelligent validation
  - **23 universal sections** for ALL legal templates (consistent structure)
  - **User-editable prompts** - customize generation per section
  - RAG-powered content generation using draft-scoped context
  - User refinement with feedback loop
  - Version control for each section (v1, v2, v3...)
  - Auto-validation with Critic agent (PASS/FAIL with scores)
- **Orchestrator:** Coordinates agents in order; does not perform processing itself.
- **Ingestion agent:** Upload → GCS → Document AI (OCR) → chunk → embed → store in DB. Tools: GCS, Document AI, chunking, embedding, DB.
- **Librarian agent:** Fetch relevant chunks from the vector DB for a user query. Tool: `fetch_relevant_chunks`. User- and document-specific only.
- **Drafter agent:** 🤖 Generate section content using Gemini with multimodal template reference and RAG context
- **Critic agent:** 🤖 Validate section content for legal accuracy, completeness, and quality with structured feedback
- **Assembler agent:** 🤖 Combine sections into final formatted document using template HTML/CSS
- **Draft-scoped context:** Each draft uses only its own uploaded files or attached case for RAG (no cross-draft contamination)

## Google ADK Integration

This service uses **Google's Agent Development Kit (ADK)** with **Gemini models** for intelligent document processing:

- **Drafter Agent** 🤖 - Uses Gemini to generate legal drafts from retrieved context
- **Critic Agent** 🤖 - Uses Gemini to validate drafts for legal correctness
- **Assembler Agent** 🤖 - Uses Gemini to format and assemble final documents

**See [AGENTS_ARCHITECTURE.md](AGENTS_ARCHITECTURE.md)** for detailed information on:
- Which agents use Google ADK vs local Python implementations
- Configuration and setup
- Model selection and cost optimization
- System prompts and customization

## Quick start

- **Environment:** Copy `.env.example` to `.env`; set `DOCUMENT_DATABASE_URL` (or `DATABASE_URL`) for Document_DB (user_files, chunks, cases), `DRAFT_DATABASE_URL` for templates/drafts, `GOOGLE_API_KEY` or `GEMINI_API_KEY`, and optional GCS/Document AI config.
- **Run:** `uvicorn api.app:app --reload --host 0.0.0.0 --port 8000`
- **Docs:** Open `/docs` for Swagger.

## Documentation

**📚 Complete Guides:**

- **[UNIVERSAL_SECTIONS_GUIDE.md](docs/UNIVERSAL_SECTIONS_GUIDE.md)** - ⭐ **START HERE** - 23 universal sections for all templates
- **[SECTION_DRAFTING.md](docs/SECTION_DRAFTING.md)** - Section-wise generation system with Drafter, Critic, versioning
- **[COMPLETE_SYSTEM_FLOW.md](docs/COMPLETE_SYSTEM_FLOW.md)** - End-to-end user journey with all 6 agents
- **[API_QUICK_REFERENCE.md](docs/API_QUICK_REFERENCE.md)** - Copy-paste Postman examples
- **[SETUP_GUIDE.md](SETUP_GUIDE.md)** - Step-by-step setup and testing
- **[AGENTS_ARCHITECTURE.md](AGENTS_ARCHITECTURE.md)** - Agent design and Google ADK integration
- **[GOOGLE_ADK_SETUP.md](GOOGLE_ADK_SETUP.md)** - Gemini setup and configuration
- **[docs/AGENT_FLOW.md](docs/AGENT_FLOW.md)** - Original agent flow documentation

## API overview

| Area | Endpoints |
|------|-----------|
| Templates | `GET /api/templates`, `GET /api/templates/{id}`, `GET /api/templates/{id}/fields`, `GET /api/templates/{id}/drafts/latest` |
| Drafts | `POST /api/drafts`, `GET /api/drafts`, `GET /api/drafts/{id}`, `PUT /api/drafts/{id}`, `POST /api/drafts/{id}/attach-case` |
| Orchestrator | `POST /api/orchestrate/upload` (file; optional draft_id, case_id), `POST /api/orchestrate/retrieve` (query) |
| Direct | `POST /api/ingest`, `POST /api/retrieve` |

All draft and orchestration endpoints require `Authorization: Bearer <JWT>` (user_id from JWT).

## References

- **Google ADK agent architecture:** [AGENTS_ARCHITECTURE.md](AGENTS_ARCHITECTURE.md) 🚀
- **Agent flow and production behaviour:** [docs/AGENT_FLOW.md](docs/AGENT_FLOW.md)
- **Postman / API examples:** [API_POSTMAN.md](API_POSTMAN.md), [postman/README_TEMPLATE_API.md](postman/README_TEMPLATE_API.md)

## Dependencies

Install required packages:

```bash
pip install -r requirements.txt
```

Key dependencies:
- `google-genai` - Google ADK for Gemini agents
- `google-cloud-storage` - Document storage
- `google-cloud-documentai` - OCR and text extraction
- `fastapi` - API framework
- `psycopg2-binary` - PostgreSQL database
