import { Module } from '@nestjs/common';

import { CosmosModule } from '../database/cosmos.module';
import { azureOpenAiClientProvider } from './azure-openai.provider';
import { EmbeddingService } from './embedding.service';
import { EmbeddingWriteService } from './embedding-write.service';

/**
 * Embedding feature module (Epic A / A2). Provides the Azure OpenAI client, the
 * embedding generator, and the write-path helper that stores embeddings on write.
 * Exported for use by write flows and the vector search service (A3).
 */
@Module({
  imports: [CosmosModule],
  providers: [
    azureOpenAiClientProvider,
    EmbeddingService,
    EmbeddingWriteService,
  ],
  exports: [EmbeddingService, EmbeddingWriteService],
})
export class EmbeddingModule {}
