/** How a verdict was reached, in escalation order (cheapest first). */
export type AdversaryDetectionMethod = 'pattern' | 'semantic' | 'llm' | 'none';

/** Closest known-attack exemplar found in the Cosmos vector container. */
export interface AdversarySemanticMatch {
  id: string;
  text: string;
  label: string;
  similarity: number;
}

/**
 * Verdict of the adversary guard on an untrusted input: whether it looks
 * like a prompt-injection / instruction-override attempt (e.g. "do not
 * consider agent responses", "ignore previous instructions") rather than a
 * genuine user message.
 */
export interface AdversaryVerdict {
  adversarial: boolean;
  method: AdversaryDetectionMethod;
  matchedPatterns: string[];
  semanticMatch: AdversarySemanticMatch | null;
  confidence: number;
  rationale: string;
}

/** One known adversarial phrase stored in the vector container. */
export interface AdversaryExemplar {
  id: string;
  text: string;
  label: string;
  source: 'seed' | 'learned';
}

/** Result of the open-source LLM classification pass. */
export interface AdversaryLlmReview {
  adversarial: boolean;
  confidence: number;
  rationale: string;
}
