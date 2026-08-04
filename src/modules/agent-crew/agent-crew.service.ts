import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrewGraphFactory } from './graph/crew-graph.factory';
import { CrewMessageDto } from './dto/crew-message.dto';
import { CrewResponseDto } from './dto/crew-response.dto';
import { ConversationRepository } from '../chatbot/repositories/conversation.repository';
import { TeamsNotificationService } from '../chatbot/services/teams-notification.service';

/**
 * Entry point for the LangGraph agent crew. Compiles the graph once, then for
 * every request runs:
 * supervisor -> parallel retrieval (service vectors / user quotes / quote &
 * requirement-form pictures) -> GPT-5 synthesis -> PII filter -> dispatch to
 * the Teams channel and WebSocket clients.
 */
@Injectable()
export class AgentCrewService implements OnModuleInit {
  private readonly logger = new Logger(AgentCrewService.name);
  private graph!: ReturnType<CrewGraphFactory['build']>;
  private readonly agentCallsEnabled: boolean;

  constructor(
    private readonly graphFactory: CrewGraphFactory,
    private readonly conversationRepository: ConversationRepository,
    private readonly teamsNotificationService: TeamsNotificationService,
    private readonly config: ConfigService,
  ) {
    const flag = this.config.get<string | boolean>('AGENT_CALLS_ENABLED');
    this.agentCallsEnabled = flag !== 'false' && flag !== false;
  }

  onModuleInit() {
    this.graph = this.graphFactory.build();
    this.logger.log('Agent crew graph compiled');
  }

  async run(dto: CrewMessageDto): Promise<CrewResponseDto> {
    const question = dto.message.trim();
    const conversationId =
      dto.conversationId || dto.sessionId || 'default-session';
    const userId = dto.userId || 'anonymous';
    const channel = dto.channel || 'Website';
    const timestamp = new Date().toISOString();

    if (!this.agentCallsEnabled) {
      this.logger.warn(`Agent calls disabled by AGENT_CALLS_ENABLED flag. Short-circuiting run.`);
      return {
        success: false,
        response: `This feature isn't available right now. Please try again later or contact support if the issue continues.`,
        conversationId,
        sessionId: conversationId,
        userId,
        channel,
        timestamp,
        meta: {
          plan: { agents: {}, rationale: 'Agent calls disabled' },
          serviceMatches: 0,
          quoteMatches: 0,
          imagesAnalyzed: 0,
          piiRedactions: [],
          dispatch: { teamsSent: false, websocketEmitted: false },
          trace: [],
        },
      };
    }

    if (channel === 'Website') {
      this.teamsNotificationService.setActiveWebsiteConversationId(
        conversationId,
      );
    }

    this.logger.log(
      `[AgentCrew] Run started. conversationId=${conversationId}, userId=${userId}, question="${question}"`,
    );

    const finalState = await this.graph.invoke({
      question,
      conversationId,
      userId,
      channel,
      history: this.conversationRepository.getFormattedHistory(conversationId),
    });

    this.logger.log(
      `[AgentCrew] Run finished. conversationId=${conversationId}, teamsSent=${finalState.dispatch.teamsSent}, websocketEmitted=${finalState.dispatch.websocketEmitted}`,
    );

    void this.conversationRepository.saveConversation({
      conversationId,
      userId,
      question,
      answer: finalState.finalAnswer,
      source: channel,
      channel,
      timestamp,
      matchedDocuments: [
        ...(finalState.serviceMatches || []),
        ...(finalState.quoteMatches || []),
      ].map((match) => ({
        id: match.id,
        sourceContainer: match.sourceContainer,
        similarity: match.similarity,
      })),
    });

    return {
      success: true,
      response: finalState.finalAnswer,
      conversationId,
      sessionId: conversationId,
      userId,
      channel,
      timestamp,
      meta: {
        plan: finalState.plan ?? { agents: {}, rationale: 'default' },
        serviceMatches: finalState.serviceMatches?.length ?? 0,
        quoteMatches: finalState.quoteMatches?.length ?? 0,
        imagesAnalyzed: finalState.imageInsights?.length ?? 0,
        piiRedactions: finalState.piiRedactions,
        dispatch: finalState.dispatch,
        trace: finalState.trace,
      },
    };
  }
}
