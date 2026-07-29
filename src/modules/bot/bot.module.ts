import { forwardRef, Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { BotAdapter } from './bot.adapter';
import { TeamsBot } from './teams.bot';
import { TeamsNotificationService } from './teams-notification.service';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { ResponseFormatterService } from './response-formatter-service';

/**
 * BotModule encapsulates all bot‑related providers. It no longer imports the
 * ChatbotModule to avoid a circular dependency. The ChatbotModule will import
 * ChatbotModule imports this module for Teams notifications; BotService imports
 * ChatbotModule to process incoming Teams messages, so the module relationship
 * is explicitly resolved with forwardRef.
 */
@Module({
  imports: [forwardRef(() => ChatbotModule)],
  controllers: [BotController],
  providers: [
    BotService,
    BotAdapter,
    TeamsBot,
    TeamsNotificationService,
    ResponseFormatterService,
  ],
  exports: [BotAdapter, TeamsNotificationService],
})
export class BotModule {}
