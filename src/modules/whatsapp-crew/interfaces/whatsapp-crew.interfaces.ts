import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';

/**
 * Customer journeys an inbound WhatsApp message can be attributed to. The
 * crew retrieves from all relevant journeys and then decides which one the
 * customer's message actually belongs to, so the reply is grounded in the
 * right record.
 */
export type AttributionDomain =
  'project' | 'quote' | 'requirements' | 'feedback' | 'general';

/** The crew's decision about which journey/record a reply should reference. */
export interface ResponseAttribution {
  domain: AttributionDomain;
  recordId: string | null;
  recordContainer: string | null;
  confidence: number;
  rationale: string;
}

// The adversary (prompt-injection) verdict comes from the shared, reusable
// adversary-guard module; re-exported here for the crew's state channel.
export type { AdversaryVerdict } from '../../adversary-guard/interfaces/adversary-guard.interfaces';

/** Which retrieval agents the supervisor activated for a message. */
export interface WhatsappCrewPlan {
  agents: Record<string, boolean>;
  rationale: string;
}

/** Understanding extracted from one non-text part of the inbound message. */
export interface WhatsappMediaInsight {
  kind: string;
  summary: string;
  url?: string;
  contentType?: string;
}

export interface WhatsappDispatchResult {
  whatsappSent: boolean;
  messageSid?: string;
  error?: string;
}

/** Audit-trail entry appended by every graph node. */
export interface WhatsappCrewTraceEntry {
  agent: string;
  detail: string;
  timestamp: string;
}

/** Per-journey retrieval output keyed by the state channel it fills. */
export type WhatsappMatchChannel =
  'projectMatches' | 'quoteMatches' | 'requirementMatches' | 'feedbackMatches';

export type WhatsappMatches = Record<
  WhatsappMatchChannel,
  VectorSearchResult[]
>;
