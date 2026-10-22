# ⚠️ Gateway Service Restart Required

## Issue
CORS error: "Method PATCH is not allowed by Access-Control-Allow-Methods in preflight response"

## Solution
The gateway service CORS configuration has been updated to include `PATCH` method, but **the service needs to be restarted** to apply the changes.

## Steps to Fix

1. **Stop the current gateway service:**
   ```bash
   # Find the process
   lsof -ti :5000
   
   # Kill it
   kill $(lsof -ti :5000)
   
   # Or press Ctrl+C in the terminal where it's running
   ```

2. **Restart the gateway service:**
   ```bash
   cd Backend/gateway-service
   npm start
   ```

3. **Verify it's working:**
   ```bash
   curl -X OPTIONS http://localhost:5000/drafting/api/drafts/2/finalize \
     -H "Origin: http://localhost:5173" \
     -H "Access-Control-Request-Method: PATCH" \
     -v
   ```
   
   You should see `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD` in the response headers.

## What Was Changed

The gateway CORS configuration was updated in `Backend/gateway-service/src/app.js`:

**Before:**
```javascript
methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
```

**After:**
```javascript
methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
```

## Why This Happens

Node.js caches the module code when it's first loaded. When you update the code, the running process still uses the old cached version. Restarting the service loads the new code from disk.

