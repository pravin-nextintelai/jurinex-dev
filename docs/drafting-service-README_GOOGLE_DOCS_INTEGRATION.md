# Google Docs Integration Flow

This document describes the complete Google Docs integration between Auth Service and Draft Service.

## Architecture Overview

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│ Auth Service│────────▶│ Draft Service│────────▶│ Google APIs │
│ (Tokens)    │         │ (OAuth Client)│         │ (Drive/Docs)│
└─────────────┘         └──────────────┘         └─────────────┘
                              │
                              ▼
                        ┌─────────────┐
                        │ GCS Bucket  │
                        │ (Exports)   │
                        └─────────────┘
```

## Components

### 1. OAuth2 Client Utility (`utils/oauth2Client.js`)

**Purpose**: Fetches refresh tokens from Auth Service and manages token refresh.

**Key Functions**:
- `getOAuth2Client()` - Initialize OAuth2 client with credentials
- `getAuthorizedClient(userId)` - Get authorized client for a user
  - Fetches refresh token from Auth Service
  - Refreshes access token if expired
  - Returns ready-to-use OAuth2 client

**Environment Variables**:
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
AUTH_SERVICE_URL=http://localhost:5001
INTERNAL_SERVICE_TOKEN=optional-internal-token
```

### 2. Google Docs Service (`services/googleDocsService.js`)

**Purpose**: Document creation and management.

**Key Functions**:
- `createGoogleDoc(userId, title)` - Create new Google Docs document
  - Uses Drive API `files.create`
  - Grants user write permission
  - Inserts record into drafts table

### 3. GCS Sync Service (`services/gcsSyncService.js`)

**Purpose**: Export Google Docs to GCS.

**Key Functions**:
- `syncDraftToGCS(draftId, format)` - Export and upload to GCS
  - Uses Drive API `files.export` (PDF/DOCX)
  - Uses `stream.pipeline` for efficient memory management
  - Updates `gcs_path` and `last_synced_at`

**Environment Variables**:
```env
GCS_BUCKET=draft_templaten
```

### 4. Controller (`controllers/googleDocsController.js`)

**Endpoints**:
- `POST /api/drafts/create` - Create new document
- `GET /api/drafts/:draftId/editor-url` - Get iframe editor URL
- `POST /api/drafts/:draftId/sync` - Sync to GCS
- `GET /api/drafts/:draftId/gcs-url` - Get GCS signed URL
- `GET /api/drafts/:draftId/sync-status` - Check sync status

## Database Schema

```sql
CREATE TABLE drafts (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    google_file_id VARCHAR(100) UNIQUE,
    gcs_path VARCHAR(512),
    last_synced_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Setup Instructions

### 1. Run Database Migration

```bash
psql your_database -f db/migrations/002_update_drafts_schema.sql
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

```env
# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback

# Auth Service
AUTH_SERVICE_URL=http://localhost:5001
INTERNAL_SERVICE_TOKEN=optional

# GCS
GCS_BUCKET=draft_templaten
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json

# Database
DRAFTING_SERVICE_URL=postgresql://user:pass@localhost:5432/db
# OR
DATABASE_URL=postgresql://user:pass@localhost:5432/db

# JWT
JWT_SECRET=your-jwt-secret
```

### 4. GCS Service Account Setup

1. Create a service account in Google Cloud Console
2. Grant Storage Admin role
3. Download JSON key file
4. Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable

## API Usage Examples

### Create Document

```bash
POST /api/drafts/create
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "title": "My Document"
}
```

Response:
```json
{
  "success": true,
  "message": "Document created successfully",
  "data": {
    "draftId": 1,
    "googleFileId": "1a2b3c4d5e6f7g8h9i0j",
    "title": "My Document",
    "fileUrl": "https://docs.google.com/document/d/...",
    "webContentLink": "..."
  }
}
```

### Get Editor URL

```bash
GET /api/drafts/1/editor-url
Authorization: Bearer <jwt-token>
```

Response:
```json
{
  "success": true,
  "editorUrl": "https://docs.google.com/document/d/1a2b3c4d5e6f7g8h9i0j/edit?rm=minimal",
  "draft": {
    "id": 1,
    "title": "My Document",
    "googleFileId": "1a2b3c4d5e6f7g8h9i0j"
  }
}
```

### Sync to GCS

```bash
POST /api/drafts/1/sync
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "format": "pdf"
}
```

Response:
```json
{
  "success": true,
  "message": "Draft synced to GCS successfully",
  "data": {
    "draftId": 1,
    "gcsPath": "drafts/123/1/My_Document_2026-01-12T10-30-00.pdf",
    "signedUrl": "https://storage.googleapis.com/...",
    "exportFormat": "pdf",
    "syncedAt": "2026-01-12T10:30:00Z"
  }
}
```

## Error Handling

### Token Expired
```json
{
  "success": false,
  "error": "Google Drive connection expired. Please reconnect your Google Drive account.",
  "needsReconnect": true
}
```

### Quota Exceeded
```json
{
  "success": false,
  "error": "Google API quota exceeded. Please try again later."
}
```

### Not Connected
```json
{
  "success": false,
  "error": "Google Drive not connected. Please connect your Google Drive account first."
}
```

## Frontend Integration

### Iframe Embedding

```jsx
<iframe
  src={editorUrl}
  className="w-full h-full border-0"
  title="Google Docs Editor"
  allow="clipboard-read; clipboard-write"
  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
/>
```

## Notes

1. **Token Refresh**: The OAuth2 client automatically refreshes expired tokens
2. **Memory Efficiency**: GCS sync uses `stream.pipeline` to avoid loading entire file into memory
3. **Permissions**: Documents are created with user write permission for iframe editing
4. **Error Recovery**: Handles quota limits, expired tokens, and permission errors gracefully

