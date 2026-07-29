import { Injectable, Logger } from '@nestjs/common';
import { CardFactory, ConversationReference } from 'botbuilder';

import { BotAdapter } from './bot.adapter';
import { ResponseFormatterService } from './response-formatter-service';

export interface TeamsNotificationResult {
  sent: boolean;
  reason?: 'no_conversation_reference' | 'delivery_failed';
}

@Injectable()
export class TeamsNotificationService {
  private readonly logger = new Logger(TeamsNotificationService.name);
  private conversationReference?: Partial<ConversationReference>;

  constructor(
    private readonly adapter: BotAdapter,
    private readonly responseFormatterService: ResponseFormatterService,
  ) {}

  /** Called after a user has contacted the bot in Teams. */
  saveConversationReference(reference: Partial<ConversationReference>) {
    this.conversationReference = reference;
    this.logger.log('Teams conversation reference saved');
  }

  /** Sends a proactive card only after a Teams conversation has been established. */
  async sendMessage(data: {
    userId: string | null;
    sessionId: string;
    question: string;
    answer: string;
  }): Promise<TeamsNotificationResult> {
    if (!this.conversationReference) {
      this.logger.warn(
        'Teams notification skipped: no conversation reference. A user must first message the bot in Teams.',
      );
      return { sent: false, reason: 'no_conversation_reference' };
    }

    try {
      await this.adapter.continueConversationAsync(
        process.env.MICROSOFT_APP_ID!,
        this.conversationReference,
        async (context) => {
          const formatted = this.responseFormatterService.format(data.answer);

          const card = CardFactory.heroCard(
            '🤖 AI Chat Activity',
            [`Question:\n${data.question}`, '', `Answer:\n${formatted}`].join(
              '\n',
            ),
          );
          await context.sendActivity({
            attachments: [card],
          });
        },
      );
      this.logger.log('Teams proactive notification delivered');
      return { sent: true };
    } catch (error) {
      this.logger.error('Teams proactive notification failed', error);
      return { sent: false, reason: 'delivery_failed' };
    }
  }
}
