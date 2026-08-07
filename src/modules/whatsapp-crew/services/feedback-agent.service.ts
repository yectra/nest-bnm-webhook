import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosRepository } from '../../chatbot/repositories/cosmos.repository';
import { VectorSearchService } from '../../chatbot/services/vector-search.service';
import { WhatsappRecordRetrievalAgent } from './record-retrieval-agent.base';

const FEEDBACK_KEYWORDS =
  /\b(feedback|review|rating|survey|form|complaint|complain|unhappy|disappointed|satisfied|experience|thank)\b/i;

/** Retrieval agent for the customer's feedback form responses. */
@Injectable()
export class FeedbackAgentService extends WhatsappRecordRetrievalAgent {
  readonly name = 'feedbackAgent';
  readonly planKey = 'useFeedback';
  readonly planningHint =
    "look up the customer's feedback form responses; true when the message " +
    'mentions feedback, a review, a rating, a survey, a complaint, or their ' +
    'experience with completed work';
  readonly domain = 'feedback' as const;
  readonly matchChannel = 'feedbackMatches' as const;

  protected readonly logger = new Logger(FeedbackAgentService.name);
  protected readonly container: string;
  protected readonly keywordPattern = FEEDBACK_KEYWORDS;

  constructor(
    vectorSearchService: VectorSearchService,
    cosmosRepository: CosmosRepository,
    config: ConfigService,
  ) {
    super(
      vectorSearchService,
      cosmosRepository,
      config.get<number>('AGENT_CREW_TOP_K') ?? 5,
    );
    this.container =
      config.get<string>('WHATSAPP_CREW_FEEDBACK_CONTAINER') ?? 'Feedback';
  }
}
