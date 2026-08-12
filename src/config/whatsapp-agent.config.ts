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
  /** Cosmos container holding customer feedback items. */
  feedbackContainer:
    process.env.WHATSAPP_AGENT_FEEDBACK_CONTAINER || 'CustomerFeedback',
}));
