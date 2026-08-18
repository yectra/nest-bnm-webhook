import { Module } from '@nestjs/common';

import { CosmosModule } from '../database/cosmos.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { HelloAgentController } from './controllers/hello-agent.controller';
import { PromptInjectionRagController } from './controllers/prompt-injection-rag.controller';
import { PromptInjectionRagGraphFactory } from './graph/prompt-injection-rag.graph';
import { PromptInjectionRagRepository } from './repositories/prompt-injection-rag.repository';
import { AgentModelService } from './services/agent-model.service';
import { HelloAgentService } from './services/hello-agent.service';
import { LangsmithTracingService } from './services/langsmith-tracing.service';
import { PromptInjectionRagService } from './services/prompt-injection-rag.service';
import { PromptInjectionResourceService } from './services/prompt-injection-resource.service';
import { WhatsappAgentEventService } from './services/whatsapp-agent-event.service';
import { RequiredApiKeyGuard } from '../../common/guards/required-api-key.guard';

/**
 * WhatsApp deep-agent module (deepagents on @langchain/langgraph).
 *
 * Ships the hello-world endpoint and the Event Grid branch that qualifies
 * UPDATE_PROMPT_INJECTION_RAG events and rebuilds the known-prompt-injection
 * RAG in Cosmos DB through a LangGraph pipeline, traced to LangSmith through
 * the shared tracing service. Later increments add the grounded support
 * agent, the adversarial-input guard that consumes this RAG, and the PII
 * filter.
 */
@Module({
  imports: [CosmosModule, EmbeddingModule],
  controllers: [HelloAgentController, PromptInjectionRagController],
  providers: [
    AgentModelService,
    HelloAgentService,
    LangsmithTracingService,
    PromptInjectionResourceService,
    PromptInjectionRagRepository,
    PromptInjectionRagGraphFactory,
    PromptInjectionRagService,
    WhatsappAgentEventService,
    RequiredApiKeyGuard,
  ],
  exports: [
    AgentModelService,
    LangsmithTracingService,
    WhatsappAgentEventService,
    PromptInjectionRagService,
  ],
})
export class WhatsappAgentModule {}
