import { Injectable, Logger } from '@nestjs/common';

import { AIService } from '../ai/ai.service';
import { AuthorizationService } from './services/authorization.service';
import { ContentModerationService } from './services/content-moderation.service';
import { ConversationService } from './services/conversation.service';
import { PromptService } from './services/prompt.service';
import { ResponseFormatterService } from './services/response-formatter.service';
import { TeamsNotificationService } from '../bot/teams-notification.service';
import { VectorSearchService } from './services/vector-search.service';

const NO_RELEVANT_INFORMATION = 'No relevant information found.';

/** Coordinates a chat response using only Cosmos native vector-search matches. */
@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly aiService: AIService,
    private readonly conversationService: ConversationService,
    private readonly promptService: PromptService,
    private readonly authorizationService: AuthorizationService,
    private readonly vectorSearchService: VectorSearchService,
    private readonly contentModerationService: ContentModerationService,
    private readonly responseFormatterService: ResponseFormatterService,
    private readonly teamsNotificationService: TeamsNotificationService,
  ) {}

  async chat(
    userId: string | null,
    tenantId: string | undefined,
    message: string,
    sessionId: string,
    notifyTeams = true,
  ) {
    this.logger.log(
      `Chat request from userId=${userId ?? 'anonymous'}, tenantId=${tenantId ?? 'none'}, sessionId=${sessionId}`,
    );

    if (await this.contentModerationService.isFlagged(message)) {
      return {
        success: false,
        response: 'Your message violates content policy.',
        sessionId,
      };
    }

    const authorization = this.authorizationService.authorize(message);
    if (!authorization.allowed) {
      return { success: false, response: authorization.reason, sessionId };
    }

    this.conversationService.addMessage(sessionId, {
      role: 'user',
      content: message,
    });
    const history = this.conversationService.getMessages(sessionId);

    // Generates the query vector and executes VectorDistance inside Cosmos DB.
    // No keyword, CONTAINS, LIKE, summary, or application-side vector matching.
    const matches = await this.vectorSearchService.search(message, userId);
    if (matches.length === 0) {
      this.conversationService.addMessage(sessionId, {
        role: 'assistant',
        content: NO_RELEVANT_INFORMATION,
      });
      return {
        success: true,
        response: NO_RELEVANT_INFORMATION,
        sessionId,
        meta: { matchedDocuments: [], totalMatches: 0 },
      };
    }

    const prompt = this.promptService.buildPrompt(
      history,
      matches,
      message,
      userId ?? 'anonymous',
    );
    const answer = this.responseFormatterService.format(
      await this.aiService.generate(prompt),
    );

    const formatted = this.responseFormatterService.format(answer);

    // 👇 Send to Teams
    const teamsNotification = notifyTeams
      ? await this.teamsNotificationService.sendMessage({
          userId,
          sessionId,
          question: message,
          answer: formatted,
        })
      : { sent: false, reason: 'not_requested' };

    this.conversationService.addMessage(sessionId, {
      role: 'assistant',
      content: answer,
    });

    return {
      success: true,
      response: answer,
      sessionId,
      meta: {
        totalMatches: matches.length,
        matchedDocuments: matches.map((match) => ({
          id: match.id,
          sourceContainer: match.sourceContainer,
          sourceId: match.sourceId,
          similarity: match.similarity,
          distance: match.distance,
        })),
        teamsNotification,
      },
    };
  }
}
