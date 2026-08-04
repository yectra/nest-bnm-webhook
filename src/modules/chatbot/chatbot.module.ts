import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatGateway } from './gateway/chat.gateway';
import { ContainerClassifierService } from './services/container-classifier.service';
import { EmbeddingService } from './services/embedding.service';
import { VectorSearchService } from './services/vector-search.service';
import { PromptBuilderService } from './services/prompt-builder.service';
import { AIService } from './services/ai.service';
import { TeamsNotificationService } from './services/teams-notification.service';
import { WebsiteRealtimeService } from './services/website-realtime.service';
import { ConversationRepository } from './repositories/conversation.repository';
import { CosmosRepository } from './repositories/cosmos.repository';
import { BotAdapter } from '../bot/bot.adapter';

@Module({
  imports: [],
  controllers: [ChatbotController],
  providers: [
    BotAdapter,
    CosmosRepository,
    ConversationRepository,
    ContainerClassifierService,
    EmbeddingService,
    VectorSearchService,
    PromptBuilderService,
    AIService,
    TeamsNotificationService,
    WebsiteRealtimeService,
    ChatGateway,
    ChatbotService,
  ],
  exports: [
    ChatbotService,
    ConversationRepository,
    TeamsNotificationService,
    WebsiteRealtimeService,
    ChatGateway,
    CosmosRepository,
    EmbeddingService,
    VectorSearchService,
  ],
})
export class ChatbotModule {}
