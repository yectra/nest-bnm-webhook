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

      // Ensure state is loaded from Cosmos DB if server restarted
      await this.notificationService.loadConversationReference();

      // Save conversation reference for proactive updates
      this.notificationService.saveConversationReference(
        TurnContext.getConversationReference(context.activity),
      );

      // Reload persisted state from Cosmos DB so the conversation map and
      // activeWebsiteConversationId are available even after a server restart.
      await this.notificationService.loadConversationReference();

      const message = context.activity.text?.trim() ?? '';
      const replyToId = context.activity.replyToId;
      const teamsConversationId = context.activity.conversation?.id;

      let websiteConversationId =
        this.notificationService.resolveWebsiteConversationId({
          replyToId,
          teamsConversationId,
          fallbackConversationId:
            this.notificationService.getActiveWebsiteConversationId(),
        });

      const activeWebsiteConversationId =
        this.notificationService.getActiveWebsiteConversationId();
      if (!websiteConversationId && activeWebsiteConversationId) {
        websiteConversationId = activeWebsiteConversationId;
        this.logger.log(
          `[TeamsRelay] Falling back to active website conversation. conversationId=${websiteConversationId}`,
        );
      }

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
      if (websiteConversationId) {
        this.notificationService.registerConversationLink(
          teamsConversationId ?? 'teams-default-session',
          websiteConversationId,
        );
        this.notificationService.setActiveWebsiteConversationId(
          websiteConversationId,
        );
      }
    }

      const mapKeys = this.notificationService.getMapKeys().join(', ');
      this.logger.log(
        `[TeamsRelay] Incoming Teams activity received. replyToId=${replyToId ?? 'n/a'}, teamsConversationId=${teamsConversationId ?? 'n/a'}, resolvedWebsiteConversationId=${websiteConversationId ?? 'n/a'}, knownMapKeys=[${mapKeys}]`,
      );

      if (websiteConversationId) {
        this.logger.log(
          `[TeamsRelay] Forwarding Teams reply to website UI. websiteConversationId=${websiteConversationId}, sourceMessage=${message}`,
        );

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
        this.logger.log(
          `[TeamsRelay] Persisted Teams reply to conversation record. conversationId=${websiteConversationId}`,
        );
        this.websiteRealtimeService.notifyWebsiteClients(agentRecord);
        this.logger.log(
          `[TeamsRelay] Emitted conversationUpdated event to website UI. conversationId=${websiteConversationId}`,
        );
        this.websiteRealtimeService.notifyDirectLineActivity(
          websiteConversationId,
          {
            type: 'message',
            id: `teams-${Date.now()}`,
            timestamp: timestamp,
            channelId: 'msteams',
            from: {
              id: context.activity.from?.id ?? 'teams-agent',
              name: context.activity.from?.name ?? 'Teams User',
            },
            conversation: {
              id: websiteConversationId,
            },
            text: message,
            replyToId,
          },
        );

        // Acknowledge in Teams safely
        try {
          await context.sendActivity('✅ Reply sent to website user.');
        } catch (err) {
          this.logger.warn(
            'Could not send activity acknowledgment in channel:',
            err,
          );
        }
      } else {
        const conversationId =
          context.activity.conversation?.id ?? 'teams-default-session';
        const userId = context.activity.from?.id ?? 'teams-user';

        this.logger.log(
          `Incoming Teams Message: "${message}" from userId=${userId}, convId=${conversationId}`,
        );

        // Delegate processing to ChatbotService via BotService with channel='Teams'
        const result = await this.botService.processMessage(
          message,
          conversationId,
          userId,
        );

        this.logger.log(
          `Teams AI Response generated: "${result.response.substring(0, 50)}..."`,
        );

        const formattedAttachment =
          TeamsFormattingUtil.formatResponseToAdaptiveCard(
            result.response ?? 'Sorry, I could not generate a response.',
          );

        try {
          await context.sendActivity({
            attachments: [formattedAttachment],
          });
        } catch (err) {
          this.logger.error('Failed to send activity response:', err);
        }
      }

      await next();
    });
  }
}
