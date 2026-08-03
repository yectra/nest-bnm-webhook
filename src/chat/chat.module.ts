import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { AiModule } from '../ai/ai.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ConversationModule } from '../conversation/conversation.module';
import { TeamsModule } from '../teams/teams.module';

@Module({
  imports: [AiModule, RetrievalModule, ConversationModule, TeamsModule],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatModule {}
