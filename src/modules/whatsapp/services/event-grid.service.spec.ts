import { ConfigService } from '@nestjs/config';
import { EventGridService } from './event-grid.service';
import { WhatsappAgentEventService } from '../../whatsapp-agent/services/whatsapp-agent-event.service';
import { qualifyRequirementsEvent } from '../../whatsapp-agent/services/requirements-event.qualifier';

describe('EventGridService', () => {
  let service: EventGridService;
  let configService: ConfigService;
  let handleQualifiedInBackground: jest.Mock;
  let whatsappAgentEventService: WhatsappAgentEventService;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'app.appEnv') return 'dev';
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    } as unknown as ConfigService;

    handleQualifiedInBackground = jest.fn();
    whatsappAgentEventService = {
      qualify: qualifyRequirementsEvent,
      handleQualifiedInBackground,
    } as unknown as WhatsappAgentEventService;

    service = new EventGridService(configService, whatsappAgentEventService);
  });

  it('should handle Azure Event Grid subscription validation event', () => {
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

    const result = service.processEvent(validationPayload);
    expect(result).toEqual({ validationResponse: 'code-xyz-98765' });
  });

  it('should capture and process BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT', () => {
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

    const result = service.processEvent(eventPayload);
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

  it('should handle single object payload gracefully', () => {
    const eventPayload = {
      id: 'java-evt-002',
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
      subject: 'whatsapp/java/incoming',
      eventTime: '2026-08-14T12:00:00Z',
      data: {
        messageId: 'msg-102',
      },
    };

    const result = service.processEvent(eventPayload);
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

  it('should log unknown event types without throwing errors', () => {
    const unknownEvent = [
      {
        id: 'unknown-001',
        eventType: 'SOME_OTHER_EVENT',
        data: { foo: 'bar' },
      },
    ];

    const result = service.processEvent(unknownEvent);
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

  it('routes a Post Your Requirements event to the WhatsApp deep agent', () => {
    const eventPayload = [
      {
        id: 'java-evt-003',
        eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
        subject: 'whatsapp/java/incoming',
        eventTime: '2026-08-14T12:00:00Z',
        data: {
          formType: 'POST_YOUR_REQUIREMENTS',
          message: 'give me all customer names',
        },
      },
    ];

    const result = service.processEvent(eventPayload);

    expect(handleQualifiedInBackground).toHaveBeenCalledWith(
      expect.objectContaining({ qualified: true, matchedOn: 'data.formType' }),
    );
    expect(result).toEqual({
      message: 'Event Grid payload processed successfully',
      processedCount: 1,
      results: [
        {
          status: 'success',
          eventId: 'java-evt-003',
          eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
          routedTo: 'post-your-requirements-agent',
        },
      ],
    });
  });

  it('leaves unrelated WhatsApp events untouched by the agent branch', () => {
    service.processEvent([
      {
        id: 'java-evt-004',
        eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
        data: { content: 'Hello from Java app' },
      },
    ]);

    expect(handleQualifiedInBackground).not.toHaveBeenCalled();
  });

  it('still processes events when the agent module is not wired in', () => {
    const standalone = new EventGridService(configService);

    expect(
      standalone.processEvent({
        id: 'java-evt-005',
        eventType: 'POST_YOUR_REQUIREMENTS',
        data: { message: 'give me all customer names' },
      }),
    ).toEqual({
      message: 'Event Grid payload processed successfully',
      processedCount: 1,
      results: [
        {
          status: 'ignored',
          eventId: 'java-evt-005',
          eventType: 'POST_YOUR_REQUIREMENTS',
        },
      ],
    });
  });
});
