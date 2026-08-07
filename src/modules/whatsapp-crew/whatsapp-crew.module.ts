import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { AgentCrewModule } from '../agent-crew/agent-crew.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AzureEventsModule } from '../azure-events/azure-events.module';
import { WhatsappCrewController } from './whatsapp-crew.controller';
import { WhatsappCrewService } from './whatsapp-crew.service';
import { WhatsappCrewGraphFactory } from './graph/whatsapp-crew-graph.factory';
import {
  WHATSAPP_CREW_AGENTS,
  WhatsappCrewAgentDefinition,
} from './graph/whatsapp-crew-agent.definition';
import { MediaIntakeService } from './services/media-intake.service';
import { AdversaryFilterService } from './services/adversary-filter.service';
import { WhatsappSupervisorService } from './services/whatsapp-supervisor.service';
import { ProjectDetailsAgentService } from './services/project-details-agent.service';
import { QuoteDetailsAgentService } from './services/quote-details-agent.service';
import { RequirementsAgentService } from './services/requirements-agent.service';
import { FeedbackAgentService } from './services/feedback-agent.service';
import { AttributionAgentService } from './services/attribution-agent.service';
import { WhatsappReplySynthesizerService } from './services/whatsapp-reply-synthesizer.service';
import { WhatsappDispatchService } from './services/whatsapp-dispatch.service';

@Module({
  imports: [ChatbotModule, AgentCrewModule, WhatsappModule, AzureEventsModule],
  controllers: [WhatsappCrewController],
  providers: [
    MediaIntakeService,
    AdversaryFilterService,
    ProjectDetailsAgentService,
    QuoteDetailsAgentService,
    RequirementsAgentService,
    FeedbackAgentService,
    // Retrieval-agent registry: the graph nodes, supervisor prompt, routing,
    // and attribution candidates are all derived from this array. To add a
    // crew member, implement WhatsappCrewAgentDefinition and append it here.
    {
      provide: WHATSAPP_CREW_AGENTS,
      useFactory: (
        projects: ProjectDetailsAgentService,
        quotes: QuoteDetailsAgentService,
        requirements: RequirementsAgentService,
        feedback: FeedbackAgentService,
      ): WhatsappCrewAgentDefinition[] => [
        projects,
        quotes,
        requirements,
        feedback,
      ],
      inject: [
        ProjectDetailsAgentService,
        QuoteDetailsAgentService,
        RequirementsAgentService,
        FeedbackAgentService,
      ],
    },
    WhatsappSupervisorService,
    AttributionAgentService,
    WhatsappReplySynthesizerService,
    WhatsappDispatchService,
    WhatsappCrewGraphFactory,
    WhatsappCrewService,
  ],
  exports: [WhatsappCrewService],
})
export class WhatsappCrewModule {}
