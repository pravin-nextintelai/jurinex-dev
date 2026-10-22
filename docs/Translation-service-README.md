# Translation Service

A backend service for document translation using Google Cloud Translation API and Document AI. The service automatically detects whether a document is digital native (text-based) or scanned, and processes it accordingly.

## Features

- **Automatic File Detection**: Detects if a document is digital native or scanned
- **Digital Native Documents**: Uses Google Cloud Translation API directly (preserves format)
- **Scanned Documents**: Uses Google Cloud Document AI to extract text, then translates it
- **Asynchronous Processing**: Handles large documents (up to 500+ pages) efficiently with job queue
- **Format Preservation**: Maintains original document format for digital native files
- **Production Ready**: 
  - Job queue system for async processing
  - Progress tracking for long-running jobs
  - Comprehensive logging with Winston
  - Rate limiting
  - Error handling and recovery
  - Optimized for large files with chunked processing

## Prerequisites

- Node.js (v14 or higher)
- Google Cloud Project with the following APIs enabled:
  - Cloud Translation API
  - Document AI API
- Service Account with appropriate permissions
- Service Account JSON key file

## Installation

1. Clone the repository and navigate to the project directory

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
# Google Cloud Configuration
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=path/to/your/service-account-key.json

# Google Cloud Translation API
TRANSLATION_API_LOCATION=global

# Google Cloud Document AI
DOCUMENT_AI_PROCESSOR_ID=your-processor-id
DOCUMENT_AI_LOCATION=us

# Server Configuration
PORT=3000
NODE_ENV=development

# File Upload Configuration
MAX_FILE_SIZE=104857600
UPLOAD_DIR=./uploads

# Job Queue Configuration
MAX_CONCURRENT_JOBS=3
```

4. Set up Google Cloud:
   - Enable Cloud Translation API
   - Enable Document AI API
   - Create a Document AI processor
   - Create a service account and download the JSON key
   - Update the `.env` file with your credentials

## Usage

### Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

### API Endpoints

#### 1. Health Check
```
GET /api/translation/health
```

#### 2. Translate Document (Async)
```
POST /api/translation/translate
Content-Type: multipart/form-data

Body:
- document: (file) The document to translate
- targetLanguage: (string) Target language code (e.g., 'en', 'es', 'fr')
- sourceLanguage: (string, optional) Source language code
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Translation job submitted successfully",
  "data": {
    "jobId": "job-1234567890-abc123",
    "status": "pending",
    "progress": 0,
    "statusUrl": "/api/translation/status/job-1234567890-abc123",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

Example using curl:
```bash
curl -X POST http://localhost:3000/api/translation/translate \
  -F "document=@/path/to/document.pdf" \
  -F "targetLanguage=es" \
  -F "sourceLanguage=en"
```

#### 3. Get Job Status
```
GET /api/translation/status/:jobId
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "job-1234567890-abc123",
    "status": "processing",
    "progress": 45,
    "message": "Translating document...",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:05.000Z",
    "fileType": "digital-native-pdf",
    "isDigitalNative": true,
    "targetLanguage": "es",
    "sourceLanguage": "en",
    "translatedFile": "translated-1234567890-document.pdf",
    "downloadUrl": "/api/translation/download/translated-1234567890-document.pdf"
  }
}
```

**Job Status Values:**
- `pending`: Job is queued, waiting to be processed
- `processing`: Job is currently being processed
- `completed`: Job completed successfully
- `failed`: Job failed (check error field)

#### 4. Download Translated Document
```
GET /api/translation/download/:filename
```

## Supported File Types

### Digital Native Formats:
- PDF (text-based)
- Microsoft Word (.doc, .docx)
- Microsoft Excel (.xls, .xlsx)
- Microsoft PowerPoint (.ppt, .pptx)
- Plain text (.txt)
- HTML
- CSV
- RTF

### Scanned/Image Formats:
- JPEG/JPG
- PNG
- TIFF
- BMP
- PDF (scanned/image-based)

## How It Works

1. **File Upload**: User uploads a document (supports up to 500+ pages)
2. **Job Creation**: System creates an async job and returns job ID immediately
3. **File Detection**: System detects if the file is digital native or scanned
4. **Processing** (handled asynchronously):
   - **Digital Native**: 
     - Direct translation using Cloud Translation API (preserves format)
     - For large files (>10MB), uses optimized batch processing
   - **Scanned**: 
     - Extract text using Document AI
     - For large text, splits into chunks and translates in parallel
     - Translate extracted text using Translation API
5. **Progress Tracking**: Job status and progress are updated throughout processing
6. **Completion**: User polls job status or receives notification when complete
7. **Download**: User downloads translated document using provided URL

## Performance Optimizations

- **Async Job Queue**: Non-blocking processing allows handling multiple large documents simultaneously
- **Chunked Processing**: Large text is split into manageable chunks and processed in parallel
- **Concurrent Jobs**: Configurable number of concurrent translation jobs (default: 3)
- **Memory Optimization**: Efficient handling of large files without loading entire document into memory
- **Progress Tracking**: Real-time progress updates for long-running translations

## Error Handling

The service includes comprehensive error handling:
- File type validation
- Size limit enforcement (default: 100MB, configurable)
- Google Cloud API error handling with retries
- Automatic cleanup of uploaded files
- Job failure tracking with error messages
- Comprehensive logging with Winston (logs saved to `logs/` directory)

## Production Considerations

### Scaling
- For high-volume production, consider replacing in-memory job queue with Redis/BullMQ
- Replace in-memory Job model with a database (MongoDB, PostgreSQL)
- Use Google Cloud Storage for file storage instead of local filesystem
- Implement horizontal scaling with load balancer

### Monitoring
- Logs are written to `logs/combined.log` and `logs/error.log`
- Monitor job queue length and processing times
- Set up alerts for failed jobs
- Track API usage and costs

### Security
- Never commit `.env` file or service account keys
- Use environment variables for sensitive data
- Implement authentication/authorization (JWT, OAuth, etc.)
- Validate and sanitize file uploads
- Set appropriate file size limits
- Use HTTPS in production
- Implement CORS policies
- Rate limit API endpoints (already configured)

## Security Notes

- Never commit `.env` file or service account keys
- Use environment variables for sensitive data
- Implement authentication/authorization in production
- Validate and sanitize file uploads
- Set appropriate file size limits

## License

ISC

