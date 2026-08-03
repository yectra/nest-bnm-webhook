import { Injectable, Logger } from '@nestjs/common';
import { ConversationReference } from 'botbuilder';
import { BotAdapter } from '../../bot/bot.adapter';
import { CosmosRepository } from '../repositories/cosmos.repository';
import { TeamsFormattingUtil } from '../../bot/utils/teams-formatting.util';

export interface TeamsNotificationResult {
  sent: boolean;
  reason?: 'no_conversation_reference' | 'delivery_failed';
}

export interface TeamsConversationResolutionInput {
  replyToId?: string;
  teamsConversationId?: string;
  fallbackConversationId?: string;
}

@Injectable()
export class TeamsNotificationService {
  private readonly logger = new Logger(TeamsNotificationService.name);
  private conversationReference?: Partial<ConversationReference>;
  private readonly messageToWebsiteMap = new Map<string, string>();
  private readonly teamsConversationToWebsiteMap = new Map<string, string>();
  private activeWebsiteConversationId?: string;
  private readonly containerName = 'TeamsConfig';
  private readonly referenceId = 'proactive-reference';

  constructor(
    private readonly adapter: BotAdapter,
    private readonly cosmosRepository: CosmosRepository,
  ) {}

  private persistState(): void {
    if (!this.cosmosRepository?.saveItem) {
      return;
    }

    void this.cosmosRepository
      .saveItem(this.containerName, {
        id: this.referenceId,
        reference: this.conversationReference,
        map: Array.from(this.messageToWebsiteMap.entries()),
        teamMap: Array.from(this.teamsConversationToWebsiteMap.entries()),
        activeWebsiteConversationId: this.activeWebsiteConversationId,
      })
      .catch((err) => {
        this.logger.error('Failed to persist Teams state to Cosmos DB', err);
      });
  }

  /** Save conversation reference when user messages bot in Teams or bot is added */
  saveConversationReference(reference: Partial<ConversationReference>): void {
    if (reference.channelId && reference.channelId !== 'msteams') {
      this.logger.warn(
        `Skipping conversation reference save for non-Teams channel: '${reference.channelId}'`,
      );
      return;
    }
    this.conversationReference = reference;
    this.logger.log('Teams conversation reference saved to memory');
    this.persistState();
  }

  /** Try to reload state from Cosmos DB if memory is wiped */
  async loadConversationReference(): Promise<void> {
    if (this.conversationReference && this.activeWebsiteConversationId) return;
    if (!this.cosmosRepository?.getItem) return;

    try {
      const data = await this.cosmosRepository.getItem<{
        id: string;
        reference?: Partial<ConversationReference>;
        map?: [string, string][];
        teamMap?: [string, string][];
        activeWebsiteConversationId?: string;
      }>(this.containerName, this.referenceId);
      if (data) {
        if (data.reference) this.conversationReference = data.reference;
        if (data.map) {
          for (const [k, v] of data.map) {
            this.messageToWebsiteMap.set(k, v);
          }
        }
        if (data.teamMap) {
          for (const [k, v] of data.teamMap) {
            this.teamsConversationToWebsiteMap.set(k, v);
          }
        }
        if (data.activeWebsiteConversationId) {
          this.activeWebsiteConversationId = data.activeWebsiteConversationId;
        }
        this.logger.log('Teams state reloaded from Cosmos DB');
      }
    } catch (error) {
      this.logger.error(
        'Error reloading Teams conversation reference from Cosmos DB',
        error,
      );
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

  setActiveWebsiteConversationId(conversationId: string): void {
    this.activeWebsiteConversationId = conversationId;
    this.persistState();
  }

  registerConversationLink(
    teamsConversationId: string,
    websiteConversationId: string,
  ): void {
    if (!teamsConversationId || !websiteConversationId) {
      return;
    }

    this.teamsConversationToWebsiteMap.set(
      teamsConversationId,
      websiteConversationId,
    );
    this.persistState();
  }

  resolveWebsiteConversationId(
    input: TeamsConversationResolutionInput,
  ): string | undefined {
    const { replyToId, teamsConversationId, fallbackConversationId } = input;
    const cleanReplyToId = replyToId ? replyToId.split('|')[0] : undefined;

    for (const candidate of [replyToId, cleanReplyToId].filter(
      Boolean,
    ) as string[]) {
      const mapped = this.messageToWebsiteMap.get(candidate);
      if (mapped) {
        return mapped;
      }
    }

    if (teamsConversationId) {
      const mappedByTeamsConversation =
        this.teamsConversationToWebsiteMap.get(teamsConversationId);
      if (mappedByTeamsConversation) {
        return mappedByTeamsConversation;
      }
    }

    if (
      fallbackConversationId &&
      fallbackConversationId !== 'website-fallback'
    ) {
      return fallbackConversationId;
    }

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
    this.logger.log(
      `[TeamsRelay] Starting proactive Teams send for conversationId=${data.conversationId}, userId=${data.userId ?? 'unknown'}`,
    );
    await this.loadConversationReference();

    if (!this.conversationReference) {
      this.logger.warn(
        `[TeamsRelay] Teams proactive message skipped: No active conversation reference available for conversationId=${data.conversationId}`,
      );
      return { sent: false, reason: 'no_conversation_reference' };
    }

    this.logger.log(
      `[TeamsRelay] Loaded Teams conversation reference for conversationId=${data.conversationId}, conversationId=${this.conversationReference?.conversation?.id ?? 'n/a'}`,
    );

    try {
      const appId = process.env.MICROSOFT_APP_ID ?? '';
      const teamsConversationId = this.conversationReference?.conversation?.id;
      await this.adapter.continueConversationAsync(
        appId,
        this.conversationReference,
        async (context) => {
          const card = TeamsFormattingUtil.formatProactiveMessage(
            data.question,
            data.answer,
          );

          this.logger.log(
            `[TeamsRelay] Sending proactive Teams card for conversationId=${data.conversationId}`,
          );
          const response = await context.sendActivity({
            attachments: [card],
          });

          if (response?.id) {
            this.logger.log(
              `[TeamsRelay] Teams card delivered. Teams message id=${response.id}, websiteConversationId=${data.conversationId}`,
            );
            this.messageToWebsiteMap.set(response.id, data.conversationId);
            const cleanId = response.id.split('|')[0];
            this.messageToWebsiteMap.set(cleanId, data.conversationId);
          } else {
            this.logger.warn(
              `[TeamsRelay] Teams card send completed without a response id for conversationId=${data.conversationId}`,
            );
          }
        },
      );

      if (teamsConversationId) {
        this.registerConversationLink(teamsConversationId, data.conversationId);
      }
      this.setActiveWebsiteConversationId(data.conversationId);

      this.logger.log(
        `[TeamsRelay] Proactive Teams notification completed successfully for conversationId=${data.conversationId}`,
      );
      return { sent: true };
    } catch (error) {
      this.logger.error(
        `[TeamsRelay] Failed to send proactive Teams notification for conversationId=${data.conversationId}`,
        error,
      );
      return { sent: false, reason: 'delivery_failed' };
    }
  }
}
