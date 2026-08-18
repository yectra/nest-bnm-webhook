import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Container } from '@azure/cosmos';

import { CosmosService } from '../../database/cosmos.service';
import type { EmbeddedPromptInjectionChunk } from '../interfaces/prompt-injection.interface';

/** Marker written on every document this RAG owns. */
export const PROMPT_INJECTION_DOC_TYPE = 'prompt-injection';

/**
 * Cosmos DB persistence for the known-prompt-injection RAG.
 *
 * The corpus lives in its own vector-enabled container so a rebuild can purge
 * and rewrite it wholesale. Purging is still scoped by `docType` rather than
 * "delete everything", so pointing the container setting at a shared container
 * by mistake cannot destroy unrelated data.
 */
@Injectable()
export class PromptInjectionRagRepository {
  private readonly logger = new Logger(PromptInjectionRagRepository.name);
  private readonly containerName: string;
  private readonly partitionKeyPath: string;
  /** Field backing the partition key, e.g. `injectionId` for `/injectionId`. */
  private readonly partitionKeyField: string;

  constructor(
    private readonly cosmosService: CosmosService,
    config: ConfigService,
  ) {
    this.containerName =
      config.get<string>('whatsappAgent.promptInjectionRag.container') ??
      'PromptInjectionRag';
    this.partitionKeyPath =
      config.get<string>('whatsappAgent.promptInjectionRag.partitionKeyPath') ??
      '/injectionId';
    this.partitionKeyField = this.partitionKeyPath.replace(/^\//, '');
  }

  getContainerName(): string {
    return this.containerName;
  }

  /** Create the DiskANN vector container if it does not exist yet. */
  async ensureContainer(): Promise<Container> {
    return this.cosmosService.ensureVectorContainer(
      this.containerName,
      this.partitionKeyPath,
    );
  }

  /**
   * Delete every document of this RAG, if any.
   *
   * @returns the number of documents removed (0 when the RAG did not exist).
   */
  async deleteExistingRag(): Promise<number> {
    const container = await this.ensureContainer();
    const { resources } = await container.items
      .query<Record<string, string>>({
        query: `SELECT c.id, c["${this.partitionKeyField}"] AS partitionKey FROM c WHERE c.docType = @docType`,
        parameters: [{ name: '@docType', value: PROMPT_INJECTION_DOC_TYPE }],
      })
      .fetchAll();

    let deleted = 0;
    for (const doc of resources) {
      // A document written before the partition key field existed falls back to
      // its own id, which is how Cosmos partitions an unset key path.
      const partitionKey = doc.partitionKey ?? doc.id;
      await container.item(doc.id, partitionKey).delete();
      deleted += 1;
    }

    this.logger.log(
      `Deleted ${deleted} existing prompt-injection document(s) from "${this.containerName}"`,
    );
    return deleted;
  }

  /**
   * Upsert embedded chunks into the container.
   *
   * @returns the number of documents written.
   */
  async upsertChunks(chunks: EmbeddedPromptInjectionChunk[]): Promise<number> {
    if (chunks.length === 0) {
      return 0;
    }
    const container = await this.ensureContainer();
    const updatedAt = new Date().toISOString();

    let upserted = 0;
    for (const chunk of chunks) {
      await container.items.upsert({
        ...chunk,
        docType: PROMPT_INJECTION_DOC_TYPE,
        updatedAt,
      });
      upserted += 1;
    }

    this.logger.log(
      `Upserted ${upserted} prompt-injection chunk(s) into "${this.containerName}"`,
    );
    return upserted;
  }
}
