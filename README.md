# BNM Webhook Backend

NestJS backend for:

- Twilio WhatsApp inbound webhook handling
- Automatic WhatsApp replies
- Outbound message sending
- Twilio message status callbacks
- Azure App Service deployment

## Local setup

```bash
npm install
npm run build
npm run start
```

The API starts on `http://localhost:3000` by default.

Useful endpoints:

- `GET /api/health`
- `POST /api/twilio/send-message`
- `POST /api/webhook/whatsapp`
- `POST /api/webhook/whatsapp/status`
- `GET /docs`

## Required environment variables

Create a `.env` file with:

```env
PORT=3000
NODE_ENV=development
APP_BASE_URL=https://your-app-name.azurewebsites.net
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
TWILIO_STATUS_CALLBACK_URL=https://your-app-name.azurewebsites.net/api/webhook/whatsapp/status
TWILIO_WEBHOOK_SECRET=optional_shared_secret
```

Notes:

- `APP_BASE_URL` should be your public Azure App Service URL.
- `TWILIO_STATUS_CALLBACK_URL` is used when this app sends outbound WhatsApp messages.
- `TWILIO_WEBHOOK_SECRET` is optional. Real Twilio requests are validated with the Twilio auth token.

## Twilio WhatsApp configuration

In the Twilio console for your WhatsApp sender:

1. Set the incoming message webhook URL to:

```text
https://your-app-name.azurewebsites.net/api/webhook/whatsapp
```

2. Set the method to `POST`.

3. For status callbacks, use:

```text
https://your-app-name.azurewebsites.net/api/webhook/whatsapp/status
```

## Azure App Service deployment

### 1. Create the App Service resources

```bash
az group create --name bnm-webhook-rg --location centralindia
az appservice plan create --name bnm-webhook-plan --resource-group bnm-webhook-rg --sku B1 --is-linux
az webapp create --name <your-unique-app-name> --resource-group bnm-webhook-rg --plan bnm-webhook-plan --runtime "NODE:22-lts"
```

### 2. Configure app settings

```bash
az webapp config appsettings set \
  --name <your-unique-app-name> \
  --resource-group bnm-webhook-rg \
  --settings \
  NODE_ENV=production \
  SCM_DO_BUILD_DURING_DEPLOYMENT=true \
  PORT=8080 \
  APP_BASE_URL=https://<your-unique-app-name>.azurewebsites.net \
  TWILIO_ACCOUNT_SID=<value> \
  TWILIO_AUTH_TOKEN=<value> \
  TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886 \
  TWILIO_STATUS_CALLBACK_URL=https://<your-unique-app-name>.azurewebsites.net/api/webhook/whatsapp/status
```

### 3. Deploy the code

```bash
az webapp deployment source config-local-git \
  --name <your-unique-app-name> \
  --resource-group bnm-webhook-rg
```

Then push your repo to the Git remote returned by Azure, or use a ZIP deployment:

```bash
az webapp deploy \
  --name <your-unique-app-name> \
  --resource-group bnm-webhook-rg \
  --src-path .
```

## Runtime behavior

- Inbound WhatsApp messages hit `/api/webhook/whatsapp`.
- The app validates the Twilio request signature.
- It responds immediately with TwiML, so Twilio sends the auto-reply back to the user.
- Outbound messages sent through `/api/twilio/send-message` include the configured status callback URL.
- Twilio delivery updates are received on `/api/webhook/whatsapp/status`.
