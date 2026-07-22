/**
 * Contract for documents that carry a vector embedding for Cosmos DB vector
 * search (Epic A). The field is optional so documents written before the
 * embedding back-fill (A2) remain valid.
 *
 * The embedding is generated from the entity's descriptive text by
 * `EmbeddingService` (A2) and stored at the `/embedding` path indexed with
 * DiskANN (see `vector-policy.ts`).
 */
export interface Embeddable {
  /** Azure OpenAI `text-embedding-3-*` vector; length must match the container's configured dimensions. */
  embedding?: number[];
}
