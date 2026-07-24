import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { BotAdapter } from './bot.adapter';
import { TeamsBot } from './teams.bot';

@Module({
  imports: [ChatbotModule],
  controllers: [BotController],
  providers: [
    BotService,
    BotAdapter,
    TeamsBot,
  ],
})
export class BotModule {}