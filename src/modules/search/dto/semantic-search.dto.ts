import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { MAX_SEARCH_TOP, SEARCHABLE_CONTAINERS } from '../search.constants';

export class SemanticSearchDto {
  /** Natural-language query to search the marketplace catalog. */
  @IsString()
  @IsNotEmpty()
  query: string;

  /**
   * Optional subset of containers to search. Restricted to the public
   * searchable containers; defaults to all of them when omitted.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(SEARCHABLE_CONTAINERS, { each: true })
  containers?: string[];

  /** Maximum number of results to return (1–50, default 10). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_TOP)
  top?: number;
}
