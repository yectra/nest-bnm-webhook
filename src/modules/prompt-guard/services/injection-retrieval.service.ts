import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqlParameter } from '@azure/cosmos';

import { CosmosService } from '../../database/cosmos.service';
import { EmbeddingService } from '../../embedding/embedding.service';
import {
  InjectionSeverity,
  InjectionTechnique,
  SignatureLabel,
  SignatureMatch,
} from '../interfaces/prompt-guard.interfaces';
import { InjectionCorpusService } from './injection-corpus.service';

/** What the retrieval node hands to the vote node. */
export interface RetrievalOutcome {
  matches: SignatureMatch[];
  /** True when the vector store could not be consulted at all. */
  degraded: boolean;
  reason?: string;
}

const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 25;
const QUERY_TIMEOUT_MS = 5000;
const EXCERPT_CHARS = 180;

/**
 * The R in RAG: embeds the inspected text with `text-embedding-3-small` and
 * pulls its nearest neighbours out of the signature container by cosine
 * distance over the DiskANN index.
 */
@Injectable()
export class InjectionRetrievalService {
  private readonly logger = new Logger(InjectionRetrievalService.name);
  private readonly topK: number;

  constructor(
    private readonly cosmosService: CosmosService,
    private readonly embeddingService: EmbeddingService,
    private readonly corpusService: InjectionCorpusService,
    config: ConfigService,
  ) {
    const configured = Number(
      config.get<number | string>('PROMPT_GUARD_TOP_K'),
    );
    this.topK = Math.min(
      Math.max(
        Number.isFinite(configured) && configured > 0
          ? Math.floor(configured)
          : DEFAULT_TOP_K,
        1,
      ),
      MAX_TOP_K,
    );
  }

  async retrieve(text: string): Promise<RetrievalOutcome> {
    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embeddingService.embed(text);
    } catch (error) {
      this.logger.warn('Could not embed the inspected text', error);
      return {
        matches: [],
        degraded: true,
        reason: 'embedding generation failed',
      };
    }

    const parameters: SqlParameter[] = [
      { name: '@embedding', value: queryEmbedding },
    ];
    // No WHERE clause on purpose: @azure/cosmos ^4.9.3 can hang its query
    // parser when a WHERE clause is combined with ORDER BY VectorDistance
    // (see VectorSearchService). Rows without an embedding are filtered below.
    const query = `
      SELECT TOP ${this.topK}
        VectorDistance(c.embedding, @embedding) AS distance,
        c AS document
      FROM c
      ORDER BY VectorDistance(c.embedding, @embedding)
    `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
    try {
      const { resources } = await this.cosmosService
        .getContainer(this.corpusService.containerName)
        .items.query<{ distance: number; document: Record<string, unknown> }>(
          { query, parameters },
          { abortSignal: controller.signal },
        )
        .fetchAll();

      const matches = resources
        .filter((row) => Array.isArray(row.document?.embedding))
        .map((row) => this.toMatch(row.distance, row.document))
        .sort((a, b) => b.similarity - a.similarity);

      if (matches.length === 0) {
        this.logger.warn(
          `Signature container "${this.corpusService.containerName}" returned no vectors; seed it via POST /api/prompt-guard/signatures/seed`,
        );
        return {
          matches,
          degraded: true,
          reason: 'signature index is empty',
        };
      }
      return { matches, degraded: false };
    } catch (error) {
      this.logger.error(
        `Vector retrieval failed against "${this.corpusService.containerName}"`,
        error instanceof Error ? error.stack : error,
      );
      return {
        matches: [],
        degraded: true,
        reason: 'vector query failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private toMatch(
    distance: number,
    document: Record<string, unknown>,
  ): SignatureMatch {
    const text = typeof document.text === 'string' ? document.text : '';
    return {
      id: typeof document.id === 'string' ? document.id : 'unknown',
      label: (document.label as SignatureLabel) ?? 'injection',
      technique:
        (document.technique as InjectionTechnique) ?? 'instruction_override',
      severity: (document.severity as InjectionSeverity) ?? 'medium',
      distance,
      similarity: Number((1 - distance).toFixed(4)),
      excerpt:
        text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text,
    };
  }
}
