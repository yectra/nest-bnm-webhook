import { Module } from '@nestjs/common';
import { WebhookController } from './controllers/webhook.controller';
import { MessageController } from './controllers/message.controller';
import { TwilioService } from './services/twilio.service';
import { MessageService } from './services/message.service';
import { WebhookService } from './services/webhook.service';
import { CallbackService } from './services/callback.service';

@Module({
  controllers: [WebhookController, MessageController],
  providers: [TwilioService, MessageService, WebhookService, CallbackService],
  exports: [TwilioService, MessageService, WebhookService, CallbackService],
})
export class WhatsappModule {}
