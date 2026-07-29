import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CosmosService } from '../database/cosmos.service';

/** Persists the searchable projection used by the chatbot's vector index. */
@Injectable()
export class EmbeddedDocumentService {
  private readonly containerName: string;
  private readonly partitionKeyPath: string;

  constructor(
    private readonly cosmosService: CosmosService,
    config: ConfigService,
  ) {
    this.containerName =
      config.get<string>('EMBEDDED_DOCUMENTS_CONTAINER') ?? 'EmbeddedDocuments';
    this.partitionKeyPath =
      config.get<string>('EMBEDDED_DOCUMENTS_PARTITION_KEY') ?? '/id';
  }

  async upsert(
    sourceContainer: string,
    sourceDocument: Record<string, unknown>,
    content: string,
    embedding: number[],
  ): Promise<void> {
    const sourceId = String(sourceDocument.id);
    const ownerUserId =
      typeof sourceDocument.userId === 'string'
        ? sourceDocument.userId
        : undefined;
    const { embedding: _sourceEmbedding, ...sourceData } = sourceDocument;

    const container = await this.cosmosService.ensureVectorContainer(
      this.containerName,
      this.partitionKeyPath,
    );
    await container.items.upsert({
      id: `${sourceContainer}:${sourceId}`,
      sourceContainer,
      sourceId,
      ...(ownerUserId ? { ownerUserId } : {}),
      content,
      sourceData,
      embedding,
    });
  }
}
