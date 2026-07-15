import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HealthModule } from './modules/health/health.module';
import { TwilioModule } from './modules/twilio/twilio.module';
import { WebhookModule } from './modules/webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    HealthModule,

    TwilioModule,

    WebhookModule,
  ],
})
export class AppModule { }