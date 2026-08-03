import { Injectable, Logger } from '@nestjs/common';
import { ActivityHandler } from 'botbuilder';
import { ConversationService } from '../../conversation/conversation.service';
import { WebsocketGateway } from '../../websocket/websocket.gateway';

@Injectable()
export class BotService extends ActivityHandler {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private conversationService: ConversationService,
    private websocketGateway: WebsocketGateway,
  ) {
    super();

    this.onMessage(async (context, next) => {
      try {
        const text = context.activity.text;

        // Ensure this is a reply to an existing conversation
        // In Teams, the replyToId is in context.activity.replyToId
        // For our simplified setup, we extract conversationId from text if we have to,
        // but normally it would be stored in the bot state or part of the activity data.
        // Assuming we pass conversationId when we send the proactive message,
        // we will parse it. E.g. user replies "CID: {id} My Answer"

        // Let's assume we use a structured format or just find pending.
        // For this demo, let's say the user types the Conversation ID at the beginning or we parse it.
        const match = text.match(/CID:\s*([a-fA-F0-9-]+)/);
        if (match && match[1]) {
          const conversationId = match[1];
          const humanReply = text.replace(match[0], '').trim();
          const author = context.activity.from.name || 'Teams Agent';

          await this.conversationService.updateConversationReply(
            conversationId,
            humanReply,
          );

          this.websocketGateway.broadcastReply(
            conversationId,
            humanReply,
            author,
          );

          await context.sendActivity('Reply processed and sent to website.');
        } else {
          await context.sendActivity(
            'Please include CID: <ConversationId> in your reply.',
          );
        }
      } catch (err) {
        this.logger.error('Failed to process message activity', err);
        await context.sendActivity('Error processing your reply.');
      }
      await next();
    });
  }
}
