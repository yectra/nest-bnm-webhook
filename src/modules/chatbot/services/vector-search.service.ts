import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqlParameter } from '@azure/cosmos';

import { VectorSearchResult } from '../../../common/interfaces/vector-search-result.interface';
import { CosmosService } from '../../database/cosmos.service';
import { EmbeddingService } from '../../embedding/embedding.service';

/**
 * Executes native Cosmos DB ANN vector searches for the chatbot. The complete
 * embedding corpus is never loaded into Node.js.
 */
@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);
  private readonly containerName: string;
  private readonly topK: number;
  private readonly minSimilarity: number;
  private readonly partitionKeyPath: string;

  constructor(
    private readonly cosmosService: CosmosService,
    private readonly embeddingService: EmbeddingService,
    config: ConfigService,
  ) {
    this.containerName =
      config.get<string>('EMBEDDED_DOCUMENTS_CONTAINER') ?? 'EmbeddedDocuments';
    this.topK = config.get<number>('CHATBOT_VECTOR_TOP_K') ?? 5;
    this.minSimilarity =
      config.get<number>('CHATBOT_VECTOR_MIN_SIMILARITY') ?? 0.7;
    this.partitionKeyPath =
      config.get<string>('EMBEDDED_DOCUMENTS_PARTITION_KEY') ?? '/id';
  }

  async search(
    question: string,
    userId: string | null,
  ): Promise<VectorSearchResult[]> {
    const queryEmbedding = await this.embeddingService.embed(question);
    this.logger.debug(
      `Generated query embedding (${queryEmbedding.length} dimensions) for vector retrieval`,
    );

    const limit = Math.min(Math.max(Math.floor(this.topK), 1), 50);
    const parameters: SqlParameter[] = [
      { name: '@embedding', value: queryEmbedding },
    ];
    const accessCondition = userId
      ? '(NOT IS_DEFINED(c.ownerUserId) OR c.ownerUserId = @userId)'
      : 'NOT IS_DEFINED(c.ownerUserId)';
    if (userId) {
      parameters.push({ name: '@userId', value: userId });
    }

    const query = `
      SELECT TOP ${limit}
        VectorDistance(c.embedding, @embedding) AS distance,
        c AS document
      FROM c
      WHERE IS_DEFINED(c.embedding) AND ${accessCondition}
      ORDER BY VectorDistance(c.embedding, @embedding)
    `;

    try {
      // Creates a missing container with the required immutable vector policy.
      // Existing containers are never modified by this operation.
      const container = await this.cosmosService.ensureVectorContainer(
        this.containerName,
        this.partitionKeyPath,
      );
      const { resources } = await container.items
        .query<{ distance: number; document: Record<string, unknown> }>({
          query,
          parameters,
        })
        .fetchAll();

      const results = resources
        .map(({ distance, document }) => this.toResult(distance, document))
        .filter((result) => result.similarity >= this.minSimilarity)
        .sort((a, b) => a.distance - b.distance);

      this.logger.log(
        `Cosmos vector search completed: ${results.length}/${resources.length} matches above similarity ${this.minSimilarity}`,
      );
      return results;
    } catch (error) {
      this.logger.error(
        `Cosmos vector search failed for container "${this.containerName}"`,
        error,
      );
      throw new ServiceUnavailableException(
        'EmbeddedDocuments is unavailable or is not configured for Cosmos vector search',
      );
    }
  }

  private toResult(
    distance: number,
    document: Record<string, unknown>,
  ): VectorSearchResult {
    const sourceData =
      this.asRecord(document.sourceData) ?? this.stripInternalFields(document);
    return {
      id: String(document.id),
      sourceContainer:
        typeof document.sourceContainer === 'string'
          ? document.sourceContainer
          : undefined,
      sourceId:
        typeof document.sourceId === 'string' ? document.sourceId : undefined,
      distance,
      similarity: 1 - distance,
      sourceData,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private stripInternalFields(
    document: Record<string, unknown>,
  ): Record<string, unknown> {
    const { embedding: _embedding, ...sourceData } = document;
    return sourceData;
  }
}
