# Ngrok URL Configuration

## Your Ngrok URL

**URL**: `https://floury-extenuatory-earnestine.ngrok-free.dev`

## Configuration

### Set Environment Variable

Add this to your `.env` file in `Backend/drafting-service/`:

```env
NGROK_URL=https://floury-extenuatory-earnestine.ngrok-free.dev
```

Or export it in your terminal:

```bash
export NGROK_URL=https://floury-extenuatory-earnestine.ngrok-free.dev
```

### Verify Configuration

After setting the environment variable, restart your backend server and check the logs. You should see:

```
[WebhookURL] Using NGROK_URL: https://floury-extenuatory-earnestine.ngrok-free.dev
```

### Webhook Endpoint

Your webhook endpoint will be:
```
https://floury-extenuatory-earnestine.ngrok-free.dev/drafting/api/webhooks/google-drive
```

### Verification Page

Your Google Search Console verification page is accessible at:
```
https://floury-extenuatory-earnestine.ngrok-free.dev/
```

✅ **Status**: The verification page is working and accessible!

## Important Notes

1. **Keep ngrok running**: Don't close the ngrok terminal while developing
2. **URL changes**: If you restart ngrok, the URL will change (unless you have a paid plan with static domain)
3. **Update NGROK_URL**: If the URL changes, update the `NGROK_URL` environment variable and restart your backend

## Testing

### Test Verification Page
Visit: https://floury-extenuatory-earnestine.ngrok-free.dev/

You should see:
- "Domain Verification in Progress" heading
- The verification meta tag in the page source

### Test Webhook Configuration
```bash
curl http://localhost:5005/api/drafts/webhook-config \
  -H "Authorization: Bearer YOUR_TOKEN"
```

This will show you the current webhook URL configuration.


