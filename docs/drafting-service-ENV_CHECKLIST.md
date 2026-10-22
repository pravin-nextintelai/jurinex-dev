# Environment Variables Checklist

## Required Environment Variables for Drafting Service

Create or update `.env` file in `Backend/drafting-service/` with the following:

### 1. Google OAuth Credentials
```bash
# Google OAuth Client ID (from Google Cloud Console)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com

# Google OAuth Client Secret (from Google Cloud Console)
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Optional: OAuth Redirect URI (defaults to gateway callback)
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback
```

### 2. Google Cloud Storage (GCS)
```bash
# GCS Bucket Name (defaults to 'draft_templaten' if not set)
GCS_BUCKET=draft_templaten

# GCS Service Account (one of the following):
# Option A: Path to service account JSON file
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Option B: Use default credentials (if running on GCP)
# No need to set GOOGLE_APPLICATION_CREDENTIALS
```

### 3. Database Connection
```bash
# PostgreSQL Database URL for Drafting Service
DRAFT_DATABASE_URL=postgresql://user:password@localhost:5432/draft_db

# OR use fallback (if DRAFT_DATABASE_URL is not set)
DATABASE_URL=postgresql://user:password@localhost:5432/draft_db
```

### 4. Service URLs
```bash
# Auth Service URL (for fetching user Google Drive tokens)
AUTH_SERVICE_URL=http://localhost:5001

# Drafting Service URL (for internal references)
DRAFTING_SERVICE_URL=http://localhost:5005

# Gateway URL (for OAuth redirects)
GATEWAY_URL=http://localhost:5000
```

### 5. Internal Service Authentication (Optional)
```bash
# Token for internal service-to-service calls
# Used when calling Auth Service internal endpoints
INTERNAL_SERVICE_TOKEN=your-internal-service-token
```

### 6. Server Configuration
```bash
# Port for Drafting Service (defaults to 5005)
PORT=5005

# Node Environment
NODE_ENV=development
```

## Complete .env Example

```bash
# ============================================
# Google OAuth Configuration
# ============================================
GOOGLE_CLIENT_ID=123456789-abcdefghijklmnop.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abcdefghijklmnopqrstuvwxyz
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback

# ============================================
# Google Cloud Storage Configuration
# ============================================
GCS_BUCKET=draft_templaten
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/service-account-key.json

# ============================================
# Database Configuration
# ============================================
DRAFT_DATABASE_URL=postgresql://postgres:password@localhost:5432/draft_db

# ============================================
# Service URLs
# ============================================
AUTH_SERVICE_URL=http://localhost:5001
DRAFTING_SERVICE_URL=http://localhost:5005
GATEWAY_URL=http://localhost:5000

# ============================================
# Internal Service Auth (Optional)
# ============================================
INTERNAL_SERVICE_TOKEN=your-secure-token-here

# ============================================
# Server Configuration
# ============================================
PORT=5005
NODE_ENV=development
```

## How to Get Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create a new one)
3. Navigate to **APIs & Services** > **Credentials**
4. Click **Create Credentials** > **OAuth client ID**
5. Choose **Web application**
6. Add authorized redirect URIs:
   - `http://localhost:5000/api/auth/google/callback` (for local dev)
   - Your production callback URL
7. Copy the **Client ID** and **Client Secret** to your `.env` file

## How to Get GCS Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **IAM & Admin** > **Service Accounts**
3. Click **Create Service Account**
4. Give it a name (e.g., "draft-service-gcs")
5. Grant roles:
   - **Storage Object Admin** (for uploading files)
   - **Storage Object Viewer** (for reading files)
6. Click **Create Key** > **JSON**
7. Download the JSON file
8. Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of this file

## How to Create GCS Bucket

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **Cloud Storage** > **Buckets**
3. Click **Create Bucket**
4. Name it: `draft_templaten` (or your preferred name)
5. Choose location and storage class
6. Set access control: **Uniform** (recommended)
7. Click **Create**
8. Update `GCS_BUCKET` in your `.env` file

## Verification Commands

### Check if environment variables are loaded:
```bash
cd Backend/drafting-service
node -e "require('dotenv').config(); console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✅ Set' : '❌ Missing'); console.log('GCS_BUCKET:', process.env.GCS_BUCKET || 'draft_templaten (default)');"
```

### Test database connection:
```bash
cd Backend/drafting-service
node -e "require('dotenv').config(); const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.DRAFT_DATABASE_URL || process.env.DATABASE_URL }); pool.query('SELECT NOW()').then(r => { console.log('✅ Database connected:', r.rows[0]); process.exit(0); }).catch(e => { console.error('❌ Database error:', e.message); process.exit(1); });"
```

### Test GCS connection:
```bash
cd Backend/drafting-service
node -e "require('dotenv').config(); const { Storage } = require('@google-cloud/storage'); const storage = new Storage(); const bucket = storage.bucket(process.env.GCS_BUCKET || 'draft_templaten'); bucket.exists().then(exists => { console.log(exists ? '✅ Bucket exists' : '❌ Bucket not found'); process.exit(exists ? 0 : 1); }).catch(e => { console.error('❌ GCS error:', e.message); process.exit(1); });"
```

## Common Issues

### 1. "Google OAuth2 credentials not configured"
- **Solution**: Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`

### 2. "Bucket not found" or GCS access denied
- **Solution**: 
  - Verify bucket name in `GCS_BUCKET`
  - Check service account has proper permissions
  - Verify `GOOGLE_APPLICATION_CREDENTIALS` path is correct

### 3. "Database connection failed"
- **Solution**: 
  - Verify `DRAFT_DATABASE_URL` is correct
  - Check database is running
  - Verify user has proper permissions

### 4. "Auth Service is unavailable"
- **Solution**: 
  - Verify `AUTH_SERVICE_URL` is correct
  - Check Auth Service is running
  - Verify internal endpoint exists: `/api/auth/internal/user/:userId/tokens`

