# Google Drive Webhooks Implementation

## Overview

This system implements real-time synchronization from Google Docs to Google Cloud Storage (GCS) using Google Drive Push Notifications (Webhooks).

## Architecture

1. **Webhook Endpoint**: Receives notifications from Google Drive
2. **Watcher Setup**: Registers webhooks for specific documents
3. **Sync Service**: Exports Google Docs and overwrites files in GCS

## Components

### 1. Webhook Endpoint

**Route:** `POST /api/webhooks/google-drive`

**Headers from Google:**
- `x-goog-resource-id`: The Google Drive file ID (google_file_id)
- `x-goog-resource-state`: The state (`sync`, `update`, etc.)
- `x-goog-resource-uri`: The resource URI
- `x-goog-channel-id`: The channel ID
- `x-goog-channel-expiration`: The expiration time

**Behavior:**
- Returns `200 OK` immediately to acknowledge receipt
- Processes webhook asynchronously to avoid Google retries
- Ignores `sync` state (initial test message)
- Only processes `update` state
- Looks up `gcs_path` from database using `google_file_id`
- Calls sync function to export and overwrite file in GCS

### 2. Watcher Setup

**Route:** `POST /api/drafts/:draftId/watch`

**Function:** `setupDriveWatcher(googleFileId, draftId, webhookUrl)`

**What it does:**
- Calls `drive.files.watch` to register webhook
- Generates unique channel ID
- Sets expiration (default: 7 days, max allowed)
- Returns channel info with expiration time
- Stores expiration in database (optional, for renewal tracking)

**Request:**
```json
{
  "webhookUrl": "https://your-domain.com/drafting/api/webhooks/google-drive" // Optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook watcher registered successfully",
  "watcher": {
    "channelId": "webhook-123-1234567890",
    "resourceId": "abc123...",
    "expiration": "2024-01-22T10:30:00.000Z",
    "webhookUrl": "https://your-domain.com/drafting/api/webhooks/google-drive"
  },
  "note": "Watcher will expire on 2024-01-22T10:30:00.000Z. Renew before expiration."
}
```

### 3. Stop Watcher

**Route:** `DELETE /api/drafts/:draftId/watch`

**Body:**
```json
{
  "channelId": "webhook-123-1234567890",
  "resourceId": "abc123..."
}
```

## Sync Logic

When a webhook is received with `update` state:

1. Extract `x-goog-resource-id` (this is the `google_file_id`)
2. Look up the draft in database using `google_file_id`
3. Get the `gcs_path` from the database
4. Export Google Doc using `drive.files.export` with `.docx` mimeType
5. Overwrite file in GCS using `bucket.file(gcs_path).save()`
6. Update `last_synced_at` in database

## Setup Instructions

### 1. Environment Variables

Add to your `.env`:

```env
# Webhook URL (your public domain)
WEBHOOK_BASE_URL=https://your-domain.com
# Or use GATEWAY_URL if you have one
GATEWAY_URL=https://your-domain.com

# Service Account (already configured)
GCS_KEY_BASE64=<your-base64-key>
GCS_BUCKET=<your-bucket-name>
```

### 2. Make Webhook Endpoint Publicly Accessible

The webhook endpoint must be:
- Publicly accessible (HTTPS recommended)
- Returns 200/204 status immediately
- Can receive POST requests from Google

### 3. Setup Watcher for a Draft

After creating a draft, setup the watcher:

```bash
POST /api/drafts/:draftId/watch
Authorization: Bearer <token>

{
  "webhookUrl": "https://your-domain.com/drafting/api/webhooks/google-drive"
}
```

### 4. Renew Watchers

Watchers expire after 7 days (maximum allowed by Google). You need to:

1. Track expiration times (store in database)
2. Set up a cron job to renew watchers before expiration
3. Call `setupDriveWatcher` again before expiration

## Example Usage

### Setup Watcher After Creating Draft

```javascript
// After creating a draft
const draft = await createDraft(...);

// Setup webhook watcher
const response = await fetch(`/api/drafts/${draft.id}/watch`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    webhookUrl: 'https://your-domain.com/drafting/api/webhooks/google-drive'
  })
});

const watcherInfo = await response.json();
console.log('Watcher expires:', watcherInfo.watcher.expiration);
```

### Automatic Watcher Renewal (Cron Job)

```javascript
// Run daily to check and renew expiring watchers
const renewExpiringWatchers = async () => {
  const drafts = await Draft.findByUserId(userId);
  
  for (const draft of drafts) {
    if (draft.webhook_expires_at) {
      const expirationDate = new Date(draft.webhook_expires_at);
      const daysUntilExpiration = (expirationDate - new Date()) / (1000 * 60 * 60 * 24);
      
      // Renew if expiring within 1 day
      if (daysUntilExpiration < 1) {
        await setupDriveWatcher(
          draft.google_file_id,
          draft.id,
          webhookUrl
        );
      }
    }
  }
};
```

## Webhook Flow Diagram

```
User edits Google Doc
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
(Async) Overwrite file in GCS at gcs_path
    ↓
(Async) Update last_synced_at in database
```

## Important Notes

1. **Immediate Response**: Webhook must return 200/204 immediately to prevent Google retries
2. **Async Processing**: All sync logic runs asynchronously after response
3. **Sync State**: Ignore `sync` state (it's just Google's initial test)
4. **Expiration**: Watchers expire after 7 days - must be renewed
5. **Service Account**: Uses Service Account authentication (no OAuth2)
6. **Error Handling**: Errors are logged but don't cause webhook to fail (already returned 200)

## Testing

### Test Webhook Locally (using ngrok)

1. Install ngrok: `npm install -g ngrok`
2. Start your server: `npm start`
3. Expose webhook: `ngrok http 5005`
4. Use ngrok URL in `setupDriveWatcher`: `https://abc123.ngrok.io/drafting/api/webhooks/google-drive`
5. Edit a Google Doc and watch for webhook calls

### Manual Webhook Test

```bash
curl -X POST https://your-domain.com/drafting/api/webhooks/google-drive \
  -H "x-goog-resource-id: YOUR_GOOGLE_FILE_ID" \
  -H "x-goog-resource-state: update" \
  -H "x-goog-channel-id: test-channel" \
  -H "Content-Type: application/json"
```

## Troubleshooting

### Webhook Not Receiving Notifications

1. Check webhook URL is publicly accessible
2. Verify watcher is set up: Check database for watcher info
3. Check watcher expiration: Renew if expired
4. Verify Service Account has Drive API access

### Sync Not Working

1. Check logs for sync errors
2. Verify `gcs_path` exists in database
3. Check Service Account permissions for GCS
4. Verify Drive API export permissions

### Watcher Expiration

- Maximum expiration: 7 days
- Set up cron job to renew before expiration
- Store expiration time in database for tracking


