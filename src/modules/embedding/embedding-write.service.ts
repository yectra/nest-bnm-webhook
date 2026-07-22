import { Injectable, Logger } from '@nestjs/common';

import { Embeddable } from '../../common/interfaces/embeddable.interface';
import { CosmosService } from '../database/cosmos.service';
import { EmbeddingService } from './embedding.service';

/**
 * Generates and stores an embedding on write (Epic A / A2).
 *
 * Composes {@link EmbeddingService} (generation) with {@link CosmosService}
 * (persistence) so any write flow can persist an entity together with a fresh
 * embedding of its descriptive text. Kept separate from `EmbeddingService` so
 * the generator stays free of persistence concerns.
 */
@Injectable()
export class EmbeddingWriteService {
  private readonly logger = new Logger(EmbeddingWriteService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly cosmosService: CosmosService,
  ) {}

  /**
   * Embed `text`, attach it to `doc` at the `/embedding` path, and upsert the
   * document into `containerName`.
   *
   * @param containerName target Cosmos container.
   * @param doc entity document to persist.
   * @param text descriptive text to embed (e.g. name + description).
   * @returns the persisted document, including its embedding.
   */
  async upsertWithEmbedding<T extends Embeddable>(
    containerName: string,
    doc: T,
    text: string,
  ): Promise<T> {
    const embedding = await this.embeddingService.embed(text);
    const withEmbedding: T = { ...doc, embedding };

    const container = this.cosmosService.getContainer(containerName);
    const { resource } = await container.items.upsert<T>(withEmbedding);

    this.logger.log(`Upserted document with embedding into "${containerName}"`);
    return (resource as T) ?? withEmbedding;
  }
}
