import { Annotation } from '@langchain/langgraph';

import {
  GuardTraceEntry,
  HeuristicHit,
  InjectionAssessment,
  JudgeVerdict,
  RetrievalVerdict,
  SignatureMatch,
} from '../interfaces/prompt-guard.interfaces';

/**
 * Shared state for the detector graph:
 *
 *   START -> scanHeuristics ---+
 *         -> retrieveSignatures -+-> voteKnn -+-> llmJudge -+-> decide -> END
 *                                             +-------------+
 *
 * The scan and retrieval nodes run in the same superstep, so their updates
 * target disjoint channels; the trace uses a concat reducer because every node
 * appends to it.
 */
export const GuardStateAnnotation = Annotation.Root({
  /** The untrusted text under inspection. */
  input: Annotation<string>,
  /** Where the text came from (event type, channel, caller). */
  source: Annotation<string>({
    reducer: (_current, update) => update ?? 'api',
    default: () => 'api',
  }),
  heuristics: Annotation<HeuristicHit[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  heuristicScore: Annotation<number>({
    reducer: (_current, update) => update ?? 0,
    default: () => 0,
  }),
  matches: Annotation<SignatureMatch[]>({
    reducer: (_current, update) => update ?? [],
    default: () => [],
  }),
  /** True when the vector index could not be consulted. */
  degraded: Annotation<boolean>({
    reducer: (_current, update) => update ?? false,
    default: () => false,
  }),
  degradedReason: Annotation<string | null>({
    reducer: (_current, update) => update ?? null,
    default: () => null,
  }),
  retrieval: Annotation<RetrievalVerdict | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  judgeVerdict: Annotation<JudgeVerdict | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  assessment: Annotation<InjectionAssessment | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  trace: Annotation<GuardTraceEntry[]>({
    reducer: (current, update) => current.concat(update ?? []),
    default: () => [],
  }),
});

export type GuardState = typeof GuardStateAnnotation.State;

export const guardTrace = (node: string, detail: string): GuardTraceEntry => ({
  node,
  detail,
  timestamp: new Date().toISOString(),
});
