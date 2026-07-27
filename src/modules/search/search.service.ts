import { Injectable } from '@nestjs/common';

import { RetrievalResult } from '../../common/interfaces/retrieval-result.interface';
import { EmbeddingService } from '../embedding/embedding.service';
import { SearchRepository } from './search.repository';
import { DEFAULT_SEARCH_TOP, SEARCHABLE_CONTAINERS } from './search.constants';

/**
 * Semantic search orchestration (Epic A / A3).
 *
 * Embeds the query text via {@link EmbeddingService} (A2) and runs a
 * `VectorDistance` search across the searchable containers, merging and ranking
 * results by ascending distance (nearest first).
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly searchRepository: SearchRepository,
  ) {}

  /**
   * Semantic search over the marketplace catalog.
   *
   * @param query natural-language query.
   * @param containers containers to search (defaults to all searchable containers).
   * @param top max results (default {@link DEFAULT_SEARCH_TOP}).
   */
  async semanticSearch(
    query: string,
    containers?: string[],
    top: number = DEFAULT_SEARCH_TOP,
  ): Promise<RetrievalResult[]> {
    const targets =
      containers && containers.length > 0
        ? containers
        : [...SEARCHABLE_CONTAINERS];

    const queryVector = await this.embeddingService.embed(query);

    // Do not turn a configuration/indexing failure into an empty successful
    // response. An empty result is meaningful only after every target was
    // queried successfully.
    const perContainer = await Promise.all(
      targets.map((container) =>
        this.searchRepository.vectorSearch(container, queryVector, top),
      ),
    );

    return perContainer
      .flat()
      .sort((a, b) => a.score - b.score)
      .slice(0, top);
  }
}
