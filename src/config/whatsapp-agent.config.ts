import { registerAs } from '@nestjs/config';

/** Truthy-string parsing that treats an unset variable as `false`. */
function toBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function toInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

  /**
   * Azure AI Foundry deployment used by the "Post Your Requirements" deep
   * agent. Defaults to the shared Azure OpenAI v1 endpoint already configured
   * for the rest of the app, so only the deployment name usually differs.
   */
  foundry: {
    baseUrl:
      process.env.WHATSAPP_AGENT_FOUNDRY_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      undefined,
    apiKey:
      process.env.WHATSAPP_AGENT_FOUNDRY_API_KEY ||
      process.env.OPENAI_API_KEY ||
      undefined,
    /** gpt-5-mini deployment name on Azure AI Foundry. */
    model: process.env.WHATSAPP_AGENT_FOUNDRY_MODEL || 'gpt-5-mini',
    timeoutMs: toInteger(process.env.OPENAI_TIMEOUT_MS, 30000),
  },

  /** Source of the customer records the requirements agent reads. */
  requirements: {
    container:
      process.env.WHATSAPP_AGENT_REQUIREMENTS_CONTAINER ||
      process.env.AGENT_CREW_REQUIREMENTS_CONTAINER ||
      'PostYourRequirements',
    /** Upper bound on customer names returned to the agent in one turn. */
    maxCustomers: toInteger(process.env.WHATSAPP_AGENT_MAX_CUSTOMERS, 200),
  },

  /** LangSmith tracing. Disabled (and silently skipped) without an API key. */
  langsmith: {
    enabled: toBoolean(
      process.env.LANGSMITH_TRACING ?? process.env.LANGCHAIN_TRACING_V2,
      true,
    ),
    apiKey:
      process.env.LANGSMITH_API_KEY ||
      process.env.LANGCHAIN_API_KEY ||
      undefined,
    apiUrl:
      process.env.LANGSMITH_ENDPOINT ||
      process.env.LANGCHAIN_ENDPOINT ||
      'https://api.smith.langchain.com',
    project:
      process.env.LANGSMITH_PROJECT ||
      process.env.LANGCHAIN_PROJECT ||
      'bnm-whatsapp-agent',
  },
}));
