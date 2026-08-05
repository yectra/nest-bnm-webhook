import { Injectable, Logger } from '@nestjs/common';
import { ActivityHandler, TurnContext } from 'botbuilder';
import { BotService } from './bot.service';
import { TeamsNotificationService } from '../chatbot/services/teams-notification.service';
import { ConversationRepository } from '../chatbot/repositories/conversation.repository';
import { WebsiteRealtimeService } from '../chatbot/services/website-realtime.service';
import { TeamsFormattingUtil } from './utils/teams-formatting.util';

@Injectable()
export class TeamsBot extends ActivityHandler {
  private readonly logger = new Logger(TeamsBot.name);

  constructor(
    private readonly botService: BotService,
    private readonly notificationService: TeamsNotificationService,
    private readonly conversationRepository: ConversationRepository,
    private readonly websiteRealtimeService: WebsiteRealtimeService,
  ) {
    super();

    // Teams sends this event when the bot is installed or added to a chat/team.
    this.onMembersAdded(async (context, next) => {
      this.notificationService.saveConversationReference(
        TurnContext.getConversationReference(context.activity),
      );
      await next();
    });

    this.onConversationUpdate(async (context, next) => {
      this.notificationService.saveConversationReference(
        TurnContext.getConversationReference(context.activity),
      );
      await next();
    });

    this.onInstallationUpdate(async (context, next) => {
      this.notificationService.saveConversationReference(
        TurnContext.getConversationReference(context.activity),
      );
      await next();
    });

    this.onMessage(async (context: TurnContext, next) => {
      TurnContext.removeRecipientMention(context.activity);

      // Save conversation reference for proactive updates
      this.notificationService.saveConversationReference(
        TurnContext.getConversationReference(context.activity),
      );

      // Reload persisted state from Cosmos DB so the conversation map and
      // activeWebsiteConversationId are available even after a server restart.
      await this.notificationService.loadConversationReference();

      const message = context.activity.text?.trim() ?? '';
      const replyToId = context.activity.replyToId;

      let websiteConversationId = replyToId
        ? this.notificationService.getWebsiteConversationId(replyToId)
        : undefined;

      // Fallback 1: Extract thread root message ID from conversation ID in Teams (for threaded channel replies)
      if (!websiteConversationId && context.activity.conversation?.id) {
        const convId = context.activity.conversation.id;
        const match = convId.match(/messageid=([^;]+)/);
        if (match && match[1]) {
          websiteConversationId = this.notificationService.getWebsiteConversationId(match[1]);
        }
      }

      // Fallback 2: If they didn't reply to a specific message/thread, route to the active conversation
      if (!websiteConversationId) {
        websiteConversationId = this.notificationService.getActiveWebsiteConversationId();
      }

      const mapKeys = this.notificationService.getMapKeys().join(', ');
      this.logger.log(`[DEBUG] Incoming Teams Message. replyToId=${replyToId}. Mapped websiteConversationId=${websiteConversationId}. Known Map Keys: [${mapKeys}]`);

      if (websiteConversationId) {
        this.logger.log(`Intercepted Live Agent reply to Website conversationId=${websiteConversationId}`);
        
        const timestamp = new Date().toISOString();
        const agentRecord = {
          conversationId: websiteConversationId,
          userId: context.activity.from?.id ?? 'teams-agent',
          question: '', // It's an answer from the agent
          answer: message,
          source: 'Teams' as const,
          channel: 'Website' as const, // Destination channel
          timestamp,
        };

        // Save to DB and push to Website in real-time
        await this.conversationRepository.saveConversation(agentRecord);
        this.websiteRealtimeService.notifyWebsiteClients(agentRecord);

        // Acknowledge in Teams
        await context.sendActivity('✅ Reply sent to website user.');
      } else {
        const conversationId = context.activity.conversation?.id ?? 'teams-default-session';
        const userId = context.activity.from?.id ?? 'teams-user';

        this.logger.log(`Incoming Teams Message: "${message}" from userId=${userId}, convId=${conversationId}`);

        // Delegate processing to ChatbotService via BotService with channel='Teams'
        const result = await this.botService.processMessage(message, conversationId, userId);

        this.logger.log(`Teams AI Response generated: "${result.response.substring(0, 50)}..."`);

        const formattedAttachment = TeamsFormattingUtil.formatResponseToAdaptiveCard(
          result.response ?? 'Sorry, I could not generate a response.',
        );

        await context.sendActivity({
          attachments: [formattedAttachment],
        });
      }

      await next();
    });
  }
}
