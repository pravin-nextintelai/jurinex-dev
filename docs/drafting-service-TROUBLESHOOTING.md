# Troubleshooting Guide

## 404 Error on `/api/drafts/initiate`

### Check 1: Service is Running
```bash
cd Backend/drafting-service
npm start
```

You should see:
```
✅ Drafting Service running on port 5005
```

### Check 2: Gateway is Running
```bash
cd Backend/gateway-service
npm start
```

### Check 3: Test Direct Service Access
```bash
# Test health endpoint
curl http://localhost:5005/api/health

# Test with authentication (replace YOUR_JWT_TOKEN)
curl -X POST http://localhost:5005/api/drafts/initiate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"templateFileId":"test","googleAccessToken":"test"}'
```

### Check 4: Test Through Gateway
```bash
# Test through gateway (replace YOUR_JWT_TOKEN)
curl -X POST http://localhost:5000/drafting/api/drafts/initiate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"templateFileId":"test","googleAccessToken":"test"}'
```

### Check 5: Verify Route Order
Routes are registered in this order (correct):
1. `draftRoutes` - has `/initiate` (literal path, matches first)
2. `googleDocsRoutes` - has `/:draftId/...` (parameterized, matches later)

### Check 6: Browser Network Tab
1. Open browser DevTools → Network tab
2. Try creating a draft
3. Check the failed request:
   - **Request URL**: Should be `http://localhost:5000/drafting/api/drafts/initiate`
   - **Status**: 404
   - **Response**: Check error message

### Common Issues

#### Issue: Service not running
**Solution**: Start the drafting service
```bash
cd Backend/drafting-service
npm start
```

#### Issue: Gateway not proxying correctly
**Solution**: Check gateway logs for proxy errors. Restart gateway service.

#### Issue: Route conflict
**Solution**: Routes are correctly ordered. `/initiate` is a literal POST route and will match before any `/:draftId` routes.

#### Issue: CORS error
**Solution**: Check CORS configuration in `Backend/drafting-service/index.js` - ensure your frontend URL is in `allowedOrigins`.

#### Issue: Authentication error
**Solution**: Ensure JWT token is being sent in `Authorization: Bearer <token>` header.

### Debug Steps

1. **Check service logs**:
   ```bash
   # In drafting-service terminal, you should see:
   [Drafting] User X initiating draft from template: Y
   ```

2. **Check gateway logs**:
   ```bash
   # In gateway-service terminal, you should see:
   [Gateway] Drafting Proxy: POST /drafting/api/drafts/initiate → /api/drafts/initiate
   ```

3. **Check browser console**:
   - Look for the exact error message
   - Check the request URL
   - Verify headers are being sent

4. **Verify environment variables**:
   ```bash
   # In drafting-service/.env
   PORT=5005
   DRAFTING_SERVICE_URL=postgresql://...
   JWT_SECRET=...
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

