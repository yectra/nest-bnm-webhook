import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { TwilioModule } from '../twilio/twilio.module';

@Module({
  imports: [TwilioModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule { }
