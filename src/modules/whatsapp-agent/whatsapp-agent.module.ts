import { Module } from '@nestjs/common';

import { CosmosModule } from '../database/cosmos.module';
import { HelloAgentController } from './controllers/hello-agent.controller';
import { RequirementsAgentController } from './controllers/requirements-agent.controller';
import { AgentModelService } from './services/agent-model.service';
import { AzureLogService } from './services/azure-log.service';
import { CustomerDirectoryService } from './services/customer-directory.service';
import { FoundryModelService } from './services/foundry-model.service';
import { HelloAgentService } from './services/hello-agent.service';
import { LangsmithTraceService } from './services/langsmith-trace.service';
import { RequirementsAgentService } from './services/requirements-agent.service';
import { WhatsappAgentEventService } from './services/whatsapp-agent-event.service';

/**
 * WhatsApp deep-agent module (deepagents on @langchain/langgraph).
 *
 * Ships the hello-world endpoint plus the "Post Your Requirements" branch: the
 * Event Grid handler qualifies each inbound event, and a qualified one runs a
 * deep agent on the Azure AI Foundry gpt-5-mini deployment, traced to
 * LangSmith and logged to the Azure application log. Later increments add the
 * grounded support agent, the adversarial-input guard, and the PII filter.
 */
@Module({
  imports: [CosmosModule],
  controllers: [HelloAgentController, RequirementsAgentController],
  providers: [
    AgentModelService,
    HelloAgentService,
    FoundryModelService,
    LangsmithTraceService,
    AzureLogService,
    CustomerDirectoryService,
    RequirementsAgentService,
    WhatsappAgentEventService,
  ],
  exports: [AgentModelService, WhatsappAgentEventService, AzureLogService],
})
export class WhatsappAgentModule {}
