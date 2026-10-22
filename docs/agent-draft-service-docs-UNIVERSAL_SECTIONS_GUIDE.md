# Universal Sections Guide

Complete implementation guide for the 23 universal sections that apply to ALL legal templates.

## Overview

Every legal document in the platform uses the same **23 standard sections**. This provides:

- ✅ **Consistency** across all legal documents
- ✅ **User familiarity** - same structure for every template
- ✅ **Easy customization** - users can edit prompts per section
- ✅ **Flexible content** - Special Terms section for template-specific clauses
- ✅ **Professional structure** - follows legal document best practices

## 23 Universal Sections

### 1️⃣ Document Header (Sections 1-3)

**1. Document Information**
- Document Title, Type, Category
- Jurisdiction, Language
- Date of Execution, Effective Date

**2. Parties**
- First Party, Second Party, Additional Parties
- Legal Status, Address, Authorized Signatory

**3. Background / Recitals**
- Purpose of Agreement
- Business Context, Intent of Parties

### 2️⃣ Core Terms (Sections 4-8)

**4. Definitions & Interpretation**
- Key term definitions
- Interpretation rules

**5. Subject Matter**
- What is being agreed
- Description of property/service/relationship

**6. Scope of Rights & Obligations**
- Rights of Party A, Party B
- Duties & Responsibilities

**7. Term & Duration**
- Start Date, End Date
- Renewal, Survival

**8. Commercial Terms**
- Consideration, Payment Amount/Method
- Taxes, Penalties

### 3️⃣ Legal Protections (Sections 9-12)

**9. Representations & Warranties**
- Legal Authority, Compliance
- Ownership, No Conflict

**10. Confidentiality & Data Protection**
- Confidentiality obligations
- Data Usage, Privacy

**11. Intellectual Property**
- IP Ownership, License, Restrictions

**12. Indemnity & Liability**
- Indemnity obligations
- Limitation of Liability

### 4️⃣ Termination & Disputes (Sections 13-16)

**13. Termination**
- Termination Events, Notice Period
- Effect of Termination

**14. Force Majeure**
- Events beyond control
- Notification requirements

**15. Dispute Resolution**
- Governing Law, Jurisdiction
- Arbitration

**16. Compliance & Legal**
- Applicable Laws
- Regulatory Compliance

### 5️⃣ Administrative Clauses (Sections 17-20)

**17. Assignment & Transfer**
- Restrictions on assignment
- Transfer conditions

**18. Notices**
- Notice addresses
- Delivery methods

**19. Amendments & Waivers**
- Amendment process
- Waiver requirements

**20. General Clauses**
- Severability
- Entire Agreement
- Relationship of Parties

### 6️⃣ Special & Attachments (Sections 21-23)

**21. Special Terms** ⭐
- Template-specific clauses
- Custom provisions

**22. Schedules & Annexures**
- Attachments, Exhibits
- Referenced documents

**23. Signatures**
- Party signatures
- Witnesses, Date & Place

## Architecture

### Backend: Configuration File

**Location:** `config/universal_sections.json`

```json
{
  "universal_sections": [
    {
      "section_key": "document_information",
      "section_name": "Document Information",
      "sort_order": 1,
      "is_required": true,
      "default_prompt": "Generate the document information section..."
    },
    ...
  ]
}
```

### Backend: API Endpoint

**GET** `/api/universal-sections`

Returns all 23 sections with default prompts.

```json
{
  "success": true,
  "sections": [...],
  "count": 23
}
```

### Frontend: Hardcoded Config

**Location:** `frontend/src/config/universalSections.js`

```javascript
export const UNIVERSAL_SECTIONS = [
  {
    section_key: 'document_information',
    section_name: 'Document Information',
    sort_order: 1,
    is_required: true,
    icon: '📄',
    default_prompt: '...',
  },
  ...
];
```

**Categories for UI grouping:**

```javascript
export const SECTION_CATEGORIES = {
  HEADER: ['document_information', 'parties', 'background_recitals'],
  CORE_TERMS: ['definitions_interpretation', 'subject_matter', ...],
  LEGAL_PROTECTIONS: ['representations_warranties', ...],
  ...
};
```

## User Flow

### Step 3: Template Sections (After Upload & Form Fields)

```
┌─────────────────────────────────────────────────────────────┐
│          Template Sections - Step 3 of Draft Form           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Progress: 5/23 sections generated • 4 passed validation    │
│  [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]              │
│                                                               │
│  [All Sections] [Header] [Core Terms] [Legal] [Admin] ...   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 📄 Document Information                Required • 1   │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ Generation Prompt:                    [Edit Prompt]  │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │ Generate the document information section...    │ │   │
│  │ │ (editable textarea)                             │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  │                                                       │   │
│  │ RAG Query (Optional):                                │   │
│  │ [What are the document details for this case?]      │   │
│  │                                                       │   │
│  │ [✨ Generate Section]                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 👥 Parties                          Required • 2     │   │
│  │                              [✅ PASS (88/100)]      │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ Generated Content (v1):              2026-02-03...   │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │ <h2>Parties to this Agreement</h2>             │ │   │
│  │ │ <p>First Party: John Doe...</p>                │ │   │
│  │ │ (HTML preview)                                  │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  │                                                       │   │
│  │ [✏️ Refine Section]                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ... (21 more sections)                                      │
│                                                               │
│  [🎉 All sections generated! → Assemble Document]           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. Frontend: Load Sections

```jsx
import { UNIVERSAL_SECTIONS } from '../../config/universalSections';

function SectionsPage() {
  const [sections] = useState(UNIVERSAL_SECTIONS);
  
  return sections.map(section => (
    <SectionCard 
      key={section.section_key}
      section={section}
      onGenerate={handleGenerate}
    />
  ));
}
```

### 2. Frontend: Section Card with Editable Prompt

```jsx
function SectionCard({ section, onGenerate }) {
  const [prompt, setPrompt] = useState(section.default_prompt);
  const [isEditing, setIsEditing] = useState(false);
  const [ragQuery, setRagQuery] = useState('');
  
  return (
    <div>
      <h3>{section.icon} {section.section_name}</h3>
      
      {/* Editable prompt */}
      <textarea 
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        disabled={!isEditing}
      />
      {isEditing ? (
        <button onClick={() => setIsEditing(false)}>Save</button>
      ) : (
        <button onClick={() => setIsEditing(true)}>Edit Prompt</button>
      )}
      
      {/* Optional RAG query */}
      <input 
        placeholder="RAG query (optional)"
        value={ragQuery}
        onChange={e => setRagQuery(e.target.value)}
      />
      
      {/* Generate button */}
      <button onClick={() => onGenerate(section.section_key, prompt, ragQuery)}>
        Generate Section
      </button>
    </div>
  );
}
```

### 3. Frontend: Generate Section

```javascript
const handleGenerate = async (sectionKey, customPrompt, ragQuery) => {
  const data = await generateSection(draftId, sectionKey, customPrompt, ragQuery);
  
  // Store generated version
  setGeneratedSections(prev => ({
    ...prev,
    [sectionKey]: data.version
  }));
  
  // Store critic review
  setCriticReviews(prev => ({
    ...prev,
    [sectionKey]: data.critic_review
  }));
};
```

### 4. Backend: Section Generation

```python
# api/section_routes.py

@router.post("/drafts/{draft_id}/sections/{section_key}/generate")
async def generate_section(
    draft_id: str,
    section_key: str,
    user_id: int = Depends(require_user_id),
    section_prompt: Optional[str] = Body(None, embed=True),
    rag_query: Optional[str] = Body(None, embed=True),
):
    # If no custom prompt provided, use universal default
    if not section_prompt:
        universal_sections = load_universal_sections()
        section_config = next((s for s in universal_sections if s["section_key"] == section_key), None)
        section_prompt = section_config["default_prompt"]
    
    # Get RAG context if query provided
    if rag_query:
        librarian_result = run_librarian_agent({...})
        rag_context = librarian_result["context"]
    
    # Generate with Drafter
    drafter_result = run_drafter_agent({
        "section_key": section_key,
        "section_prompt": section_prompt,  # User's edited prompt or default
        "rag_context": rag_context,
        "field_values": field_values,
    })
    
    # Validate with Critic
    critic_result = run_critic_agent({...})
    
    # Save version with user's prompt in user_prompt_override
    version = save_section_version(
        draft_id=draft_id,
        section_key=section_key,
        content_html=drafter_result["content_html"],
        user_prompt_override=section_prompt if section_prompt != section_config["default_prompt"] else None,
        ...
    )
    
    return {"version": version, "critic_review": critic_result}
```

## Database Storage

### section_versions table

```sql
SELECT 
  section_key,
  version_number,
  user_prompt_override,  -- User's edited prompt (null if using default)
  content_html,          -- Generated HTML
  is_active              -- Only one version is active
FROM section_versions
WHERE draft_id = 'uuid' AND section_key = 'parties';
```

**Result:**
```
 section_key | version_number | user_prompt_override | is_active
-------------+----------------+---------------------+-----------
 parties     | 1              | NULL                | false
 parties     | 2              | "Add more detail..." | true
```

- v1: Used default prompt → `user_prompt_override = NULL`
- v2: User edited prompt → `user_prompt_override = "Add more detail..."`

## Key Features

### 1. Prompt Editing

Users can customize the generation prompt for each section:

```
Default: "Generate the parties section..."

User edits to:
"Generate the parties section with special emphasis on legal entity types 
and include GST numbers for both parties"

→ Stored in user_prompt_override
→ Used for future regeneration
```

### 2. RAG Query per Section

Each section can have a specific RAG query:

```javascript
// Document Information section
rag_query: "What are the document details and dates?"

// Parties section
rag_query: "Who are the parties to this agreement?"

// Commercial Terms section
rag_query: "What are the payment terms and amounts?"
```

### 3. Version Control

Every refinement creates a new version:

```
v1: Generated with default prompt
v2: Refined with user feedback "Add more citations"
v3: Refined with user feedback "Make it more formal"
```

Only ONE version is `is_active=true` at a time.

### 4. Critic Validation

Every generation/refinement is validated:

```json
{
  "critic_status": "PASS",
  "critic_score": 88,
  "feedback": "Well-structured parties section with all required details",
  "issues": [],
  "suggestions": ["Consider adding email addresses"]
}
```

Displayed as badges in UI:
- ✅ PASS (88/100) - Green
- ❌ FAIL (45/100) - Red

### 5. Category Filtering

UI groups sections into categories:

- **Document Header** (3 sections)
- **Core Terms** (5 sections)
- **Legal Protections** (4 sections)
- **Termination & Disputes** (4 sections)
- **Administrative Clauses** (4 sections)
- **Special & Attachments** (3 sections)

Users can filter to work on one category at a time.

## Special Terms Section

Section 21 (Special Terms) is for **template-specific clauses**:

### Rent Agreement Example

```
Special Terms:
- Pet Policy
- Subletting Restrictions
- Renovation Permissions
- Parking Allocation
- Utility Payment Responsibility
```

### NDA Example

```
Special Terms:
- Non-Solicitation Clause
- Return of Materials
- Injunctive Relief
- No License Grant
```

The Drafter agent uses the **retrieved context** to populate this section with relevant template-specific clauses.

## Testing

### 1. Get Universal Sections

```bash
curl http://localhost:8000/api/universal-sections
```

**Response:**
```json
{
  "success": true,
  "sections": [
    {
      "section_key": "document_information",
      "section_name": "Document Information",
      "default_prompt": "..."
    },
    ...
  ],
  "count": 23
}
```

### 2. Generate Section with Custom Prompt

```bash
curl -X POST http://localhost:8000/api/drafts/{draft_id}/sections/parties/generate \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "section_prompt": "Generate parties section with GST numbers and PAN details",
    "rag_query": "Who are the parties and their tax IDs?",
    "auto_validate": true
  }'
```

### 3. Frontend Integration

```jsx
import { UNIVERSAL_SECTIONS } from './config/universalSections';
import SectionCard from './components/DraftSections/SectionCard';
import SectionsPage from './components/DraftSections/SectionsPage';

// In DraftFormPage.jsx - Step 3
<Route path="/drafts/:draftId/sections" element={<SectionsPage />} />
```

## Benefits

### For Users

1. **Familiar Structure** - Same 23 sections for every document
2. **Customizable** - Edit prompts to match specific needs
3. **Smart Generation** - RAG retrieves relevant context per section
4. **Quality Control** - Critic validates every section
5. **Version History** - Track changes and revert if needed

### For Developers

1. **No Admin Config** - No need to configure sections per template
2. **Consistent Code** - Same logic for all templates
3. **Easy Updates** - Change universal config once, applies everywhere
4. **Flexible Content** - Special Terms section for template-specific clauses

### For Legal Quality

1. **Complete Coverage** - All 23 sections ensure comprehensive documents
2. **Professional Structure** - Follows legal document best practices
3. **Consistent Format** - Every document has the same professional structure
4. **Validated Content** - Critic ensures legal accuracy and completeness

## Migration from Template-Specific Sections

If you previously used `template_sections` table:

```sql
-- Old approach: Different sections per template
SELECT * FROM template_sections WHERE template_id = 'rent-agreement';
→ Returns: preamble, terms, signatures

SELECT * FROM template_sections WHERE template_id = 'nda';
→ Returns: introduction, confidentiality, termination
```

**New approach: Same 23 sections for ALL templates**

```javascript
// All templates use UNIVERSAL_SECTIONS
UNIVERSAL_SECTIONS.forEach(section => {
  // Generate with template-specific content via RAG and field_values
});
```

**Special Terms section** handles template-specific clauses.

## Summary

✅ **23 universal sections** for all legal templates
✅ **Frontend-hardcoded** configuration for consistency
✅ **User-editable prompts** for customization
✅ **RAG query per section** for relevant context
✅ **Drafter + Critic** for intelligent generation and validation
✅ **Version control** for refinement tracking
✅ **Special Terms** for template-specific clauses

**Result:** Professional, consistent, customizable legal documents with AI-powered generation!
