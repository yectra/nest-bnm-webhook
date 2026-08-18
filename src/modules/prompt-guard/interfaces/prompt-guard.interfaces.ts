/**
 * Prompt-injection guard contracts (RAG detector).
 *
 * The detector answers one question — "does this input contain a prompt
 * injection?" — by retrieving the nearest known-injection signatures from the
 * Cosmos vector store and fusing that evidence with a deterministic pattern
 * scan and an optional GPT-5 judge.
 */

/** Attack families represented in the seeded signature corpus. */
export type InjectionTechnique =
  | 'instruction_override'
  | 'system_prompt_exfiltration'
  | 'role_play_jailbreak'
  | 'delimiter_spoofing'
  | 'encoding_obfuscation'
  | 'indirect_injection'
  | 'tool_abuse'
  | 'data_exfiltration'
  | 'guardrail_bypass'
  | 'payload_splitting'
  | 'benign';

/** How damaging a successful attack of this shape would be. */
export type InjectionSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Verdict labels stored on every corpus entry and returned per match. */
export type SignatureLabel = 'injection' | 'benign';

/** What the caller should do with the inspected input. */
export type GuardRecommendation = 'allow' | 'review' | 'block';

/** One curated example in the seed corpus (see `data/injection-corpus.ts`). */
export interface InjectionSignature {
  /** Stable id, also the Cosmos document id. */
  id: string;
  /** The example text that gets embedded with text-embedding-3-small. */
  text: string;
  label: SignatureLabel;
  technique: InjectionTechnique;
  severity: InjectionSeverity;
  /** Short note on why this example is in the corpus. */
  note?: string;
}

/** A signature document as stored in Cosmos (embedding kept out of responses). */
export interface StoredInjectionSignature extends InjectionSignature {
  corpusVersion: string;
  /** Hash of `text` — lets re-seeding skip unchanged entries. */
  contentHash: string;
  embedding?: number[];
  embeddingModel: string;
  dimensions: number;
  updatedAt: string;
}

/** One retrieved neighbour of the inspected input. */
export interface SignatureMatch {
  id: string;
  label: SignatureLabel;
  technique: InjectionTechnique;
  severity: InjectionSeverity;
  /** Cosine distance returned by Cosmos (0 = identical). */
  distance: number;
  /** 1 - distance, so higher is more similar. */
  similarity: number;
  /** Truncated signature text, for explainability in the response. */
  excerpt: string;
}

/** Output of the deterministic pattern pre-pass. */
export interface HeuristicHit {
  rule: string;
  technique: InjectionTechnique;
  severity: InjectionSeverity;
  /** The matched fragment, truncated. */
  evidence: string;
}

/** Weighted k-NN vote over the retrieved neighbours. */
export interface RetrievalVerdict {
  /** 0..1 — share of the neighbour weight that belongs to injection examples. */
  score: number;
  /**
   * 0..1 — how much the vote is worth: a unanimous verdict over neighbours that
   * barely cleared the similarity floor is much weaker evidence than one over a
   * near-duplicate.
   */
  support: number;
  /** `score` damped by `support`. This is what the fusion consumes. */
  effectiveScore: number;
  nearestInjectionSimilarity: number;
  nearestBenignSimilarity: number;
  topTechnique: InjectionTechnique | null;
  matches: SignatureMatch[];
}

/** Optional GPT-5 adjudication over the retrieved evidence. */
export interface JudgeVerdict {
  injection: boolean;
  confidence: number;
  technique: InjectionTechnique | null;
  reason: string;
}

/** Audit-trail entry appended by every graph node. */
export interface GuardTraceEntry {
  node: string;
  detail: string;
  timestamp: string;
}

/** The full detector result returned by the HTTP endpoints. */
export interface InjectionAssessment {
  /** The headline answer: does the input contain a prompt injection? */
  injectionDetected: boolean;
  /** Plain-language statement of the verdict. */
  summary: string;
  confidence: number;
  riskLevel: InjectionSeverity;
  recommendation: GuardRecommendation;
  techniques: InjectionTechnique[];
  matches: SignatureMatch[];
  heuristics: HeuristicHit[];
  signals: {
    /** Retrieval evidence after support damping — the value fusion used. */
    retrieval: number;
    /** The raw k-NN vote, before damping. */
    retrievalVote: number;
    heuristic: number;
    /** Null when the judge did not run. */
    llm: number | null;
  };
  judge: JudgeVerdict | null;
  /** True when the vector store could not be consulted (heuristics only). */
  degraded: boolean;
  inspectedChars: number;
  trace: GuardTraceEntry[];
}
