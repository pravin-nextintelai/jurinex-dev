# Ngrok Setup for Local Development

## Overview

Google Drive webhooks require a public HTTPS URL. Since you're developing locally, you need to use **ngrok** to create a secure tunnel from the internet to your localhost.

## Prerequisites

1. **Install ngrok**: [Download from ngrok.com](https://ngrok.com/download)
2. **Sign up for free account**: [Create account at ngrok.com](https://dashboard.ngrok.com/signup)
3. **Get your authtoken**: After signing up, copy your authtoken from the dashboard

## Step-by-Step Setup

### Step 1: Install and Configure Ngrok

**Option A: Install Locally (Recommended - No Permissions Needed)**

```bash
# Navigate to your backend directory
cd Backend/drafting-service

# Install ngrok as a dev dependency (already done if you see this)
npm install ngrok --save-dev

# Authenticate with your ngrok account
npx ngrok config add-authtoken YOUR_AUTH_TOKEN
```

**Option B: Install Globally (Requires sudo)**

```bash
# Install globally (requires sudo)
sudo npm install ngrok -g

# Or use sudo with the command
sudo npm install -g ngrok

# Authenticate
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

**Option C: Download Binary Directly**

```bash
# Download ngrok binary
cd ~/Downloads
wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
tar -xzf ngrok-v3-stable-linux-amd64.tgz
sudo mv ngrok /usr/local/bin/  # Or add to your PATH

# Authenticate
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

### Step 2: Start Your Backend Server

```bash
# Navigate to your backend directory
cd Backend/drafting-service

# Start your Node.js server (usually on port 5000)
npm start
# or
node server.js
```

**Verify**: Your server should be running on `http://localhost:5000`

### Step 3: Start Ngrok Tunnel

Open a **new terminal window** and run:

**If installed locally (Option A):**
```bash
cd Backend/drafting-service
npx ngrok http 5000
```

**If installed globally (Option B or C):**
```bash
ngrok http 5000
```

You should see output like:

```
ngrok                                                                              
                                                                                   
Session Status                online                                               
Account                       your-email@example.com                               
Version                       3.x.x                                                
Region                        United States (us)                                    
Latency                       -                                                    
Web Interface                 http://127.0.0.1:4040                                
Forwarding                    https://a1b2-c3d4.ngrok-free.app -> http://localhost:5000
                                                                                   
Connections                   ttl     opn     rt1     rt5     p50     p90         
                              0       0       0.00    0.00    0.00    0.00         
```

### Step 4: Capture the Ngrok URL

Look for the **Forwarding** line. Copy the HTTPS URL:
```
https://a1b2-c3d4.ngrok-free.app
```

**Important**: 
- The URL changes every time you restart ngrok (unless you have a paid plan)
- Keep ngrok running while developing
- The URL must start with `https://`

### Step 5: Set Environment Variable

Add the ngrok URL to your environment variables:

**Option A: Create/Update `.env` file**

```bash
# In Backend/drafting-service/.env
NGROK_URL=https://a1b2-c3d4.ngrok-free.app
```

**Option B: Export in terminal**

```bash
export NGROK_URL=https://a1b2-c3d4.ngrok-free.app
```

**Option C: Add to your shell profile** (for persistence)

```bash
# Add to ~/.bashrc or ~/.zshrc
export NGROK_URL=https://a1b2-c3d4.ngrok-free.app
```

### Step 6: Restart Your Backend Server

After setting the environment variable, restart your backend:

```bash
# Stop the server (Ctrl+C)
# Then restart
npm start
```

### Step 7: Verify Configuration

Check the logs when you open a document. You should see:

```
[WebhookURL] Using NGROK_URL: https://a1b2-c3d4.ngrok-free.app
[Draft] Webhook URL: https://a1b2-c3d4.ngrok-free.app/drafting/api/webhooks/google-drive
[Draft] ✅ Webhook watcher active - edits will auto-sync to GCS
```

## Environment Variable Priority

The system checks for webhook URLs in this order:

1. **`NGROK_URL`** (highest priority for local development)
2. **`WEBHOOK_BASE_URL`** (for production)
3. **`GATEWAY_URL`** (fallback)

## Testing the Webhook

### Test 1: Check Webhook URL Validation

The system automatically validates the webhook URL. Check your logs for:

```
[WebhookURL] Using NGROK_URL: https://a1b2-c3d4.ngrok-free.app
```

If you see warnings about localhost, the `NGROK_URL` is not set correctly.

### Test 2: Open a Document

1. Open a document via `GET /api/drafts/:id/open`
2. Check logs for webhook setup:
   ```
   [Draft] Step 2: Setting up webhook watcher for draft X
   [Draft] Webhook URL: https://a1b2-c3d4.ngrok-free.app/drafting/api/webhooks/google-drive
   [Draft] ✅ Webhook watcher active
   ```

### Test 3: Make an Edit

1. Edit the document in Google Docs
2. Wait 5 seconds (quiet period)
3. Check logs for:
   ```
   [Webhook] Received Google Drive webhook
   [Webhook] ✅ Successfully synced draft X to GCS
   ```

## Troubleshooting

### Error: "Webhook URL is using localhost"

**Problem**: `NGROK_URL` is not set or ngrok is not running.

**Solution**:
1. Make sure ngrok is running: `ngrok http 5000`
2. Copy the HTTPS URL from ngrok output
3. Set `NGROK_URL=https://your-ngrok-url.ngrok-free.app`
4. Restart your backend server

### Error: "Webhook URL must use HTTPS"

**Problem**: Using HTTP instead of HTTPS.

**Solution**: Make sure your ngrok URL starts with `https://`, not `http://`

### Error: "push.webhookUrlNotHttps"

**Problem**: Google Drive API requires HTTPS URLs.

**Solution**: 
1. Use ngrok HTTPS URL (not HTTP)
2. Make sure `NGROK_URL` is set correctly
3. Restart backend after setting environment variable

### Webhook Not Receiving Updates

**Checklist**:
1. ✅ Is ngrok running? (`ngrok http 5000`)
2. ✅ Is `NGROK_URL` set correctly?
3. ✅ Is backend server running?
4. ✅ Did you restart backend after setting `NGROK_URL`?
5. ✅ Check ngrok web interface: `http://127.0.0.1:4040` (shows incoming requests)

### Ngrok URL Changes on Restart

**Problem**: Free ngrok URLs change every restart.

**Solutions**:
1. **Keep ngrok running**: Don't restart ngrok during development
2. **Use ngrok config file**: Set up a static domain (paid feature)
3. **Update environment variable**: Update `NGROK_URL` each time you restart ngrok

## Production Setup

For production, use a real domain with HTTPS:

```env
# Production .env
WEBHOOK_BASE_URL=https://your-domain.com
```

The system will automatically use `WEBHOOK_BASE_URL` instead of `NGROK_URL` in production.

## Quick Reference

```bash
# 1. Start backend
npm start

# 2. Start ngrok (in new terminal)
ngrok http 5000

# 3. Copy HTTPS URL from ngrok output
# Example: https://a1b2-c3d4.ngrok-free.app

# 4. Set environment variable
export NGROK_URL=https://a1b2-c3d4.ngrok-free.app

# 5. Restart backend
npm start

# 6. Verify in logs
# Look for: [WebhookURL] Using NGROK_URL
```

## Additional Resources

- [Ngrok Documentation](https://ngrok.com/docs)
- [Google Drive API Webhooks](https://developers.google.com/drive/api/v3/push)
- [Ngrok Dashboard](https://dashboard.ngrok.com)

## Notes

- **Free ngrok**: URLs change on restart, 40 connections/minute limit
- **Paid ngrok**: Static domains, higher limits
- **Keep ngrok running**: Don't close the ngrok terminal while developing
- **HTTPS required**: Google requires HTTPS for webhooks (ngrok provides this)

