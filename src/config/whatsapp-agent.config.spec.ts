import whatsappAgentConfig from './whatsapp-agent.config';

const ENV_KEYS = [
  'WHATSAPP_AGENT_LLM_BASE_URL',
  'WHATSAPP_AGENT_LLM_API_KEY',
  'WHATSAPP_AGENT_LLM_MODEL',
  'WHATSAPP_AGENT_FEEDBACK_CONTAINER',
] as const;

describe('whatsappAgentConfig', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('applies safe defaults when nothing is set', () => {
    expect(whatsappAgentConfig()).toEqual({
      llm: {
        baseUrl: undefined,
        apiKey: undefined,
        model: 'phi-4-mini-instruct',
      },
      feedbackContainer: 'CustomerFeedback',
    });
  });

  it('reads explicit environment values', () => {
    process.env.WHATSAPP_AGENT_LLM_BASE_URL = 'https://llm.example/v1';
    process.env.WHATSAPP_AGENT_LLM_API_KEY = 'secret-key';
    process.env.WHATSAPP_AGENT_LLM_MODEL = 'my-model';
    process.env.WHATSAPP_AGENT_FEEDBACK_CONTAINER = 'MyFeedback';
    expect(whatsappAgentConfig()).toEqual({
      llm: {
        baseUrl: 'https://llm.example/v1',
        apiKey: 'secret-key',
        model: 'my-model',
      },
      feedbackContainer: 'MyFeedback',
    });
  });
});
