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
  },
  twilio: {
    /** Messaging service for outbound WhatsApp session replies. */
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
  },
}));
