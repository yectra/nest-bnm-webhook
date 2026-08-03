import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';

/** Which specialist agents the supervisor decided to activate for a request. */
export interface CrewPlan {
  useServices: boolean;
  useQuotes: boolean;
  useImages: boolean;
  rationale: string;
}

/** One analyzed picture pulled from a Quote or Post Your Requirements document. */
export interface CrewImageInsight {
  url: string;
  sourceContainer: string;
  sourceId: string;
  summary: string;
}

/** Audit-trail entry appended by every graph node. */
export interface CrewTraceEntry {
  agent: string;
  detail: string;
  timestamp: string;
}

export interface PiiRedactionResult {
  text: string;
  redactions: string[];
}

export interface CrewDispatchResult {
  teamsSent: boolean;
  websocketEmitted: boolean;
}

export interface CrewRunResult {
  answer: string;
  plan: CrewPlan;
  serviceMatches: VectorSearchResult[];
  quoteMatches: VectorSearchResult[];
  imageInsights: CrewImageInsight[];
  piiRedactions: string[];
  dispatch: CrewDispatchResult;
  trace: CrewTraceEntry[];
}
