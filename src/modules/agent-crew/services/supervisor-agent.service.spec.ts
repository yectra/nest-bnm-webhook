import { ConfigService } from '@nestjs/config';
import { SupervisorAgentService } from './supervisor-agent.service';
import { CrewLlmProvider } from './crew-llm.provider';

describe('SupervisorAgentService', () => {
  let llm: { completeJson: jest.Mock };

  const buildService = (imageAgentEnabled: unknown) => {
    llm = { completeJson: jest.fn() };
    const config = {
      get: jest.fn((key: string) =>
        key === 'AGENT_CREW_IMAGE_AGENT_ENABLED'
          ? imageAgentEnabled
          : undefined,
      ),
    } as unknown as ConfigService;
    return new SupervisorAgentService(
      llm as unknown as CrewLlmProvider,
      config,
    );
  };

  const imageQuestion = 'What do the pictures on my quote show?';

  it('never plans the image agent by default, even when the LLM asks for it', async () => {
    const service = buildService(undefined);
    llm.completeJson.mockResolvedValue({
      useServices: true,
      useQuotes: true,
      useImages: true,
      rationale: 'user mentioned pictures',
    });

    const plan = await service.plan(imageQuestion);
    expect(plan.useImages).toBe(false);
    expect(plan.useQuotes).toBe(true);
  });

  it('never plans the image agent in the heuristic fallback by default', async () => {
    const service = buildService(false);
    llm.completeJson.mockResolvedValue(null);

    const plan = await service.plan(imageQuestion);
    expect(plan.useImages).toBe(false);
    expect(plan.useServices).toBe(true);
  });

  it('plans the image agent when AGENT_CREW_IMAGE_AGENT_ENABLED is true', async () => {
    const service = buildService(true);
    llm.completeJson.mockResolvedValue({
      useServices: true,
      useQuotes: false,
      useImages: true,
      rationale: 'user mentioned pictures',
    });

    const plan = await service.plan(imageQuestion);
    expect(plan.useImages).toBe(true);
  });

  it('accepts the string form "true" from the environment', async () => {
    const service = buildService('true');
    llm.completeJson.mockResolvedValue(null);

    const plan = await service.plan(imageQuestion);
    expect(plan.useImages).toBe(true);
  });
});
