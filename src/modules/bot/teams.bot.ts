import { Injectable } from '@nestjs/common';
import { ActivityHandler, TurnContext } from 'botbuilder';
import { BotService } from './bot.service';
import { TeamsNotificationService } from './teams-notification.service';

@Injectable()
export class TeamsBot extends ActivityHandler {
  constructor(
    private readonly botService: BotService,
    private readonly notificationService: TeamsNotificationService,
  ) {
    super();

    // Teams sends this event when the bot is installed or added to a chat/team.
    // Capture it so proactive notifications can be sent without requiring the
    // user to first type a normal message.
    this.onMembersAdded(async (context, next) => {
      this.notificationService.saveConversationReference(
        TurnContext.getConversationReference(context.activity),
      );
      await next();
    });

    this.onMessage(async (context: TurnContext, next) => {
      TurnContext.removeRecipientMention(context.activity);

      this.notificationService.saveConversationReference(
        TurnContext.getConversationReference(context.activity),
      );

      const message = context.activity.text?.trim() ?? '';

      console.log('Teams Message:', message);

      const result = await this.botService.processMessage(message);

      console.log('AI Response:', result.response);

      await context.sendActivity(
        result.response ?? 'Sorry, I could not generate a response.',
      );

      await next();
    });
  }
}
