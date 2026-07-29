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
    const conversationId = dto.conversationId || dto.sessionId || 'default-session';
    const userId = dto.userId || 'anonymous';
    const channel = dto.channel || 'Website';
    const timestamp = new Date().toISOString();

    this.logger.log(
      `[ChatbotService] Received message: "${message}" from channel="${channel}", userId="${userId}"`,
    );

    // Step 3a: Identify the correct Cosmos DB container (Service, Vendor, AskOurExpert, Project, etc.)
    const classification = this.containerClassifier.classify(message);

    // Step 3b & 3c: Generate embedding and search selected container using vector distance
    const matches = await this.vectorSearchService.search(message, classification.container, userId);

    // Step 3d: If no matching document is found, return user-friendly message
    if (matches.length === 0) {
      const fallbackResponse = "Sorry, I couldn't find any matching information.";
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
    const history = this.conversationRepository.getFormattedHistory(conversationId);
    const prompt = this.promptBuilderService.buildPrompt(
      history,
      matches,
      message,
      userId,
      classification.domain,
    );

    // Step 5: Generate final response using Azure AI Foundry GPT
    const aiAnswer = await this.aiService.generate(prompt);

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

    void this.conversationRepository.saveConversation(conversationRecord);

    // Step 7 & 8: Post message to Microsoft Teams Bot (asynchronous background sync)
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
      this.websiteRealtimeService.notifyWebsiteClients(record);
    } catch (error) {
      this.logger.error('Website real-time synchronization error', error);
    }

    if (originatingChannel === 'Website') {
      try {
        await this.teamsNotificationService.sendProactiveMessage({
          question: record.question,
          answer: record.answer,
          conversationId: record.conversationId,
          userId: record.userId,
        });
      } catch (error) {
        this.logger.error('Teams proactive notification sync error', error);
      }
    }
  }
}
