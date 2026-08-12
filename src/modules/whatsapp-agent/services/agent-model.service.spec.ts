import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { AgentModelService } from './agent-model.service';

function configWith(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('AgentModelService', () => {
  it('is not configured and returns no model without a base URL', () => {
    const service = new AgentModelService(configWith({}));
    expect(service.isConfigured()).toBe(false);
    expect(service.createModel()).toBeUndefined();
  });

  it('builds a ChatOpenAI model from explicit settings', () => {
    const service = new AgentModelService(
      configWith({
        'whatsappAgent.llm.baseUrl': 'https://llm.example/v1',
        'whatsappAgent.llm.apiKey': 'secret-key',
        'whatsappAgent.llm.model': 'my-model',
      }),
    );
    expect(service.isConfigured()).toBe(true);
    const model = service.createModel();
    expect(model).toBeInstanceOf(ChatOpenAI);
    expect((model as ChatOpenAI).model).toBe('my-model');
  });

  it('falls back to the default model and placeholder key', () => {
    const service = new AgentModelService(
      configWith({ 'whatsappAgent.llm.baseUrl': 'https://llm.example/v1' }),
    );
    const model = service.createModel() as ChatOpenAI;
    expect(model.model).toBe('phi-4-mini-instruct');
  });
});
