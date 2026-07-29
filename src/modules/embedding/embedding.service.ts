import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { AZURE_OPENAI_CLIENT } from './azure-openai.provider';

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
  ) {
    this.model = config.getOrThrow<string>('EMBEDDING_MODEL');
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

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: inputs,
        dimensions: this.dimensions,
      });
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
