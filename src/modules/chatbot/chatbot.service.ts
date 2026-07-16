import { Injectable, Logger } from '@nestjs/common';
import { AIService } from '../ai/ai.service';
import { ConversationService } from './services/conversation.service';
import { PromptService } from './services/prompt.service';
import { AuthorizationService } from './services/authorization.service';
import {
  RetrievalService,
  ContainerResult,
} from './services/retrieval.service';
import { QueryPlannerService } from './services/query-planner.service';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly aiService: AIService,
    private readonly conversationService: ConversationService,
    private readonly promptService: PromptService,
    private readonly authorizationService: AuthorizationService,
    private readonly retrievalService: RetrievalService,
    private readonly queryPlannerService: QueryPlannerService,
  ) {}

  /**
   * Main chat handler.
   *
   * @param userId    Authenticated user's ID extracted from JWT
   * @param tenantId  Optional tenant ID from JWT
   * @param message   The user's natural language question
   * @param sessionId Conversation session identifier
   */
  async chat(
    userId: string | null,
    tenantId: string | undefined,
    message: string,
    sessionId: string,
  ) {
    this.logger.log(
      `Chat request from userId=${userId ?? 'anonymous'}, sessionId=${sessionId}`,
    );

    // ──────────────────────────────────────────────
    // 1. Authorization — check for blocked keywords
    // ──────────────────────────────────────────────
    const authorization = this.authorizationService.authorize(message);

    if (!authorization.allowed) {
      return {
        success: false,
        response: authorization.reason,
        sessionId,
      };
    }

    // ──────────────────────────────────────────────
    // 2. Save user message to conversation history
    // ──────────────────────────────────────────────
    this.conversationService.addMessage(sessionId, {
      role: 'user',
      content: message,
    });

    // ──────────────────────────────────────────────
    // 3. Retrieve conversation history for context
    // ──────────────────────────────────────────────
    const history = this.conversationService.getMessages(sessionId);

    // ──────────────────────────────────────────────
    // 4. AI-driven query planning
    //    Determines which containers to query and what filters to apply
    // ──────────────────────────────────────────────
    let knowledge: ContainerResult[] = [];

    try {
      const queryPlan = await this.queryPlannerService.plan(message);

      this.logger.log(
        `Query plan: ${JSON.stringify({ containers: queryPlan.containers, operation: queryPlan.operation, filters: queryPlan.filters })}`,
      );

      // ──────────────────────────────────────────────
      // 5. Retrieve data from Cosmos DB using the plan
      //    Authenticated  → full access scoped to their userId
      //    Anonymous      → Service, AskOurExpert, Category only
      // ──────────────────────────────────────────────
      if (userId) {
        // Authenticated user — full access
        if (queryPlan.operation === 'SUMMARY') {
          knowledge = await this.retrievalService.getBusinessSummary(userId);
        } else if (queryPlan.containers.length > 0) {
          knowledge = await this.retrievalService.fetchByContainers(
            queryPlan.containers,
            userId,
            queryPlan.filters,
          );
        }
      } else {
        // Anonymous user — public containers only
        if (queryPlan.operation === 'SUMMARY') {
          knowledge = await this.retrievalService.getPublicSummary();
        } else if (queryPlan.containers.length > 0) {
          // fetchByContainers will silently skip private containers
          knowledge = await this.retrievalService.fetchByContainers(
            queryPlan.containers,
            null,
            queryPlan.filters,
          );
        }
      }
    } catch (error) {
      this.logger.error('Query planning or retrieval failed', error);
      // Continue with empty knowledge — AI will state no records found
      knowledge = [];
    }

    // ──────────────────────────────────────────────
    // 6. Build the prompt with user identity (if any) + retrieved data
    // ──────────────────────────────────────────────
    const prompt = this.promptService.buildPrompt(
      history,
      knowledge,
      message,
      userId ?? 'anonymous',
    );

    // ──────────────────────────────────────────────
    // 7. Generate AI response
    // ──────────────────────────────────────────────
    const answer = await this.aiService.generate(prompt);

    // ──────────────────────────────────────────────
    // 8. Save assistant response to conversation history
    // ──────────────────────────────────────────────
    this.conversationService.addMessage(sessionId, {
      role: 'assistant',
      content: answer,
    });

    // ──────────────────────────────────────────────
    // 9. Return response
    // ──────────────────────────────────────────────
    return {
      success: true,
      response: answer,
      sessionId,
      meta: {
        containersQueried: knowledge.map((k) => k.container),
        totalRecords: knowledge.reduce((sum, k) => sum + k.count, 0),
      },
    };
  }
}
