# Storing Edited Files to GCS Bucket

## Overview

This system automatically stores edited Google Docs files to your GCS bucket in real-time using webhooks, and also provides manual sync options.

## How It Works

### Automatic Sync (Real-Time)

When a user edits a Google Doc, the system automatically:

1. **Webhook Trigger**: Google Drive sends a webhook notification
2. **Extract File ID**: System gets `google_file_id` from webhook headers
3. **Lookup GCS Path**: Finds the corresponding `gcs_path` in database
4. **Export Document**: Exports Google Doc as `.docx` using Drive API
5. **Save to GCS**: Overwrites the file at the existing `gcs_path` in GCS bucket
6. **Update Timestamp**: Updates `last_synced_at` in database

**No user action required** - happens automatically in the background!

### Manual Sync (On-Demand)

Users can also manually trigger a sync:

**Endpoint:** `POST /api/drafts/:draftId/sync`

**Request:**
```json
{
  "format": "docx"  // Optional: "docx" or "pdf" (default: "docx")
}
```

**Response:**
```json
{
  "success": true,
  "message": "Document saved to GCS successfully",
  "gcsPath": "uploads/3/1768375700722_Project_proposal.docx",
  "syncedAt": "2024-01-15T10:30:00Z",
  "draftId": 123,
  "exportFormat": "docx"
}
```

## Automatic Webhook Setup

The system automatically sets up webhooks when:

1. **File Upload**: When a file is uploaded via `/api/drafts/upload`
2. **Draft Creation**: When a draft is created from a template
3. **Document Opening**: When a document is opened for editing

This ensures that **every edited file is automatically saved to GCS** without any user action.

## Webhook Flow

```
User edits Google Doc in browser
    ↓
Google Drive detects change
    ↓
Google sends POST to /api/webhooks/google-drive
    ↓
Webhook returns 200 OK immediately
    ↓
(Async) Extract google_file_id from x-goog-resource-id
    ↓
(Async) Look up gcs_path in database
    ↓
(Async) Export Google Doc as .docx
    ↓
(Async) Save to GCS at gcs_path (overwrites existing file)
    ↓
(Async) Update last_synced_at timestamp
```

## Database Schema

The system uses these fields:

- `google_file_id` - Google Drive file ID (used to identify the file)
- `gcs_path` - Path in GCS bucket (where file is stored/overwritten)
- `last_synced_at` - Timestamp of last sync

## Key Features

✅ **Automatic**: No user action needed - edits are auto-saved
✅ **Real-Time**: Sync happens within seconds of editing
✅ **Overwrites**: Uses the same `gcs_path` - no duplicates
✅ **Service Account**: Uses Service Account auth (no OAuth2 issues)
✅ **Reliable**: Webhook returns 200 immediately, processes async

## Manual Save Button (Frontend)

You can add a "Save to GCS" button in your UI:

```javascript
const saveToGCS = async (draftId) => {
  try {
    const response = await fetch(`/api/drafts/${draftId}/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ format: 'docx' })
    });
    
    const result = await response.json();
    if (result.success) {
      toast.success('Document saved to GCS!');
      console.log('Saved to:', result.gcsPath);
    }
  } catch (error) {
    toast.error('Failed to save document');
  }
};
```

## Verification

To verify files are being stored:

1. **Check Database**: Query `last_synced_at` to see when files were last synced
2. **Check GCS**: List files in your bucket at the `gcs_path`
3. **Check Logs**: Look for `[Webhook] ✅ Successfully synced` messages

## Troubleshooting

### Files Not Syncing Automatically

1. **Check Webhook Setup**: Verify watcher is set up (check logs for "Webhook watcher set up")
2. **Check Webhook URL**: Ensure `WEBHOOK_BASE_URL` is set correctly
3. **Check Expiration**: Webhooks expire after 7 days - may need renewal
4. **Check Logs**: Look for webhook errors in server logs

### Manual Sync Not Working

1. **Check GCS Path**: Ensure draft has a `gcs_path` in database
2. **Check Service Account**: Verify `GCS_KEY_BASE64` is set correctly
3. **Check Permissions**: Ensure Service Account has Drive API and GCS permissions

## Environment Variables

```env
# Service Account (required)
GCS_KEY_BASE64=<base64-encoded-service-account-json>

# GCS Bucket (required)
GCS_BUCKET=<your-bucket-name>

# Webhook URL (required for automatic sync)
WEBHOOK_BASE_URL=https://your-domain.com
# Or use GATEWAY_URL
GATEWAY_URL=https://your-domain.com
```

## Summary

- ✅ **Automatic**: Webhooks automatically save edited files to GCS
- ✅ **Manual**: Users can click "Save" to sync immediately
- ✅ **Reliable**: Uses Service Account (no auth issues)
- ✅ **Efficient**: Overwrites at same path (no duplicates)

Your edited files are automatically stored to GCS bucket! 🎉


