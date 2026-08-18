/** Minimal Event Grid envelope shape the qualifier needs. */
export interface QualifiableEvent {
  id?: string;
  eventType?: string;
  subject?: string;
  eventTime?: string;
  topic?: string;
  data?: Record<string, unknown> | null;
}

/** Outcome of qualifying one Event Grid event as "Post Your Requirements". */
export interface RequirementsQualification {
  /** True only when the event is a Post Your Requirements event. */
  qualified: boolean;
  /** Human-readable explanation, always populated (logged either way). */
  reason: string;
  /** Field whose value carried the Post Your Requirements marker. */
  matchedOn?: string;
  eventId?: string;
  eventType?: string;
  /** Free-text message the customer sent, empty when the event carries none. */
  message: string;
  from?: string;
  conversationId?: string;
  userId?: string;
}

/** What the requirements deep agent produced for one qualified event. */
export interface RequirementsAgentResult {
  /** Plain-text answer to send back on WhatsApp. */
  answer: string;
  /** True when the customer-name intent was detected/served. */
  customerNamesRequested: boolean;
  /** Names resolved from Cosmos, when the agent looked them up. */
  customerNames: string[];
  /** Deployment that answered, or `null` when no LLM was configured. */
  model: string | null;
  /** LangSmith run id of this turn — the trace correlation key. */
  traceRunId: string;
  /** LangSmith project the trace was sent to, `null` when tracing is off. */
  traceProject: string | null;
  /** True when the agent degraded (no LLM, or the LLM/tool failed). */
  degraded: boolean;
  durationMs: number;
}
