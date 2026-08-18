/** Shapes for the known-prompt-injection corpus and its RAG projection. */

/** How much damage the technique does if it lands. */
export type PromptInjectionSeverity = 'low' | 'medium' | 'high' | 'critical';

/** A single attack family as described in `resources/prompt-injections.json`. */
export interface PromptInjectionRecord {
  id: string;
  category: string;
  severity: PromptInjectionSeverity;
  title: string;
  summary: string;
  /** Representative surface forms of the attack. */
  patterns: string[];
  example: string;
  detectionGuidance: string;
  /** What the guard should do once the family is recognised. */
  recommendedAction: string;
}

/** The resource file as a whole. */
export interface PromptInjectionCorpus {
  version: string;
  name: string;
  description: string;
  injections: PromptInjectionRecord[];
}

/** One chunk produced by the chunking node, before embedding. */
export interface PromptInjectionChunk {
  /** Deterministic id: `<injectionId>::<chunkIndex>`. */
  id: string;
  injectionId: string;
  category: string;
  severity: PromptInjectionSeverity;
  title: string;
  recommendedAction: string;
  corpusVersion: string;
  chunkIndex: number;
  chunkCount: number;
  content: string;
}

/** A chunk carrying its embedding vector, ready to persist. */
export interface EmbeddedPromptInjectionChunk extends PromptInjectionChunk {
  embedding: number[];
}

/** Outcome of one RAG rebuild, returned to the Event Grid caller. */
export interface PromptInjectionRagResult {
  status: 'success' | 'failed' | 'skipped';
  corpusVersion: string;
  injectionCount: number;
  chunkCount: number;
  deletedCount: number;
  upsertedCount: number;
  container: string;
  traced: boolean;
  durationMs: number;
  errors: string[];
}
