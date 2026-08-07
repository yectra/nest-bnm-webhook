import { WhatsappCrewState } from './whatsapp-crew-state';
import { AttributionDomain } from '../interfaces/whatsapp-crew.interfaces';

/** DI token under which the WhatsApp retrieval-agent registry is provided. */
export const WHATSAPP_CREW_AGENTS = Symbol('WHATSAPP_CREW_AGENTS');

/**
 * A self-describing WhatsApp retrieval agent. The graph factory, supervisor
 * router/prompt, and the attribution candidate list are all derived from this
 * contract, so adding a crew member is: implement this interface, append the
 * class to the registry in whatsapp-crew.module.ts — nothing else changes.
 */
export interface WhatsappCrewAgentDefinition {
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

  /** Attribution domain whose candidates this agent retrieves. */
  readonly domain: AttributionDomain;

  /** State channel this agent's matches are written to. */
  readonly matchChannel:
    | 'projectMatches'
    | 'quoteMatches'
    | 'requirementMatches'
    | 'feedbackMatches';

  /** Hard kill-switch (e.g. env flag). Disabled agents are never routed to. */
  enabled(): boolean;

  /** Keyword fallback used when the LLM planner is unavailable. */
  planHeuristic(question: string): boolean;

  /** The node body: retrieve and return a partial state update. */
  run(state: WhatsappCrewState): Promise<Partial<WhatsappCrewState>>;
}
