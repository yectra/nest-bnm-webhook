import { Module } from '@nestjs/common';
import { CosmosModule } from '../database/cosmos.module';
import { HelloAgentController } from './controllers/hello-agent.controller';
import { AgentModelService } from './services/agent-model.service';
import { CustomerFeedbackService } from './services/customer-feedback.service';
import { HelloAgentService } from './services/hello-agent.service';

/**
 * WhatsApp deep-agent module (deepagents on @langchain/langgraph).
 *
 * This increment ships the hello-world endpoint plus the agent's first tool:
 * the Cosmos customer-feedback counter. Later increments add the Event Grid
 * consumer for BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT, the grounded support
 * agent, the adversarial-input guard, and the PII filter.
 */
@Module({
  imports: [CosmosModule],
  controllers: [HelloAgentController],
  providers: [AgentModelService, CustomerFeedbackService, HelloAgentService],
  exports: [AgentModelService],
})
export class WhatsappAgentModule {}
