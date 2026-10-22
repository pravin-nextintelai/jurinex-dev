# File Synchronization System Documentation

## Overview

This system provides bidirectional synchronization between Google Cloud Storage (GCS) and Google Drive, allowing users to upload files, edit them in Google Docs, and keep them synchronized.

## Database Schema

The `drafts` table includes the following fields:

- `id` - Auto-incrementing primary key
- `user_id` - User ID (INT)
- `title` - Document title
- `google_file_id` - Google Drive file ID (unique)
- `gcs_path` - Path to file in GCS bucket
- `last_synced_at` - Timestamp of last sync from Drive to GCS
- `status` - Draft status (active, archived, etc.)
- `editor_type` - Editor type (google, local, etc.)
- `drive_item_id` - Google Drive item ID (same as google_file_id)
- `drive_path` - Path in Google Drive
- `last_opened_at` - Timestamp when document was last opened

## Flow Overview

### 1. Initial Upload Flow

**Endpoint:** `POST /api/drafts/upload`

**Flow:**
1. User uploads file from local computer
2. File is uploaded to GCS bucket
3. File is downloaded from GCS and uploaded to Google Drive
4. File is converted to Google Docs format (if supported)
5. All IDs and paths are saved to database

**Request:**
```bash
POST /api/drafts/upload
Content-Type: multipart/form-data
Authorization: Bearer <JWT_TOKEN>

Form Data:
- file: <file>
```

**Response:**
```json
{
  "success": true,
  "message": "File uploaded successfully to GCS and Google Drive",
  "draft": {
    "id": 1,
    "user_id": 123,
    "title": "My Document",
    "google_file_id": "1a2b3c4d5e6f7g8h9i0j",
    "drive_item_id": "1a2b3c4d5e6f7g8h9i0j",
    "gcs_path": "uploads/123/1234567890_My_Document.docx",
    "drive_path": "/My Document",
    "last_synced_at": "2024-01-15T10:30:00Z",
    "status": "active",
    "editor_type": "google"
  },
  "editorUrl": "https://docs.google.com/document/d/1a2b3c4d5e6f7g8h9i0j/edit"
}
```

### 2. Sync Logic

**Endpoint:** `POST /api/drafts/sync-drive-to-gcs`

**Function:** `syncDriveToGCS(google_file_id)`

**Flow:**
1. Look up the `gcs_path` associated with `google_file_id`
2. Use Google Drive API to export the current version of the Google Doc (default: .docx format)
3. Upload the exported content back to GCS, overwriting the file at the existing `gcs_path`
4. Update the `last_synced_at` timestamp in the database

**Request:**
```bash
POST /api/drafts/sync-drive-to-gcs
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

{
  "google_file_id": "1a2b3c4d5e6f7g8h9i0j",
  "exportFormat": "docx"  // Optional: "docx" or "pdf" (default: "docx")
}
```

**Response:**
```json
{
  "success": true,
  "message": "File synced successfully from Google Drive to GCS",
  "draftId": 1,
  "google_file_id": "1a2b3c4d5e6f7g8h9i0j",
  "gcsPath": "uploads/123/1234567890_My_Document.docx",
  "signedUrl": "https://storage.googleapis.com/...",
  "exportFormat": "docx",
  "syncedAt": "2024-01-15T11:00:00Z"
}
```

### 3. Editing Flow

**Endpoint:** `GET /api/drafts/:id/open`

**Flow:**
1. User requests to open a document
2. System looks up the `google_file_id` from the database
3. Updates `last_opened_at` timestamp
4. Returns Google Docs editor URL for redirection

**Request:**
```bash
GET /api/drafts/1/open
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{
  "success": true,
  "editorUrl": "https://docs.google.com/document/d/1a2b3c4d5e6f7g8h9i0j/edit",
  "google_file_id": "1a2b3c4d5e6f7g8h9i0j",
  "message": "Document ready for editing"
}
```

## How to Trigger syncDriveToGCS

### Option 1: Via API Endpoint (Recommended)

Call the sync endpoint when the user clicks a "Save" button in your UI:

```javascript
// Frontend example
const syncDocument = async (googleFileId) => {
  try {
    const response = await fetch('/api/drafts/sync-drive-to-gcs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        google_file_id: googleFileId,
        exportFormat: 'docx'
      })
    });
    
    const result = await response.json();
    if (result.success) {
      console.log('Document synced successfully!');
    }
  } catch (error) {
    console.error('Sync failed:', error);
  }
};
```

### Option 2: Via Webhook (Google Drive Push Notifications)

You can set up Google Drive push notifications to automatically trigger sync when a document is modified:

1. **Set up a webhook endpoint** in your application:
   ```javascript
   // POST /api/drafts/webhook/drive-change
   // This endpoint receives notifications from Google Drive
   ```

2. **Subscribe to Drive changes** using the Google Drive API:
   ```javascript
   const drive = google.drive({ version: 'v3', auth: oauth2Client });
   
   await drive.changes.watch({
     requestBody: {
       id: 'unique-channel-id',
       type: 'web_hook',
       address: 'https://your-domain.com/api/drafts/webhook/drive-change'
     }
   });
   ```

3. **Handle the webhook** and trigger sync:
   ```javascript
   // When webhook is received
   const { google_file_id } = webhookData;
   await syncDriveToGCS(google_file_id);
   ```

### Option 3: Scheduled Sync (Cron Job)

Set up a periodic sync for all documents:

```javascript
// Run every hour
const syncAllDocuments = async () => {
  const drafts = await Draft.findByUserId(userId);
  
  for (const draft of drafts) {
    if (draft.google_file_id && draft.gcs_path) {
      try {
        await syncDriveToGCS(draft.google_file_id);
      } catch (error) {
        console.error(`Failed to sync draft ${draft.id}:`, error);
      }
    }
  }
};
```

## Technical Requirements

### Dependencies

- `googleapis` - Google Drive API v3
- `@google-cloud/storage` - Google Cloud Storage Client Library
- `multer` - For handling file uploads

### Environment Variables

```env
GCS_BUCKET=draft_templates
GCS_BUCKET_NAME=draft_templates
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
AUTH_SERVICE_URL=http://localhost:5001
```

### Supported File Formats for Conversion

The system automatically converts the following formats to Google Docs:

- `.docx` - Microsoft Word (OpenXML)
- `.doc` - Microsoft Word (Legacy)
- `.pdf` - PDF (converted but not editable)
- `.txt` - Plain text
- `.rtf` - Rich Text Format
- `.html` - HTML

## Error Handling

The system handles various error scenarios:

- **Google Drive not connected**: Returns 401 with `needsAuth: true`
- **Token expired**: Returns 401 with reconnection message
- **Quota exceeded**: Returns 429 with appropriate message
- **Permission denied**: Returns 403
- **File not found**: Returns 404
- **Missing GCS path**: Returns 400

## Example Frontend Integration

```javascript
// Upload file
const uploadFile = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch('/api/drafts/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  return await response.json();
};

// Open document for editing
const openDocument = async (draftId) => {
  const response = await fetch(`/api/drafts/${draftId}/open`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const { editorUrl } = await response.json();
  window.open(editorUrl, '_blank');
};

// Sync document (Save button)
const saveDocument = async (googleFileId) => {
  const response = await fetch('/api/drafts/sync-drive-to-gcs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      google_file_id: googleFileId,
      exportFormat: 'docx'
    })
  });
  
  return await response.json();
};
```

## Database Migration

Run the migration to add the new fields:

```bash
psql -d your_database -f Backend/drafting-service/db/migrations/003_add_sync_fields.sql
```

## Notes

- The `gcs_path` remains constant throughout the document's lifecycle
- Files are overwritten in GCS during sync (not duplicated)
- The system uses the existing `gcs_path` to maintain file location consistency
- Export format defaults to `.docx` for better compatibility
- The `last_synced_at` timestamp is updated on every successful sync


