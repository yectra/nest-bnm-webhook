export interface VectorSearchResult {
  id: string;
  sourceContainer?: string;
  sourceId?: string;
  distance: number;
  similarity: number;
  sourceData?: Record<string, unknown>;
}

export interface ContainerClassificationResult {
  domain: string;
  container: string | null;
  confidence: number;
}
