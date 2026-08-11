import { registerAs } from '@nestjs/config';

/**
 * WhatsApp deep-agent configuration. Every setting has a safe default: the
 * agent must work with NO LLM configured (it falls back to static replies),
 * and a missing dependency degrades the answer rather than failing.
 */
export default registerAs('whatsappAgent', () => ({
  llm: {
    /** OpenAI-compatible base URL of a LOW-COST endpoint. Unset = no LLM. */
    baseUrl: process.env.WHATSAPP_AGENT_LLM_BASE_URL || undefined,
    apiKey: process.env.WHATSAPP_AGENT_LLM_API_KEY || undefined,
    /** Frontier models are never required. */
    model: process.env.WHATSAPP_AGENT_LLM_MODEL || 'phi-4-mini-instruct',
  },
  /** Event type published by the upstream Java webhook app. */
  eventType:
    process.env.WHATSAPP_AGENT_EVENT_TYPE ||
    'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
  containers: {
    /** Processed messageSids for idempotency (partition key /id). */
    processed:
      process.env.WHATSAPP_AGENT_PROCESSED_CONTAINER ||
      'WhatsAppProcessedMessages',
    /** Customer profiles used for grounding (phoneNumber, name, role). */
    user: process.env.WHATSAPP_AGENT_USER_CONTAINER || 'User',
    /** Previously sent notifications (phoneNumber, renderedMessage, type, createdDate). */
    content: process.env.WHATSAPP_AGENT_CONTENT_CONTAINER || 'WhatsAppContent',
    /** Audit trail: one row per generated reply (partition key /id). */
    audit: process.env.WHATSAPP_AGENT_AUDIT_CONTAINER || 'WhatsAppAgentAudit',
  },
  twilio: {
    /** Messaging service for outbound WhatsApp session replies. */
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
  },
  embedding: {
    /** Embedding model for the guard's semantic layer. */
    model:
      process.env.WHATSAPP_AGENT_EMBEDDING_MODEL || 'text-embedding-3-small',
    baseUrl:
      process.env.WHATSAPP_AGENT_EMBEDDING_BASE_URL ||
      process.env.WHATSAPP_AGENT_LLM_BASE_URL ||
      undefined,
    apiKey:
      process.env.WHATSAPP_AGENT_EMBEDDING_API_KEY ||
      process.env.WHATSAPP_AGENT_LLM_API_KEY ||
      undefined,
    /** Must match the AdversarialInputs embedding policy. */
    dimensions: Number(process.env.WHATSAPP_AGENT_EMBEDDING_DIMENSIONS) || 1536,
  },
  /**
   * Kill switch for outbound replies. When false the agent still generates
   * and audits a reply, but nothing is sent to the customer and the
   * assistant turn is not recorded in conversation history.
   */
  replyEnabled: !['false', '0', 'no', 'off'].includes(
    (process.env.WHATSAPP_AGENT_REPLY_ENABLED || 'true').trim().toLowerCase(),
  ),
  guard: {
    /** Vector container of known prompt-injection exemplars. */
    adversarialContainer:
      process.env.WHATSAPP_AGENT_ADVERSARIAL_CONTAINER || 'AdversarialInputs',
    /** Similarity at or above which a message is blocked outright. */
    blockThreshold:
      Number(process.env.WHATSAPP_AGENT_GUARD_BLOCK_THRESHOLD) || 0.82,
    /** Lower bound of the borderline band escalated to the LLM classifier. */
    borderlineThreshold:
      Number(process.env.WHATSAPP_AGENT_GUARD_BORDERLINE_THRESHOLD) || 0.6,
  },
}));
