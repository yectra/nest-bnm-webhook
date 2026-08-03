import { Injectable, Logger } from '@nestjs/common';
import { ChatMessageDto } from './dto/chat-message.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { ContainerClassifierService } from './services/container-classifier.service';
import { VectorSearchService } from './services/vector-search.service';
import { PromptBuilderService } from './services/prompt-builder.service';
import { AIService } from './services/ai.service';
import { TeamsNotificationService } from './services/teams-notification.service';
import { WebsiteRealtimeService } from './services/website-realtime.service';
import { ConversationRepository } from './repositories/conversation.repository';
import { ConversationRecord } from './interfaces/conversation.interface';
import { VectorSearchResult } from './interfaces/vector-search.interface';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly containerClassifier: ContainerClassifierService,
    private readonly vectorSearchService: VectorSearchService,
    private readonly promptBuilderService: PromptBuilderService,
    private readonly aiService: AIService,
    private readonly conversationRepository: ConversationRepository,
    private readonly teamsNotificationService: TeamsNotificationService,
    private readonly websiteRealtimeService: WebsiteRealtimeService,
  ) {}

  /**
   * Single Orchestrator Entrypoint for both Website Chat UI and Microsoft Teams.
   * Follows the exact 10-step flow requested.
   */
  async processMessage(dto: ChatMessageDto): Promise<ChatResponseDto> {
    const message = dto.message.trim();
    const conversationId =
      dto.conversationId || dto.sessionId || 'default-session';
    const userId = dto.userId || 'anonymous';
    const channel = dto.channel || 'Website';
    const timestamp = new Date().toISOString();

    this.logger.log(
      `[ChatbotFlow] Stage 1: Website question received. channel=${channel}, userId=${userId}, conversationId=${conversationId}, message="${message}"`,
    );

    // Step 3a: Identify the correct Cosmos DB container (Service, Vendor, AskOurExpert, Project, etc.)
    const classification = this.containerClassifier.classify(message);
    this.logger.log(
      `[ChatbotFlow] Stage 2: Container classification complete. domain=${classification.domain}, container=${classification.container}`,
    );

    // Step 3b & 3c: Generate embedding and search selected container using vector distance
    this.logger.log(
      `[ChatbotFlow] Stage 3: Starting vector search. query="${message}", container=${classification.container}, userId=${userId}`,
    );
    const matches = await this.vectorSearchService.search(
      message,
      classification.container,
      userId,
    );
    this.logger.log(
      `[ChatbotFlow] Stage 3 complete: Vector search returned ${matches.length} match(es)`,
    );

    // Step 3d: If no matching document is found, return user-friendly message
    if (matches.length === 0) {
      const fallbackResponse =
        "Sorry, I couldn't find any matching information.";
      this.logger.warn(
        `[ChatbotFlow] Stage 4: No relevant matches found. conversationId=${conversationId}, userId=${userId}`,
      );
      const noMatchRecord: ConversationRecord = {
        conversationId,
        userId,
        question: message,
        answer: fallbackResponse,
        source: channel,
        channel,
        timestamp,
        matchedDocuments: [],
      };

      void this.conversationRepository.saveConversation(noMatchRecord);
      void this.synchronizeChannels(channel, noMatchRecord);

      return {
        success: true,
        response: fallbackResponse,
        conversationId,
        sessionId: conversationId,
        userId,
        channel,
        timestamp,
        meta: {
          domain: classification.domain,
          container: classification.container,
          totalMatches: 0,
          matchedDocuments: [],
        },
      };
    }

    // Step 4: Build AI prompt using ONLY retrieved documents
    this.logger.log(
      `[ChatbotFlow] Stage 4: Building AI prompt from ${matches.length} retrieved documents. conversationId=${conversationId}`,
    );
    const history =
      this.conversationRepository.getFormattedHistory(conversationId);
    const prompt = this.promptBuilderService.buildPrompt(
      history,
      matches,
      message,
      userId,
      classification.domain,
    );

    // Step 5: Generate final response using Azure AI Foundry GPT
    this.logger.log(
      `[ChatbotFlow] Stage 5: Generating AI answer. conversationId=${conversationId}`,
    );
    const aiAnswer = await this.aiService.generate(prompt);
    this.logger.log(
      `[ChatbotFlow] Stage 5 complete: AI answer generated. conversationId=${conversationId}, answerLength=${aiAnswer.length}`,
    );

    // Step 6: Build and store conversation record
    const conversationRecord: ConversationRecord = {
      conversationId,
      userId,
      question: message,
      answer: aiAnswer,
      source: channel,
      channel,
      timestamp,
      matchedDocuments: matches.map((m) => ({
        id: m.id,
        sourceContainer: m.sourceContainer,
        similarity: m.similarity,
      })),
    };

    this.logger.log(
      `[ChatbotFlow] Stage 6: Saving conversation record. conversationId=${conversationId}, channel=${channel}`,
    );
    void this.conversationRepository.saveConversation(conversationRecord);

    // Step 7 & 8: Post message to Microsoft Teams Bot (asynchronous background sync)
    this.logger.log(
      `[ChatbotFlow] Stage 7: Starting cross-channel synchronization. originatingChannel=${channel}, conversationId=${conversationId}`,
    );
    void this.synchronizeChannels(channel, conversationRecord);

    // Step 6: Return response immediately to originating client (Website or Teams)
    return {
      success: true,
      response: aiAnswer,
      conversationId,
      sessionId: conversationId,
      userId,
      channel,
      timestamp,
      meta: {
        domain: classification.domain,
        container: classification.container,
        totalMatches: matches.length,
        matchedDocuments: matches.map((m) => ({
          id: m.id,
          sourceContainer: m.sourceContainer,
          similarity: m.similarity,
        })),
      },
    };
  }

  /** Legacy adapter method for backward compatibility */
  async chat(
    userId: string | null,
    tenantId: string | undefined,
    message: string,
    sessionId: string,
    channel: 'Website' | 'Teams' = 'Website',
  ) {
    return this.processMessage({
      message,
      sessionId,
      conversationId: sessionId,
      userId: userId ?? undefined,
      tenantId,
      channel,
    });
  }

  /** Background cross-channel synchronization to Microsoft Teams and Website clients */
  private async synchronizeChannels(
    originatingChannel: 'Website' | 'Teams',
    record: ConversationRecord,
  ) {
    try {
      this.logger.log(
        `[ChatbotFlow] Stage 7a: Emitting website realtime update. conversationId=${record.conversationId}`,
      );
      this.websiteRealtimeService.notifyWebsiteClients(record);
    } catch (error) {
      this.logger.error('Website real-time synchronization error', error);
    }

    if (originatingChannel === 'Website') {
      try {
        this.logger.log(
          `[ChatbotFlow] Stage 7b: Sending proactive Teams message. conversationId=${record.conversationId}`,
        );
        await this.teamsNotificationService.sendProactiveMessage({
          question: record.question,
          answer: record.answer,
          conversationId: record.conversationId,
          userId: record.userId,
        });
      } catch (error) {
        this.logger.error('Teams proactive notification sync error', error);
      }
    } else {
      this.logger.log(
        `[ChatbotFlow] Stage 7b skipped: originating channel is Teams, no proactive Teams send required. conversationId=${record.conversationId}`,
      );
    }
  }
}
