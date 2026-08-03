import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqlParameter } from '@azure/cosmos';
import { CosmosRepository } from '../../chatbot/repositories/cosmos.repository';
import { VectorSearchService } from '../../chatbot/services/vector-search.service';
import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';

/**
 * Retrieval agent for the user's own quotes. Combines vector matches from the
 * embedded documents projection (sourceContainer=Quote) with the user's most
 * recent documents from the Quote container itself.
 */
@Injectable()
export class QuoteAgentService {
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
      null,
      userId,
    );
    return matches.filter((match) =>
      /quote/i.test(match.sourceContainer ?? ''),
    );
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
