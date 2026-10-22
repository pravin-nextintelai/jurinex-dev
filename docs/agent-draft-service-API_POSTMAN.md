# API for Postman Testing

Base URL (local): **http://localhost:8000**

Run the server from `Backend/agent-draft-service`:

```bash
cd Backend/agent-draft-service
source venv/bin/activate   # or: python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn api.app:app --reload --host 0.0.0.0 --port 8000
```

---

## 1. Ingest only (GCS → Document AI → chunk → embed → store in DB)

**POST** `/api/ingest`

**Body:** `form-data`

| Key          | Type | Required | Description                    |
|--------------|------|----------|--------------------------------|
| `file`       | File | Yes      | PDF/DOCX/image file to upload  |
| `user_id`    | Text | Yes      | User identifier (e.g. UUID)    |
| `folder_path`| Text | No       | Folder path (default: "")      |

**Postman steps:**

1. Method: **POST**
2. URL: `http://localhost:8000/api/ingest`
3. Body → **form-data**
4. Add row: key `file`, type **File**, choose a file
5. Add row: key `user_id`, type **Text**, value e.g. `test-user-123`
6. (Optional) Add row: key `folder_path`, type **Text**, value e.g. `uploads`
7. Send

**Example response (200):**

```json
{
  "success": true,
  "file_id": "uuid-here",
  "raw_text_length": 1234,
  "raw_text_preview": "First 500 chars...",
  "chunks_count": 12,
  "embeddings_count": 12,
  "message": "Document uploaded to GCS, OCR via Document AI, chunked, embedded, and stored in DB."
}
```

---

## 2. Orchestrator upload (orchestrator triggers ingestion, then full pipeline)

**POST** `/api/orchestrate/upload`

**Body:** `form-data`

| Key           | Type | Required | Description                    |
|---------------|------|----------|--------------------------------|
| `file`        | File | Yes      | PDF/DOCX/image file to upload |
| `user_id`     | Text | Yes      | User identifier               |
| `folder_path` | Text | No       | Folder path (default: "")     |

**Postman steps:**

1. Method: **POST**
2. URL: `http://localhost:8000/api/orchestrate/upload`
3. Body → **form-data**
4. Add row: key `file`, type **File**, choose a file
5. Add row: key `user_id`, type **Text**, value e.g. `test-user-123`
6. (Optional) key `folder_path`, type **Text**
7. Send

**Example response (200):**

```json
{
  "success": true,
  "final_document": "...",
  "state": { "flags": {...}, "chunks_count": 12, ... },
  "message": "Orchestrator triggered ingestion (GCS → Document AI → chunk → embed → DB); pipeline completed."
}
```

---

## 3. Get template sections

**GET** `/api/templates/{template_id}/sections`

Returns sections for a template (admin or user-uploaded).

- **Admin templates** (non-UUID `template_id`): sections from draft DB. No extra headers required.
- **User-uploaded templates** (UUID `template_id`): sections from Template Analyzer. Requires either **Authorization: Bearer &lt;JWT&gt;** or **X-User-Id: &lt;integer&gt;** and env **TEMPLATE_ANALYZER_URL** (e.g. `http://localhost:5017`).

**Headers (optional for user templates):**

| Header          | Description                          |
|-----------------|--------------------------------------|
| `Authorization` | `Bearer <JWT>` — user id used for Analyzer |
| `X-User-Id`     | Integer user id (if no JWT)          |

**Example (admin template):**  
`GET http://localhost:8000/api/templates/lease_agreement/sections`

**Example (user template):**  
`GET http://localhost:8000/api/templates/550e8400-e29b-41d4-a716-446655440000/sections`  
with header `X-User-Id: 1` or `Authorization: Bearer <token>`

**Response (200):**

```json
{
  "success": true,
  "sections": [
    {
      "section_id": "uuid",
      "section_key": "parties_and_recitals",
      "section_name": "Parties and Recitals",
      "default_prompt": "...",
      "sort_order": 0,
      "is_required": true
    }
  ],
  "count": 1
}
```

---

## Other endpoints

- **GET** `/` — Service info and endpoint list
- **GET** `/health` — Health check (`{"status": "ok"}`)
- **GET** `/docs` — Swagger UI
