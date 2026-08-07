import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosRepository } from '../../chatbot/repositories/cosmos.repository';
import { VectorSearchService } from '../../chatbot/services/vector-search.service';
import { WhatsappRecordRetrievalAgent } from './record-retrieval-agent.base';

const QUOTE_KEYWORDS =
  /\b(quote|quotes|quotation|quotations|estimate|estimates|price|pricing|cost|budget|approval|approved|discount)\b/i;

/** Retrieval agent for the customer's quote details. */
@Injectable()
export class QuoteDetailsAgentService extends WhatsappRecordRetrievalAgent {
  readonly name = 'quoteAgent';
  readonly planKey = 'useQuotes';
  readonly planningHint =
    "look up the customer's quotes / estimates; true when the message " +
    'mentions quotes, quotations, estimates, pricing, cost, budget, or ' +
    'approvals';
  readonly domain = 'quote' as const;
  readonly matchChannel = 'quoteMatches' as const;

  protected readonly logger = new Logger(QuoteDetailsAgentService.name);
  protected readonly container: string;
  protected readonly keywordPattern = QUOTE_KEYWORDS;

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
      config.get<string>('AGENT_CREW_QUOTE_CONTAINER') ?? 'Quote';
  }
}
