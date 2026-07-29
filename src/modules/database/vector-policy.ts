import {
  IndexingPolicy,
  VectorEmbeddingDataType,
  VectorEmbeddingDistanceFunction,
  VectorEmbeddingPolicy,
  VectorIndex,
  VectorIndexType,
} from '@azure/cosmos';

/**
 * Vector search configuration for Cosmos DB (Epic A / A1).
 *
 * Embeddings are stored as a field on the existing entity documents and indexed
 * in-place with a DiskANN vector index, so semantic search runs as a normal
 * Cosmos query in the request path — no separate vector database.
 */

/** Document path that holds the embedding vector. */
export const EMBEDDING_PATH = '/embedding';

/**
 * Vector dimensionality. Matches Azure OpenAI `text-embedding-3-small` (1536).
 * Switch to 3072 if `text-embedding-3-large` is adopted — keep this in sync with
 * the model configured for {@link EmbeddingService} (A2).
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Build the vector embedding policy for a container.
 *
 * @param dimensions vector length (defaults to {@link EMBEDDING_DIMENSIONS}).
 */
export function buildVectorEmbeddingPolicy(
  dimensions: number = EMBEDDING_DIMENSIONS,
): VectorEmbeddingPolicy {
  return {
    vectorEmbeddings: [
      {
        path: EMBEDDING_PATH,
        dataType: VectorEmbeddingDataType.Float32,
        distanceFunction: VectorEmbeddingDistanceFunction.Cosine,
        dimensions,
      },
    ],
  };
}

/** Build the DiskANN vector index entry for the embedding path. */
export function buildVectorIndexes(): VectorIndex[] {
  return [
    {
      path: EMBEDDING_PATH,
      type: VectorIndexType.DiskANN,
    },
  ];
}

/**
 * Build an indexing policy that adds the DiskANN vector index and excludes the
 * embedding path from the normal (range) index so the vector is not
 * double-indexed.
 */
export function buildVectorIndexingPolicy(): IndexingPolicy {
  return {
    indexingMode: 'consistent',
    automatic: true,
    includedPaths: [{ path: '/*' }],
    excludedPaths: [{ path: `${EMBEDDING_PATH}/*` }],
    vectorIndexes: buildVectorIndexes(),
  };
}
