# Setup Guide - Agentic Drafting System

Step-by-step guide to set up and test the complete section-wise drafting system.

## Prerequisites

- PostgreSQL database (2 databases: Document_DB and Draft_DB)
- Google Cloud account with GCS and Document AI enabled
- Google API key for Gemini
- Python 3.10+

## Step 1: Database Setup

### 1.1 Apply Section Schema to Draft_DB

```bash
# Connect to your Draft_DB
psql $DRAFT_DATABASE_URL

# Run the schema
\i schema/section_versions.sql

# Verify tables created
\dt template_sections
\dt section_versions
\dt section_reviews
```

**Expected output:**
```
 template_sections | table | ...
 section_versions  | table | ...
 section_reviews   | table | ...
```

### 1.2 Verify Existing Tables

**Draft_DB should have:**
- templates
- template_assets
- template_css
- template_html
- template_images
- template_fields
- user_drafts
- draft_field_data
- template_sections ✅ NEW
- section_versions ✅ NEW
- section_reviews ✅ NEW

**Document_DB should have:**
- user_files
- file_chunks
- chunk_vectors
- cases

## Step 2: Environment Configuration

### 2.1 Update .env

```bash
cd Backend/agent-draft-service
cp .env.example .env
nano .env  # or your editor
```

**Required variables:**

```bash
# Google API (Gemini for Drafter, Critic, Assembler)
GOOGLE_API_KEY=AIzaSyChe4mToCEhhSMr1bk8Lk6eGgQo7tzanR4

# Document_DB (files, chunks, cases)
DOCUMENT_DATABASE_URL=postgresql://user:pass@host:5432/document_db

# Draft_DB (templates, drafts, sections)
DRAFT_DATABASE_URL=postgresql://user:pass@host:5432/draft_db

# JWT (same secret as authservice)
JWT_SECRET=your-jwt-secret

# GCS
GCS_BUCKET_NAME=your-bucket
GCS_INPUT_BUCKET_NAME=your-input-bucket

# Document AI
GCLOUD_PROJECT_ID=your-project-id
DOCUMENT_AI_LOCATION=us
DOCUMENT_AI_PROCESSOR_ID=your-processor-id

# Optional
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

### 2.2 Install Dependencies

```bash
pip install -r requirements.txt
```

**New dependencies:**
- `pydantic>=2.0.0` - For Critic validation

## Step 3: Populate Template Sections (Admin)

For each template, configure sections:

```sql
-- Connect to Draft_DB
psql $DRAFT_DATABASE_URL

-- Example: Rent Agreement template
INSERT INTO template_sections (template_id, section_key, section_name, default_prompt, sort_order, is_required)
VALUES
  -- Preamble
  ('3a50b4c7-3685-41f6-9b18-9432d680a0c2', 'preamble', 'Preamble', 
   'Draft a professional preamble for this rent agreement. Include the parties (landlord and tenant), property address, and agreement date. Use formal legal language.', 
   1, true),
  
  -- Terms & Conditions
  ('3a50b4c7-3685-41f6-9b18-9432d680a0c2', 'terms', 'Terms & Conditions', 
   'Draft comprehensive terms and conditions including: rent amount, payment schedule, security deposit, maintenance responsibilities, and lease duration. Base this on the retrieved context and form data.', 
   2, true),
  
  -- Special Clauses
  ('3a50b4c7-3685-41f6-9b18-9432d680a0c2', 'special_clauses', 'Special Clauses', 
   'Draft special clauses based on the specific requirements. This may include pet policy, subletting restrictions, renovation permissions, or any other specific terms mentioned in the context.', 
   3, false),
  
  -- Signatures
  ('3a50b4c7-3685-41f6-9b18-9432d680a0c2', 'signatures', 'Signatures & Verification', 
   'Draft the signature section with spaces for landlord and tenant signatures, witness details, and date. Include verification clause if required.', 
   4, true);

-- Verify
SELECT section_key, section_name, sort_order, is_required 
FROM template_sections 
WHERE template_id = '3a50b4c7-3685-41f6-9b18-9432d680a0c2'
ORDER BY sort_order;
```

**Repeat for other templates** (NDA, Divorce Petition, etc.)

## Step 4: Start the Service

```bash
cd Backend/agent-draft-service

# Start server
uvicorn api.app:app --reload --host 0.0.0.0 --port 8000
```

**Expected logs:**
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

**Open API docs:**
```
http://localhost:8000/docs
```

## Step 5: Test with Postman

### 5.1 Get JWT Token

```http
POST http://localhost:5001/api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}
```

Save the `token` from response.

### 5.2 Create Draft

```http
POST http://localhost:8000/api/drafts
Authorization: Bearer {token}
Content-Type: application/json

{
  "template_id": "3a50b4c7-3685-41f6-9b18-9432d680a0c2",
  "draft_title": "Test Rent Agreement"
}
```

Save `draft_id` from response.

### 5.3 Upload Document

```http
POST http://localhost:8000/api/orchestrate/upload
Authorization: Bearer {token}
Content-Type: multipart/form-data

file: [select a PDF]
draft_id: {draft_id}
```

**Expected logs:**
```
[Orchestrator → ingestion] upload document to GCS, run Document AI...
[Ingestion completed] file_id=..., chunks=15
[Linked file_id=... to draft_id=...]
```

Save `file_id` from response.

### 5.4 Link File to Draft

```http
POST http://localhost:8000/api/drafts/{draft_id}/link-file
Authorization: Bearer {token}
Content-Type: application/json

{
  "file_id": "{file_id}",
  "file_name": "contract.pdf"
}
```

### 5.5 Fill Form Fields

```http
PUT http://localhost:8000/api/drafts/{draft_id}
Authorization: Bearer {token}
Content-Type: application/json

{
  "field_values": {
    "landlord_name": "Ramesh Kumar",
    "tenant_name": "Suresh Patel",
    "property_address": "Flat 501, Building A, Andheri West, Mumbai - 400053",
    "monthly_rent": "50000",
    "security_deposit": "150000",
    "lease_start_date": "2026-03-01",
    "lease_end_date": "2027-03-01"
  }
}
```

### 5.6 Get Template Sections

```http
GET http://localhost:8000/api/templates/3a50b4c7-3685-41f6-9b18-9432d680a0c2/sections
```

**Expected response:**
```json
{
  "sections": [
    {"section_key": "preamble", "section_name": "Preamble", ...},
    {"section_key": "terms", "section_name": "Terms & Conditions", ...},
    ...
  ]
}
```

### 5.7 Generate Section

```http
POST http://localhost:8000/api/drafts/{draft_id}/sections/preamble/generate
Authorization: Bearer {token}
Content-Type: application/json

{
  "rag_query": "What are the standard rent agreement terms and party details?",
  "auto_validate": true
}
```

**Expected logs:**
```
[API] Generating section: draft_id=..., section_key=preamble, user_id=3
[Orchestrator → Librarian] Fetching context for query...
[Retrieve for draft_id=...] using 1 uploaded file(s) → total 1 file(s) (draft-scoped)
[Librarian → Orchestrator] Retrieved 10 chunks
[Orchestrator → Drafter] Generating section content
[Drafter: Generated initial section=preamble, length=1234 chars
[Orchestrator → Critic] Validating generated content
[Critic: Reviewed section=preamble, status=PASS, score=88
[save_section_version] draft=... section=preamble v1 by drafter
[save_critic_review] version=... status=PASS score=88
```

**Expected response:**
```json
{
  "success": true,
  "version": {
    "version_id": "uuid",
    "section_key": "preamble",
    "version_number": 1,
    "content_html": "<div class=\"section-preamble\">...</div>",
    "is_active": true
  },
  "critic_review": {
    "status": "PASS",
    "score": 88,
    "feedback": "Well-structured preamble..."
  }
}
```

### 5.8 Refine Section

```http
POST http://localhost:8000/api/drafts/{draft_id}/sections/preamble/refine
Authorization: Bearer {token}
Content-Type: application/json

{
  "user_feedback": "Add a clause about utilities payment responsibility",
  "auto_validate": true
}
```

**Expected:** Version 2 created, v1 deactivated

### 5.9 Get All Sections

```http
GET http://localhost:8000/api/drafts/{draft_id}/sections
Authorization: Bearer {token}
```

**Expected:** All active versions (latest for each section)

## Step 6: Frontend Integration

### 6.1 Create Section Management UI

```jsx
// In DraftFormPage.jsx - Step 3: Template Sections

const [sections, setSections] = useState([]);
const [generatedSections, setGeneratedSections] = useState({});

// Fetch template sections
useEffect(() => {
  if (draft?.template_id) {
    fetch(`${API}/api/templates/${draft.template_id}/sections`)
      .then(res => res.json())
      .then(data => setSections(data.sections));
  }
}, [draft]);

// Fetch generated sections for this draft
useEffect(() => {
  if (draftId) {
    fetch(`${API}/api/drafts/${draftId}/sections`)
      .then(res => res.json())
      .then(data => {
        const sectionsMap = {};
        data.sections.forEach(s => {
          sectionsMap[s.section_key] = s;
        });
        setGeneratedSections(sectionsMap);
      });
  }
}, [draftId]);

// Render sections
{sections.map(section => (
  <SectionCard key={section.section_key}>
    <h3>{section.section_name}</h3>
    
    {/* Editable prompt */}
    <textarea 
      defaultValue={section.default_prompt}
      onChange={e => updatePrompt(section.section_key, e.target.value)}
    />
    
    {/* Generate or show content */}
    {!generatedSections[section.section_key] ? (
      <button onClick={() => generateSection(section.section_key)}>
        Generate
      </button>
    ) : (
      <>
        <div dangerouslySetInnerHTML={{
          __html: generatedSections[section.section_key].content_html
        }} />
        
        {/* Critic badge */}
        <CriticBadge 
          status={sectionReviews[section.section_key]?.critic_status}
          score={sectionReviews[section.section_key]?.critic_score}
        />
        
        {/* Refine button */}
        <button onClick={() => refineSection(section.section_key)}>
          Refine
        </button>
        
        {/* Version selector */}
        <VersionDropdown section_key={section.section_key} />
      </>
    )}
  </SectionCard>
))}
```

### 6.2 API Functions

```javascript
// services/sectionApi.js

export const generateSection = async (draftId, sectionKey, ragQuery) => {
  const res = await fetch(`${API}/api/drafts/${draftId}/sections/${sectionKey}/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      rag_query: ragQuery,
      auto_validate: true
    })
  });
  return res.json();
};

export const refineSection = async (draftId, sectionKey, userFeedback) => {
  const res = await fetch(`${API}/api/drafts/${draftId}/sections/${sectionKey}/refine`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user_feedback: userFeedback,
      auto_validate: true
    })
  });
  return res.json();
};

export const getAllSections = async (draftId) => {
  const res = await fetch(`${API}/api/drafts/${draftId}/sections`, {
    headers: {
      'Authorization': `Bearer ${getToken()}`
    }
  });
  return res.json();
};
```

## Step 7: Verification

### 7.1 Check Database

After generating a section, verify data:

```sql
-- Check section_versions
SELECT draft_id, section_key, version_number, is_active, 
       LENGTH(content_html) as content_length,
       created_by_agent, created_at
FROM section_versions
ORDER BY created_at DESC
LIMIT 5;

-- Check section_reviews
SELECT sv.section_key, sv.version_number,
       sr.critic_status, sr.critic_score,
       sr.reviewed_at
FROM section_reviews sr
JOIN section_versions sv ON sr.version_id = sv.version_id
ORDER BY sr.reviewed_at DESC
LIMIT 5;
```

**Expected:**
```
 draft_id | section_key | version_number | is_active | content_length | created_by_agent | created_at
----------+-------------+----------------+-----------+----------------+------------------+------------
 uuid     | preamble    | 1              | t         | 1234           | drafter          | 2026-02-03...
```

### 7.2 Check Logs

Look for the complete flow:

```
✅ [Orchestrator → Librarian] Fetching context...
✅ [Librarian → Orchestrator] Retrieved 10 chunks
✅ [Orchestrator → Drafter] Generating section content
✅ [Drafter: Generated initial section=preamble
✅ [Orchestrator → Critic] Validating...
✅ [Critic: Reviewed section=preamble, status=PASS, score=88
✅ [save_section_version] draft=... section=preamble v1
✅ [save_critic_review] version=... status=PASS score=88
```

## Step 8: Test Complete Flow

### Full Postman Collection

**1. Create Draft**
```
POST /api/drafts
→ draft_id
```

**2. Upload + Link File**
```
POST /api/orchestrate/upload (draft_id)
→ file_id

POST /api/drafts/{draft_id}/link-file (file_id)
→ Success
```

**3. Fill Fields**
```
PUT /api/drafts/{draft_id}
→ field_values saved
```

**4. Generate All Sections**
```
POST /api/drafts/{draft_id}/sections/preamble/generate
POST /api/drafts/{draft_id}/sections/terms/generate
POST /api/drafts/{draft_id}/sections/special_clauses/generate
POST /api/drafts/{draft_id}/sections/signatures/generate
```

**5. Get All Sections**
```
GET /api/drafts/{draft_id}/sections
→ All active versions
```

**6. Assemble** (future)
```
POST /api/drafts/{draft_id}/assemble
→ Final document
```

## Troubleshooting

### Issue: "DRAFT_DATABASE_URL must be set"

**Fix:**
```bash
export DRAFT_DATABASE_URL="postgresql://user:pass@host:5432/draft_db"
# Or add to .env file
```

### Issue: "GOOGLE_API_KEY not found"

**Fix:**
```bash
export GOOGLE_API_KEY="AIza..."
# Or add to .env file
```

### Issue: "Table template_sections does not exist"

**Fix:**
```bash
psql $DRAFT_DATABASE_URL < schema/section_versions.sql
```

### Issue: "No sections configured for template"

**Fix:**
- Insert rows into `template_sections` table (see Step 3)
- Or call `/generate` with custom `section_prompt` parameter

### Issue: "Retrieve returns 0 file_ids (draft-scoped)"

**Fix:**
- Upload a file for the draft AND call `/link-file` endpoint
- OR attach a case to the draft
- Verify `draft_field_data.metadata` has `uploaded_file_ids` or `case_id`

### Issue: "Critic always returns FAIL"

**Check:**
1. Is RAG context relevant to the section?
2. Is section_prompt clear and achievable?
3. Are field_values filled correctly?
4. Review `critic_feedback` in response for specific issues

**Fix:**
- Improve RAG query to get better context
- Simplify section_prompt
- Ensure uploaded file contains relevant information

## Performance Tips

1. **Template URL Caching:**
   - Generate signed GCS URLs for templates once
   - Cache for 1 hour
   - Reuse across section generations

2. **Parallel Generation:**
   - Generate independent sections in parallel (future)
   - Current: sequential per user request

3. **RAG Optimization:**
   - Use specific queries per section
   - Adjust `top_k` based on section complexity (5-15 chunks)

4. **Critic Optimization:**
   - Set `auto_validate=false` for draft iterations
   - Enable only for final review

## Security Checklist

- [x] JWT authentication on all endpoints
- [x] User ownership verification (draft CRUD)
- [x] Draft-scoped file access (no cross-draft)
- [x] User-scoped RAG (no cross-user chunks)
- [x] SQL injection prevention (parameterized queries)
- [x] CORS properly configured

## Monitoring

### Key Metrics to Track

1. **Generation time per section:** ~5-10 seconds
2. **Critic validation rate:** PASS vs FAIL ratio
3. **Auto-retry frequency:** How often Critic triggers retry
4. **Version count per section:** User refinement frequency
5. **RAG context quality:** Chunk relevance scores

### Logging

All agent calls are logged with:
```
[Agent: Level] Message with context
```

Use logs to debug flow and performance.

## Next Steps

1. ✅ Apply schema to Draft_DB
2. ✅ Configure environment variables
3. ✅ Populate template_sections for your templates
4. ✅ Test section generation flow
5. Build frontend section UI
6. Implement Assembler for final document
7. Add PDF export functionality
8. Deploy to production

## Support

For issues or questions:
- Check logs in console
- Review [SECTION_DRAFTING.md](docs/SECTION_DRAFTING.md)
- Test with [API_QUICK_REFERENCE.md](docs/API_QUICK_REFERENCE.md)
