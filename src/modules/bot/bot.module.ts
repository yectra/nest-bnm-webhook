import { forwardRef, Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { BotAdapter } from './bot.adapter';
import { TeamsBot } from './teams.bot';
import { ChatbotModule } from '../chatbot/chatbot.module';

@Module({
  imports: [forwardRef(() => ChatbotModule)],
  controllers: [BotController],
  providers: [
    BotService,
    BotAdapter,
    TeamsBot,
  ],
  exports: [BotAdapter, BotService],
})
export class BotModule {}
