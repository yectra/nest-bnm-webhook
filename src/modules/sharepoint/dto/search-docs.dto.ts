import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class SearchDocsDto {
  /** Free-text search query matched against SharePoint documents. */
  @IsString()
  @IsNotEmpty()
  query: string;

  /** Maximum number of results to return (1–100, default 25). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  top?: number;
}
