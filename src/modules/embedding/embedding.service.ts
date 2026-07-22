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

  constructor(
    @Inject(AZURE_OPENAI_CLIENT) private readonly client: OpenAI,
    config: ConfigService,
  ) {
    this.model =
      config.get<string>('EMBEDDING_MODEL') ?? 'text-embedding-3-small';
  }

  /** Generate an embedding for a single piece of text. */
  async embed(text: string): Promise<number[]> {
    const input = text?.trim();
    if (!input) {
      throw new BadRequestException('Cannot embed empty text');
    }
    const [embedding] = await this.embedMany([input]);
    return embedding;
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
      });
      return response.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
    } catch (error) {
      this.logger.error('Azure OpenAI embedding generation failed', error);
      throw new InternalServerErrorException('Embedding generation failed');
    }
  }
}
