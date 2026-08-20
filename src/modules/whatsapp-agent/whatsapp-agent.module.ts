import { Module } from '@nestjs/common';
import { HelloAgentController } from './controllers/hello-agent.controller';
import { AgentModelService } from './services/agent-model.service';
import { HelloAgentService } from './services/hello-agent.service';
import { LangsmithTracingService } from './services/langsmith-tracing.service';
import { PostYourRequirementsAgentService } from './services/post-your-requirements-agent.service';

/**
 * WhatsApp deep-agent module (deepagents on @langchain/langgraph).
 *
 * Provides:
 *  - HelloAgentService       : hello-world endpoint (GET/POST /api/hello-agent)
 *  - PostYourRequirementsAgentService : handles POST_YOUR_REQUIREMENTS Event Grid events
 *    with LangSmith tracing, injected into EventGridService via WhatsappModule.
 */
@Module({
  controllers: [HelloAgentController],
  providers: [
    AgentModelService,
    HelloAgentService,
    LangsmithTracingService,
    PostYourRequirementsAgentService,
  ],
  exports: [
    AgentModelService,
    LangsmithTracingService,
    PostYourRequirementsAgentService,
  ],
})
export class WhatsappAgentModule {}
