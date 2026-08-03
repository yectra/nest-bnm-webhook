import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { AgentCrewController } from './agent-crew.controller';
import { AgentCrewService } from './agent-crew.service';
import { AgentCrewGateway } from './agent-crew.gateway';
import { CrewGraphFactory } from './graph/crew-graph.factory';
import {
  CREW_AGENTS,
  CrewAgentDefinition,
} from './graph/crew-agent.definition';
import { CrewLlmProvider } from './services/crew-llm.provider';
import { SupervisorAgentService } from './services/supervisor-agent.service';
import { ServiceVectorAgentService } from './services/service-vector-agent.service';
import { QuoteAgentService } from './services/quote-agent.service';
import { ImageAgentService } from './services/image-agent.service';
import { SynthesizerAgentService } from './services/synthesizer-agent.service';
import { PiiFilterService } from './services/pii-filter.service';
import { CrewDispatchService } from './services/crew-dispatch.service';

@Module({
  imports: [ChatbotModule],
  controllers: [AgentCrewController],
  providers: [
    CrewLlmProvider,
    ServiceVectorAgentService,
    QuoteAgentService,
    ImageAgentService,
    // Retrieval-agent registry: the graph nodes, supervisor prompt, and
    // routing are all derived from this array. To add a crew member,
    // implement CrewAgentDefinition and append it here — nothing else.
    {
      provide: CREW_AGENTS,
      useFactory: (
        services: ServiceVectorAgentService,
        quotes: QuoteAgentService,
        images: ImageAgentService,
      ): CrewAgentDefinition[] => [services, quotes, images],
      inject: [ServiceVectorAgentService, QuoteAgentService, ImageAgentService],
    },
    SupervisorAgentService,
    SynthesizerAgentService,
    PiiFilterService,
    CrewDispatchService,
    CrewGraphFactory,
    AgentCrewGateway,
    AgentCrewService,
  ],
  exports: [AgentCrewService],
})
export class AgentCrewModule {}
