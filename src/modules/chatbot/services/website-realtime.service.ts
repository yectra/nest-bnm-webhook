import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ChatGateway } from '../gateway/chat.gateway';
import { ConversationRecord } from '../interfaces/conversation.interface';

@Injectable()
export class WebsiteRealtimeService {
  private readonly logger = new Logger(WebsiteRealtimeService.name);

  constructor(
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  private extraEmitters: ((record: ConversationRecord) => void)[] = [];

  /** Allow other modules (like AgentCrewGateway) to register for realtime updates */
  registerEmitter(emitter: (record: ConversationRecord) => void): void {
    this.extraEmitters.push(emitter);
  }

  /** Emit new conversation record to connected website clients in real-time */
  notifyWebsiteClients(record: ConversationRecord): void {
    try {
      this.chatGateway.emitToSession(
        record.conversationId,
        'conversationUpdated',
        record,
      );
      this.logger.log(
        `[TeamsRelay] Website realtime event 'conversationUpdated' emitted for conversationId=${record.conversationId}`,
      );

      for (const emitter of this.extraEmitters) {
        try {
          emitter(record);
        } catch (err) {
          this.logger.error('Error in extra realtime emitter', err);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to emit website realtime update for conversationId=${record.conversationId}`,
        error,
      );
    }
  }

  notifyDirectLineActivity(
    sessionId: string,
    activity: Record<string, unknown>,
  ): void {
    try {
      this.chatGateway.emitDirectLineActivity(sessionId, activity);
      this.logger.log(
        `[TeamsRelay] Website realtime event 'activity' emitted for conversationId=${sessionId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to emit Direct Line activity for conversationId=${sessionId}`,
        error,
      );
    }
  }
}
