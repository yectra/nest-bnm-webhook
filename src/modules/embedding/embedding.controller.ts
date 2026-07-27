import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequiredApiKeyGuard } from '../../common/guards/required-api-key.guard';
import { CosmosService } from '../database/cosmos.service';
import { BackfillEmbeddingsDto } from './dto/backfill-embeddings.dto';
import { CreateEmbeddedDocumentDto } from './dto/create-embedded-document.dto';
import { EmbeddingPreviewDto } from './dto/embedding-preview.dto';
import {
  EmbeddingBackfillService,
  BackfillResult,
} from './embedding-backfill.service';
import { EmbeddingService } from './embedding.service';
import { EmbeddingWriteService } from './embedding-write.service';
import { EmbeddedDocumentService } from './embedded-document.service';

@ApiTags('embeddings')
@ApiHeader({ name: 'x-api-key', required: true })
@UseGuards(RequiredApiKeyGuard)
@Controller('embeddings')
export class EmbeddingController {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly backfillService: EmbeddingBackfillService,
    private readonly embeddingWriteService: EmbeddingWriteService,
    private readonly embeddedDocumentService: EmbeddedDocumentService,
    private readonly cosmosService: CosmosService,
  ) {}

  @Post('preview')
  @ApiOperation({ summary: 'Verify Azure OpenAI embedding generation' })
  async preview(@Body() dto: EmbeddingPreviewDto) {
    const embedding = await this.embeddingService.embed(dto.text);
    // Returning the full vector is unnecessary and can create very large logs.
    return { dimensions: embedding.length };
  }

  @Post('documents')
  @ApiOperation({
    summary: 'Create or update one catalog document with an embedding',
  })
  async createDocument(@Body() dto: CreateEmbeddedDocumentDto) {
    if (typeof dto.document.id !== 'string' || !dto.document.id.trim()) {
      throw new BadRequestException('document.id must be a non-empty string');
    }

    const text = this.toEmbeddingText(dto.container, dto.document);
    if (!text) {
      throw new BadRequestException(
        'Document has no searchable text for the selected container',
      );
    }

    // A new test container is created with the correct vector policy. If the
    // container already exists, Cosmos keeps its existing immutable policy.
    await this.cosmosService.ensureVectorContainer(dto.container, '/id');
    const stored = await this.embeddingWriteService.upsertWithEmbedding(
      dto.container,
      dto.document,
      text,
    );
    if (!Array.isArray(stored.embedding)) {
      throw new BadRequestException('The generated embedding is invalid');
    }
    await this.embeddedDocumentService.upsert(
      dto.container,
      stored,
      text,
      stored.embedding,
    );
    await this.cosmosService.getContainer(dto.container).items.upsert({
      ...stored,
      embeddingProjectionSyncedAt: new Date().toISOString(),
    });
    return {
      container: dto.container,
      id: stored.id,
      dimensions: stored.embedding.length,
    };
  }

  @Post('backfill')
  @ApiOperation({
    summary: 'Create and store embeddings for existing catalog documents',
  })
  backfill(@Body() dto: BackfillEmbeddingsDto): Promise<BackfillResult> {
    return this.backfillService.backfill(dto.container, dto.limit);
  }

  private toEmbeddingText(
    container: CreateEmbeddedDocumentDto['container'],
    document: Record<string, unknown>,
  ): string {
    const fields: Record<CreateEmbeddedDocumentDto['container'], string[]> = {
      MovinService: ['name', 'description', 'category', 'location'],
    };
    return fields[container]
      .map((field) => document[field])
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      )
      .join('\n')
      .trim();
  }
}
