import { Module } from '@nestjs/common';
import { WebhookController } from './controllers/webhook.controller';
import { MessageController } from './controllers/message.controller';
import { TwilioService } from './services/twilio.service';
import { MessageService } from './services/message.service';
import { WebhookService } from './services/webhook.service';
import { CallbackService } from './services/callback.service';
import { EventGridService } from './services/event-grid.service';

@Module({
  controllers: [WebhookController, MessageController],
  providers: [
    TwilioService,
    MessageService,
    WebhookService,
    CallbackService,
    EventGridService,
  ],
  exports: [
    TwilioService,
    MessageService,
    WebhookService,
    CallbackService,
    EventGridService,
  ],
})
export class WhatsappModule {}
