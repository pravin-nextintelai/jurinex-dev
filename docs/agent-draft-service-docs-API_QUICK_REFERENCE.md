# API Quick Reference - Section Drafting

Quick copy-paste examples for testing the section-wise drafting system.

## Base URL

```
http://localhost:8000
```

## Authentication

All endpoints require JWT:

```http
Authorization: Bearer {your_jwt_token}
```

Get JWT from auth service or use existing token from localStorage.

---

## 1. Create Draft from Template

```http
POST /api/drafts
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "template_id": "3a50b4c7-3685-41f6-9b18-9432d680a0c2",
  "draft_title": "My Rent Agreement"
}
```

**Response:**
```json
{
  "success": true,
  "draft": {
    "draft_id": "generated-uuid",
    "template_id": "...",
    "draft_title": "My Rent Agreement",
    "status": "draft"
  }
}
```

---

## 2. Upload File for Draft

```http
POST /api/orchestrate/upload
Authorization: Bearer {JWT}
Content-Type: multipart/form-data

form-data:
  file: [select file]
  draft_id: {draft_id_from_step1}
```

**Response:**
```json
{
  "success": true,
  "file_id": "file-uuid",
  "chunks_count": 15,
  "message": "Orchestrator ran ingestion only: GCS → Document AI → chunk → embed → DB."
}
```

**Then link file to draft:**

```http
POST /api/drafts/{draft_id}/link-file
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "file_id": "{file_id_from_upload}",
  "file_name": "contract.pdf"
}
```

---

## 3. Fill Form Fields

```http
PUT /api/drafts/{draft_id}
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "field_values": {
    "landlord_name": "John Doe",
    "tenant_name": "Jane Smith",
    "property_address": "123 Main St, Mumbai",
    "monthly_rent": "50000",
    "lease_start_date": "2026-03-01",
    "lease_end_date": "2027-03-01"
  }
}
```

---

## 4. Get Template Sections

```http
GET /api/templates/{template_id}/sections
```

**Response:**
```json
{
  "success": true,
  "sections": [
    {
      "section_id": "uuid",
      "section_key": "preamble",
      "section_name": "Preamble",
      "default_prompt": "Draft the preamble with party details...",
      "sort_order": 1,
      "is_required": true
    },
    {
      "section_key": "terms",
      "section_name": "Terms & Conditions",
      "default_prompt": "Draft terms and conditions...",
      "sort_order": 2
    }
  ]
}
```

---

## 5. Generate Section (Initial)

```http
POST /api/drafts/{draft_id}/sections/preamble/generate
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "rag_query": "What are the standard rent agreement terms?",
  "auto_validate": true
}
```

**Optional parameters:**
```json
{
  "section_prompt": "Custom prompt to override template default",
  "rag_query": "Query for Librarian context retrieval",
  "template_url": "gs://bucket/template.html",
  "auto_validate": true  // Run Critic validation (default true)
}
```

**Response:**
```json
{
  "success": true,
  "version": {
    "version_id": "uuid",
    "draft_id": "uuid",
    "section_key": "preamble",
    "version_number": 1,
    "content_html": "<div class=\"section-preamble\"><h2>Preamble</h2><p>This Rent Agreement...</p></div>",
    "user_prompt_override": null,
    "rag_context_used": "chunk1\n\nchunk2...",
    "is_active": true,
    "created_by_agent": "drafter"
  },
  "critic_review": {
    "status": "PASS",
    "score": 88,
    "feedback": "Well-structured preamble with all required elements...",
    "issues": [],
    "suggestions": ["Consider adding specific lease duration in opening line"]
  }
}
```

**Console Logs:**
```
[API] Generating section: draft_id=..., section_key=preamble, user_id=3
[Orchestrator → Librarian] Fetching context for query: What are the standard...
[Librarian → Orchestrator] Retrieved 10 chunks
[Orchestrator → Drafter] Generating section content
[Drafter: Generated initial section=preamble, length=1234 chars
[Orchestrator → Critic] Validating generated content
[Critic: Reviewed section=preamble, status=PASS, score=88
[save_section_version] draft=... section=preamble v1 by drafter
[save_critic_review] version=... status=PASS score=88
```

---

## 6. Refine Section (User Feedback)

```http
POST /api/drafts/{draft_id}/sections/preamble/refine
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "user_feedback": "Add a clause about late payment penalties",
  "rag_query": "late payment penalties in rent agreements",
  "auto_validate": true
}
```

**Response:**
```json
{
  "success": true,
  "version": {
    "version_id": "new-uuid",
    "version_number": 2,
    "content_html": "<div>...updated content with late payment clause...</div>",
    "user_prompt_override": "Add a clause about late payment penalties",
    "is_active": true
  },
  "critic_review": {
    "status": "PASS",
    "score": 95,
    "feedback": "Excellent refinement..."
  }
}
```

**Console Logs:**
```
[API] Refining section: draft_id=..., section_key=preamble
[Orchestrator → Librarian] Fetching updated context
[Orchestrator → Drafter] Refining with user feedback
[Drafter: Refined section=preamble, length=1456 chars
[Orchestrator → Critic] Validating refined content
[Critic: Reviewed section=preamble, status=PASS, score=95
[save_section_version] draft=... section=preamble v2 by drafter
```

---

## 7. Get All Active Sections

```http
GET /api/drafts/{draft_id}/sections
Authorization: Bearer {JWT}
```

**Response:**
```json
{
  "success": true,
  "sections": [
    {
      "version_id": "uuid1",
      "section_key": "preamble",
      "version_number": 2,
      "content_html": "<div>...</div>",
      "is_active": true
    },
    {
      "version_id": "uuid2",
      "section_key": "terms",
      "version_number": 1,
      "content_html": "<div>...</div>",
      "is_active": true
    }
  ],
  "count": 2
}
```

---

## 8. Get Specific Section with Reviews

```http
GET /api/drafts/{draft_id}/sections/preamble
Authorization: Bearer {JWT}
```

**Response:**
```json
{
  "success": true,
  "version": {
    "version_id": "uuid",
    "section_key": "preamble",
    "version_number": 2,
    "content_html": "<div>...</div>",
    "user_prompt_override": "Add late payment clause",
    "is_active": true
  },
  "reviews": [
    {
      "review_id": "uuid1",
      "critic_status": "PASS",
      "critic_score": 95,
      "critic_feedback": "Excellent refinement",
      "reviewed_at": "2026-02-03T..."
    },
    {
      "review_id": "uuid2",
      "critic_status": "PASS",
      "critic_score": 88,
      "critic_feedback": "Well-structured",
      "reviewed_at": "2026-02-03T..."
    }
  ]
}
```

---

## 9. Get Version History

```http
GET /api/drafts/{draft_id}/sections/preamble/versions
Authorization: Bearer {JWT}
```

**Response:** All versions (v1, v2, v3...) with is_active flag

---

## Complete Test Sequence (Postman Collection)

### Collection: "Agentic Drafting - Section Wise"

**1. Create Draft**
```
POST {{base_url}}/api/drafts
{
  "template_id": "{{template_id}}",
  "draft_title": "Test Draft"
}

→ Save {{draft_id}} to environment
```

**2. Upload Document**
```
POST {{base_url}}/api/orchestrate/upload
form-data: file, draft_id={{draft_id}}

→ Save {{file_id}} from response
```

**3. Link File to Draft**
```
POST {{base_url}}/api/drafts/{{draft_id}}/link-file
{
  "file_id": "{{file_id}}",
  "file_name": "test.pdf"
}
```

**4. Fill Form Fields**
```
PUT {{base_url}}/api/drafts/{{draft_id}}
{
  "field_values": {
    "landlord_name": "Test Landlord",
    "tenant_name": "Test Tenant"
  }
}
```

**5. Get Template Sections**
```
GET {{base_url}}/api/templates/{{template_id}}/sections

→ Note section_key values (preamble, terms, etc.)
```

**6. Generate Introduction**
```
POST {{base_url}}/api/drafts/{{draft_id}}/sections/introduction/generate
{
  "rag_query": "What are the key parties and terms?",
  "auto_validate": true
}

→ Check critic_review.status and score
```

**7. Refine Introduction**
```
POST {{base_url}}/api/drafts/{{draft_id}}/sections/introduction/refine
{
  "user_feedback": "Make it more professional",
  "auto_validate": true
}

→ Note version_number increments to 2
```

**8. Get All Sections**
```
GET {{base_url}}/api/drafts/{{draft_id}}/sections

→ See all is_active=true versions
```

**9. Assemble Document** (future)
```
POST {{base_url}}/api/drafts/{{draft_id}}/assemble
{
  "format": "html"
}
```

---

## Error Handling

### Common Errors

**1. "Draft not found"**
- Check draft_id is correct
- Verify JWT token belongs to draft owner

**2. "No existing version for section. Generate first."**
- Cannot refine before initial generation
- Call `/generate` endpoint first

**3. "Drafter returned empty content"**
- Check GOOGLE_API_KEY is set
- Verify RAG context is not empty
- Check section_prompt is meaningful

**4. "No case attached and no uploaded files → 0 file_ids"**
- Upload a file first OR attach a case
- RAG requires documents for context

**5. Critic always FAIL**
- Review Critic feedback in response
- Check if RAG context matches section purpose
- Consider simplifying section_prompt

---

## Monitoring & Logs

All agent calls are logged:

```
[API] POST /api/drafts/{id}/sections/{key}/generate called by user {user_id}
[Orchestrator → Librarian] Fetching context...
[Librarian → Orchestrator] Retrieved N chunks
[Orchestrator → Drafter] Generating section content
[Drafter: Generated section={key}, length=N chars
[Orchestrator → Critic] Validating...
[Critic: Reviewed section={key}, status={PASS/FAIL}, score=N
[save_section_version] draft={id} section={key} v{N}
[save_critic_review] version={id} status={PASS/FAIL}
```

Use logs to debug agent flow and performance.
