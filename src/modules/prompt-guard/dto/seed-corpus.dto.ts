import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

/** Admin request to (re)build the signature vector index. */
export class SeedCorpusDto {
  @ApiPropertyOptional({
    description:
      'Re-embed every signature even when unchanged. Use after switching the embedding deployment.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  force?: boolean;
}
