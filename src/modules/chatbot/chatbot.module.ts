import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AIModule } from '../ai/ai.module';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ConversationService } from './services/conversation.service';
import { PromptService } from './services/prompt.service';
import { IntentService } from './services/intent.service';
import { AuthorizationService } from './services/authorization.service';
import { RetrievalService } from './services/retrieval.service';
import { CosmosModule } from '../database/cosmos.module';
import { QueryPlannerService } from './services/query-planner.service';
import { ContentModerationService } from './services/content-moderation.service';
import { ResponseFormatterService } from './services/response-formatter.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Module({
  imports: [AIModule, CosmosModule],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ConversationService,
    PromptService,
    IntentService,
    AuthorizationService,
    RetrievalService,
    QueryPlannerService,
    // New services for moderation and response formatting
    ContentModerationService,
    ResponseFormatterService,
    JwtAuthGuard,
    Reflector,
  ],
  exports: [ChatbotService],
})
export class ChatbotModule {}
