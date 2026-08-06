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
