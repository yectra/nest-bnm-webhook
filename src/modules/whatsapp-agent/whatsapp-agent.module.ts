import { Module } from '@nestjs/common';
import { HelloAgentController } from './controllers/hello-agent.controller';
import { AgentModelService } from './services/agent-model.service';
import { HelloAgentService } from './services/hello-agent.service';
import { PromptInjectionDetectorService } from './services/prompt-injection-detector.service';

/**
 * WhatsApp deep-agent module (deepagents on @langchain/langgraph).
 *
 * Ships the hello-world endpoint and the adversarial-input guard that scans
 * the "Post Your Requirements" text carried by
 * BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT for prompt injection. Later
 * increments add the grounded support agent and the PII filter.
 */
@Module({
  controllers: [HelloAgentController],
  providers: [
    AgentModelService,
    HelloAgentService,
    PromptInjectionDetectorService,
  ],
  exports: [AgentModelService, PromptInjectionDetectorService],
})
export class WhatsappAgentModule {}
