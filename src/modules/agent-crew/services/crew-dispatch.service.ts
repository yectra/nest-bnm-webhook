import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { TeamsNotificationService } from '../../chatbot/services/teams-notification.service';
import { AgentCrewGateway } from '../agent-crew.gateway';
import { CrewDispatchResult } from '../interfaces/crew.interfaces';

/**
 * Terminal graph node: delivers the PII-filtered answer to the Microsoft
 * Teams channel (proactive card) and to connected WebSocket clients.
 */
@Injectable()
export class CrewDispatchService {
  private readonly logger = new Logger(CrewDispatchService.name);

  constructor(
    private readonly teamsNotificationService: TeamsNotificationService,
    @Inject(forwardRef(() => AgentCrewGateway))
    private readonly gateway: AgentCrewGateway,
  ) {}

  async dispatch(payload: {
    question: string;
    answer: string;
    conversationId: string;
    userId: string;
    channel: 'Website' | 'Teams';
    piiRedactions: string[];
  }): Promise<CrewDispatchResult> {
    const [teamsSent, websocketEmitted] = await Promise.all([
      this.sendToTeams(payload),
      Promise.resolve(this.emitToWebsocket(payload)),
    ]);
    return { teamsSent, websocketEmitted };
  }

  private async sendToTeams(payload: {
    question: string;
    answer: string;
    conversationId: string;
    userId: string;
  }): Promise<boolean> {
    try {
      const result = await this.teamsNotificationService.sendProactiveMessage({
        question: payload.question,
        answer: payload.answer,
        conversationId: payload.conversationId,
        userId: payload.userId,
      });
      if (!result.sent) {
        this.logger.warn(
          `Teams delivery skipped for conversationId=${payload.conversationId}: ${result.reason}`,
        );
      }
      return result.sent;
    } catch (error) {
      this.logger.error(
        `Teams delivery failed for conversationId=${payload.conversationId}`,
        error,
      );
      return false;
    }
  }

  private emitToWebsocket(payload: {
    question: string;
    answer: string;
    conversationId: string;
    userId: string;
    channel: 'Website' | 'Teams';
    piiRedactions: string[];
  }): boolean {
    try {
      this.gateway.emitCrewResponse(payload.conversationId, {
        conversationId: payload.conversationId,
        userId: payload.userId,
        channel: payload.channel,
        question: payload.question,
        answer: payload.answer,
        piiRedactions: payload.piiRedactions,
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `WebSocket emit failed for conversationId=${payload.conversationId}`,
        error,
      );
      return false;
    }
  }
}
