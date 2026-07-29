import { Module } from '@nestjs/common';

import { CosmosModule } from '../database/cosmos.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { SearchController } from './search.controller';
import { SearchRepository } from './search.repository';
import { SearchService } from './search.service';

/**
 * Semantic search module (Epic A / A3). Wires the vector search repository, the
 * orchestration service, and the `POST /search/semantic` route. Depends on the
 * embedding module (A2) and the Cosmos data layer (A1).
 */
@Module({
  imports: [CosmosModule, EmbeddingModule],
  controllers: [SearchController],
  providers: [SearchRepository, SearchService],
  exports: [SearchService],
})
export class SearchModule {}
