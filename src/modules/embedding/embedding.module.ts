import { Module } from '@nestjs/common';

import { CosmosModule } from '../database/cosmos.module';
import { RequiredApiKeyGuard } from '../../common/guards/required-api-key.guard';
import { azureOpenAiClientProvider } from './azure-openai.provider';
import { EmbeddingBackfillService } from './embedding-backfill.service';
import { EmbeddingController } from './embedding.controller';
import { EmbeddingService } from './embedding.service';
import { EmbeddingWriteService } from './embedding-write.service';
import { EmbeddedDocumentService } from './embedded-document.service';

/**
 * Embedding feature module (Epic A / A2). Provides the Azure OpenAI client, the
 * embedding generator, and the write-path helper that stores embeddings on write.
 * Exported for use by write flows and the vector search service (A3).
 */
@Module({
  imports: [CosmosModule],
  controllers: [EmbeddingController],
  providers: [
    azureOpenAiClientProvider,
    EmbeddingService,
    EmbeddingWriteService,
    EmbeddedDocumentService,
    EmbeddingBackfillService,
    RequiredApiKeyGuard,
  ],
  exports: [EmbeddingService, EmbeddingWriteService],
})
export class EmbeddingModule {}
