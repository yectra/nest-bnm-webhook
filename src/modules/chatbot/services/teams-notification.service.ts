import { Injectable, Logger } from '@nestjs/common';
import { CardFactory, ConversationReference } from 'botbuilder';
import { BotAdapter } from '../../bot/bot.adapter';
import { CosmosRepository } from '../repositories/cosmos.repository';
import { TeamsFormattingUtil } from '../../bot/utils/teams-formatting.util';

export interface TeamsNotificationResult {
  sent: boolean;
  reason?: 'no_conversation_reference' | 'delivery_failed';
}

@Injectable()
export class TeamsNotificationService {
  private readonly logger = new Logger(TeamsNotificationService.name);
  private conversationReference?: Partial<ConversationReference>;
  private readonly messageToWebsiteMap = new Map<string, string>();
  private activeWebsiteConversationId?: string;
  private readonly containerName = 'TeamsConfig';
  private readonly referenceId = 'proactive-reference';

  constructor(
    private readonly adapter: BotAdapter,
    private readonly cosmosRepository: CosmosRepository,
  ) {}

  private persistState(): void {
    void this.cosmosRepository.saveItem(this.containerName, {
      id: this.referenceId,
      reference: this.conversationReference,
      map: Array.from(this.messageToWebsiteMap.entries()),
      activeWebsiteConversationId: this.activeWebsiteConversationId,
    }).catch(err => {
      this.logger.error('Failed to persist Teams state to Cosmos DB', err);
    });
  }

  /** Save conversation reference when user messages bot in Teams or bot is added */
  saveConversationReference(reference: Partial<ConversationReference>): void {
    this.conversationReference = reference;
    this.logger.log('Teams conversation reference saved to memory');
    this.persistState();
  }

  /** Try to reload state from Cosmos DB if memory is wiped */
  async loadConversationReference(): Promise<void> {
    if (this.conversationReference) return;

    try {
      const data = await this.cosmosRepository.getItem<{ id: string; reference?: Partial<ConversationReference>; map?: [string, string][]; activeWebsiteConversationId?: string; }>(
        this.containerName,
        this.referenceId,
      );
      if (data) {
        if (data.reference) this.conversationReference = data.reference;
        if (data.map) {
          for (const [k, v] of data.map) {
            this.messageToWebsiteMap.set(k, v);
          }
        }
        if (data.activeWebsiteConversationId) {
          this.activeWebsiteConversationId = data.activeWebsiteConversationId;
        }
        this.logger.log('Teams state reloaded from Cosmos DB');
      }
    } catch (error) {
      this.logger.error('Error reloading Teams conversation reference from Cosmos DB', error);
    }
  }

  /** Get active conversation reference */
  getConversationReference(): Partial<ConversationReference> | undefined {
    return this.conversationReference;
  }

  /** Look up which website conversation a Teams message is replying to */
  getWebsiteConversationId(teamsMessageId: string): string | undefined {
    return this.messageToWebsiteMap.get(teamsMessageId);
  }

  getActiveWebsiteConversationId(): string | undefined {
    return this.activeWebsiteConversationId;
  }

  getMapKeys(): string[] {
    return Array.from(this.messageToWebsiteMap.keys());
  }

  /** Send proactive Teams message/card. No AI or DB logic here. */
  async sendProactiveMessage(data: {
    question: string;
    answer: string;
    conversationId: string;
    userId?: string;
  }): Promise<TeamsNotificationResult> {
    await this.loadConversationReference();

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
          const card = TeamsFormattingUtil.formatProactiveMessage(data.question, data.answer);

          const response = await context.sendActivity({
            attachments: [card],
          });

          if (response?.id) {
            // Map the Teams message ID to the Website Conversation ID
            this.messageToWebsiteMap.set(response.id, data.conversationId);
            const cleanId = response.id.split('|')[0]; 
            this.messageToWebsiteMap.set(cleanId, data.conversationId);
          }
        },
      );

      this.activeWebsiteConversationId = data.conversationId;
      this.persistState();

      this.logger.log(`Proactive Teams notification sent for conversationId=${data.conversationId}`);
      return { sent: true };
    } catch (error) {
      this.logger.error('Failed to send proactive Teams notification', error);
      return { sent: false, reason: 'delivery_failed' };
    }
  }
}
