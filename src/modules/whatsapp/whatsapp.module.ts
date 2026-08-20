import { Module, forwardRef } from '@nestjs/common';
import { WebhookController } from './controllers/webhook.controller';
import { MessageController } from './controllers/message.controller';
import { TwilioService } from './services/twilio.service';
import { MessageService } from './services/message.service';
import { WebhookService } from './services/webhook.service';
import { CallbackService } from './services/callback.service';
import { EventGridService } from './services/event-grid.service';
import { WhatsappAgentModule } from '../whatsapp-agent/whatsapp-agent.module';
import { KeyVaultService } from '../../common/services/key-vault.service';
import { EventSecurityGuard } from '../../common/guards/event-security.guard';

@Module({
  imports: [forwardRef(() => WhatsappAgentModule)],
  controllers: [WebhookController, MessageController],
  providers: [
    TwilioService,
    MessageService,
    WebhookService,
    CallbackService,
    EventGridService,
    KeyVaultService,
    EventSecurityGuard,
  ],
  exports: [
    TwilioService,
    MessageService,
    WebhookService,
    CallbackService,
    EventGridService,
    KeyVaultService,
    EventSecurityGuard,
  ],
})
export class WhatsappModule {}

