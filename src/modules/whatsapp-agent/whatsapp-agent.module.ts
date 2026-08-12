import { Module } from '@nestjs/common';
import { HelloAgentController } from './controllers/hello-agent.controller';
import { AgentModelService } from './services/agent-model.service';
import { HelloAgentService } from './services/hello-agent.service';

/**
 * WhatsApp deep-agent module (deepagents on @langchain/langgraph).
 *
 * This first increment ships the hello-world endpoint. Later increments add
 * the Event Grid consumer for BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT, the
 * grounded support agent, the adversarial-input guard, and the PII filter.
 */
@Module({
  controllers: [HelloAgentController],
  providers: [AgentModelService, HelloAgentService],
  exports: [AgentModelService],
})
export class WhatsappAgentModule {}
