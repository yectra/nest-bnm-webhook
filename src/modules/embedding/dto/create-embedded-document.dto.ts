import { IsIn, IsNotEmpty, IsObject } from 'class-validator';

import { SEARCHABLE_CONTAINERS } from '../../search/search.constants';

/** Creates one catalog document and its embedding for controlled testing. */
export class CreateEmbeddedDocumentDto {
  @IsIn(SEARCHABLE_CONTAINERS)
  container: (typeof SEARCHABLE_CONTAINERS)[number];

  /** The document must include a non-empty string `id`. */
  @IsObject()
  @IsNotEmpty()
  document: Record<string, unknown>;
}
