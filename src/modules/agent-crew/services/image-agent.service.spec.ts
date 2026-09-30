import { ConfigService } from '@nestjs/config';
import { ImageAgentService } from './image-agent.service';
import { CosmosRepository } from '../../chatbot/repositories/cosmos.repository';
import { CrewLlmProvider } from './crew-llm.provider';

describe('ImageAgentService', () => {
  const buildService = (
    imageAgentEnabled: unknown,
    imageModel: string | null = 'gpt-5-mini',
  ) => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AGENT_CREW_IMAGE_AGENT_ENABLED') return imageAgentEnabled;
        if (key === 'OPENAI_IMAGE_MODEL') return imageModel ?? undefined;
        return undefined;
      }),
    } as unknown as ConfigService;
    return new ImageAgentService(
      {} as CosmosRepository,
      {} as CrewLlmProvider,
      config,
    );
  };

  it('fails fast if OPENAI_IMAGE_MODEL is missing', () => {
    expect(() => buildService(false, null)).toThrow(
      'OPENAI_IMAGE_MODEL is required but not configured.',
    );
  });

  it('is disabled by default', () => {
    expect(buildService(undefined).enabled()).toBe(false);
  });

  it('stays disabled when the flag is false', () => {
    expect(buildService(false).enabled()).toBe(false);
    expect(buildService('false').enabled()).toBe(false);
  });

  it('is enabled with the boolean flag', () => {
    expect(buildService(true).enabled()).toBe(true);
  });

  it('accepts the string form "true" from the environment', () => {
    expect(buildService('true').enabled()).toBe(true);
  });

  it('activates in the plan heuristic only for picture questions', () => {
    const service = buildService(true);
    expect(service.planHeuristic('What do the pictures show?')).toBe(true);
    expect(service.planHeuristic('List plumbing services')).toBe(false);
  });
});
