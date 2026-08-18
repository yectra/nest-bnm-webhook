import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { CosmosService } from '../../database/cosmos.service';
import { EmbeddingService } from '../../embedding/embedding.service';
import {
  CORPUS_VERSION,
  INJECTION_CORPUS,
  corpusStats,
} from '../data/injection-corpus';
import {
  InjectionSignature,
  StoredInjectionSignature,
} from '../interfaces/prompt-guard.interfaces';

export const DEFAULT_SIGNATURE_CONTAINER = 'PromptInjectionSignatures';

/** Outcome of a seed run. */
export interface SeedResult {
  container: string;
  corpusVersion: string;
  total: number;
  embedded: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

/** Embedding requests are batched to keep the number of round trips low. */
const EMBED_BATCH_SIZE = 32;

/** Deadline for the public index-status query. */
const STATS_TIMEOUT_MS = 5000;

/**
 * Owns the RAG vector database of known prompt-injection messages.
 *
 * The container is created with the DiskANN cosine policy from
 * `vector-policy.ts` (1536 dims — `text-embedding-3-small`), then every corpus
 * entry is embedded and upserted. Seeding is idempotent: entries whose text
 * hash and embedding model are unchanged are skipped, so a re-seed after
 * adding signatures only pays for the new ones.
 */
@Injectable()
export class InjectionCorpusService implements OnModuleInit {
  private readonly logger = new Logger(InjectionCorpusService.name);
  readonly containerName: string;
  private readonly autoSeed: boolean;
  private readonly embeddingModel: string;

  constructor(
    private readonly cosmosService: CosmosService,
    private readonly embeddingService: EmbeddingService,
    config: ConfigService,
  ) {
    this.containerName =
      config.get<string>('PROMPT_GUARD_CONTAINER') ??
      DEFAULT_SIGNATURE_CONTAINER;
    const flag = config.get<boolean | string>('PROMPT_GUARD_AUTO_SEED');
    this.autoSeed = flag === true || flag === 'true';
    this.embeddingModel =
      config.get<string>('EMBEDDING_MODEL') ?? 'text-embedding-3-small';
  }

  /**
   * Optional boot-time seeding (PROMPT_GUARD_AUTO_SEED=true). Off by default so
   * a deployment never blocks on Azure OpenAI; the admin endpoint seeds on
   * demand instead. Failures are logged, never fatal — the detector degrades to
   * the heuristic pass.
   */
  async onModuleInit(): Promise<void> {
    if (!this.autoSeed) {
      return;
    }
    try {
      const result = await this.seed();
      this.logger.log(
        `Auto-seed complete: ${result.embedded} embedded, ${result.skipped} unchanged`,
      );
    } catch (error) {
      this.logger.error(
        'Auto-seed of the prompt-injection corpus failed; detection will run degraded until seeded',
        error,
      );
    }
  }

  /** Create the vector container if it does not exist yet. */
  async ensureContainer(): Promise<void> {
    await this.cosmosService.ensureVectorContainer(this.containerName, '/id');
  }

  /**
   * Embed and upsert the corpus.
   *
   * @param force re-embed every entry even when its hash is unchanged (use
   * after switching the embedding deployment).
   */
  async seed(force = false): Promise<SeedResult> {
    const startedAt = Date.now();
    await this.ensureContainer();

    const existing = force
      ? new Map<string, string>()
      : await this.loadFingerprints();
    const pending = INJECTION_CORPUS.filter(
      (entry) => existing.get(entry.id) !== this.fingerprint(entry),
    );

    let embedded = 0;
    let failed = 0;

    for (let index = 0; index < pending.length; index += EMBED_BATCH_SIZE) {
      const batch = pending.slice(index, index + EMBED_BATCH_SIZE);
      try {
        const vectors = await this.embeddingService.embedMany(
          batch.map((entry) => entry.text),
        );
        await Promise.all(
          batch.map((entry, position) =>
            this.upsert(entry, vectors[position]).then(
              () => {
                embedded += 1;
              },
              (error: unknown) => {
                failed += 1;
                this.logger.warn(
                  `Failed to store signature "${entry.id}"`,
                  error,
                );
              },
            ),
          ),
        );
      } catch (error) {
        failed += batch.length;
        this.logger.error(
          `Failed to embed signature batch starting at ${index}`,
          error,
        );
      }
    }

    const result: SeedResult = {
      container: this.containerName,
      corpusVersion: CORPUS_VERSION,
      total: INJECTION_CORPUS.length,
      embedded,
      skipped: INJECTION_CORPUS.length - pending.length,
      failed,
      durationMs: Date.now() - startedAt,
    };
    this.logger.log(
      `Seeded prompt-injection corpus into "${this.containerName}": ${JSON.stringify(result)}`,
    );
    return result;
  }

  /** Corpus composition plus how much of it is actually indexed right now. */
  async stats(): Promise<Record<string, unknown>> {
    const composition = corpusStats();
    // The status route is unauthenticated, so the count query gets a hard
    // deadline rather than inheriting the Cosmos SDK's long retry chain.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATS_TIMEOUT_MS);
    try {
      const { resources } = await this.cosmosService
        .getContainer(this.containerName)
        .items.query<number>(
          {
            query: 'SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.embedding)',
          },
          { abortSignal: controller.signal },
        )
        .fetchAll();
      return {
        container: this.containerName,
        embeddingModel: this.embeddingModel,
        indexed: resources[0] ?? 0,
        ...composition,
      };
    } catch (error) {
      this.logger.warn(
        `Could not read signature counts from "${this.containerName}"`,
        error,
      );
      return {
        container: this.containerName,
        embeddingModel: this.embeddingModel,
        indexed: null,
        ...composition,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** id -> fingerprint for everything already stored. */
  private async loadFingerprints(): Promise<Map<string, string>> {
    try {
      const { resources } = await this.cosmosService
        .getContainer(this.containerName)
        .items.query<{
          id: string;
          contentHash: string;
          embeddingModel: string;
        }>({
          query:
            'SELECT c.id, c.contentHash, c.embeddingModel FROM c WHERE IS_DEFINED(c.embedding)',
        })
        .fetchAll();
      return new Map(
        resources.map((row) => [
          row.id,
          `${row.contentHash}:${row.embeddingModel}`,
        ]),
      );
    } catch (error) {
      this.logger.warn(
        `Could not read existing signatures from "${this.containerName}"; seeding all entries`,
        error,
      );
      return new Map();
    }
  }

  private async upsert(
    entry: InjectionSignature,
    embedding: number[],
  ): Promise<void> {
    const document: StoredInjectionSignature = {
      ...entry,
      corpusVersion: CORPUS_VERSION,
      contentHash: this.hash(entry.text),
      embedding,
      embeddingModel: this.embeddingModel,
      dimensions: embedding.length,
      updatedAt: new Date().toISOString(),
    };
    await this.cosmosService
      .getContainer(this.containerName)
      .items.upsert(document);
  }

  /** Re-embed when either the text or the embedding deployment changed. */
  private fingerprint(entry: InjectionSignature): string {
    return `${this.hash(entry.text)}:${this.embeddingModel}`;
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 32);
  }
}
