# Drafting Service

A microservice for creating and managing document drafts from Google Docs templates.

## Overview

The Drafting Service allows users to:
- Create new document drafts from Google Docs templates
- Populate template placeholders with dynamic data
- Track draft status (DRAFTING/FINALIZED)
- Manage draft lifecycle

## Features

- **Template Copying**: Uses Google Drive API `files.copy` to create new documents from templates
- **Placeholder Replacement**: Uses Google Docs API `documents.batchUpdate` with `replaceAllText` to replace placeholders like `{{full_name}}`
- **Draft Management**: Full CRUD operations for drafts with status tracking
- **User Authentication**: JWT-based authentication compatible with the main auth service

## API Endpoints

### POST /api/drafts/initiate
Create a new draft from a template.

**Request Body:**
```json
{
  "templateFileId": "google-drive-file-id",
  "googleAccessToken": "user-oauth-access-token",
  "draftName": "Optional custom name",
  "metadata": {
    "variables": {}
  },
  "folderId": "optional-destination-folder-id"
}
```

**Response:**
```json
{
  "success": true,
  "draft": {
    "id": "uuid",
    "googleFileId": "new-file-id",
    "templateFileId": "template-id",
    "fileName": "Draft - Template Name (2026-01-12)",
    "fileUrl": "https://docs.google.com/...",
    "status": "DRAFTING",
    "placeholders": ["{{full_name}}", "{{date}}"],
    "createdAt": "2026-01-12T00:00:00Z"
  }
}
```

### POST /api/drafts/populate/:draftId
Replace placeholders in a draft with provided values.

**Request Body:**
```json
{
  "googleAccessToken": "user-oauth-access-token",
  "variables": {
    "{{full_name}}": "John Doe",
    "{{date}}": "January 12, 2026",
    "{{company}}": "Acme Corp"
  },
  "saveToMetadata": true
}
```

**Response:**
```json
{
  "success": true,
  "draft": {
    "id": "uuid",
    "googleFileId": "file-id",
    "fileName": "Draft Name",
    "status": "DRAFTING"
  },
  "replacements": {
    "variablesProvided": 3,
    "occurrencesChanged": 5,
    "details": [
      { "placeholder": "{{full_name}}", "occurrences": 2 },
      { "placeholder": "{{date}}", "occurrences": 2 },
      { "placeholder": "{{company}}", "occurrences": 1 }
    ]
  }
}
```

### GET /api/drafts
List all drafts for the current user.

**Query Parameters:**
- `status`: Filter by status (DRAFTING or FINALIZED)
- `limit`: Number of results (default: 50)
- `offset`: Pagination offset

### GET /api/drafts/:draftId
Get a specific draft by ID.

### GET /api/drafts/:draftId/placeholders
Get placeholders from a draft document.

**Query Parameters:**
- `googleAccessToken`: Required for reading document content

### PATCH /api/drafts/:draftId/finalize
Mark a draft as finalized (complete).

### DELETE /api/drafts/:draftId
Delete a draft record.

## Database Schema

```sql
CREATE TABLE drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    google_file_id VARCHAR(255) NOT NULL,
    template_file_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'DRAFTING',
    metadata JSONB DEFAULT '{}',
    file_name VARCHAR(500),
    file_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Environment Variables

```env
# Server
PORT=5005
NODE_ENV=development

# Database (PostgreSQL)
DRAFT_DATABASE_URL=postgresql://user:pass@localhost:5432/draft_db

# JWT (shared with other services)
JWT_SECRET=your-shared-jwt-secret
```

## Setup

1. Install dependencies:
   ```bash
   cd Backend/drafting-service
   npm install
   ```

2. Create the database:
   ```bash
   createdb draft_db
   psql draft_db -f db/migrations/001_create_drafts_table.sql
   ```

3. Configure environment variables (copy from .env.example)

4. Start the service:
   ```bash
   npm run dev
   ```

## Google API Configuration

The service uses the user's Google OAuth access token for all API calls. This means:

1. Users must authenticate with Google via the frontend
2. The access token is passed with each request
3. No server-side Google credentials are required
4. The service respects user permissions in Google Drive

### Required Google API Scopes

The frontend should request these scopes during OAuth:
- `https://www.googleapis.com/auth/drive.file` - Access to files created by the app
- `https://www.googleapis.com/auth/documents` - Access to Google Docs

## Frontend Integration

### Using the TemplatePicker Component

```jsx
import TemplatePicker from '../components/TemplatePicker';

<TemplatePicker
  onTemplateSelected={(template) => {
    // template contains: { id, name, mimeType, url, accessToken }
    createDraft(template);
  }}
  buttonText="Select Template"
/>
```

### Using the DraftEditor Page

```jsx
// Route configuration
<Route path="/draft/:draftId" element={<DraftEditorPage />} />
<Route path="/draft/new" element={<DraftEditorPage />} />

// Navigate to create new draft
navigate('/draft/new');

// Navigate to edit existing draft
navigate(`/draft/${draftId}`);
```

## Gateway Configuration

Add the drafting service route to your gateway:

```javascript
// gateway-service/src/routes/draftingRoutes.js
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const router = express.Router();

router.use('/', createProxyMiddleware({
  target: process.env.DRAFTING_SERVICE_URL || 'http://localhost:5005',
  changeOrigin: true,
  pathRewrite: { '^/drafting': '' }
}));

module.exports = router;
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│  Gateway Service │────▶│ Drafting Service│
│  (React/Vite)   │     │    (Express)     │     │   (Express)     │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
        │                                                  │
        │                                                  ▼
        │                                        ┌─────────────────┐
        │                                        │   Draft_Db      │
        │                                        │  (PostgreSQL)   │
        └───────────────────────────────────────▶└─────────────────┘
                     Google APIs                          │
                  (Drive & Docs)                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  Google Drive   │
                                                 │ (User's Files)  │
                                                 └─────────────────┘
```

## License

Internal use only.

