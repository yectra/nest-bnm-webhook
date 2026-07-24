import { Injectable } from '@nestjs/common';
import { ActivityHandler, TurnContext } from 'botbuilder';
import { BotService } from './bot.service';

@Injectable()
export class TeamsBot extends ActivityHandler {
  constructor(private readonly botService: BotService) {
    super();

    this.onMessage(async (context: TurnContext, next) => {
      TurnContext.removeRecipientMention(context.activity);

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
