# Postman Testing Guide for Drafting Service

## Base URL
```
http://localhost:5000/drafting
```

## Authentication
All endpoints require JWT authentication. Add this header:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## 1. Create Draft from Template
**POST** `/api/drafts/initiate`

### URL
```
http://localhost:5000/drafting/api/drafts/initiate
```

### Headers
```
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN
```

### Body (JSON)
```json
{
  "templateFileId": "1a2b3c4d5e6f7g8h9i0j",
  "googleAccessToken": "ya29.a0AfH6SMC...",
  "draftName": "My Custom Draft Name",
  "metadata": {
    "full_name": "John Doe",
    "email": "john@example.com",
    "company": "Acme Corp"
  },
  "folderId": "optional-folder-id"
}
```

### Required Fields
- `templateFileId`: Google Drive file ID of the template document
- `googleAccessToken`: User's Google OAuth access token

### Optional Fields
- `draftName`: Custom name for the draft (defaults to "Draft - {template_name} ({date})")
- `metadata`: Object with template variables (e.g., `{{full_name}}`, `{{email}}`)
- `folderId`: Destination folder ID in Google Drive

---

## 2. Create New Google Docs Document
**POST** `/api/drafts/create`

### URL
```
http://localhost:5000/drafting/api/drafts/create
```

### Headers
```
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN
```

### Body (JSON)
```json
{
  "title": "New Document Title"
}
```

### Required Fields
- `title`: Title for the new Google Docs document

---

## 3. List All Drafts
**GET** `/api/drafts`

### URL
```
http://localhost:5000/drafting/api/drafts
```

### Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
```

### Query Parameters (Optional)
```
?status=active
?limit=10
?offset=0
```

### Example with Query Params
```
http://localhost:5000/drafting/api/drafts?status=active&limit=10
```

---

## 4. Get Specific Draft
**GET** `/api/drafts/:draftId`

### URL
```
http://localhost:5000/drafting/api/drafts/123
```

### Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
```

### Replace `123` with actual draft ID

---

## 5. Get Editor URL (Iframe)
**GET** `/api/drafts/:draftId/editor-url`

### URL
```
http://localhost:5000/drafting/api/drafts/123/editor-url
```

### Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
```

### Response
```json
{
  "editorUrl": "https://docs.google.com/document/d/1a2b3c4d5e6f7g8h9i0j/edit?rm=minimal"
}
```

---

## 6. Populate Draft with Variables
**POST** `/api/drafts/populate/:draftId`

### URL
```
http://localhost:5000/drafting/api/drafts/123/populate
```

### Headers
```
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN
```

### Body (JSON)
```json
{
  "googleAccessToken": "ya29.a0AfH6SMC...",
  "variables": {
    "full_name": "John Doe",
    "email": "john@example.com",
    "company": "Acme Corp",
    "date": "2024-01-15"
  }
}
```

### Required Fields
- `googleAccessToken`: User's Google OAuth access token
- `variables`: Object with key-value pairs to replace placeholders (e.g., `{{full_name}}` → `"John Doe"`)

---

## 7. Get Placeholders from Draft
**GET** `/api/drafts/:draftId/placeholders`

### URL
```
http://localhost:5000/drafting/api/drafts/123/placeholders
```

### Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
```

### Response
```json
{
  "placeholders": ["full_name", "email", "company", "date"]
}
```

---

## 8. Sync Draft to GCS
**POST** `/api/drafts/:draftId/sync`

### URL
```
http://localhost:5000/drafting/api/drafts/123/sync
```

### Headers
```
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN
```

### Body (JSON)
```json
{
  "format": "pdf"
}
```

### Optional Fields
- `format`: Export format - `"pdf"` (default) or `"docx"`

---

## 9. Get GCS URL
**GET** `/api/drafts/:draftId/gcs-url`

### URL
```
http://localhost:5000/drafting/api/drafts/123/gcs-url
```

### Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## 10. Get Sync Status
**GET** `/api/drafts/:draftId/sync-status`

### URL
```
http://localhost:5000/drafting/api/drafts/123/sync-status
```

### Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## 11. Finalize Draft
**PATCH** `/api/drafts/:draftId/finalize`

### URL
```
http://localhost:5000/drafting/api/drafts/123/finalize
```

### Headers
```
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN
```

### Body (JSON) - Optional
```json
{
  "finalName": "Final Document Name"
}
```

---

## 12. Delete Draft
**DELETE** `/api/drafts/:draftId`

### URL
```
http://localhost:5000/drafting/api/drafts/123
```

### Headers
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## 13. Health Check
**GET** `/api/health`

### URL
```
http://localhost:5000/drafting/api/health
```

### No Authentication Required

---

## How to Get JWT Token

1. **Login through Auth Service:**
   ```
   POST http://localhost:5000/auth/api/auth/login
   Body: {
     "email": "user@example.com",
     "password": "password123"
   }
   ```

2. **Copy the token from response:**
   ```json
   {
     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   }
   ```

3. **Use it in Authorization header:**
   ```
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

---

## How to Get Google Access Token

1. **Complete Google OAuth flow through your frontend**
2. **Or use the Auth Service Google OAuth endpoint:**
   ```
   GET http://localhost:5000/auth/api/auth/google
   ```
   This will redirect to Google OAuth, then callback with tokens.

3. **The access token is typically stored in the user's session or returned in the OAuth callback**

---

## Common Error Responses

### 401 Unauthorized
```json
{
  "error": "No token provided"
}
```
**Solution:** Add `Authorization: Bearer YOUR_TOKEN` header

### 403 Forbidden
```json
{
  "error": "Invalid token"
}
```
**Solution:** Token is expired or invalid. Get a new token.

### 404 Not Found
```json
{
  "error": "Draft not found"
}
```
**Solution:** Check the draft ID is correct

### 400 Bad Request
```json
{
  "success": false,
  "error": "Template file ID is required"
}
```
**Solution:** Check required fields in request body

---

## Quick Test Sequence

1. **Health Check** → Verify service is running
2. **Create Draft** → Create a new draft from template
3. **List Drafts** → Verify draft was created
4. **Get Draft** → Get details of created draft
5. **Get Editor URL** → Get iframe URL for editing
6. **Populate Draft** → Replace placeholders with values
7. **Sync to GCS** → Export and save to Google Cloud Storage
8. **Get GCS URL** → Get download link
9. **Finalize Draft** → Mark as finalized
10. **Delete Draft** → Clean up test data

