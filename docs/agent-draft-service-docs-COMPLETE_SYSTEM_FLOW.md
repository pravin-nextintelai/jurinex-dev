# Complete Agentic Drafting System Flow

End-to-end documentation for the JuriNex Agentic Drafting System with 6 agents.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ADMIN SIDE (Template Setup)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. Upload template.docx                                         │
│  2. Extract → HTML, CSS, Assets                                  │
│  3. Store in Draft_DB:                                           │
│     - templates                                                  │
│     - template_html (HTML content)                               │
│     - template_css (styling)                                     │
│     - template_assets (.docx file)                               │
│     - template_images (preview images)                           │
│     - template_sections (section prompts)                        │
│     - template_fields (form fields)                              │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      USER SIDE (Document Creation)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────┐           │
│  │ STEP 1: Select Template                          │           │
│  ├─────────────────────────────────────────────────┤           │
│  │ - Fetch templates from Draft_DB                 │           │
│  │ - Display gallery with preview images           │           │
│  │ - User clicks template                          │           │
│  │ → Create fresh draft (is_fresh=true)            │           │
│  └─────────────────────────────────────────────────┘           │
│                          ↓                                       │
│  ┌─────────────────────────────────────────────────┐           │
│  │ STEP 2: Upload Files / Attach Case              │           │
│  ├─────────────────────────────────────────────────┤           │
│  │ Option A: Upload File                           │           │
│  │   → Orchestrator → Ingestion Agent              │           │
│  │   → GCS upload → Document AI OCR                │           │
│  │   → Chunk → Embed → Store in Document_DB        │           │
│  │   → Link file_id to draft metadata              │           │
│  │                                                  │           │
│  │ Option B: Select Case                           │           │
│  │   → Fetch user's cases from Document_DB         │           │
│  │   → User selects case                           │           │
│  │   → Attach case_id to draft metadata            │           │
│  │   → All case folder files used for RAG          │           │
│  └─────────────────────────────────────────────────┘           │
│                          ↓                                       │
│  ┌─────────────────────────────────────────────────┐           │
│  │ STEP 3: Fill Form Fields                        │           │
│  ├─────────────────────────────────────────────────┤           │
│  │ - Display template_fields (category-specific)   │           │
│  │ - User fills fields (landlord_name, etc.)       │           │
│  │ - Auto-save to draft_field_data.field_values    │           │
│  │ - Clears is_fresh flag on first save            │           │
│  └─────────────────────────────────────────────────┘           │
│                          ↓                                       │
│  ┌─────────────────────────────────────────────────┐           │
│  │ STEP 4: Generate Sections (Agentic)             │           │
│  ├─────────────────────────────────────────────────┤           │
│  │ For each template_sections row:                 │           │
│  │                                                  │           │
│  │ 4a. Section Card UI:                            │           │
│  │   - Section name                                │           │
│  │   - Editable prompt (default from DB)           │           │
│  │   - Generate button (if no content)             │           │
│  │   - Content preview (if generated)              │           │
│  │   - Refine button (if has content)              │           │
│  │   - Critic badge (PASS/FAIL with score)         │           │
│  │   - Version dropdown (v1, v2, v3...)            │           │
│  │                                                  │           │
│  │ 4b. User clicks "Generate":                     │           │
│  │   1. Orchestrator gets section config           │           │
│  │   2. Librarian fetches RAG context              │           │
│  │      (draft-scoped: case files + uploaded)      │           │
│  │   3. Drafter generates HTML content             │           │
│  │   4. Critic validates content                   │           │
│  │   5. If FAIL → auto-retry with feedback         │           │
│  │   6. Save to section_versions (v1)              │           │
│  │   7. Save to section_reviews                    │           │
│  │                                                  │           │
│  │ 4c. User clicks "Refine":                       │           │
│  │   1. User enters feedback text                  │           │
│  │   2. Orchestrator gets previous version         │           │
│  │   3. Librarian (optional updated query)         │           │
│  │   4. Drafter refines with feedback              │           │
│  │   5. Critic validates                           │           │
│  │   6. Save as v2 (deactivate v1)                 │           │
│  │                                                  │           │
│  │ 4d. Repeat for all sections                     │           │
│  └─────────────────────────────────────────────────┘           │
│                          ↓                                       │
│  ┌─────────────────────────────────────────────────┐           │
│  │ STEP 5: Assemble Final Document                 │           │
│  ├─────────────────────────────────────────────────┤           │
│  │ - Get all active sections (is_active=true)      │           │
│  │ - Get template_html + template_css              │           │
│  │ - Assembler agent combines sections             │           │
│  │ - Render with template format                   │           │
│  │ - User previews and downloads                   │           │
│  └─────────────────────────────────────────────────┘           │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 6 Agents Explained

### 1. **Orchestrator Agent** 🎯

**Purpose:** Central coordinator that delegates tasks to specialized agents

**Location:** `agents/orchestrator/agent.py`

**Responsibilities:**
- Receives user requests (upload, retrieve, generate section, assemble)
- Decides which agent to call next based on document state
- Maintains document lifecycle state
- Returns agent_tasks trace for debugging

**Does NOT:**
- Perform actual processing
- Call LLMs directly
- Access databases directly (uses other agents)

**Example flow:**
```python
orchestrator.run(query_payload={
    "user_id": 3,
    "query": "What are the facts?",
    "draft_id": "uuid"
})
# → Librarian → returns chunks
```

### 2. **Ingestion Agent** 📄

**Purpose:** Process uploaded documents

**Location:** `agents/ingestion/agent.py`

**Flow:**
1. Upload file to GCS
2. Extract text with Document AI (OCR)
3. Chunk document into segments
4. Generate embeddings for each chunk
5. Store in Document_DB (file_chunks, chunk_vectors)

**Tools:**
- GCS client (Google Cloud Storage)
- Document AI client
- Chunking service
- Embedding service (Gemini models/text-embedding-004)

**Input:**
```json
{
  "file_content": "base64...",
  "originalname": "contract.pdf",
  "user_id": "3",
  "draft_id": "optional-uuid"
}
```

**Output:**
```json
{
  "file_id": "uuid",
  "raw_text": "extracted text...",
  "chunks": ["chunk1", "chunk2", ...],
  "embeddings": [[0.1, 0.2, ...], ...]
}
```

### 3. **Librarian Agent** 🔍

**Purpose:** Fetch relevant chunks for RAG

**Location:** `agents/librarian/agent.py`

**Flow:**
1. Receive query from Orchestrator
2. Generate embedding for query
3. Vector search in Document_DB (draft-scoped)
4. Return top-k relevant chunks

**Key Feature:** Draft-scoped retrieval
- Uses ONLY files from draft's case OR uploaded files
- Never returns chunks from other users or other drafts

**Input:**
```json
{
  "user_id": 3,
  "query": "What are the facts?",
  "draft_id": "uuid",
  "top_k": 10
}
```

**Output:**
```json
{
  "chunks": [
    {
      "chunk_id": "uuid",
      "content": "chunk text...",
      "file_id": "uuid",
      "similarity": 0.85
    }
  ],
  "context": "concatenated chunk text"
}
```

### 4. **Drafter Agent** ✍️ (Google ADK / Gemini)

**Purpose:** Generate section content using AI

**Location:** `agents/drafter/agent.py`

**Mode 1: Initial Generation**
```python
generate_initial_section(
    section_key="introduction",
    section_prompt="Draft a professional introduction...",
    rag_context="<Librarian chunks>",
    field_values={"landlord_name": "John Doe"},
    template_url="gs://bucket/template.html"
)
```

**Mode 2: Refinement**
```python
refine_section(
    section_key="introduction",
    previous_content="<v1 HTML>",
    user_feedback="Make it more formal",
    rag_context="<updated context>",
    field_values={...},
    template_url="..."
)
```

**Multimodal:** Uses `types.Part.from_uri` to reference template HTML as visual guide

**Output:** HTML content for the section (e.g., `<div><h2>Introduction</h2><p>...</p></div>`)

### 5. **Critic Agent** ⚖️ (Google ADK / Gemini)

**Purpose:** Validate section content for quality and accuracy

**Location:** `agents/critic/agent.py`

**Function:**
```python
review_draft(
    section_content="<generated HTML>",
    section_key="introduction",
    rag_context="<context>",
    field_values={...},
    section_prompt="original prompt"
) -> CriticReview
```

**Validation Criteria:**
- Legal Accuracy (30%)
- Completeness (25%)
- Consistency (20%)
- Structure & Format (15%)
- Clarity & Language (10%)

**Output (Pydantic validated):**
```python
{
  "status": "PASS" | "FAIL",
  "score": 85,  # 0-100
  "feedback": "Well-structured and legally accurate...",
  "issues": ["Minor: Add case citation"],
  "suggestions": ["Consider adding specific dates"]
}
```

**Auto-retry:**
- If status == "FAIL" → Orchestrator calls Drafter again with Critic feedback
- Only 1 auto-retry attempt
- User can manually refine if still FAIL

### 6. **Assembler Agent** 🔧 (Google ADK / Gemini)

**Purpose:** Combine all sections into final formatted document

**Location:** `agents/assembler/agent.py`

**Flow:**
1. Fetch all active section versions
2. Fetch template HTML + CSS
3. Inject section content into template placeholders
4. Apply formatting rules
5. Return final HTML ready for rendering/PDF

**Input:**
```json
{
  "sections": [
    {"section_key": "intro", "content_html": "..."},
    {"section_key": "facts", "content_html": "..."}
  ],
  "template_html": "<html>...</html>",
  "template_css": "@page {...}",
  "field_values": {...}
}
```

**Output:**
```json
{
  "final_document": "<complete HTML with all sections>",
  "page_count": 5,
  "sections_assembled": 4
}
```

## Database Architecture

### Draft_DB (Templates & User Drafts)

```
templates
├── template_assets (original .docx)
├── template_html (extracted HTML)
├── template_css (extracted CSS)
├── template_images (preview images)
├── template_sections (section prompts) ← Admin configures
└── template_fields (form fields) ← Admin configures

user_drafts
├── draft_field_data (field_values, metadata)
├── section_versions (generated sections) ← Drafter creates
└── section_reviews (validation results) ← Critic creates
```

### Document_DB (Files & RAG)

```
user_files (uploaded documents)
├── file_chunks (chunked content)
└── chunk_vectors (embeddings for RAG)

cases (legal cases)
└── folder_id → user_files (case documents)
```

## Complete User Journey

### Scenario: User wants to draft a Rent Agreement

```
1. SELECT TEMPLATE
   GET /api/templates?category=REAL%20ESTATE
   → User sees "Rent Agreement" template with preview
   → Click template
   → POST /api/drafts (template_id)
   → Draft created with draft_id, is_fresh=true

2. UPLOAD CONTEXT
   → User uploads "previous_rent_agreement.pdf"
   → POST /api/orchestrate/upload (file, draft_id)
   → Orchestrator → Ingestion Agent
   → GCS → Document AI → Chunk → Embed → Document_DB
   → file_id linked to draft metadata.uploaded_file_ids

3. FILL FORM
   → GET /api/templates/{template_id}/fields
   → Display fields: landlord_name, tenant_name, monthly_rent, etc.
   → User fills form
   → Auto-save: PUT /api/drafts/{draft_id} (field_values)
   → Stored in draft_field_data.field_values
   → is_fresh flag cleared

4. GENERATE SECTIONS
   
   GET /api/templates/{template_id}/sections
   → Returns: [
       {section_key: "preamble", section_name: "Preamble", default_prompt: "..."},
       {section_key: "terms", section_name: "Terms & Conditions", ...},
       {section_key: "signatures", section_name: "Signatures", ...}
     ]
   
   For section "preamble":
   
   POST /api/drafts/{draft_id}/sections/preamble/generate
   {
     "rag_query": "What are the standard rent agreement terms?",
     "auto_validate": true
   }
   
   Flow:
   ┌─────────────────────┐
   │   Orchestrator      │
   └──────┬──────────────┘
          │
          ├─→ Librarian (fetch RAG context for "preamble" from uploaded PDF)
          │   Returns: 10 chunks about rent terms
          │
          ├─→ Drafter (generate preamble using chunks + field_values + template)
          │   Returns: HTML content for preamble section
          │
          └─→ Critic (validate generated content)
              Returns: {status: "PASS", score: 88, feedback: "..."}
              
              If FAIL:
              └─→ Drafter retry (with Critic feedback)
                  └─→ Critic re-validate
   
   → Save section_versions (v1, is_active=true)
   → Save section_reviews (PASS, score=88)
   
   Repeat for "terms", "signatures", etc.

5. USER REFINEMENT (Optional)
   
   → User sees preamble content, wants changes
   → Clicks "Refine", enters: "Add a clause about pet policy"
   
   POST /api/drafts/{draft_id}/sections/preamble/refine
   {
     "user_feedback": "Add a clause about pet policy",
     "rag_query": "pet policy in rent agreements"
   }
   
   Flow:
   ┌─────────────────────┐
   │   Orchestrator      │
   └──────┬──────────────┘
          │
          ├─→ Get section_versions (latest: v1)
          │
          ├─→ Librarian (fetch pet policy context)
          │
          ├─→ Drafter refine (previous_content + user_feedback + context)
          │   Returns: Updated HTML
          │
          └─→ Critic validate
              Returns: {status: "PASS", score: 95}
   
   → Save section_versions (v2, is_active=true, deactivate v1)
   → Save review

6. ASSEMBLE FINAL DOCUMENT
   
   → User confirms all sections
   → Clicks "Generate Document"
   
   GET /api/drafts/{draft_id}/sections
   → Returns all is_active=true versions
   
   POST /api/drafts/{draft_id}/assemble (future endpoint)
   {
     "format": "pdf" | "html" | "docx"
   }
   
   Flow:
   ┌─────────────────────┐
   │   Orchestrator      │
   └──────┬──────────────┘
          │
          └─→ Assembler Agent
              - Fetch template_html + template_css
              - Inject all section content_html
              - Apply formatting
              - Generate final document
   
   → Store in generated_documents table
   → Return download URL

7. DOWNLOAD / EXPORT
   → User downloads PDF or exports to Word/Google Docs
```

## Agent Communication Protocol

### Payload Structure

**Orchestrator → Agent:**
```json
{
  "user_id": 3,
  "draft_id": "uuid",
  "section_key": "introduction",
  "mode": "generate" | "refine",
  ...agent-specific fields
}
```

**Agent → Orchestrator:**
```json
{
  "content_html": "<div>...</div>",
  "metadata": {
    "model": "gemini-2.0-flash-exp",
    "tokens": 1234,
    "chunks_used": 10
  },
  "error": null
}
```

### Agent Tasks Trace

Every API response includes `agent_tasks`:

```json
{
  "agent_tasks": [
    {
      "from": "orchestrator",
      "to": "librarian",
      "task": "fetch relevant chunks for query: What are the facts...",
      "payload_summary": {"query": "...", "top_k": 10, "file_ids": ["uuid1"]}
    },
    {
      "from": "orchestrator",
      "to": "drafter",
      "task": "generate section content"
    },
    {
      "from": "orchestrator",
      "to": "critic",
      "task": "validate generated content"
    }
  ]
}
```

## Data Flow Diagram

```
┌──────────────┐
│   Frontend   │
└──────┬───────┘
       │
       │ POST /api/drafts/{id}/sections/{key}/generate
       │ { "rag_query": "...", "auto_validate": true }
       ↓
┌──────────────────────────────────────────────────┐
│           Orchestrator (section_routes.py)        │
├──────────────────────────────────────────────────┤
│ 1. Get draft → verify ownership                  │
│ 2. Get template_sections → section_prompt        │
│ 3. Get draft metadata → case_id, uploaded_files  │
└──────┬───────────────────────────────────────────┘
       │
       ├─→ Librarian Agent
       │   ┌────────────────────────────────┐
       │   │ 1. Embed query                 │
       │   │ 2. Vector search (draft-scoped)│
       │   │    - Use case_id files OR      │
       │   │    - Use uploaded_file_ids     │
       │   │ 3. Return top-k chunks         │
       │   └────────────────────────────────┘
       │   Returns: { chunks: [...], context: "..." }
       │
       ├─→ Drafter Agent (Gemini)
       │   ┌────────────────────────────────┐
       │   │ 1. Load template via Part.uri  │
       │   │ 2. Build prompt:               │
       │   │    - Section prompt            │
       │   │    - RAG context               │
       │   │    - Field values              │
       │   │ 3. Call Gemini                 │
       │   │ 4. Return HTML content         │
       │   └────────────────────────────────┘
       │   Returns: { content_html: "<div>...</div>" }
       │
       ├─→ Critic Agent (Gemini)
       │   ┌────────────────────────────────┐
       │   │ 1. Validate against criteria   │
       │   │ 2. Score 0-100                 │
       │   │ 3. Return structured JSON      │
       │   └────────────────────────────────┘
       │   Returns: { status: "PASS", score: 85, ... }
       │
       │   If FAIL:
       │   └─→ Drafter retry (with Critic feedback)
       │       └─→ Critic re-validate
       │
       ├─→ Save to Draft_DB
       │   ┌────────────────────────────────┐
       │   │ 1. section_versions (v1)       │
       │   │    - content_html              │
       │   │    - rag_context_used          │
       │   │    - is_active = true          │
       │   │ 2. section_reviews             │
       │   │    - critic_status, score      │
       │   └────────────────────────────────┘
       │
       └─→ Response to Frontend
           ┌────────────────────────────────┐
           │ {                              │
           │   "version": {...},            │
           │   "critic_review": {...}       │
           │ }                              │
           └────────────────────────────────┘
```

## Database Operations

### Create Fresh Draft

```python
# User clicks template in gallery
draft = create_user_draft(user_id=3, template_id="uuid", draft_title="My Rent Agreement")

# Result in DB:
user_drafts:
  draft_id: uuid
  user_id: 3
  template_id: uuid
  status: "draft"

draft_field_data:
  draft_id: uuid
  field_values: {}
  metadata: {"is_fresh": true}
```

### Upload File for Draft

```python
# User uploads PDF
result = orchestrate_upload(file, draft_id="uuid")
file_id = result["file_id"]

# Link to draft
add_uploaded_file_id_to_draft(draft_id="uuid", user_id=3, file_id=file_id)

# Result in DB:
draft_field_data.metadata:
  {
    "is_fresh": true,
    "uploaded_file_ids": ["file-uuid"],
    "uploaded_file_name": "document.pdf"
  }
```

### Attach Case to Draft

```python
# User selects case from dropdown
attach_case_to_draft(draft_id="uuid", user_id=3, case_id="89", case_title="Case Name")

# Result in DB:
draft_field_data.metadata:
  {
    "case_id": "89",
    "case_title": "Case Name",
    "uploaded_file_ids": []  # or existing files
  }
```

### Generate Section

```python
# User clicks "Generate" on "Introduction" section

# 1. Librarian fetches context (draft-scoped)
librarian_result = run_librarian_agent({
    "user_id": 3,
    "query": "Introduction facts",
    "file_ids": ["file-uuid"]  # Resolved from draft's case_id + uploaded_file_ids
})

# 2. Drafter generates
drafter_result = run_drafter_agent({
    "section_key": "introduction",
    "section_prompt": "Draft introduction...",
    "rag_context": librarian_result["context"],
    "field_values": {"landlord_name": "John"},
    "template_url": "gs://..."
})

# 3. Critic validates
critic_result = run_critic_agent({
    "section_content": drafter_result["content_html"],
    ...
})

# 4. Save version
version = save_section_version(
    draft_id="uuid",
    user_id=3,
    section_key="introduction",
    content_html=drafter_result["content_html"],
    rag_context_used=librarian_result["context"],
    ...
)

# Result in DB:
section_versions:
  version_id: uuid
  draft_id: uuid
  section_key: "introduction"
  version_number: 1
  content_html: "<div><h2>Introduction</h2><p>...</p></div>"
  is_active: true

section_reviews:
  version_id: uuid
  critic_status: "PASS"
  critic_score: 85
  critic_feedback: "Well-structured..."
```

## API Summary

| Endpoint | Method | Purpose | Agent Flow |
|----------|--------|---------|------------|
| `/api/orchestrate/upload` | POST | Upload file | Orchestrator → Ingestion |
| `/api/orchestrate/retrieve` | POST | RAG query | Orchestrator → Librarian |
| `/api/drafts/{id}/sections/{key}/generate` | POST | Generate section | Orchestrator → Librarian → Drafter → Critic |
| `/api/drafts/{id}/sections/{key}/refine` | POST | Refine section | Orchestrator → Librarian → Drafter → Critic |
| `/api/drafts/{id}/sections` | GET | Get all sections | Direct DB read |
| `/api/drafts/{id}/sections/{key}` | GET | Get specific section | Direct DB read |
| `/api/drafts/{id}/assemble` | POST | Final assembly | Orchestrator → Assembler |

## Environment Setup

```bash
# .env file
GOOGLE_API_KEY=AIza...                    # For Drafter, Critic, Assembler (Gemini)
DOCUMENT_DATABASE_URL=postgresql://...    # user_files, chunks, cases
DRAFT_DATABASE_URL=postgresql://...       # templates, drafts, sections
JWT_SECRET=your-secret                    # User authentication
GCS_BUCKET_NAME=your-bucket              # Document storage
DOCUMENT_AI_PROCESSOR_ID=your-processor  # OCR
```

## Testing Checklist

- [ ] Run `schema/section_versions.sql` on Draft_DB
- [ ] Set all environment variables in `.env`
- [ ] Upload a template (admin side)
- [ ] Configure template_sections (hardcoded prompts)
- [ ] Test: Create draft
- [ ] Test: Upload file for draft
- [ ] Test: Generate section
- [ ] Test: Refine section
- [ ] Test: Get all sections
- [ ] Test: Assemble final document

## Performance Considerations

- **Drafter:** ~3-5 seconds per section (Gemini API)
- **Critic:** ~2-3 seconds per validation
- **Auto-retry:** Adds ~5-8 seconds if FAIL
- **Total per section:** ~10-15 seconds (initial + validation + potential retry)
- **Caching:** Consider caching template HTML/CSS URLs
- **Batch:** Generate multiple sections in parallel (future optimization)

## Security

- All endpoints require JWT authentication
- User-scoped: Only user's own drafts and documents
- Draft-scoped: Each draft uses only its own files/case
- No cross-draft contamination
- No access to other users' content

## Next Steps

1. Apply database schema: `psql $DRAFT_DATABASE_URL < schema/section_versions.sql`
2. Populate template_sections for your templates
3. Test section generation flow in Postman
4. Build frontend UI for section management
5. Integrate Assembler for final document generation
