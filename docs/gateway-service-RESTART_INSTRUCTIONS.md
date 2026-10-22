# Gateway Service Restart Instructions

## Issue
Requests are going to `/api/templates/api/drafts/initiate` instead of `/drafting/api/drafts/initiate`.

## Solution
The gateway service needs to be restarted to pick up the new draftProxy configuration.

## Steps

1. **Stop the current gateway service**:
   - Find the process: `ps aux | grep "node.*gateway\|node.*server.js" | grep gateway`
   - Kill it: `kill <PID>` or press `Ctrl+C` in the terminal where it's running

2. **Restart the gateway service**:
   ```bash
   cd Backend/gateway-service
   npm start
   ```

3. **Verify it's working**:
   ```bash
   curl -X POST http://localhost:5000/drafting/api/drafts/initiate \
     -H "Content-Type: application/json" \
     -d '{"test":"test"}'
   ```
   
   Should return: `{"error":"No token provided"}` (not 404)

4. **Check the logs**:
   You should see:
   ```
   [Gateway] Drafting Proxy received: POST /drafting/api/drafts/initiate
   [Gateway] Drafting Proxy Forward: POST /drafting/api/drafts/initiate → /api/drafts/initiate
   ```

## Why This Happened
The gateway service was running an old version of the code that had a pathRewrite rule rewriting `/drafting` to `/api/templates`. The new code removes that rewrite, but the service needs to be restarted to pick up the changes.

