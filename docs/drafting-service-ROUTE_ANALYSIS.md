# Route Analysis & Fix

## Current Route Setup

### Backend Routes (drafting-service/index.js)
```javascript
app.use('/api/drafts', draftRoutes);        // Line 47
app.use('/api/drafts', googleDocsRoutes);   // Line 48
```

### draftRoutes.js
- `POST /initiate` → `/api/drafts/initiate` ✅
- `POST /populate/:draftId` → `/api/drafts/populate/:draftId`
- `GET /` → `/api/drafts`
- `GET /:draftId` → `/api/drafts/:draftId`
- `GET /:draftId/placeholders` → `/api/drafts/:draftId/placeholders`
- `PATCH /:draftId/finalize` → `/api/drafts/:draftId/finalize`
- `DELETE /:draftId` → `/api/drafts/:draftId`

### googleDocsRoutes.js
- `POST /create` → `/api/drafts/create` ✅
- `GET /:draftId/editor-url` → `/api/drafts/:draftId/editor-url`
- `POST /:draftId/sync` → `/api/drafts/:draftId/sync`
- `GET /:draftId/gcs-url` → `/api/drafts/:draftId/gcs-url`
- `GET /:draftId/sync-status` → `/api/drafts/:draftId/sync-status`

## Potential Conflicts

1. **Route Order Issue**: Both routers are mounted at `/api/drafts`. Express matches routes in order, so:
   - `draftRoutes` is checked first
   - `googleDocsRoutes` is checked second
   
2. **Parameterized Route Conflict**: 
   - `GET /:draftId` in `draftRoutes` could match `/api/drafts/create` if `create` is treated as a `draftId`
   - However, `POST /create` should match first because it's more specific

3. **Frontend URL**: 
   - Frontend calls: `${DRAFTING_SERVICE_URL}/api/drafts/initiate`
   - `DRAFTING_SERVICE_URL` = `http://localhost:5000/drafting`
   - Full URL: `http://localhost:5000/drafting/api/drafts/initiate`
   - Gateway should forward to: `http://localhost:5005/api/drafts/initiate`

## Required Environment Variables

### Google OAuth
- `GOOGLE_CLIENT_ID` - Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth Client Secret
- `GOOGLE_DRIVE_REDIRECT_URI` - OAuth redirect URI (optional, defaults to gateway callback)

### GCS (Google Cloud Storage)
- `GCS_BUCKET` - Bucket name (defaults to `draft_templaten`)
- GCS Service Account credentials (via `GOOGLE_APPLICATION_CREDENTIALS` or default credentials)

### Database
- `DRAFT_DATABASE_URL` - PostgreSQL connection string (or `DATABASE_URL` as fallback)

### Service URLs
- `AUTH_SERVICE_URL` - Auth service URL (defaults to `http://localhost:5001`)
- `DRAFTING_SERVICE_URL` - Drafting service URL (defaults to `http://localhost:5005`)
- `GATEWAY_URL` - Gateway URL (defaults to `http://localhost:5000`)

### Internal Auth
- `INTERNAL_SERVICE_TOKEN` - Token for internal service-to-service calls (optional)

