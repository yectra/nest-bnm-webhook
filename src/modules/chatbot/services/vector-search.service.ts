import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqlParameter } from '@azure/cosmos';
import { VectorSearchResult } from '../interfaces/vector-search.interface';
import { CosmosRepository } from '../repositories/cosmos.repository';
import { EmbeddingService } from './embedding.service';

export const DEFAULT_SEARCH_CONTAINER = 'EmbeddedDocuments';

@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);
  private readonly defaultContainer: string;
  private readonly topK: number;
  private readonly minSimilarity: number;

  constructor(
    private readonly cosmosRepository: CosmosRepository,
    private readonly embeddingService: EmbeddingService,
    config: ConfigService,
  ) {
    this.defaultContainer =
      config.get<string>('EMBEDDED_DOCUMENTS_CONTAINER') ?? DEFAULT_SEARCH_CONTAINER;
    this.topK = config.get<number>('CHATBOT_VECTOR_TOP_K') ?? 5;
    this.minSimilarity = 0.5; // Force 0.5 to bypass .env cache and trigger hot-reload
  }

  /**
   * Fast vector search. Searches ONLY the selected target container in Cosmos DB 
   * using the existing "embedding" field.
   */
  async search(
    question: string,
    targetContainer?: string | null,
    userId?: string | null,
  ): Promise<VectorSearchResult[]> {
    try {
      const queryEmbedding = await this.embeddingService.embed(question);
      const limit = Math.min(Math.max(Math.floor(this.topK), 1), 50);

      const containerToSearch = targetContainer || this.defaultContainer;

      this.logger.log(`Starting vector search on container: "${containerToSearch}"`);

      return await this.executeQueryOnContainer(
        queryEmbedding,
        containerToSearch,
        limit,
        userId,
      );
    } catch (error) {
      this.logger.warn('Embedding or vector search error, proceeding with 0 matches', error);
      return [];
    }
  }

  private async executeQueryOnContainer(
    queryEmbedding: number[],
    containerName: string,
    limit: number,
    userId?: string | null,
  ): Promise<VectorSearchResult[]> {
    const parameters: SqlParameter[] = [
      { name: '@embedding', value: queryEmbedding },
    ];

    let accessCondition = '1=1';
    if (userId) {
      accessCondition = '(NOT IS_DEFINED(c.ownerUserId) OR c.ownerUserId = @userId)';
      parameters.push({ name: '@userId', value: userId });
    }

    // Exclude dummy sample entries
    const testFilter = "NOT STARTSWITH(c.id, 'MovinService:')";

    const query = `
      SELECT TOP ${limit}
        VectorDistance(c.embedding, @embedding) AS distance,
        c AS document
      FROM c
      WHERE IS_DEFINED(c.embedding) AND ${accessCondition} AND ${testFilter}
      ORDER BY VectorDistance(c.embedding, @embedding)
    `;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const rawResults = await this.cosmosRepository.queryVector<{
        distance: number;
        document: Record<string, unknown>;
      }>(containerName, query, parameters, controller.signal).finally(() => {
        clearTimeout(timeoutId);
      });

      if (!rawResults || rawResults.length === 0) {
        this.logger.warn(`Vector query returned 0 raw results for container "${containerName}"`);
        return [];
      }

      this.logger.log(`Vector query returned ${rawResults.length} raw results. Processing similarities...`);

      const results: VectorSearchResult[] = rawResults
        .map(({ distance, document }) => {
          const similarity = 1 - distance;
          const { embedding: _emb, ...sourceData } = document;

          let rawSourceContainer =
            typeof document.sourceContainer === 'string' &&
            document.sourceContainer.length > 0
              ? document.sourceContainer
              : containerName;

          const cleanSourceContainer = rawSourceContainer.replace(/^Movin/i, '');

          let cleanId =
            typeof document.sourceId === 'string' && document.sourceId.length > 0
              ? document.sourceId
              : (typeof document.id === 'string' && document.id.includes(':')
                  ? document.id.split(':').slice(1).join(':')
                  : String(document.id ?? 'doc-id'));

          this.logger.debug(`Found document ${cleanId} with similarity ${similarity}`);

          return {
            id: cleanId,
            sourceContainer: cleanSourceContainer,
            sourceId: cleanId,
            distance,
            similarity,
            sourceData,
          };
        })
        .filter((r) => r.similarity >= this.minSimilarity)
        .sort((a, b) => a.distance - b.distance);

      this.logger.log(
        `Vector search completed on ONLY container "${containerName}": ${results.length} matches found after filtering (minSimilarity=${this.minSimilarity})`,
      );
      return results;
    } catch (error) {
      this.logger.error(
        `Vector search error on "${containerName}". Does this container have a Vector Indexing Policy?`,
        error instanceof Error ? error.stack : error,
      );
      return [];
    }
  }
}
