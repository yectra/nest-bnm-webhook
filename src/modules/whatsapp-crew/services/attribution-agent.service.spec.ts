import { AttributionAgentService } from './attribution-agent.service';
import { CrewLlmProvider } from '../../agent-crew/services/crew-llm.provider';
import { WhatsappCrewAgentDefinition } from '../graph/whatsapp-crew-agent.definition';
import { WhatsappCrewState } from '../graph/whatsapp-crew-state';
import { VectorSearchResult } from '../../chatbot/interfaces/vector-search.interface';

const match = (
  id: string,
  container: string,
  similarity: number,
): VectorSearchResult => ({
  id,
  sourceContainer: container,
  sourceId: id,
  distance: 1 - similarity,
  similarity,
  sourceData: { id, title: `record ${id}` },
});

const agentStub = (
  domain: WhatsappCrewAgentDefinition['domain'],
  matchChannel: WhatsappCrewAgentDefinition['matchChannel'],
): WhatsappCrewAgentDefinition => ({
  name: `${domain}Agent`,
  planKey: `use${domain}`,
  planningHint: domain,
  domain,
  matchChannel,
  enabled: () => true,
  planHeuristic: () => true,
  run: () => Promise.resolve({}),
});

const stateWith = (overrides: Partial<WhatsappCrewState>): WhatsappCrewState =>
  ({
    question: 'Where is my quote?',
    projectMatches: [],
    quoteMatches: [],
    requirementMatches: [],
    feedbackMatches: [],
    ...overrides,
  }) as WhatsappCrewState;

describe('AttributionAgentService', () => {
  const agents = [
    agentStub('project', 'projectMatches'),
    agentStub('quote', 'quoteMatches'),
    agentStub('requirements', 'requirementMatches'),
    agentStub('feedback', 'feedbackMatches'),
  ];

  const buildService = (completeJsonResult: unknown) => {
    const llm = {
      completeJson: jest.fn().mockResolvedValue(completeJsonResult),
    } as unknown as CrewLlmProvider;
    return new AttributionAgentService(llm, agents);
  };

  it('returns general attribution when nothing was retrieved', async () => {
    const service = buildService(null);
    const attribution = await service.attribute(stateWith({}));
    expect(attribution.domain).toBe('general');
    expect(attribution.recordId).toBeNull();
  });

  it('falls back to the best-similarity candidate when the LLM is unavailable', async () => {
    const service = buildService(null);
    const attribution = await service.attribute(
      stateWith({
        projectMatches: [match('p1', 'Project', 0.4)],
        quoteMatches: [match('q1', 'Quote', 0.9)],
        feedbackMatches: [match('f1', 'Feedback', 0.6)],
      }),
    );
    expect(attribution.domain).toBe('quote');
    expect(attribution.recordId).toBe('q1');
    expect(attribution.recordContainer).toBe('Quote');
  });

  it('accepts a valid LLM attribution', async () => {
    const service = buildService({
      domain: 'feedback',
      recordId: 'f1',
      confidence: 0.85,
      rationale: 'Customer is following up on their feedback form.',
    });
    const attribution = await service.attribute(
      stateWith({
        quoteMatches: [match('q1', 'Quote', 0.9)],
        feedbackMatches: [match('f1', 'Feedback', 0.6)],
      }),
    );
    expect(attribution.domain).toBe('feedback');
    expect(attribution.recordId).toBe('f1');
    expect(attribution.confidence).toBeCloseTo(0.85);
  });

  it('rejects a hallucinated recordId not present in the candidates', async () => {
    const service = buildService({
      domain: 'quote',
      recordId: 'made-up-id',
      confidence: 0.9,
      rationale: 'Invented record.',
    });
    const attribution = await service.attribute(
      stateWith({ quoteMatches: [match('q1', 'Quote', 0.7)] }),
    );
    expect(attribution.domain).toBe('quote');
    expect(attribution.recordId).toBeNull();
  });

  it('clamps an out-of-range confidence and rejects an invalid domain', async () => {
    const service = buildService({
      domain: 'nonsense',
      recordId: 'q1',
      confidence: 7,
      rationale: 'Bad output.',
    });
    const attribution = await service.attribute(
      stateWith({ quoteMatches: [match('q1', 'Quote', 0.7)] }),
    );
    expect(attribution.domain).toBe('quote'); // heuristic fallback domain
    expect(attribution.confidence).toBeLessThanOrEqual(1);
  });
});
