import { Injectable, Logger } from '@nestjs/common';

import { CosmosService } from '../database/cosmos.service';
import { SearchableContainer } from '../search/search.constants';
import { EmbeddingService } from './embedding.service';
import { EmbeddedDocumentService } from './embedded-document.service';

export interface BackfillResult {
  container: SearchableContainer;
  scanned: number;
  embedded: number;
  synced: number;
}

/** Back-fills existing catalog documents that do not have an embedding yet. */
@Injectable()
export class EmbeddingBackfillService {
  private readonly logger = new Logger(EmbeddingBackfillService.name);

  constructor(
    private readonly cosmosService: CosmosService,
    private readonly embeddingService: EmbeddingService,
    private readonly embeddedDocumentService: EmbeddedDocumentService,
  ) {}

  async backfill(
    containerName: SearchableContainer,
    limit: number,
  ): Promise<BackfillResult> {
    const container = this.cosmosService.getContainer(containerName);
    const { resources } = await container.items
      .query<Record<string, unknown>>({
        query: `
          SELECT TOP ${limit} c
          FROM c
          WHERE NOT IS_DEFINED(c.embedding)
             OR NOT IS_DEFINED(c.embeddingProjectionSyncedAt)
        `,
      })
      .fetchAll();

    const eligible = resources.map((document) => ({
      document,
      text:
        this.toEmbeddingText(containerName, document) ||
        this.toFallbackText(document),
    }));

    if (eligible.length === 0) {
      return { container: containerName, scanned: resources.length, embedded: 0, synced: 0 };
    }

    const documentsNeedingEmbedding = eligible.filter(
      ({ document }) => !this.asEmbedding(document.embedding),
    );
    const generatedEmbeddings = await Promise.all(
      documentsNeedingEmbedding.map((item) =>
        this.embeddingService.embed(item.text),
      ),
    );
    const generatedById = new Map(
      documentsNeedingEmbedding.map((item, index) => [
        String(item.document.id),
        generatedEmbeddings[index],
      ]),
    );

    await Promise.all(
      eligible.map(async ({ document, text }) => {
        const existingEmbedding = this.asEmbedding(document.embedding);
        const embedding = existingEmbedding ?? generatedById.get(String(document.id));
        if (!embedding) {
          return;
        }
        const embeddedDocument = {
          ...document,
          embedding,
          embeddingProjectionSyncedAt: new Date().toISOString(),
        };
        await container.items.upsert(embeddedDocument);
        await this.embeddedDocumentService.upsert(
          containerName,
          embeddedDocument,
          text,
          embedding,
        );
      }),
    );

    this.logger.log(
      `Embedded ${documentsNeedingEmbedding.length} and synced ${eligible.length} records in "${containerName}"`,
    );
    return {
      container: containerName,
      scanned: resources.length,
      embedded: documentsNeedingEmbedding.length,
      synced: eligible.length,
    };
  }

  private toEmbeddingText(
    container: SearchableContainer,
    document: Record<string, unknown>,
  ): string {
    const fields: Record<SearchableContainer, string[]> = {
      Service: ['name', 'description', 'category', 'location'],
      Vendor: ['companyName', 'productServiceOfferings', 'locationOfService'],
      Category: ['name', 'description'],
      AskOurExpert: ['name', 'description', 'specialization'],
    };
    const configuredText = fields[container]
      .map((field) => document[field])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
      .trim();
    if (configuredText) {
      return configuredText;
    }

    // Preserve migration progress for legacy documents whose field names do
    // not exactly match the current entity schema. Internal Cosmos/vector
    // fields are deliberately excluded from the searchable text.
    return Object.entries(document)
      .filter(
        ([key, value]) =>
          !['id', 'embedding', 'embeddingProjectionSyncedAt'].includes(key) &&
          !key.startsWith('_') &&
          typeof value === 'string' &&
          value.trim().length > 0,
      )
      .map(([, value]) => value as string)
      .join('\n')
      .trim();
  }

  private toFallbackText(document: Record<string, unknown>): string {
    const readableData = Object.fromEntries(
      Object.entries(document).filter(
        ([key]) =>
          !['embedding', 'embeddingProjectionSyncedAt'].includes(key) &&
          !key.startsWith('_'),
      ),
    );
    return JSON.stringify(readableData);
  }

  /** Cosmos SDKs can deserialize a vector as either an array or typed array. */
  private asEmbedding(value: unknown): number[] | undefined {
    if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      return value;
    }
    if (ArrayBuffer.isView(value)) {
      const values = Array.from(value as unknown as ArrayLike<number>);
      return values.every((item) => typeof item === 'number') ? values : undefined;
    }
    return undefined;
  }
}
