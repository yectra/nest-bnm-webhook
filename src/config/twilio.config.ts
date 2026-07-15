import { registerAs } from '@nestjs/config';

export default registerAs('twilio', () => ({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER,
  webhookSecret: process.env.TWILIO_WEBHOOK_SECRET,
  statusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL,
}));
