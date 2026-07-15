import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

import { HealthModule } from './modules/health/health.module';
import { TwilioModule } from './modules/twilio/twilio.module';
import { WebhookModule } from './modules/webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'production')
          .default('development'),
        PORT: Joi.number().port().default(3000),
        APP_BASE_URL: Joi.string().uri().optional(),
        TWILIO_ACCOUNT_SID: Joi.string().required(),
        TWILIO_AUTH_TOKEN: Joi.string().required(),
        TWILIO_WHATSAPP_NUMBER: Joi.string()
          .pattern(/^whatsapp:\+\d+$/)
          .required(),
        TWILIO_WEBHOOK_SECRET: Joi.string().optional(),
        TWILIO_STATUS_CALLBACK_URL: Joi.string().uri().optional(),
      }),
    }),

    HealthModule,

    TwilioModule,

    WebhookModule,
  ],
})
export class AppModule {}
