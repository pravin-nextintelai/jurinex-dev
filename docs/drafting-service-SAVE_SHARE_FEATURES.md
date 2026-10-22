# Save, Share & Open Another Document Features

## ✅ Features Added

### 1. **Save Document to GCS**
- **Button**: "Save" button in the header
- **Functionality**: Exports the Google Doc to PDF and saves it to Google Cloud Storage
- **Endpoint**: `POST /api/drafts/:draftId/sync`
- **Usage**: Click "Save" button to export and save the current document

### 2. **Share Document**
- **Button**: "Share" button in the header
- **Functionality**: Share the Google Doc with another user via email
- **Endpoint**: `POST /api/drafts/:draftId/share`
- **Features**:
  - Enter email address
  - Select permission level (Viewer, Commenter, Editor)
  - Share button opens a modal dialog

### 3. **Open Another Document**
- **Button**: "Open Another" button in the header
- **Functionality**: Navigate back to the drafts list to select/open another document
- **Action**: Navigates to `/drafts` page

## 📋 API Endpoints

### Save to GCS
```
POST /api/drafts/:draftId/sync
Headers:
  Authorization: Bearer YOUR_JWT_TOKEN
Body:
{
  "format": "pdf"  // or "docx"
}
```

### Share Document
```
POST /api/drafts/:draftId/share
Headers:
  Authorization: Bearer YOUR_JWT_TOKEN
Body:
{
  "googleAccessToken": "ya29.a0AfH6SMC...",
  "email": "user@example.com",
  "role": "writer"  // "reader", "commenter", or "writer"
}
```

## 🎨 UI Layout

The header now includes:
- **Left Side**: Back button + Document title
- **Right Side**: Save | Share | Open Another buttons

The Google Docs iframe takes up the full remaining screen space, showing the complete native Google Docs interface.

## 🔧 How It Works

### Save Flow:
1. User clicks "Save" button
2. Frontend calls `POST /api/drafts/:draftId/sync`
3. Backend exports Google Doc to PDF using Drive API
4. PDF is streamed to GCS bucket
5. Database is updated with `gcs_path` and `last_synced_at`
6. Success message shown to user

### Share Flow:
1. User clicks "Share" button
2. Modal opens with email input and permission selector
3. User enters email and selects permission level
4. Frontend calls `POST /api/drafts/:draftId/share`
5. Backend grants permission to the email via Drive API
6. Success message shown to user

### Open Another Flow:
1. User clicks "Open Another" button
2. Navigates to `/drafts` page
3. User can select/create another draft

## 📝 Notes

- **Permissions**: When a file is copied, the user automatically becomes the owner, so they have full edit access
- **GCS Bucket**: Make sure `GCS_BUCKET` environment variable is set
- **Google OAuth**: Share requires a valid Google access token with Drive API permissions

