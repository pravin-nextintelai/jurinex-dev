# Complete Diagnosis & Fix Guide

## ✅ Route Status: WORKING

The route `/api/drafts/initiate` exists and is working correctly. Test result:
```bash
curl -X POST http://localhost:5005/api/drafts/initiate
# Response: {"message":"Authentication token required"} ✅
```

## 🔍 Issue Analysis

### 1. Frontend URL Configuration ✅
- **Frontend calls**: `${DRAFTING_SERVICE_URL}/api/drafts/initiate`
- **DRAFTING_SERVICE_URL** = `http://localhost:5000/drafting` (from `apiConfig.js`)
- **Full URL**: `http://localhost:5000/drafting/api/drafts/initiate`
- **Gateway should forward to**: `http://localhost:5005/api/drafts/initiate`

### 2. Gateway Proxy Configuration ✅
- Gateway mounts draftProxy at `/drafting`
- When request comes to `/drafting/api/drafts/initiate`:
  - Express strips `/drafting` prefix
  - Router receives `/api/drafts/initiate`
  - Proxy forwards to `http://localhost:5005/api/drafts/initiate`

### 3. Route Conflicts ✅ FIXED
- Both `draftRoutes` and `googleDocsRoutes` are mounted at `/api/drafts`
- **Order matters**: `draftRoutes` is mounted first (correct)
- Specific routes (`/initiate`, `/create`) come before parameterized routes (`/:draftId`)
- **Status**: No conflicts detected

## 🐛 Most Likely Causes of 404 Error

### Cause 1: Gateway Service Running Old Code (MOST LIKELY)
**Symptom**: Requests go to `/api/templates/api/drafts/initiate` instead of `/drafting/api/drafts/initiate`

**Solution**: 
```bash
# Stop gateway service
kill $(lsof -ti :5000)

# Restart gateway service
cd Backend/gateway-service
npm start
```

### Cause 2: Missing Environment Variables
**Check**: Verify all required environment variables are set in `Backend/drafting-service/.env`

**Required Variables**:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GCS_BUCKET` (defaults to `draft_templaten`)
- `DRAFT_DATABASE_URL` or `DATABASE_URL`
- `AUTH_SERVICE_URL` (defaults to `http://localhost:5001`)

See `ENV_CHECKLIST.md` for complete list.

### Cause 3: Drafting Service Not Running
**Check**: 
```bash
curl http://localhost:5005/api/health
# Should return: {"status":"healthy","service":"drafting-service",...}
```

**Solution**: Start drafting service if not running:
```bash
cd Backend/drafting-service
npm start
```

### Cause 4: CORS Issues
**Symptom**: Browser console shows CORS error

**Solution**: Verify frontend origin is in allowed list:
- `http://localhost:5173` (Vite dev server)
- Check `Backend/drafting-service/index.js` CORS configuration

## 📋 Postman Testing URLs

### Base URL
```
http://localhost:5000/drafting
```

### 1. Create Draft from Template
```
POST http://localhost:5000/drafting/api/drafts/initiate
Headers:
  Content-Type: application/json
  Authorization: Bearer YOUR_JWT_TOKEN

Body:
{
  "templateFileId": "1a2b3c4d5e6f7g8h9i0j",
  "googleAccessToken": "ya29.a0AfH6SMC...",
  "draftName": "My Draft",
  "metadata": {
    "full_name": "John Doe",
    "email": "john@example.com"
  }
}
```

### 2. Create New Google Doc
```
POST http://localhost:5000/drafting/api/drafts/create
Headers:
  Content-Type: application/json
  Authorization: Bearer YOUR_JWT_TOKEN

Body:
{
  "title": "New Document"
}
```

### 3. List All Drafts
```
GET http://localhost:5000/drafting/api/drafts
Headers:
  Authorization: Bearer YOUR_JWT_TOKEN
```

### 4. Health Check (No Auth)
```
GET http://localhost:5000/drafting/api/health
```

## 🔧 Step-by-Step Fix

### Step 1: Verify Services Are Running
```bash
# Check gateway (port 5000)
curl http://localhost:5000/health

# Check drafting service (port 5005)
curl http://localhost:5005/api/health

# Check auth service (port 5001)
curl http://localhost:5001/api/health
```

### Step 2: Restart Gateway Service
```bash
# Find gateway process
lsof -ti :5000

# Kill it
kill $(lsof -ti :5000)

# Restart
cd Backend/gateway-service
npm start
```

### Step 3: Verify Environment Variables
```bash
cd Backend/drafting-service
cat .env | grep -E "GOOGLE_CLIENT|GCS_BUCKET|DATABASE_URL|AUTH_SERVICE"
```

### Step 4: Test Route Directly
```bash
# Test drafting service directly (bypass gateway)
curl -X POST http://localhost:5005/api/drafts/initiate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{"templateFileId":"test","googleAccessToken":"test"}'

# Should return error about missing fields, NOT 404
```

### Step 5: Test Through Gateway
```bash
# Test through gateway
curl -X POST http://localhost:5000/drafting/api/drafts/initiate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{"templateFileId":"test","googleAccessToken":"test"}'

# Should return same error, NOT 404
```

## 📝 Environment Variables Checklist

### Google OAuth (Required)
- [ ] `GOOGLE_CLIENT_ID` - From Google Cloud Console
- [ ] `GOOGLE_CLIENT_SECRET` - From Google Cloud Console

### GCS (Required)
- [ ] `GCS_BUCKET` - Bucket name (defaults to `draft_templaten`)
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` - Path to service account JSON

### Database (Required)
- [ ] `DRAFT_DATABASE_URL` - PostgreSQL connection string
- [ ] OR `DATABASE_URL` - Fallback connection string

### Service URLs (Optional - have defaults)
- [ ] `AUTH_SERVICE_URL` - Defaults to `http://localhost:5001`
- [ ] `DRAFTING_SERVICE_URL` - Defaults to `http://localhost:5005`
- [ ] `GATEWAY_URL` - Defaults to `http://localhost:5000`

See `ENV_CHECKLIST.md` for complete details.

## 🎯 Quick Test Sequence

1. **Health Check**:
   ```bash
   curl http://localhost:5000/drafting/api/health
   ```

2. **Test Route (No Auth)**:
   ```bash
   curl -X POST http://localhost:5000/drafting/api/drafts/initiate
   # Should return: {"message":"Authentication token required"}
   ```

3. **Test Route (With Auth)**:
   ```bash
   curl -X POST http://localhost:5000/drafting/api/drafts/initiate \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"templateFileId":"test","googleAccessToken":"test"}'
   # Should return validation error, NOT 404
   ```

## 🚨 Common Errors & Solutions

### Error: "404 Not Found"
**Cause**: Gateway not forwarding correctly or service not running
**Solution**: Restart gateway service

### Error: "Authentication token required"
**Cause**: Missing or invalid JWT token
**Solution**: Get valid token from auth service

### Error: "Template file ID is required"
**Cause**: Missing required field in request body
**Solution**: Include `templateFileId` in request body

### Error: "Google OAuth2 credentials not configured"
**Cause**: Missing `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET`
**Solution**: Set in `.env` file

### Error: "Bucket not found"
**Cause**: GCS bucket doesn't exist or wrong name
**Solution**: Verify `GCS_BUCKET` in `.env` matches actual bucket name

## 📚 Related Files

- `POSTMAN_TESTING.md` - Complete Postman test guide
- `ENV_CHECKLIST.md` - Environment variables checklist
- `ROUTE_ANALYSIS.md` - Route structure analysis
- `TROUBLESHOOTING.md` - General troubleshooting guide

