# Postman Collection Setup Guide

## Import Collection

1. Open Postman
2. Click **Import** button (top left)
3. Select the file: `Translation-Service.postman_collection.json`
4. Click **Import**

## Environment Variables

The collection uses the following environment variables:

- `baseUrl`: Base URL of your API (default: `http://localhost:3000`)
- `jobId`: Automatically set when you submit a translation job
- `translatedFileName`: Filename of the translated document (get from job status)

### Setting Up Environment

1. In Postman, click on **Environments** (left sidebar)
2. Click **+** to create a new environment
3. Name it "Translation Service Local" or "Translation Service Production"
4. Add variables:
   - `baseUrl`: `http://localhost:3000` (or your production URL)
   - `jobId`: (leave empty, will be auto-set)
   - `translatedFileName`: (leave empty, set manually from job status)
5. Click **Save**
6. Select the environment from the dropdown (top right)

## Testing Workflow

### 1. Health Check
- Run **Health Check** request
- Should return 200 OK with service status

### 2. Translate Document
- Run **Translate Document** request
- Select a file in the `document` field
- Set `targetLanguage` (e.g., "es" for Spanish, "fr" for French)
- Optionally set `sourceLanguage` (leave empty for auto-detect)
- Send request
- Should return **202 Accepted** with a `jobId`
- The `jobId` is automatically saved to environment variable

### 3. Check Job Status
- Run **Get Job Status** request
- The `jobId` from step 2 is automatically used
- Poll this endpoint every few seconds
- Watch for:
  - `status`: `pending` → `processing` → `completed`
  - `progress`: 0 → 100
- When `status` is `completed`, note the `translatedFile` or `downloadUrl`

### 4. Download Translated Document
- Run **Download Translated Document** request
- Set `translatedFileName` environment variable to the filename from step 3
- Or manually replace `{{translatedFileName}}` in the URL
- Should download the translated file

## Example Language Codes

Common target language codes:
- `en` - English
- `es` - Spanish
- `fr` - French
- `de` - German
- `it` - Italian
- `pt` - Portuguese
- `zh` - Chinese
- `ja` - Japanese
- `ko` - Korean
- `ar` - Arabic
- `ru` - Russian
- `hi` - Hindi

## Quick Test Examples

The collection includes pre-configured examples:
- **Translate Document - Spanish**: English → Spanish
- **Translate Document - French**: English → French
- **Translate Document - Auto Detect Source**: Auto-detect → English

## Tips

1. **Large Files**: For large documents (500+ pages), the job may take several minutes. Poll the status endpoint every 5-10 seconds.

2. **Auto Job ID**: The collection automatically saves the `jobId` when you submit a translation job, so you don't need to copy-paste it.

3. **Error Handling**: If a job fails, check the `error` field in the job status response.

4. **File Types**: 
   - Digital native: PDF, DOCX, DOC, XLSX, PPTX, TXT, HTML, CSV, RTF
   - Scanned: JPEG, PNG, TIFF, BMP, scanned PDFs

5. **Rate Limiting**: The API has rate limiting (100 requests per 15 minutes per IP). If you hit the limit, wait a few minutes.

## Troubleshooting

- **404 on Job Status**: Make sure the `jobId` environment variable is set correctly
- **404 on Download**: Verify the `translatedFileName` matches exactly (case-sensitive)
- **500 Error**: Check server logs in `logs/error.log`
- **Connection Refused**: Make sure the server is running on the correct port

