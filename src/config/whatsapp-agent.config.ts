import { registerAs } from '@nestjs/config';

/** Env flags are strings once dotenv loads them; treat only explicit
 * negatives as "off" so a missing value keeps the documented default. */
function isDisabled(value: string | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return ['false', '0', 'no', 'off'].includes(normalized);
}

/** Parse an integer env var, falling back when unset or malformed. */
function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The mirror of isDisabled, for flags that stay off until asked for. */
function isEnabled(value: string | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
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
   * Known-prompt-injection RAG rebuilt from `resources/prompt-injections.json`
   * whenever an UPDATE_PROMPT_INJECTION_RAG event arrives. The container is
   * dedicated to this corpus — the rebuild purges it before writing.
   */
  promptInjectionRag: {
    container:
      process.env.PROMPT_INJECTION_RAG_CONTAINER || 'PromptInjectionRag',
    partitionKeyPath:
      process.env.PROMPT_INJECTION_RAG_PARTITION_KEY || '/injectionId',
    /** Target characters per chunk before overlap. */
    chunkSize: int(process.env.PROMPT_INJECTION_RAG_CHUNK_SIZE, 800),
    chunkOverlap: int(process.env.PROMPT_INJECTION_RAG_CHUNK_OVERLAP, 120),
    /** Chunks embedded per Azure OpenAI request. */
    embedBatchSize: int(process.env.PROMPT_INJECTION_RAG_EMBED_BATCH_SIZE, 16),
  },
  langsmith: {
    /**
     * LangSmith API key. This is the ONLY switch that turns tracing on:
     * with no key, no trace is ever sent (and no LangSmith client is built).
     */
    apiKey: process.env.LANGSMITH_API_KEY || undefined,
    /** Self-hosted/EU deployments override the default LangSmith host. */
    endpoint: process.env.LANGSMITH_ENDPOINT || undefined,
    /** LangSmith project that receives the hello-agent runs. */
    project: process.env.LANGSMITH_PROJECT || 'bnm-hello-agent',
    /** Kill switch: LANGSMITH_TRACING=false disables tracing even with a key. */
    enabled: !isDisabled(process.env.LANGSMITH_TRACING),
    /**
     * Upload the trace before the reply returns instead of batching it in
     * the background. Off by default because it puts a LangSmith round trip
     * on the request path; turn it on where the process may not live long
     * enough to drain the batch queue (short-lived or scale-to-zero hosts).
     */
    flushAfterRun: isEnabled(process.env.LANGSMITH_FLUSH_AFTER_RUN),
  },
}));
