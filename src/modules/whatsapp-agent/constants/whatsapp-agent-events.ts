/**
 * Event qualification for the WhatsApp agent.
 *
 * Events reach the agent from Azure Event Grid, where the producing systems do
 * not agree on one exact spelling of an event type (the Java producer, the
 * portal and manual replays all differ). Qualification therefore matches on a
 * normalised form rather than on string equality.
 */

/** Canonical event types the WhatsApp agent understands. */
export const WHATSAPP_AGENT_EVENT_TYPES = {
  /** Rebuild the known-prompt-injection RAG in Cosmos DB. */
  UPDATE_PROMPT_INJECTION_RAG: 'BNM_WHATSAPP_UPDATE_PROMPT_INJECTION_RAG_EVENT',
  /** Inbound WhatsApp message relayed by the Java application. */
  MESSAGE_RECEIVED: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
} as const;

/** Result of qualifying an incoming Event Grid event. */
export enum WhatsappAgentEventKind {
  UpdatePromptInjectionRag = 'UPDATE_PROMPT_INJECTION_RAG',
  MessageReceived = 'MESSAGE_RECEIVED',
  Unknown = 'UNKNOWN',
}

/**
 * Normalised token that must appear in an event's type/subject for it to
 * qualify as a prompt-injection RAG update. Matching the normalised form
 * accepts `UPDATE_PROMPT_INJECTION_RAG`,
 * `BNM_WHATSAPP_UPDATE_PROMPT_INJECTION_RAG_EVENT`, `update-prompt-injection-rag`
 * and `Update Prompt Injection RAG` alike.
 */
const UPDATE_PROMPT_INJECTION_RAG_TOKEN = 'updatepromptinjectionrag';
const MESSAGE_RECEIVED_TOKEN = 'whatsappreceivedfromjava';

/** Lowercase and strip everything that is not a letter or digit. */
export function normalizeEventToken(value: unknown): string {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
}

/**
 * Qualify an Event Grid event against the kinds the WhatsApp agent handles.
 *
 * All plausible carriers of the event name are considered — producers put it on
 * `eventType`, on `subject`, or inside `data` — so a correctly-typed event is
 * never dropped because of where the producer placed the name.
 */
export function qualifyWhatsappAgentEvent(event: {
  eventType?: string;
  subject?: string;
  data?: unknown;
}): WhatsappAgentEventKind {
  const data = (event?.data ?? {}) as Record<string, unknown>;
  const candidates = [
    event?.eventType,
    event?.subject,
    data.eventType,
    data.event,
    data.action,
    data.type,
  ].map(normalizeEventToken);

  if (candidates.some((c) => c.includes(UPDATE_PROMPT_INJECTION_RAG_TOKEN))) {
    return WhatsappAgentEventKind.UpdatePromptInjectionRag;
  }
  if (candidates.some((c) => c.includes(MESSAGE_RECEIVED_TOKEN))) {
    return WhatsappAgentEventKind.MessageReceived;
  }
  return WhatsappAgentEventKind.Unknown;
}
