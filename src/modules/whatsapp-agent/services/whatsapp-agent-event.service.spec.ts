import { WhatsappAgentEventKind } from '../constants/whatsapp-agent-events';
import { PromptInjectionRagService } from './prompt-injection-rag.service';
import { WhatsappAgentEventService } from './whatsapp-agent-event.service';
import type { PromptInjectionRagResult } from '../interfaces/prompt-injection.interface';

function ragResult(
  overrides: Partial<PromptInjectionRagResult> = {},
): PromptInjectionRagResult {
  return {
    status: 'success',
    corpusVersion: '2026.08.1',
    injectionCount: 22,
    chunkCount: 71,
    deletedCount: 71,
    upsertedCount: 71,
    container: 'PromptInjectionRag',
    traced: true,
    durationMs: 12,
    errors: [],
    ...overrides,
  };
}

describe('WhatsappAgentEventService', () => {
  let ragService: jest.Mocked<Pick<PromptInjectionRagService, 'rebuild'>>;
  let service: WhatsappAgentEventService;

  beforeEach(() => {
    ragService = { rebuild: jest.fn(() => Promise.resolve(ragResult())) };
    service = new WhatsappAgentEventService(
      ragService as unknown as PromptInjectionRagService,
    );
  });

  it('qualifies a RAG update event and runs the rebuild', async () => {
    const outcome = await service.handle({
      id: 'evt-1',
      eventType: 'BNM_WHATSAPP_UPDATE_PROMPT_INJECTION_RAG_EVENT',
    });

    expect(outcome.kind).toBe(WhatsappAgentEventKind.UpdatePromptInjectionRag);
    expect(outcome.handled).toBe(true);
    expect(outcome.status).toBe('success');
    expect(ragService.rebuild).toHaveBeenCalledWith('evt-1');
  });

  it('reports a failed rebuild without throwing', async () => {
    ragService.rebuild.mockResolvedValue(
      ragResult({ status: 'failed', errors: ['cosmos down'] }),
    );

    const outcome = await service.handle({
      id: 'evt-2',
      eventType: 'UPDATE_PROMPT_INJECTION_RAG',
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.status).toBe('failed');
  });

  it('leaves inbound message events to the existing handling', async () => {
    const outcome = await service.handle({
      id: 'evt-3',
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
    });

    expect(outcome.kind).toBe(WhatsappAgentEventKind.MessageReceived);
    expect(outcome.handled).toBe(false);
    expect(outcome.status).toBe('ignored');
    expect(ragService.rebuild).not.toHaveBeenCalled();
  });

  it('ignores unrelated events', async () => {
    const outcome = await service.handle({ eventType: 'SOME_OTHER_EVENT' });

    expect(outcome.kind).toBe(WhatsappAgentEventKind.Unknown);
    expect(outcome.status).toBe('ignored');
    expect(ragService.rebuild).not.toHaveBeenCalled();
  });

  it('exposes qualification without acting on the event', () => {
    expect(service.qualify({ eventType: 'UPDATE_PROMPT_INJECTION_RAG' })).toBe(
      WhatsappAgentEventKind.UpdatePromptInjectionRag,
    );
    expect(service.canHandle({ eventType: 'SOME_OTHER_EVENT' })).toBe(false);
    expect(ragService.rebuild).not.toHaveBeenCalled();
  });
});
