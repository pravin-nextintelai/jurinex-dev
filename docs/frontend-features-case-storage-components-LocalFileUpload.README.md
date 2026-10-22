# LocalFileUpload Component

A React component for uploading files from local computer following the complete flow:
**Local → GCS → Google Drive (converted to Google Docs) → Database**

## Features

- ✅ Drag and drop file upload
- ✅ File size validation
- ✅ File type validation
- ✅ Upload progress indicator
- ✅ Automatic conversion to Google Docs
- ✅ Direct link to open in Google Docs editor
- ✅ Error handling with user-friendly messages
- ✅ Success callbacks

## Usage

### Basic Usage

```jsx
import LocalFileUpload from './components/LocalFileUpload';

function MyComponent() {
  const handleUploadSuccess = (draft, editorUrl) => {
    console.log('Upload successful!', draft);
    console.log('Editor URL:', editorUrl);
  };

  const handleUploadError = (error) => {
    console.error('Upload failed:', error);
  };

  return (
    <LocalFileUpload
      onUploadSuccess={handleUploadSuccess}
      onUploadError={handleUploadError}
    />
  );
}
```

### With Custom Configuration

```jsx
<LocalFileUpload
  onUploadSuccess={(draft, editorUrl) => {
    // Handle success
    console.log('Draft created:', draft);
    // Redirect to editor
    window.open(editorUrl, '_blank');
  }}
  onUploadError={(error) => {
    // Handle error
    console.error('Error:', error);
  }}
  maxFileSize={50 * 1024 * 1024} // 50MB
  acceptedFormats={[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'text/plain', // .txt
  ]}
  showEditorButton={true}
  className="my-custom-class"
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onUploadSuccess` | `(draft, editorUrl) => void` | `undefined` | Callback when upload succeeds. Receives draft object and editor URL. |
| `onUploadError` | `(error) => void` | `undefined` | Callback when upload fails. Receives error object. |
| `maxFileSize` | `number` | `100 * 1024 * 1024` (100MB) | Maximum file size in bytes. |
| `acceptedFormats` | `string[]` | Common document formats | Array of MIME types to accept. |
| `className` | `string` | `''` | Additional CSS classes for the container. |
| `showEditorButton` | `boolean` | `true` | Whether to show "Open in Google Docs" button after upload. |

## Default Accepted Formats

- `.docx` - Microsoft Word (OpenXML)
- `.doc` - Microsoft Word (Legacy)
- `.pdf` - PDF
- `.txt` - Plain text
- `.rtf` - Rich Text Format
- `.html` - HTML

## Upload Flow

1. **User selects file** from local computer
2. **File validation** (size and type)
3. **Upload to GCS** - File is uploaded to Google Cloud Storage
4. **Convert to Google Docs** - File is converted to Google Docs format
5. **Save to Database** - All IDs and paths are saved:
   - `google_file_id` - Google Drive file ID
   - `gcs_path` - Path in GCS bucket
   - `drive_item_id` - Same as google_file_id
   - `drive_path` - Path in Google Drive
   - `last_synced_at` - Initial sync timestamp

## Response Format

On successful upload, the component receives:

```javascript
{
  success: true,
  message: "File uploaded successfully to GCS and Google Drive",
  draft: {
    id: 1,
    user_id: 123,
    title: "My Document",
    google_file_id: "1a2b3c4d5e6f7g8h9i0j",
    drive_item_id: "1a2b3c4d5e6f7g8h9i0j",
    gcs_path: "uploads/123/1234567890_My_Document.docx",
    drive_path: "/My Document",
    last_synced_at: "2024-01-15T10:30:00Z",
    status: "active",
    editor_type: "google"
  },
  editorUrl: "https://docs.google.com/document/d/1a2b3c4d5e6f7g8h9i0j/edit"
}
```

## Error Handling

The component handles various error scenarios:

- **File size exceeded**: Shows error message with max size
- **Unsupported file type**: Shows error with accepted formats
- **Google Drive not connected**: Shows message to connect Google Drive
- **Authentication required**: Shows message to log in
- **Network errors**: Shows generic error message

All errors are also displayed via toast notifications.

## Styling

The component uses Tailwind CSS classes. You can customize it by:

1. Passing `className` prop for container styling
2. Overriding Tailwind classes in your global CSS
3. Using CSS modules or styled-components

## Example Integration

See `LocalFileUploadExample.jsx` for a complete example with:
- Success handling
- Error handling
- List of uploaded documents
- Direct links to Google Docs editor

## API Endpoint

The component uses the following endpoint:
- **POST** `${DRAFTING_SERVICE_URL}/api/drafts/upload`
- **Headers**: `Authorization: Bearer <token>`
- **Body**: `FormData` with `file` field

## Requirements

- User must be authenticated (token in localStorage or sessionStorage)
- User must have Google Drive connected
- Backend service must be running and accessible


