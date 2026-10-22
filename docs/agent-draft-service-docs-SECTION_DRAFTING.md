# Section-wise Drafting System

Complete guide to the Agentic Drafting System with section-wise generation, versioning, and intelligent validation.

## Overview

The drafting system generates legal documents **section by section** using AI agents:

1. **Drafter Agent** 🤖 - Generates section content using Gemini with RAG context
2. **Critic Agent** 🤖 - Validates content for legal accuracy and quality
3. **Version Control** - Each section can have multiple versions with user refinement
4. **Auto-retry** - Failed validations trigger automatic regeneration with feedback

## Architecture

```
User Action → Orchestrator → Librarian (RAG) → Drafter → Critic → Save Version
                                    ↓                        ↓
                              Fetch Context          If FAIL: Auto-retry
```

## Database Schema

### 1. template_sections (Admin-configured)

Hardcoded section prompts per template:

```sql
CREATE TABLE template_sections (
    section_id UUID PRIMARY KEY,
    template_id UUID NOT NULL,
    section_key VARCHAR(100) NOT NULL,        -- e.g. "introduction", "facts"
    section_name VARCHAR(255) NOT NULL,       -- Display: "Introduction", "Statement of Facts"
    default_prompt TEXT NOT NULL,             -- Hardcoded RAG/generation prompt
    sort_order INT DEFAULT 0,
    is_required BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);
```

**Example data:**
```json
{
  "section_key": "facts",
  "section_name": "Statement of Facts",
  "default_prompt": "Draft a clear and concise statement of facts based on the retrieved context. Include relevant dates, parties, and events in chronological order.",
  "sort_order": 2
}
```

### 2. section_versions (Generated content with versioning)

User-specific generated sections:

```sql
CREATE TABLE section_versions (
    version_id UUID PRIMARY KEY,
    draft_id UUID NOT NULL,
    section_key VARCHAR(100) NOT NULL,
    version_number INT NOT NULL DEFAULT 1,
    content_html TEXT NOT NULL,               -- Generated HTML for this section
    user_prompt_override TEXT,                -- User's refinement feedback (null for initial)
    rag_context_used TEXT,                    -- Librarian chunks used
    generation_metadata JSONB,                -- { model, tokens, critic_score, etc. }
    is_active BOOLEAN DEFAULT TRUE,           -- Only one version is "live" per section
    created_by_agent VARCHAR(50) DEFAULT 'drafter',
    created_at TIMESTAMP DEFAULT NOW()
);
```

**Key behavior:**
- Each section can have multiple versions (v1, v2, v3, ...)
- Only ONE version is `is_active = true` per (draft_id, section_key)
- When a new version is created, previous versions are deactivated

### 3. section_reviews (Critic validation results)

```sql
CREATE TABLE section_reviews (
    review_id UUID PRIMARY KEY,
    version_id UUID NOT NULL,
    critic_status VARCHAR(20) NOT NULL CHECK (critic_status IN ('PASS', 'FAIL', 'PENDING')),
    critic_score INT CHECK (critic_score >= 0 AND critic_score <= 100),
    critic_feedback TEXT,
    review_metadata JSONB,
    reviewed_at TIMESTAMP DEFAULT NOW()
);
```

## Agent Implementation

### Drafter Agent

**Location:** `agents/drafter/agent.py`

**Key Functions:**

#### 1. `generate_initial_section()`
```python
def generate_initial_section(
    section_key: str,
    section_prompt: str,
    rag_context: str,
    field_values: Dict[str, Any],
    template_url: Optional[str] = None,
    model: str = "gemini-2.0-flash-exp",
) -> str:
    """Generate initial section using Gemini with multimodal template reference."""
```

**Features:**
- Uses `types.Part.from_uri` for template visual reference
- Combines RAG context + form values + section prompt
- Returns clean HTML content (no full page structure)

#### 2. `refine_section()`
```python
def refine_section(
    section_key: str,
    previous_content: str,
    user_feedback: str,
    rag_context: str,
    field_values: Dict[str, Any],
    template_url: Optional[str] = None,
    model: str = "gemini-2.0-flash-exp",
) -> str:
    """Refine section based on user feedback."""
```

**Features:**
- Takes previous content + user feedback
- Preserves HTML structure and CSS classes
- Updates only the specific aspects mentioned in feedback

### Critic Agent

**Location:** `agents/critic/agent.py`

**Key Function:**

```python
def review_draft(
    section_content: str,
    section_key: str,
    rag_context: str,
    field_values: Dict[str, Any],
    section_prompt: str,
    model: str = "gemini-2.0-flash-exp",
) -> CriticReview:
    """Review section using Gemini as legal/structural auditor."""
```

**Validation Output (Pydantic):**
```python
class CriticReview(BaseModel):
    status: str  # "PASS" or "FAIL"
    score: int   # 0-100
    feedback: str
    issues: Optional[list[str]]
    suggestions: Optional[list[str]]
```

**Validation Criteria:**
- Legal Accuracy (30%)
- Completeness (25%)
- Consistency (20%)
- Structure & Format (15%)
- Clarity & Language (10%)

**Decision:**
- PASS: score >= 70, no critical issues
- FAIL: score < 70 or critical errors → triggers auto-retry

## API Endpoints

### 1. Generate Initial Section

```http
POST /api/drafts/{draft_id}/sections/{section_key}/generate
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "section_prompt": "Optional custom prompt (overrides template default)",
  "rag_query": "Optional query for Librarian context",
  "template_url": "Optional signed GCS URL for template reference",
  "auto_validate": true
}
```

**Response:**
```json
{
  "success": true,
  "version": {
    "version_id": "uuid",
    "version_number": 1,
    "content_html": "<div>...</div>",
    "is_active": true
  },
  "critic_review": {
    "status": "PASS",
    "score": 85,
    "feedback": "Well-structured and legally accurate...",
    "issues": [],
    "suggestions": ["Consider adding more specific dates"]
  }
}
```

**Flow:**
1. Orchestrator fetches template section configuration
2. If `rag_query` provided → Librarian fetches relevant chunks
3. Drafter generates content
4. If `auto_validate=true` → Critic validates
5. If Critic FAIL → auto-retry once with feedback
6. Save version with is_active=true (deactivates previous)

### 2. Refine Section (User Feedback)

```http
POST /api/drafts/{draft_id}/sections/{section_key}/refine
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "user_feedback": "Make the language more formal and add case citations",
  "rag_query": "Optional updated query",
  "template_url": "Optional template reference",
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
    "content_html": "<div>...</div>",
    "user_prompt_override": "Make the language more formal...",
    "is_active": true
  },
  "critic_review": {
    "status": "PASS",
    "score": 92,
    "feedback": "Excellent refinement..."
  }
}
```

**Flow:**
1. Fetch latest active version (previous content)
2. If `rag_query` → Librarian fetches updated context
3. Drafter refines with user feedback + previous content
4. Critic validates (optional)
5. Save NEW version (v2, v3, etc.), deactivate previous

### 3. Get All Active Sections

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
      "version_id": "uuid",
      "section_key": "introduction",
      "version_number": 2,
      "content_html": "<div>...</div>",
      "is_active": true
    },
    {
      "version_id": "uuid",
      "section_key": "facts",
      "version_number": 1,
      "content_html": "<div>...</div>",
      "is_active": true
    }
  ],
  "count": 2
}
```

### 4. Get Section with Reviews

```http
GET /api/drafts/{draft_id}/sections/{section_key}
Authorization: Bearer {JWT}
```

**Response:**
```json
{
  "success": true,
  "version": {
    "version_id": "uuid",
    "section_key": "facts",
    "version_number": 2,
    "content_html": "<div>...</div>",
    "is_active": true
  },
  "reviews": [
    {
      "review_id": "uuid",
      "critic_status": "PASS",
      "critic_score": 92,
      "critic_feedback": "Excellent...",
      "reviewed_at": "2026-02-03T..."
    }
  ]
}
```

### 5. Get Version History

```http
GET /api/drafts/{draft_id}/sections/{section_key}/versions
Authorization: Bearer {JWT}
```

Returns all versions (not just active) ordered by version_number DESC.

### 6. Get Template Sections

```http
GET /api/templates/{template_id}/sections
```

Returns all configured sections for a template (admin prompts).

## Usage Example

### Initial Generation Flow

```python
# 1. User clicks "Generate" on "Introduction" section
POST /api/drafts/{draft_id}/sections/introduction/generate
{
  "rag_query": "What are the key facts of this case?",
  "auto_validate": true
}

# Response includes:
# - Generated HTML content
# - Critic validation (PASS/FAIL, score, feedback)
# - Version saved as v1, is_active=true
```

### Refinement Flow

```python
# 2. User wants to improve the introduction
POST /api/drafts/{draft_id}/sections/introduction/refine
{
  "user_feedback": "Add more legal citations and make it more formal",
  "auto_validate": true
}

# System:
# - Fetches v1 content
# - Drafter refines with feedback
# - Critic validates
# - Saves as v2, deactivates v1
```

### Assembly Flow

```python
# 3. Get all active sections for final assembly
GET /api/drafts/{draft_id}/sections

# Returns all is_active=true versions (latest for each section)
# Frontend/Assembler combines them using template HTML/CSS
```

## Frontend Integration

### Step-by-step UI Flow

**Step 1: Upload / Case**
- User uploads file OR selects case
- File is ingested → chunks stored in Document_DB

**Step 2: Form Fields**
- User fills template fields
- Data auto-saved to draft_field_data.field_values

**Step 3: Template Sections**
- Display all template sections with:
  - Section name
  - Editable prompt (default from template_sections)
  - "Generate" button
  - Generated content preview
  - "Refine" button (if content exists)
  - Critic status badge (PASS/FAIL with score)
  - Version selector (v1, v2, v3...)

### Section Component Example

```jsx
<SectionCard section_key="introduction">
  <SectionHeader>
    Introduction
    <Badge>{critic_status} ({critic_score}/100)</Badge>
  </SectionHeader>
  
  <PromptEditor 
    defaultValue={section.default_prompt}
    editable={true}
  />
  
  {!hasContent ? (
    <Button onClick={generateSection}>Generate</Button>
  ) : (
    <>
      <ContentPreview html={section.content_html} />
      <Button onClick={refineSection}>Refine</Button>
      <VersionSelector versions={[v1, v2, v3]} active={v3} />
    </>
  )}
</SectionCard>
```

## Draft-scoped Context

Each draft uses ONLY its own files/case for RAG:

**Storage in draft_field_data.metadata:**
```json
{
  "case_id": "89",
  "case_title": "Case Name",
  "uploaded_file_ids": ["uuid1", "uuid2"],
  "uploaded_file_name": "filename.pdf"
}
```

**Librarian behavior:**
- If draft has `case_id` → use case folder file_ids
- If draft has `uploaded_file_ids` → use those file_ids
- Union of both if both exist
- No other user files are used

**API calls automatically scope to draft:**
```python
# When section generate/refine is called:
# 1. draft_id is known
# 2. Librarian is called with draft_id
# 3. _resolve_retrieve_file_ids uses draft's case_id + uploaded_file_ids
# 4. Only that draft's context is retrieved
```

## Orchestrator Flow

### Generate Section

```
1. User → POST /api/drafts/{id}/sections/{key}/generate
2. Orchestrator:
   a. Fetch template section config (default_prompt)
   b. If rag_query → Librarian (draft-scoped files)
   c. Drafter (section_prompt + RAG context + field_values + template_url)
   d. If auto_validate → Critic (validate content)
   e. If FAIL → Drafter retry (with Critic feedback)
   f. Save version (is_active=true, deactivate previous)
   g. Save critic review
3. Return: version + critic_review
```

### Refine Section

```
1. User → POST /api/drafts/{id}/sections/{key}/refine with user_feedback
2. Orchestrator:
   a. Get latest active version (previous content)
   b. If rag_query → Librarian (updated context)
   c. Drafter refine (previous + user_feedback)
   d. Critic validate
   e. Save NEW version (v2, v3, ...), deactivate v1
   f. Save review
3. Return: new version + critic_review
```

## Template Setup (Admin)

### 1. Create Template

Upload .docx → extracts to template_assets, template_css, template_html.

### 2. Configure Sections

```sql
INSERT INTO template_sections (template_id, section_key, section_name, default_prompt, sort_order)
VALUES
  ('template-uuid', 'introduction', 'Introduction', 'Draft a professional introduction for this legal document...', 1),
  ('template-uuid', 'facts', 'Statement of Facts', 'Provide a clear chronological statement...', 2),
  ('template-uuid', 'arguments', 'Legal Arguments', 'Draft legal arguments based on applicable law...', 3),
  ('template-uuid', 'prayer', 'Prayer for Relief', 'Draft the relief sought by the petitioner...', 4);
```

### 3. Field Configuration

Already exists via `template_fields` table.

## Testing with Postman

### Generate Introduction Section

```http
POST http://localhost:8000/api/drafts/{draft_id}/sections/introduction/generate
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "rag_query": "What are the key facts of this dispute?",
  "auto_validate": true
}
```

**Expected logs:**
```
[API] Generating section: draft_id=..., section_key=introduction, user_id=3
[Orchestrator → Librarian] Fetching context for query: What are the key facts...
[Librarian → Orchestrator] Retrieved 10 chunks
[Orchestrator → Drafter] Generating section content
[Drafter: Generated initial section=introduction, length=1234 chars
[Orchestrator → Critic] Validating generated content
[Critic: Reviewed section=introduction, status=PASS, score=85
[save_section_version] draft=... section=introduction v1 by drafter
[save_critic_review] version=... status=PASS score=85
```

### Refine with User Feedback

```http
POST http://localhost:8000/api/drafts/{draft_id}/sections/introduction/refine
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "user_feedback": "Make it more formal and add case citations",
  "auto_validate": true
}
```

**Expected logs:**
```
[API] Refining section: draft_id=..., section_key=introduction
[Orchestrator → Drafter] Refining with user feedback
[Drafter: Refined section=introduction, length=1456 chars
[Orchestrator → Critic] Validating refined content
[Critic: Reviewed section=introduction, status=PASS, score=92
[save_section_version] draft=... section=introduction v2 by drafter
```

### Get All Sections (for Assembly)

```http
GET http://localhost:8000/api/drafts/{draft_id}/sections
Authorization: Bearer {jwt_token}
```

Returns all active versions → ready for assembly.

## Auto-retry Logic

When Critic returns FAIL:

```python
# First attempt
drafter_result = run_drafter_agent(payload)
critic_result = run_critic_agent({"section_content": drafter_result["content_html"]})

if critic_result["status"] == "FAIL":
    # Auto-retry with Critic feedback
    retry_payload = {
        "mode": "refine",
        "previous_content": drafter_result["content_html"],
        "user_feedback": f"Critic feedback: {critic_result['feedback']}"
    }
    drafter_result_retry = run_drafter_agent(retry_payload)
    
    # Re-validate retry
    critic_result_retry = run_critic_agent({
        "section_content": drafter_result_retry["content_html"]
    })
    
    # Use retry result (even if still FAIL - user can refine manually)
    final_content = drafter_result_retry["content_html"]
```

## Assembler Integration

After all sections are generated and confirmed:

```python
# Get all active sections
sections = get_all_active_sections(draft_id, user_id)

# Get template HTML/CSS
template_html = get_template_html(template_id)
template_css = get_template_css(template_id)

# Assemble final document
final_html = assemble_document(
    template_html=template_html,
    template_css=template_css,
    sections=sections,
    field_values=field_values
)

# Render in frontend with template styling
```

## Configuration

### Environment Variables

```bash
# Google API (required for Drafter and Critic)
GOOGLE_API_KEY=AIza...

# Document_DB (user_files, chunks, cases)
DOCUMENT_DATABASE_URL=postgresql://...

# Draft_DB (templates, drafts, sections)
DRAFT_DATABASE_URL=postgresql://...

# JWT (for user authentication)
JWT_SECRET=your-secret
```

### ADK Client Configuration

In `orchestrator_cli.py` or service initialization:

```python
adk_client = ADKClient(
    api_key=os.environ["GOOGLE_API_KEY"],
    use_local_drafter=False,  # Use Google ADK (Gemini)
    use_local_critic=False,   # Use Google ADK (Gemini)
    use_local_assembler=False,
)
```

## Best Practices

1. **Always provide rag_query** for fact-based sections (Facts, Arguments)
2. **Use template_url** for consistent visual styling
3. **Enable auto_validate** to catch issues early
4. **Review Critic feedback** before manual refinement
5. **Keep section prompts focused** - one purpose per section
6. **Use version history** to revert if needed

## Troubleshooting

### Issue: Empty content generated

**Cause:** No GOOGLE_API_KEY or RAG context is empty

**Solution:**
- Set GOOGLE_API_KEY in .env
- Provide rag_query or ensure files are uploaded/case attached

### Issue: Critic always FAIL

**Cause:** Prompt mismatch or RAG context insufficient

**Solution:**
- Review section_prompt clarity
- Ensure RAG query matches section purpose
- Check that draft has files/case attached

### Issue: Version not saving

**Cause:** User doesn't own the draft

**Solution:**
- Verify JWT token is correct
- Check draft_id exists for this user

## Next Steps

1. ✅ Create database tables (run schema/section_versions.sql)
2. ✅ Set environment variables (GOOGLE_API_KEY, DRAFT_DATABASE_URL, DOCUMENT_DATABASE_URL)
3. ✅ Test section generation in Postman
4. Build frontend UI for section management
5. Integrate Assembler for final document
