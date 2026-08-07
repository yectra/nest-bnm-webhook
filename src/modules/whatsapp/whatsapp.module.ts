import { Module } from '@nestjs/common';
import { AzureEventsModule } from '../azure-events/azure-events.module';
import { WebhookController } from './controllers/webhook.controller';
import { MessageController } from './controllers/message.controller';
import { TwilioService } from './services/twilio.service';
import { MessageService } from './services/message.service';
import { WebhookService } from './services/webhook.service';
import { CallbackService } from './services/callback.service';
import { TwilioMessageParserService } from './services/twilio-message-parser.service';

@Module({
  imports: [AzureEventsModule],
  controllers: [WebhookController, MessageController],
  providers: [
    TwilioService,
    MessageService,
    WebhookService,
    CallbackService,
    TwilioMessageParserService,
  ],
  exports: [
    TwilioService,
    MessageService,
    WebhookService,
    CallbackService,
    TwilioMessageParserService,
  ],
})
export class WhatsappModule {}
