import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import {
  ConversationService,
  ConversationItem,
} from '../conversation/conversation.service';
import { TeamsService } from '../teams/teams.service';
import * as crypto from 'crypto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private aiService: AiService,
    private retrievalService: RetrievalService,
    private conversationService: ConversationService,
    private teamsService: TeamsService,
  ) {}

  async handleChat(
    question: string,
  ): Promise<{ answer: string; conversationId: string }> {
    const conversationId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    // 1. Generate embedding for the question
    const embedding = await this.aiService.generateEmbedding(question);

    // 2. Search vector database
    const context =
      await this.retrievalService.searchSimilarDocuments(embedding);

    // 3. Generate Azure OpenAI response
    const aiAnswer = await this.aiService.generateAnswer(question, context);

    // 4. Store Conversation
    const conversationItem: ConversationItem = {
      id: conversationId,
      question,
      aiAnswer,
      status: 'PENDING_HUMAN',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.conversationService.createConversation(conversationItem);

    // 5. Asynchronously send message to Teams
    // Fire and forget
    this.teamsService.notifyTeams(conversationItem).catch((err) => {
      this.logger.error('Failed to notify teams asynchronously', err);
    });

    // 6. Return answer to Website immediately
    return {
      answer: aiAnswer,
      conversationId,
    };
  }
}
