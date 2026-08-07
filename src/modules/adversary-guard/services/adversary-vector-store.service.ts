import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { CosmosRepository } from '../../chatbot/repositories/cosmos.repository';
import { EmbeddingService } from '../../chatbot/services/embedding.service';
import { ADVERSARY_SEED_EXEMPLARS } from '../adversary-exemplars';
import { AdversarySemanticMatch } from '../interfaces/adversary-guard.interfaces';

/**
 * Cosmos DB vector container of known adversarial inputs. Exemplar phrases
 * are stored with their embeddings; classifying an inbound message is a
 * single embedding call (near-free) plus one VectorDistance query — no big
 * LLM involved. The container is created and seeded on startup, and
 * confirmed attacks found at runtime are upserted back (source='learned')
 * so the semantic net widens over time for every workflow that shares it.
 */
@Injectable()
export class AdversaryVectorStoreService {
  private readonly logger = new Logger(AdversaryVectorStoreService.name);
  private readonly containerName: string;
  private readonly topK: number;
  private readonly seedEnabled: boolean;

  constructor(
    private readonly cosmosRepository: CosmosRepository,
    private readonly embeddingService: EmbeddingService,
    config: ConfigService,
  ) {
    this.containerName =
      config.get<string>('ADVERSARY_GUARD_CONTAINER') ?? 'AdversarialInputs';
    this.topK = config.get<number>('ADVERSARY_GUARD_TOP_K') ?? 3;
    const seedFlag = config.get<string | boolean>('ADVERSARY_GUARD_SEED');
    this.seedEnabled = seedFlag !== 'false' && seedFlag !== false;
  }

  /** Create the vector container if needed and upsert missing seed exemplars. */
  async ensureSeeded(): Promise<void> {
    if (!this.seedEnabled) {
      this.logger.log('Adversary exemplar seeding disabled by config');
      return;
    }
    try {
      await this.cosmosRepository.ensureVectorContainer(
        this.containerName,
        '/id',
      );

      const existingIds = new Set(
        await this.cosmosRepository.queryVector<string>(
          this.containerName,
          'SELECT VALUE c.id FROM c',
          [],
        ),
      );

      const missing = ADVERSARY_SEED_EXEMPLARS.map((seed) => ({
        ...seed,
        id: this.exemplarId('seed', seed.text),
      })).filter((seed) => !existingIds.has(seed.id));

      for (const seed of missing) {
        await this.upsertExemplar(seed.id, seed.text, seed.label, 'seed');
      }

      this.logger.log(
        `Adversary vector store ready: container="${this.containerName}", seeded ${missing.length} new exemplars (${existingIds.size} already present)`,
      );
    } catch (error) {
      // Never block startup on guard infrastructure; the pattern pass and
      // LLM review still protect the crews.
      this.logger.error(
        `Failed to seed adversary vector store "${this.containerName}"`,
        error,
      );
    }
  }

  /** Closest known-attack exemplar for the given text, or null. */
  async findClosestMatch(text: string): Promise<AdversarySemanticMatch | null> {
    const embedding = await this.embeddingService.embed(text);

    // Dedicated single-purpose container, so the query needs no WHERE clause
    // (see vector-search.service.ts for the SDK bug that combination hits).
    const query = `
      SELECT TOP ${this.topK}
        VectorDistance(c.embedding, @embedding) AS distance,
        c.id AS id,
        c.text AS text,
        c.label AS label
      FROM c
      ORDER BY VectorDistance(c.embedding, @embedding)
    `;

    const rows = await this.cosmosRepository.queryVector<{
      distance: number;
      id: string;
      text: string;
      label: string;
    }>(this.containerName, query, [{ name: '@embedding', value: embedding }]);

    if (!rows || rows.length === 0) {
      return null;
    }

    const best = rows[0];
    return {
      id: best.id,
      text: best.text,
      label: best.label,
      similarity: 1 - best.distance,
    };
  }

  /**
   * Record a confirmed adversarial input so future paraphrases of it are
   * caught semantically. Idempotent: the id is derived from the text.
   */
  async addLearnedExemplar(text: string, label: string): Promise<void> {
    const trimmed = text.trim().slice(0, 500);
    if (!trimmed) {
      return;
    }
    try {
      await this.upsertExemplar(
        this.exemplarId('learned', trimmed),
        trimmed,
        label,
        'learned',
      );
      this.logger.log(`Learned new adversarial exemplar (label=${label})`);
    } catch (error) {
      this.logger.warn('Failed to store learned adversarial exemplar', error);
    }
  }

  private async upsertExemplar(
    id: string,
    text: string,
    label: string,
    source: 'seed' | 'learned',
  ): Promise<void> {
    const embedding = await this.embeddingService.embed(text);
    await this.cosmosRepository.getContainer(this.containerName).items.upsert({
      id,
      text,
      label,
      source,
      embedding,
      updatedAt: new Date().toISOString(),
    });
  }

  private exemplarId(source: 'seed' | 'learned', text: string): string {
    const hash = createHash('sha1')
      .update(text.toLowerCase())
      .digest('hex')
      .slice(0, 16);
    return `${source}-${hash}`;
  }
}
