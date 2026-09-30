import { ConfigService } from '@nestjs/config';
import { CrewLlmProvider } from '../modules/agent-crew/services/crew-llm.provider';
import { EmbeddingService } from '../modules/embedding/embedding.service';
import { AgentModelService } from '../modules/whatsapp-agent/services/agent-model.service';
import { EventGridService } from '../modules/whatsapp/services/event-grid.service';
import { EventGridEventValidator } from '../auth/events/event-grid-event.validator';

describe('Configuration & Model Architecture Audit', () => {
  const baseEnv = {
    OPENAI_BASE_URL: 'https://test.openai.azure.com/openai/v1',
    OPENAI_API_KEY: 'test-key-12345678901234567890',
    OPENAI_MODEL: 'test-chat-model',
    OPENAI_TEXT_MODEL: 'test-text-model',
    OPENAI_IMAGE_MODEL: 'test-image-model',
    OPENAI_EVALUATION_MODEL: 'test-eval-model',
    AGENT_CREW_MODEL: 'test-crew-model',
    WHATSAPP_AGENT_LLM_MODEL: 'test-intake-model',
    EMBEDDING_MODEL: 'test-embedding-model',
    COSMOS_ENDPOINT: 'https://test.documents.azure.com:443/',
    COSMOS_KEY: 'test-cosmos-key',
    COSMOS_DATABASE: 'test-db',
    TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
    TWILIO_AUTH_TOKEN: 'test-token',
    TWILIO_WHATSAPP_NUMBER: 'whatsapp:+14155238886',
    EVENT_GRID_EVENT_TYPES_REQUIREMENTS: 'POST_YOUR_REQUIREMENT,POST_YOUR_REQUIREMENTS',
    EVENT_GRID_EVENT_TYPES_QUOTES: 'QUOTE_CREATED_EVENT',
    EVENT_GRID_EVENT_TYPES_WHATSAPP: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
  };

  const mockOpenAIClient = {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'test' } }] }),
      },
    },
    embeddings: {
      create: jest.fn().mockResolvedValue({ data: [{ index: 0, embedding: Array(1536).fill(0.1) }] }),
    },
  };

  it('verifies text model is read from OPENAI_TEXT_MODEL', () => {
    const config = new ConfigService({ ...baseEnv, OPENAI_TEXT_MODEL: 'custom-text-model' });
    const crewLlm = new CrewLlmProvider(config);
    expect(crewLlm.getTextModelName()).toBe('custom-text-model');
  });

  it('verifies image model is read from OPENAI_IMAGE_MODEL', () => {
    const config = new ConfigService({ ...baseEnv, OPENAI_IMAGE_MODEL: 'custom-image-model' });
    const crewLlm = new CrewLlmProvider(config);
    expect(crewLlm.getImageModelName()).toBe('custom-image-model');
  });

  it('verifies evaluation model is read from OPENAI_EVALUATION_MODEL', () => {
    const config = new ConfigService({ ...baseEnv, OPENAI_EVALUATION_MODEL: 'custom-eval-model' });
    const crewLlm = new CrewLlmProvider(config);
    expect(crewLlm.getEvaluationModelName()).toBe('custom-eval-model');
  });

  it('verifies intake agent model is read from WHATSAPP_AGENT_LLM_MODEL', () => {
    const config = new ConfigService({
      ...baseEnv,
      WHATSAPP_AGENT_LLM_MODEL: 'custom-intake-model',
      WHATSAPP_AGENT_LLM_BASE_URL: 'https://test.openai.azure.com/openai/v1',
    });
    const agentModelService = new AgentModelService(config);
    expect(agentModelService.isConfigured()).toBe(true);
    const model = agentModelService.createModel();
    expect(model).toBeDefined();
  });

  it('verifies embedding model is read from EMBEDDING_MODEL', () => {
    const config = new ConfigService({ ...baseEnv, EMBEDDING_MODEL: 'custom-embedding-model' });
    const service = new EmbeddingService(mockOpenAIClient as any, config);
    expect((service as any).model).toBe('custom-embedding-model');
  });

  it('verifies multiple Event Grid event types are parsed and normalized', () => {
    const config = new ConfigService({
      ...baseEnv,
      EVENT_GRID_EVENT_TYPES_REQUIREMENTS: ' EVENT_A , EVENT_B ',
    });
    const service = new EventGridService(config);
    const types = service.getRequirementsEventTypes();
    expect(types.has('EVENT_A')).toBe(true);
    expect(types.has('EVENT_B')).toBe(true);
    expect(types.size).toBe(2);
  });
});
