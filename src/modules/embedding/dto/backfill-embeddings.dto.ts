import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { SEARCHABLE_CONTAINERS } from '../../search/search.constants';

export class BackfillEmbeddingsDto {
  @IsIn(SEARCHABLE_CONTAINERS)
  container: (typeof SEARCHABLE_CONTAINERS)[number];

  /** Number of currently unembedded documents to process in this invocation. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
