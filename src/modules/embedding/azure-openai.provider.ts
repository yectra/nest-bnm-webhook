import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/** DI token for the shared Azure OpenAI client used for embeddings (Epic A / A2). */
export const AZURE_OPENAI_CLIENT = 'AZURE_OPENAI_CLIENT';

/**
 * Azure OpenAI client provider.
 *
 * Reuses the same Azure OpenAI resource as {@link AIService} (`OPENAI_BASE_URL`
 * / `OPENAI_API_KEY`); the embedding deployment/model is selected per-call by
 * {@link EmbeddingService}. Credentials are resolved through `ConfigService`
 * and never committed.
 */
export const azureOpenAiClientProvider: Provider = {
  provide: AZURE_OPENAI_CLIENT,
  useFactory: (config: ConfigService): OpenAI =>
    new OpenAI({
      baseURL: config.get<string>('OPENAI_BASE_URL'),
      apiKey: config.get<string>('OPENAI_API_KEY'),
    }),
  inject: [ConfigService],
};
