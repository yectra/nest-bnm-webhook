import { ConfigService } from '@nestjs/config';
import {
  EventGridService,
  type EventGridProcessingResponse,
} from './event-grid.service';
import { WhatsappAgentEventService } from '../../whatsapp-agent/services/whatsapp-agent-event.service';
import { PromptInjectionRagService } from '../../whatsapp-agent/services/prompt-injection-rag.service';
import type { PromptInjectionRagResult } from '../../whatsapp-agent/interfaces/prompt-injection.interface';

const RAG_RESULT: PromptInjectionRagResult = {
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
};

describe('EventGridService', () => {
  let service: EventGridService;
  let configService: ConfigService;
  let rebuild: jest.Mock;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'app.appEnv') return 'dev';
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    } as unknown as ConfigService;

    rebuild = jest.fn().mockResolvedValue(RAG_RESULT);
    const whatsappAgentEventService = new WhatsappAgentEventService({
      rebuild,
    } as unknown as PromptInjectionRagService);

    service = new EventGridService(configService, whatsappAgentEventService);
  });

  it('should handle Azure Event Grid subscription validation event', async () => {
    const validationPayload = [
      {
        id: 'validation-id-123',
        eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
        subject: '',
        eventTime: '2026-08-14T12:00:00Z',
        data: {
          validationCode: 'code-xyz-98765',
        },
      },
    ];

    const result = await service.processEvent(validationPayload);
    expect(result).toEqual({ validationResponse: 'code-xyz-98765' });
  });

  it('should capture and process BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT', async () => {
    const eventPayload = [
      {
        id: 'java-evt-001',
        eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
        subject: 'whatsapp/java/incoming',
        eventTime: '2026-08-14T12:00:00Z',
        data: {
          messageId: 'msg-101',
          from: '+1234567890',
          content: 'Hello from Java app',
        },
      },
    ];

    const result = await service.processEvent(eventPayload);
    expect(result).toEqual({
      message: 'Event Grid payload processed successfully',
      processedCount: 1,
      results: [
        {
          status: 'success',
          eventId: 'java-evt-001',
          eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
        },
      ],
    });
  });

  it('should handle single object payload gracefully', async () => {
    const eventPayload = {
      id: 'java-evt-002',
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
      subject: 'whatsapp/java/incoming',
      eventTime: '2026-08-14T12:00:00Z',
      data: {
        messageId: 'msg-102',
      },
    };

    const result = await service.processEvent(eventPayload);
    expect(result).toEqual({
      message: 'Event Grid payload processed successfully',
      processedCount: 1,
      results: [
        {
          status: 'success',
          eventId: 'java-evt-002',
          eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
        },
      ],
    });
  });

  it('should log unknown event types without throwing errors', async () => {
    const unknownEvent = [
      {
        id: 'unknown-001',
        eventType: 'SOME_OTHER_EVENT',
        data: { foo: 'bar' },
      },
    ];

    const result = await service.processEvent(unknownEvent);
    expect(result).toEqual({
      message: 'Event Grid payload processed successfully',
      processedCount: 1,
      results: [
        {
          status: 'ignored',
          eventId: 'unknown-001',
          eventType: 'SOME_OTHER_EVENT',
        },
      ],
    });
  });

  it('branches to the prompt-injection RAG rebuild for an update event', async () => {
    const result = (await service.processEvent([
      {
        id: 'rag-evt-001',
        eventType: 'BNM_WHATSAPP_UPDATE_PROMPT_INJECTION_RAG_EVENT',
        subject: 'whatsapp/agent/rag',
        eventTime: '2026-08-18T12:00:00Z',
        data: {},
      },
    ])) as EventGridProcessingResponse;

    expect(rebuild).toHaveBeenCalledWith('rag-evt-001');
    expect(result.results).toEqual([
      {
        status: 'success',
        eventId: 'rag-evt-001',
        eventType: 'BNM_WHATSAPP_UPDATE_PROMPT_INJECTION_RAG_EVENT',
        agentEventKind: 'UPDATE_PROMPT_INJECTION_RAG',
        promptInjectionRag: RAG_RESULT,
      },
    ]);
  });

  it('qualifies the update event when the producer only sets the subject', async () => {
    const result = (await service.processEvent({
      id: 'rag-evt-002',
      eventType: 'BNM_GENERIC_EVENT',
      subject: 'whatsapp/agent/update-prompt-injection-rag',
    })) as EventGridProcessingResponse;

    expect(rebuild).toHaveBeenCalledWith('rag-evt-002');
    expect(result.results[0].status).toBe('success');
  });

  it('reports a failed rebuild without failing the webhook', async () => {
    rebuild.mockResolvedValue({
      ...RAG_RESULT,
      status: 'failed',
      errors: ['cosmos down'],
    });

    const result = (await service.processEvent({
      id: 'rag-evt-003',
      eventType: 'UPDATE_PROMPT_INJECTION_RAG',
    })) as EventGridProcessingResponse;

    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].promptInjectionRag).toMatchObject({
      errors: ['cosmos down'],
    });
  });

  it('does not rebuild the RAG for unrelated events', async () => {
    await service.processEvent({
      id: 'other-001',
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
    });
    await service.processEvent({ id: 'other-002', eventType: 'SOME_OTHER' });

    expect(rebuild).not.toHaveBeenCalled();
  });
});
