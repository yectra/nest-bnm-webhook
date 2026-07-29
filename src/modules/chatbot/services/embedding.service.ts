import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(config: ConfigService) {
    this.model = config.get<string>('EMBEDDING_MODEL') ?? 'text-embedding-3-small';
    this.dimensions = config.get<number>('EMBEDDING_DIMENSIONS') ?? 1536;
    const timeout = config.get<number>('OPENAI_TIMEOUT_MS') ?? 15000;

    this.client = new OpenAI({
      baseURL: config.get<string>('OPENAI_BASE_URL'),
      apiKey: config.get<string>('OPENAI_API_KEY'),
      timeout,
      maxRetries: 2,
    });
  }

  async embed(text: string): Promise<number[]> {
    const input = text?.trim();
    if (!input) {
      throw new BadRequestException('Cannot generate embedding for empty text');
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: [input],
        dimensions: this.dimensions,
      });

      const embedding = response.data?.[0]?.embedding;
      if (!embedding || embedding.length !== this.dimensions) {
        throw new Error(
          `Embedding dimensions mismatch. Expected ${this.dimensions}, got ${embedding?.length}`,
        );
      }
      return embedding;
    } catch (error) {
      this.logger.error('Failed to generate vector embedding', error);
      throw error;
    }
  }
}
