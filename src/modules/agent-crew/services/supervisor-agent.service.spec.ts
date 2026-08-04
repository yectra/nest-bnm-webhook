import { SupervisorAgentService } from './supervisor-agent.service';
import { CrewLlmProvider } from './crew-llm.provider';
import { CrewAgentDefinition } from '../graph/crew-agent.definition';

describe('SupervisorAgentService', () => {
  let llm: { completeJson: jest.Mock };

  const makeAgent = (
    overrides: Partial<CrewAgentDefinition> & { planKey: string },
  ): CrewAgentDefinition => ({
    name: `${overrides.planKey}-agent`,
    planningHint: 'test hint',
    enabled: () => true,
    planHeuristic: () => false,
    run: jest.fn(),
    ...overrides,
  });

  const buildService = (agents: CrewAgentDefinition[]) => {
    llm = { completeJson: jest.fn() };
    return new SupervisorAgentService(
      llm as unknown as CrewLlmProvider,
      agents,
    );
  };

  const imageQuestion = 'What do the pictures on my quote show?';

  const registry = (imageEnabled: boolean): CrewAgentDefinition[] => [
    makeAgent({
      name: 'serviceVectorAgent',
      planKey: 'useServices',
      planHeuristic: () => true,
    }),
    makeAgent({
      name: 'quoteAgent',
      planKey: 'useQuotes',
      planHeuristic: (q) => /quote/i.test(q),
    }),
    makeAgent({
      name: 'imageAgent',
      planKey: 'useImages',
      enabled: () => imageEnabled,
      planHeuristic: (q) => /picture|photo|image/i.test(q),
    }),
  ];

  it('never plans a disabled agent, even when the LLM asks for it', async () => {
    const service = buildService(registry(false));
    llm.completeJson.mockResolvedValue({
      useServices: true,
      useQuotes: true,
      useImages: true,
      rationale: 'user mentioned pictures',
    });

    const plan = await service.plan(imageQuestion);
    expect(plan.agents.useImages).toBeUndefined();
    expect(plan.agents.useQuotes).toBe(true);
  });

  it('never plans a disabled agent in the heuristic fallback', async () => {
    const service = buildService(registry(false));
    llm.completeJson.mockResolvedValue(null);

    const plan = await service.plan(imageQuestion);
    expect(plan.agents.useImages).toBeUndefined();
    expect(plan.agents.useServices).toBe(true);
  });

  it('plans an enabled agent when the LLM selects it', async () => {
    const service = buildService(registry(true));
    llm.completeJson.mockResolvedValue({
      useServices: true,
      useQuotes: false,
      useImages: true,
      rationale: 'user mentioned pictures',
    });

    const plan = await service.plan(imageQuestion);
    expect(plan.agents.useImages).toBe(true);
    expect(plan.agents.useQuotes).toBe(false);
  });

  it('offers only enabled agents to the LLM planner', async () => {
    const service = buildService(registry(false));
    llm.completeJson.mockResolvedValue(null);

    await service.plan(imageQuestion);
    const calls = llm.completeJson.mock.calls as [string, string][];
    const systemPrompt = calls[0][0];
    expect(systemPrompt).toContain('useServices');
    expect(systemPrompt).toContain('useQuotes');
    expect(systemPrompt).not.toContain('useImages');
  });

  it('never plans an empty crew', async () => {
    const service = buildService([
      makeAgent({ planKey: 'useServices', planHeuristic: () => false }),
      makeAgent({ planKey: 'useQuotes', planHeuristic: () => false }),
    ]);
    llm.completeJson.mockResolvedValue({
      useServices: false,
      useQuotes: false,
      rationale: 'nothing needed',
    });

    const plan = await service.plan('hello');
    expect(plan.agents.useServices).toBe(true);
  });
});
