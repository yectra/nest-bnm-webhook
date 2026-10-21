import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { AZURE_OPENAI_CLIENT } from './azure-openai.provider';
import { TokenBudgetService } from '../token-budget/token-budget.service';

/**
 * Generates vector embeddings via Azure OpenAI `text-embedding-3-*` (Epic A / A2).
 *
 * The output dimensionality must match the Cosmos container's vector policy
 * (see `vector-policy.ts` — 1536 for `text-embedding-3-small`).
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly model: string;
  private readonly dimensions: number;
  private readonly maxCharsPerChunk: number;

  constructor(
    @Inject(AZURE_OPENAI_CLIENT) private readonly client: OpenAI,
    config: ConfigService,
    @Optional() private readonly tokenBudgetService?: TokenBudgetService,
  ) {
    this.model = config.getOrThrow<string>('EMBEDDING_MODEL');
    this.logger.log(`[AI MODEL] stage=embedding model=${this.model}`);
    this.dimensions = config.get<number>('EMBEDDING_DIMENSIONS') ?? 1536;
    this.maxCharsPerChunk =
      config.get<number>('EMBEDDING_MAX_CHARS_PER_CHUNK') ?? 6000;
  }

  /** Generate an embedding for a single piece of text. */
  async embed(text: string): Promise<number[]> {
    const input = text?.trim();
    if (!input) {
      throw new BadRequestException('Cannot embed empty text');
    }
    const embeddings = await this.embedMany(this.splitIntoChunks(input));
    return embeddings.length === 1
      ? embeddings[0]
      : this.normalizedMean(embeddings);
  }

  /**
   * Generate embeddings for many texts in a single request. Order is preserved:
   * result[i] corresponds to texts[i].
   */
  async embedMany(texts: string[]): Promise<number[][]> {
    const inputs = texts.map((t) => t?.trim() ?? '');
    if (inputs.length === 0 || inputs.some((t) => !t)) {
      throw new BadRequestException('Cannot embed empty text');
    }

    const estimatedTokens = Math.max(
      10,
      Math.ceil(inputs.reduce((acc, t) => acc + t.length, 0) / 3),
    );

    let reservationId: string | undefined;
    if (this.tokenBudgetService) {
      const reservation = await this.tokenBudgetService.reserveTokens({
        stage: 'embedding_generate',
        process: 'embedding',
        model: this.model,
        modelEnv: 'EMBEDDING_MODEL',
        estimatedTokens,
      });

      if (!reservation.allowed) {
        throw new InternalServerErrorException(
          'AI_TOKEN_BUDGET_EXHAUSTED: rolling 24-hour token limit reached',
        );
      }
      reservationId = reservation.reservationId;
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: inputs,
        dimensions: this.dimensions,
      });

      if (this.tokenBudgetService && reservationId) {
        const usage = response?.usage;
        const totalTokens =
          usage?.total_tokens ?? usage?.prompt_tokens ?? estimatedTokens;

        await this.tokenBudgetService.reconcileUsage({
          reservationId,
          actualUsage: {
            inputTokens: totalTokens,
            outputTokens: 0,
            totalTokens,
          },
          success: true,
        });
      }

      const embeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
      if (embeddings.some((embedding) => embedding.length !== this.dimensions)) {
        throw new Error(
          `Azure OpenAI returned an embedding with dimensions different from the configured ${this.dimensions}`,
        );
      }
      return embeddings;
    } catch (error) {
      if (this.tokenBudgetService && reservationId) {
        await this.tokenBudgetService.reconcileUsage({
          reservationId,
          actualUsage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: estimatedTokens,
          },
          success: false,
          error,
        });
      }
      this.logger.error('Azure OpenAI embedding generation failed', error);
      throw new InternalServerErrorException('Embedding generation failed');
    }
  }

  private splitIntoChunks(text: string): string[] {
    if (text.length <= this.maxCharsPerChunk) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > this.maxCharsPerChunk) {
      const candidate = remaining.slice(0, this.maxCharsPerChunk);
      const boundary = Math.max(
        candidate.lastIndexOf('\n'),
        candidate.lastIndexOf(' '),
      );
      const end = boundary > this.maxCharsPerChunk / 2 ? boundary : candidate.length;
      chunks.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    if (remaining) {
      chunks.push(remaining);
    }
    return chunks;
  }

  private normalizedMean(embeddings: number[][]): number[] {
    const mean = Array.from({ length: this.dimensions }, () => 0);
    for (const embedding of embeddings) {
      embedding.forEach((value, index) => {
        mean[index] += value / embeddings.length;
      });
    }
    const magnitude = Math.sqrt(mean.reduce((sum, value) => sum + value ** 2, 0));
    return magnitude === 0 ? mean : mean.map((value) => value / magnitude);
  }
}
