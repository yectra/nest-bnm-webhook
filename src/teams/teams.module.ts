import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { BotController } from './bot/bot.controller';
import { BotService } from './bot/bot.service';
import { ConversationModule } from '../conversation/conversation.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [ConversationModule, WebsocketModule],
  controllers: [BotController],
  providers: [TeamsService, BotService],
  exports: [TeamsService],
})
export class TeamsModule {}
