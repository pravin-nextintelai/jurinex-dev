# User Template Analyzer Agent – API Documentation

**Base URL:** `http://localhost:5017/analysis`  
**(Via Gateway):** `http://localhost:5000/api/template-analysis`

---

## Overview

This is a **User-Side Microservice** responsible for:
1.  **Uploading Templates**: Users upload PDF/Text templates.
2.  **AI Analysis**: The service uses Gemini to extract logical sections and fields.
3.  **Prompt Generation**: It automatically generates drafting prompts for each section.
4.  **Storage**: All data is stored in user-specific tables (`user_templates`, etc.).

---

## Authentication & Headers

The service is designed to sit behind a **Gateway**.

### Required Headers
1.  **`Authorization`**: `Bearer <token>` (Handled by Gateway, but good for local testing).
2.  **`x-user-id`**: **REQUIRED**. The Gateway extracts this from the JWT and passes it to the service.
    - *Local Testing*: You MUST manually send this header (e.g., `x-user-id: 1`).

---

## API Reference

### 1. Upload Template (The Main Flow)

**Endpoint:** `POST /upload-template`  
**URL:** `http://localhost:5017/analysis/upload-template`  
**Gateway URL:** `http://localhost:5000/api/template-analysis/upload-template`

**Headers:**
- `x-user-id`: `<integer_user_id>` (Required)

**Form-Data Body:**
| Key | Type | Description |
|---|---|---|
| `name` | Text | Name of the template (Required) |
| `category` | Text | Category (e.g., "Legal", "Contract") (Required) |
| `subcategory` | Text | Subcategory (Optional) |
| `description` | Text | Description (Optional) |
| `file` | File | The PDF or Text file to analyze (Required) |
| `image` | File | Cover image for the template (Optional) |

**Response:**
```json
{
  "status": "success",
  "template_id": "uuid-string",
  "image_url": "https://signed-url...",
  "message": "Template uploaded and processed successfully"
}
```

---

### 2. List User Templates

**Endpoint:** `GET /templates`  
**URL:** `http://localhost:5017/analysis/templates`  

**Headers:**
- `x-user-id`: `<integer_user_id>` (Required)

**Response:** List of templates belonging to that user.

---

### 3. Get Template Details

**Endpoint:** `GET /template/{template_id}`  
**URL:** `http://localhost:5017/analysis/template/{template_id}`

**Headers:**
- `x-user-id`: `<integer_user_id>` (Required)

**Response:**
```json
{
  "template": { ... },
  "sections": [ ... ],
  "fields": { ... }
}
```

---

### 4. Get Template Sections Only

**Endpoint:** `GET /template/{template_id}/sections`  
**URL:** `http://localhost:5017/analysis/template/{template_id}/sections`

Used by agent-draft-service to fetch sections for user-uploaded (UUID) templates.

**Headers:**
- `x-user-id`: `<integer_user_id>` (Required)

**Response:**
```json
{
  "sections": [
    {
      "id": "uuid",
      "template_id": "uuid",
      "section_name": "Parties and Recitals",
      "section_purpose": "...",
      "section_intro": "...",
      "section_prompts": [{ "prompt": "...", "field_id": "master_instruction" }],
      "order_index": 0,
      "is_active": true
    }
  ],
  "count": 1
}
```

---

## Testing Guide (cURL & Postman)

### 1. Test Connectivity (Health)
```bash
curl http://localhost:5017/
# Output: {"message": "User Template Analyzer Agent is active."}
```

### 2. Upload Template (Local Test without Gateway)
**Prerequisite:** You need a sample PDF file (e.g., `sample.pdf`).

```bash
curl -X POST "http://localhost:5017/analysis/upload-template" \
     -H "x-user-id: 1" \
     -F "name=My Test Contract" \
     -F "category=Contracts" \
     -F "file=@/path/to/your/sample.pdf"
```

**Expected Output:**
The console logs will show a detailed step-by-step progress:
1. `[STEP 1] Received upload request...`
2. `[STEP 2] Processing Text Extraction...`
3. `[STEP 3] Uploading to GCS...`
4. `[STEP 4] Saving UserTemplate...`
5. `[STEP 5] Starting AI Analysis...`
...
8. `[STEP 8] Final Database Commit...`

### 3. List Templates
```bash
curl -X GET "http://localhost:5017/analysis/templates" \
     -H "x-user-id: 1"
```

### 4. Delete Template
```bash
# Get ID from list above, then:
curl -X DELETE "http://localhost:5017/analysis/template/<TEMPLATE_UUID>" \
     -H "x-user-id: 1"
```
