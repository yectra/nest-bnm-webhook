import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AIModule } from '../ai/ai.module';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ConversationService } from './services/conversation.service';
import { PromptService } from './services/prompt.service';
import { IntentService } from './services/intent.service';
import { AuthorizationService } from './services/authorization.service';
import { CosmosModule } from '../database/cosmos.module';
import { ContentModerationService } from './services/content-moderation.service';
import { ResponseFormatterService } from './services/response-formatter.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { EmbeddingModule } from '../embedding/embedding.module';
import { VectorSearchService } from './services/vector-search.service';

@Module({
  imports: [AIModule, CosmosModule, EmbeddingModule],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ConversationService,
    PromptService,
    IntentService,
    AuthorizationService,
    VectorSearchService,
    // New services for moderation and response formatting
    ContentModerationService,
    ResponseFormatterService,
    JwtAuthGuard,
    Reflector,
  ],
})
export class ChatbotModule {}
