import { Injectable, Logger } from '@nestjs/common';
import { CardFactory, ConversationReference } from 'botbuilder';
import { BotAdapter } from '../../bot/bot.adapter';

export interface TeamsNotificationResult {
  sent: boolean;
  reason?: 'no_conversation_reference' | 'delivery_failed';
}

@Injectable()
export class TeamsNotificationService {
  private readonly logger = new Logger(TeamsNotificationService.name);
  private conversationReference?: Partial<ConversationReference>;
  private readonly messageToWebsiteMap = new Map<string, string>();

  constructor(private readonly adapter: BotAdapter) {}

  /** Save conversation reference when user messages bot in Teams or bot is added */
  saveConversationReference(reference: Partial<ConversationReference>): void {
    this.conversationReference = reference;
    this.logger.log('Teams conversation reference saved');
  }

  /** Get active conversation reference */
  getConversationReference(): Partial<ConversationReference> | undefined {
    return this.conversationReference;
  }

  /** Look up which website conversation a Teams message is replying to */
  getWebsiteConversationId(teamsMessageId: string): string | undefined {
    return this.messageToWebsiteMap.get(teamsMessageId);
  }

  /** Send proactive Teams message/card. No AI or DB logic here. */
  async sendProactiveMessage(data: {
    question: string;
    answer: string;
    conversationId: string;
    userId?: string;
  }): Promise<TeamsNotificationResult> {
    if (!this.conversationReference) {
      this.logger.warn(
        'Teams proactive message skipped: No active conversation reference available.',
      );
      return { sent: false, reason: 'no_conversation_reference' };
    }

    try {
      const appId = process.env.MICROSOFT_APP_ID ?? '';
      await this.adapter.continueConversationAsync(
        appId,
        this.conversationReference,
        async (context) => {
          const card = CardFactory.heroCard(
            '🤖 AI Chatbot Synchronized Message',
            `**Question:**\n${data.question}\n\n**Answer:**\n${data.answer}`,
          );

          const response = await context.sendActivity({
            attachments: [card],
          });

          if (response?.id) {
            // Map the Teams message ID to the Website Conversation ID
            this.messageToWebsiteMap.set(response.id, data.conversationId);
            // Also store it without the prefix just in case Teams modifies the replyToId format
            const cleanId = response.id.split('|')[0]; 
            this.messageToWebsiteMap.set(cleanId, data.conversationId);
          }
        },
      );

      this.logger.log(`Proactive Teams notification sent for conversationId=${data.conversationId}`);
      return { sent: true };
    } catch (error) {
      this.logger.error('Failed to send proactive Teams notification', error);
      return { sent: false, reason: 'delivery_failed' };
    }
  }
}
