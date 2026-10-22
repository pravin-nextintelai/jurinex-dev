# Google Docs to GCS Sync Flow Documentation

## Overview

This system implements a complete file synchronization flow between Google Docs and Google Cloud Storage (GCS), with automatic real-time updates via webhooks.

## Data Flow

### Step 1: Capture ID (Draft Creation)
When a draft is created:
- `google_file_id` is captured and saved to database
- File is automatically shared with Service Account
- Metadata is stored: `user_id`, `title`, `status`, `editor_type`

### Step 2: Initial Sync (Open Event)
When a document is opened via `GET /api/drafts/:id/open`:

1. **Export Google Doc**: Uses `drive.files.export` to convert Google Doc to `.docx`
2. **Upload to GCS**: Streams exported bytes directly to `gcs_path`
3. **Create gcs_path if needed**: If draft doesn't have a `gcs_path`, creates one automatically
4. **Set Status**: Updates `last_synced_at` timestamp
5. **Setup Webhook**: Registers a webhook watcher for real-time updates

**Code Location**: `controllers/draftController.js` → `openDocumentForEditing()`

### Step 3: Monitor (Webhook Registration)
When document is opened, a webhook is automatically registered:

- **Method**: `drive.files.watch()` API
- **Channel ID**: Unique identifier for this webhook
- **Webhook URL**: `{WEBHOOK_BASE_URL}/drafting/api/webhooks/google-drive`
- **Expiration**: 7 days (renewed automatically on open)
- **Resource ID**: Google Drive file ID

**Code Location**: `services/driveWebhookService.js` → `setupDriveWatcher()`

### Step 4: Real-time Update (Edit Event)
When Google Docs detects a change:

1. **Webhook Trigger**: Google sends POST to webhook endpoint
2. **Immediate Response**: Server returns 200 OK immediately
3. **Debouncing**: Waits for 5-second "quiet period" to avoid excessive exports
4. **Export & Sync**: After quiet period, exports and overwrites file at same `gcs_path`
5. **Update Timestamp**: Updates `last_synced_at` in database

**Code Location**: `controllers/webhookController.js` → `handleGoogleDriveWebhook()`

## Implementation Details

### Initial Export (Open Event)

```javascript
// When document is opened
1. Export Google Doc → .docx format
2. Create gcs_path if doesn't exist: uploads/{userId}/{timestamp}_{filename}.docx
3. Upload to GCS at gcs_path
4. Update last_synced_at
5. Setup webhook watcher
```

### Debouncing Logic

To avoid exporting 100 times while someone is typing:

```javascript
// Quiet Period: 5 seconds
const QUIET_PERIOD_MS = 5000;

// When webhook is received:
1. Cancel any pending sync for this file
2. Schedule new sync after 5 seconds
3. If another edit comes within 5 seconds, cancel and reschedule
4. After 5 seconds of no edits, perform the sync
```

This ensures:
- ✅ No excessive API calls during active editing
- ✅ File is synced after user stops typing
- ✅ Efficient resource usage

### Webhook Handler Flow

```
Google Drive detects change
    ↓
POST to /api/webhooks/google-drive
    ↓
Return 200 OK immediately (acknowledge receipt)
    ↓
(Async) Extract google_file_id from headers
    ↓
(Async) Find draft in database
    ↓
(Async) Cancel any pending sync for this file
    ↓
(Async) Schedule new sync after 5 seconds
    ↓
(Wait 5 seconds - quiet period)
    ↓
(If no new edits) Export Google Doc as .docx
    ↓
(Async) Overwrite file in GCS at gcs_path
    ↓
(Async) Update last_synced_at timestamp
```

## API Endpoints

### Open Document (Triggers Initial Sync)
```
GET /api/drafts/:id/open
```
- Exports document to GCS immediately
- Sets up webhook watcher
- Returns editor URL

### Manual Sync
```
POST /api/drafts/:draftId/sync
Body: { format: 'docx' }
```
- Manually triggers export and sync
- Useful for forcing immediate sync

### Webhook Endpoint
```
POST /api/webhooks/google-drive
Headers:
  - x-goog-resource-id: Google file ID
  - x-goog-resource-state: 'update' or 'sync'
```
- Called by Google Drive when file changes
- Returns 200 immediately
- Processes sync asynchronously with debouncing

## Database Schema

```sql
drafts (
  id,
  user_id,
  title,
  google_file_id,      -- Google Drive file ID
  gcs_path,            -- Path in GCS bucket (e.g., uploads/3/123456_doc.docx)
  last_synced_at,      -- Timestamp of last sync
  status,
  editor_type,
  drive_item_id,
  drive_path,
  last_opened_at       -- Timestamp when document was opened
)
```

## Error Handling

### File Not Found
If Service Account can't access file:
- Error: "File not found in Google Drive"
- Solution: File must be shared with Service Account email
- Auto-fix: New drafts are automatically shared

### Missing gcs_path
If draft doesn't have `gcs_path`:
- Auto-creates: `uploads/{userId}/{timestamp}_{filename}.docx`
- Updates database with new path
- Continues with sync

### Webhook Failures
- Non-blocking: Errors are logged but don't prevent document opening
- Retry: Webhook is re-registered on next open
- Monitoring: All errors are logged for debugging

## Configuration

### Environment Variables

```env
# Service Account (required)
GCS_KEY_BASE64=<base64-encoded-service-account-json>

# GCS Bucket (required)
GCS_BUCKET=<your-bucket-name>

# Webhook URL (required for real-time sync)
WEBHOOK_BASE_URL=https://your-domain.com
# Or use GATEWAY_URL
GATEWAY_URL=https://your-domain.com
```

### Quiet Period Configuration

Default: 5 seconds
- Can be adjusted in `webhookController.js`
- `const QUIET_PERIOD_MS = 5000;`
- Recommended: 3-10 seconds depending on use case

## Benefits

✅ **Automatic**: No user action needed - edits auto-sync
✅ **Real-Time**: Syncs within seconds of editing
✅ **Efficient**: Debouncing prevents excessive API calls
✅ **Reliable**: Uses Service Account (no OAuth issues)
✅ **Consistent**: Always overwrites at same `gcs_path`
✅ **Initial Sync**: Exports immediately when opened

## Testing

### Test Initial Sync
1. Open a document: `GET /api/drafts/:id/open`
2. Check logs for: "Initial export completed"
3. Verify file exists in GCS at `gcs_path`

### Test Webhook Sync
1. Open document in Google Docs
2. Make an edit
3. Wait 5+ seconds
4. Check logs for: "Successfully synced draft X to GCS"
5. Verify file in GCS is updated

### Test Debouncing
1. Open document
2. Make rapid edits (type quickly)
3. Check logs: Should see "Cancelled pending sync" messages
4. After stopping, wait 5 seconds
5. Should see one final sync (not 100 syncs)

## Summary

This implementation provides:
- ✅ Initial export when document is opened
- ✅ Real-time sync via webhooks with debouncing
- ✅ Automatic `gcs_path` creation
- ✅ Efficient resource usage
- ✅ Reliable Service Account authentication

The system ensures that every Google Doc is automatically stored in GCS, with updates synced in real-time after a quiet period to avoid excessive API calls.


