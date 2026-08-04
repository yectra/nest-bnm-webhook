import { CrewState } from './crew-state';

/** DI token under which the retrieval-agent registry array is provided. */
export const CREW_AGENTS = Symbol('CREW_AGENTS');

/**
 * A self-describing retrieval agent. The graph factory, supervisor router,
 * and supervisor planning prompt are all derived from this contract, so
 * adding a crew member is: implement this interface, add the class to the
 * CREW_AGENTS registry in agent-crew.module.ts — nothing else changes.
 */
export interface CrewAgentDefinition {
  /**
   * Graph node name. Must not collide with a state channel name or a
   * backbone node name (asserted at graph build time).
   */
  readonly name: string;

  /** Boolean flag in the supervisor plan that activates this agent. */
  readonly planKey: string;

  /**
   * One-line description of when this agent helps. The supervisor's
   * planning prompt is assembled from these hints.
   */
  readonly planningHint: string;

  /** Hard kill-switch (e.g. env flag). Disabled agents are never routed to. */
  enabled(): boolean;

  /** Keyword fallback used when the LLM planner is unavailable. */
  planHeuristic(question: string): boolean;

  /** The node body: retrieve/analyze and return a partial state update. */
  run(state: CrewState): Promise<Partial<CrewState>>;
}
