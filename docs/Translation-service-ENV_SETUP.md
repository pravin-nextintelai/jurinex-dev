# Environment Setup Guide

## Required Environment Variables

Create a `.env` file in the root directory with the following variables:

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
NODE_ENV=production

# File Upload Configuration (100MB default - supports 500+ page documents)
MAX_FILE_SIZE=104857600
UPLOAD_DIR=./uploads

# Job Queue Configuration
MAX_CONCURRENT_JOBS=3
```

## Google Cloud Setup

### 1. Enable Required APIs
- Cloud Translation API
- Document AI API
- Cloud Storage API (optional, for batch processing)

### 2. Create Service Account
1. Go to Google Cloud Console → IAM & Admin → Service Accounts
2. Create a new service account
3. Grant the following roles:
   - Cloud Translation API User
   - Document AI API User
   - Storage Object Admin (if using GCS for batch processing)
4. Create and download JSON key
5. Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of this JSON file

### 3. Create Document AI Processor
1. Go to Document AI → Processors
2. Create a new processor (OCR Processor recommended)
3. Copy the Processor ID and set `DOCUMENT_AI_PROCESSOR_ID`

### 4. Set Translation API Location
- Use `global` for most use cases
- Use specific region (e.g., `us-central1`) for better performance in that region

## Production Recommendations

1. **Use Environment Variables**: Never hardcode credentials
2. **Secure Storage**: Store service account keys securely (use secret management services)
3. **Database**: Replace in-memory job storage with a database
4. **Queue System**: Use Redis/BullMQ for distributed job processing
5. **File Storage**: Use Google Cloud Storage instead of local filesystem
6. **Monitoring**: Set up monitoring and alerting
7. **Scaling**: Configure horizontal scaling based on load

