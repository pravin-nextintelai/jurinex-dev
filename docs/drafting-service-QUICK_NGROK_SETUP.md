# Quick Ngrok Setup Guide

## ✅ Ngrok is Already Installed!

Ngrok has been installed locally in this project. You can use it without sudo permissions.

## Quick Start

### 1. Get Your Ngrok Auth Token

1. Sign up at [ngrok.com](https://dashboard.ngrok.com/signup) (free)
2. Copy your authtoken from the dashboard
3. Authenticate:

```bash
cd Backend/drafting-service
npm run ngrok:auth YOUR_AUTH_TOKEN
```

### 2. Start Your Backend Server

```bash
npm start
```

Keep this terminal running.

### 3. Start Ngrok (in a NEW terminal)

```bash
cd Backend/drafting-service
npm run ngrok
```

You'll see output like:
```
Forwarding  https://a1b2-c3d4.ngrok-free.app -> http://localhost:5000
```

### 4. Copy the HTTPS URL

Copy the URL: `https://a1b2-c3d4.ngrok-free.app`

### 5. Set Environment Variable

**Option A: Export in terminal**
```bash
export NGROK_URL=https://a1b2-c3d4.ngrok-free.app
```

**Option B: Add to .env file**
```bash
# In Backend/drafting-service/.env
NGROK_URL=https://a1b2-c3d4.ngrok-free.app
```

### 6. Restart Your Backend

Stop the server (Ctrl+C) and restart:
```bash
npm start
```

### 7. Verify Configuration

Check the logs - you should see:
```
[WebhookURL] Using NGROK_URL: https://a1b2-c3d4.ngrok-free.app
```

Or test the endpoint:
```bash
curl http://localhost:5000/api/drafts/webhook-config \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Troubleshooting

### "ngrok: command not found"
Use `npx` instead:
```bash
npx ngrok http 5000
```

### "Webhook URL is using localhost"
Make sure you:
1. ✅ Started ngrok: `npm run ngrok`
2. ✅ Set `NGROK_URL` environment variable
3. ✅ Restarted your backend server

### Ngrok URL Changes
Free ngrok URLs change every restart. Just update `NGROK_URL` and restart your backend.

## Commands Reference

```bash
# Start ngrok tunnel
npm run ngrok

# Authenticate ngrok (first time only)
npm run ngrok:auth YOUR_AUTH_TOKEN

# Or use npx directly
npx ngrok http 5000
```

## Next Steps

Once ngrok is running and `NGROK_URL` is set:
1. Open a document: `GET /api/drafts/:id/open`
2. Check logs for webhook setup confirmation
3. Edit the document in Google Docs
4. Wait 5 seconds - file should auto-sync to GCS!


