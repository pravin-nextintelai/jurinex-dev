# Template API – Postman & curl

Base URL (default): `http://localhost:8000`

## Import in Postman

1. Open Postman → **Import** → **Upload Files**
2. Select: `Template_API.postman_collection.json`
3. Collection **"Agent Draft - Template API"** appears with 3 requests.

**Variables:**  
- `base_url`: `http://localhost:8000` (change if your server runs elsewhere)  
- `template_id`: set this when testing "Get template by ID" or "Get template preview image URL" (e.g. a real template ID from list response).

---

## Requests (no JWT)

### 1. List templates

**Postman:** `GET {{base_url}}/api/templates`

Query params (optional):

| Param               | Default | Description                    |
|---------------------|--------|--------------------------------|
| `category`          | -      | Filter by category             |
| `is_active`         | true   | Only active templates          |
| `limit`             | 50     | Page size (1–100)               |
| `offset`            | 0      | Pagination offset               |
| `include_preview_url` | true | Include signed preview URL per item |

**curl:**

```bash
# Default (all active, with preview URLs)
curl -X GET "http://localhost:8000/api/templates"

# With query params
curl -X GET "http://localhost:8000/api/templates?category=petition&limit=20&offset=0&include_preview_url=true"
```

**Example response:**

```json
{
  "success": true,
  "templates": [
    {
      "template_id": "tpl-001",
      "name": "Rent Deed",
      "description": "Standard rent deed template",
      "category": "deed",
      "is_active": true,
      "created_at": "2025-01-15T10:00:00Z",
      "updated_at": "2025-01-15T10:00:00Z",
      "preview_image_url": "https://storage.googleapis.com/..."
    }
  ],
  "count": 1
}
```

---

### 2. Get template by ID

**Postman:** `GET {{base_url}}/api/templates/{{template_id}}`

Query: `include_asset_urls` (optional, default `false`) – set `true` to get signed URLs for assets and images.

**curl:**

```bash
# Replace YOUR_TEMPLATE_ID with an id from list response
curl -X GET "http://localhost:8000/api/templates/YOUR_TEMPLATE_ID"

# With signed URLs for assets/images
curl -X GET "http://localhost:8000/api/templates/YOUR_TEMPLATE_ID?include_asset_urls=true"
```

**Example response:**

```json
{
  "success": true,
  "template": {
    "template_id": "tpl-001",
    "name": "Rent Deed",
    "description": "...",
    "category": "deed",
    "assets": [...],
    "css": { "css_content": "...", "paper_size": "A4", ... },
    "html": { "html_content": "...", ... },
    "images": [...],
    "preview_image_url": "https://storage.googleapis.com/..."
  }
}
```

---

### 3. Get template preview image URL

**Postman:** `GET {{base_url}}/api/templates/{{template_id}}/preview-image`

**curl:**

```bash
curl -X GET "http://localhost:8000/api/templates/YOUR_TEMPLATE_ID/preview-image"
```

**Example response:**

```json
{
  "success": true,
  "template_id": "YOUR_TEMPLATE_ID",
  "preview_image_url": "https://storage.googleapis.com/bucket/path?X-Goog-Signature=...&X-Goog-Expires=3600",
  "expires_minutes": 60
}
```

Use `preview_image_url` in the frontend as `<img src="{preview_image_url}" />`.
