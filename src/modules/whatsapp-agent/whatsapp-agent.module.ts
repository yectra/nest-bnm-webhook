import { Module } from '@nestjs/common';
import { CosmosModule } from '../database/cosmos.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { HelloAgentController } from './controllers/hello-agent.controller';
import { WhatsappEventController } from './controllers/whatsapp-event.controller';
import { AgentModelService } from './services/agent-model.service';
import { CheckpointerService } from './services/checkpointer.service';
import { CustomerDataService } from './services/customer-data.service';
import { DedupService } from './services/dedup.service';
import { GuardService } from './services/guard.service';
import { HelloAgentService } from './services/hello-agent.service';
import { ReplyGeneratorService } from './services/reply-generator.service';
import { SupportAgentService } from './services/support-agent.service';
import { WhatsappEventHandlerService } from './services/whatsapp-event-handler.service';
import { WhatsappReplyService } from './services/whatsapp-reply.service';

/**
 * WhatsApp deep-agent module (deepagents on @langchain/langgraph).
 *
 * Consumes BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT from the Event Grid push
 * subscription and answers each message over Twilio WhatsApp. Later
 * increments add the grounded support agent, the adversarial-input guard,
 * and the PII filter.
 */
@Module({
  imports: [CosmosModule, WhatsappModule],
  controllers: [HelloAgentController, WhatsappEventController],
  providers: [
    AgentModelService,
    CheckpointerService,
    CustomerDataService,
    HelloAgentService,
    SupportAgentService,
    DedupService,
    GuardService,
    ReplyGeneratorService,
    WhatsappEventHandlerService,
    WhatsappReplyService,
  ],
  exports: [AgentModelService],
})
export class WhatsappAgentModule {}
