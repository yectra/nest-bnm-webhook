import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqlParameter } from '@azure/cosmos';
import { CosmosRepository } from '../../chatbot/repositories/cosmos.repository';
import { VectorSearchService } from '../../chatbot/services/vector-search.service';
import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';
import { CrewAgentDefinition } from '../graph/crew-agent.definition';
import { CrewState, traceEntry } from '../graph/crew-state';

const QUOTE_KEYWORDS =
  /\b(quote|quotes|quotation|quotations|estimate|estimates|approval|approved|my request)\b/i;

/**
 * Retrieval agent for the user's own quotes. Combines vector matches from the
 * embedded documents projection (sourceContainer=Quote) with the user's most
 * recent documents from the Quote container itself.
 */
@Injectable()
export class QuoteAgentService implements CrewAgentDefinition {
  readonly name = 'quoteAgent';
  readonly planKey = 'useQuotes';
  readonly planningHint =
    "look up the user's own quotes / estimates; true when the question " +
    'mentions quotes, quotations, estimates, approvals, pricing the user ' +
    'requested, or "my" requests';

  private readonly logger = new Logger(QuoteAgentService.name);
  private readonly quoteContainer: string;
  private readonly topK: number;

  constructor(
    private readonly vectorSearchService: VectorSearchService,
    private readonly cosmosRepository: CosmosRepository,
    config: ConfigService,
  ) {
    this.quoteContainer =
      config.get<string>('AGENT_CREW_QUOTE_CONTAINER') ?? 'Quote';
    this.topK = config.get<number>('AGENT_CREW_TOP_K') ?? 5;
  }

  enabled(): boolean {
    return true;
  }

  planHeuristic(question: string): boolean {
    return QUOTE_KEYWORDS.test(question);
  }

  async run(state: CrewState): Promise<Partial<CrewState>> {
    const quoteMatches = await this.retrieve(state.question, state.userId);
    return {
      quoteMatches,
      trace: [
        traceEntry(this.name, `retrieved ${quoteMatches.length} quote records`),
      ],
    };
  }

  async retrieve(
    question: string,
    userId?: string,
  ): Promise<VectorSearchResult[]> {
    const [vectorMatches, recentQuotes] = await Promise.all([
      this.searchQuoteVectors(question, userId),
      this.fetchRecentQuotes(userId),
    ]);

    const merged = new Map<string, VectorSearchResult>();
    for (const match of [...vectorMatches, ...recentQuotes]) {
      if (!merged.has(match.id)) {
        merged.set(match.id, match);
      }
    }

    const results = Array.from(merged.values()).slice(0, this.topK);
    this.logger.log(
      `Quote agent: ${vectorMatches.length} vector + ${recentQuotes.length} recent -> ${results.length} merged quote records`,
    );
    return results;
  }

  private async searchQuoteVectors(
    question: string,
    userId?: string,
  ): Promise<VectorSearchResult[]> {
    const matches = await this.vectorSearchService.search(
      question,
      this.quoteContainer,
      userId,
    );
    return matches;
  }

  private async fetchRecentQuotes(
    userId?: string,
  ): Promise<VectorSearchResult[]> {
    const parameters: SqlParameter[] = [];
    let userCondition = '1=1';
    if (userId) {
      userCondition = '(c.userId = @userId OR c.ownerUserId = @userId)';
      parameters.push({ name: '@userId', value: userId });
    }

    const query = `
      SELECT TOP ${this.topK} c
      FROM c
      WHERE ${userCondition}
      ORDER BY c._ts DESC
    `;

    const rows = await this.cosmosRepository.queryVector<{
      c: Record<string, unknown>;
    }>(this.quoteContainer, query, parameters);

    return rows.map(({ c }) => {
      const sourceData = { ...c };
      delete sourceData.embedding;
      const id = typeof c.id === 'string' ? c.id : 'quote';
      return {
        id,
        sourceContainer: this.quoteContainer,
        sourceId: id,
        distance: 0,
        similarity: 1,
        sourceData,
      };
    });
  }
}
