import { Injectable, Logger } from '@nestjs/common';
import { SqlParameter } from '@azure/cosmos';

import { RetrievalResult } from '../../common/interfaces/retrieval-result.interface';
import { CosmosService } from '../database/cosmos.service';
import { DEFAULT_SEARCH_TOP, MAX_SEARCH_TOP } from './search.constants';

/**
 * Vector search data access (Epic A / A3).
 *
 * Runs a Cosmos `VectorDistance` query against the DiskANN index provisioned in
 * A1, ordering by ascending distance (nearest first, cosine distance). Controllers
 * never call this directly — they go through {@link SearchService}.
 */
@Injectable()
export class SearchRepository {
  private readonly logger = new Logger(SearchRepository.name);

  constructor(private readonly cosmosService: CosmosService) {}

  /**
   * Find the documents in `containerName` whose embedding is nearest to
   * `queryVector`.
   *
   * @param containerName container to search.
   * @param queryVector query embedding (must match the container's vector dims).
   * @param top max results (clamped to [1, {@link MAX_SEARCH_TOP}]).
   */
  async vectorSearch(
    containerName: string,
    queryVector: number[],
    top: number = DEFAULT_SEARCH_TOP,
  ): Promise<RetrievalResult[]> {
    const limit = Math.min(
      Math.max(Math.floor(top) || DEFAULT_SEARCH_TOP, 1),
      MAX_SEARCH_TOP,
    );
    const parameters: SqlParameter[] = [
      { name: '@embedding', value: queryVector },
    ];

    // `top` is a sanitized integer (interpolated, like the existing retrieval
    // queries); the query vector is bound as a parameter.
    const sql = `
      SELECT TOP ${limit}
        VectorDistance(c.embedding, @embedding) AS score,
        c AS document
      FROM c
      WHERE IS_DEFINED(c.embedding)
      ORDER BY VectorDistance(c.embedding, @embedding)
    `;

    try {
      const container = this.cosmosService.getContainer(containerName);
      const { resources } = await container.items
        .query<{ score: number; document: Record<string, any> }>({
          query: sql,
          parameters,
        })
        .fetchAll();

      return resources.map((row) => {
        const data = { ...row.document };
        delete data.embedding;
        return { container: containerName, score: row.score, data };
      });
    } catch (error) {
      this.logger.error(
        `Vector search failed for container "${containerName}"`,
        error,
      );
      throw error;
    }
  }
}
