import { Logger } from '@nestjs/common';
import { SqlParameter } from '@azure/cosmos';
import { CosmosRepository } from '../../chatbot/repositories/cosmos.repository';
import { VectorSearchService } from '../../chatbot/services/vector-search.service';
import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';
import {
  WhatsappCrewAgentDefinition,
  WHATSAPP_CREW_AGENTS,
} from '../graph/whatsapp-crew-agent.definition';
import { WhatsappCrewState, waTraceEntry } from '../graph/whatsapp-crew-state';
import {
  AttributionDomain,
  WhatsappMatchChannel,
} from '../interfaces/whatsapp-crew.interfaces';

// Re-export so agents only need one import site for registry wiring.
export { WHATSAPP_CREW_AGENTS };

/**
 * Shared retrieval strategy for the journey agents (project / quote /
 * requirements / feedback): merge semantic vector matches for the message
 * with the customer's most recent documents from the journey's container.
 * WhatsApp customers are identified by phone (WaId), so the recency query
 * also matches common phone fields alongside userId/ownerUserId.
 */
export abstract class WhatsappRecordRetrievalAgent implements WhatsappCrewAgentDefinition {
  abstract readonly name: string;
  abstract readonly planKey: string;
  abstract readonly planningHint: string;
  abstract readonly domain: AttributionDomain;
  abstract readonly matchChannel: WhatsappMatchChannel;

  protected abstract readonly logger: Logger;
  protected abstract readonly container: string;
  protected abstract readonly keywordPattern: RegExp;

  constructor(
    private readonly vectorSearchService: VectorSearchService,
    private readonly cosmosRepository: CosmosRepository,
    protected readonly topK: number,
  ) {}

  enabled(): boolean {
    return true;
  }

  planHeuristic(question: string): boolean {
    return this.keywordPattern.test(question);
  }

  async run(state: WhatsappCrewState): Promise<Partial<WhatsappCrewState>> {
    const matches = await this.retrieve(
      state.question,
      state.userId,
      state.message?.waId,
    );
    return {
      [this.matchChannel]: matches,
      trace: [
        waTraceEntry(
          this.name,
          `retrieved ${matches.length} ${this.domain} records from ${this.container}`,
        ),
      ],
    };
  }

  async retrieve(
    question: string,
    userId?: string,
    waId?: string,
  ): Promise<VectorSearchResult[]> {
    const [vectorMatches, recentRecords] = await Promise.all([
      this.searchVectors(question, userId),
      this.fetchRecentRecords(userId, waId),
    ]);

    const merged = new Map<string, VectorSearchResult>();
    for (const match of [...vectorMatches, ...recentRecords]) {
      if (!merged.has(match.id)) {
        merged.set(match.id, match);
      }
    }

    const results = Array.from(merged.values()).slice(0, this.topK);
    this.logger.log(
      `${this.name}: ${vectorMatches.length} vector + ${recentRecords.length} recent -> ${results.length} merged ${this.domain} records`,
    );
    return results;
  }

  private async searchVectors(
    question: string,
    userId?: string,
  ): Promise<VectorSearchResult[]> {
    try {
      return await this.vectorSearchService.search(
        question,
        this.container,
        userId,
      );
    } catch (error) {
      this.logger.warn(
        `${this.name}: vector search failed on ${this.container}`,
        error,
      );
      return [];
    }
  }

  private async fetchRecentRecords(
    userId?: string,
    waId?: string,
  ): Promise<VectorSearchResult[]> {
    const parameters: SqlParameter[] = [];
    const conditions: string[] = [];

    if (userId) {
      conditions.push('c.userId = @userId', 'c.ownerUserId = @userId');
      parameters.push({ name: '@userId', value: userId });
    }
    if (waId) {
      conditions.push(
        'CONTAINS(c.phone, @waId)',
        'CONTAINS(c.phoneNumber, @waId)',
        'CONTAINS(c.mobileNumber, @waId)',
        'CONTAINS(c.whatsappNumber, @waId)',
      );
      parameters.push({ name: '@waId', value: waId });
    }

    const userCondition =
      conditions.length > 0 ? `(${conditions.join(' OR ')})` : '1=1';

    const query = `
      SELECT TOP ${this.topK} c
      FROM c
      WHERE ${userCondition}
      ORDER BY c._ts DESC
    `;

    try {
      const rows = await this.cosmosRepository.queryVector<{
        c: Record<string, unknown>;
      }>(this.container, query, parameters);

      return rows.map(({ c }) => {
        const sourceData = { ...c };
        delete sourceData.embedding;
        const id = typeof c.id === 'string' ? c.id : this.container;
        return {
          id,
          sourceContainer: this.container,
          sourceId: id,
          distance: 0,
          similarity: 1,
          sourceData,
        };
      });
    } catch (error) {
      this.logger.warn(
        `${this.name}: recent-records query failed on ${this.container}`,
        error,
      );
      return [];
    }
  }
}
