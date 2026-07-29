/** A single semantically matched document returned by Cosmos DB. */
export interface VectorSearchResult {
  id: string;
  sourceContainer?: string;
  sourceId?: string;
  /** Cosine distance returned by Cosmos DB; lower is a closer match. */
  distance: number;
  /** Cosine similarity (1 - distance), included for diagnostics. */
  similarity: number;
  /** Original data copied into the embedded document at ingestion time. */
  sourceData: Record<string, unknown>;
}
