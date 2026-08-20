import { ConfigService } from '@nestjs/config';
import { EventGridService } from './event-grid.service';

describe('EventGridService', () => {
  let service: EventGridService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'app.appEnv') return 'dev';
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new EventGridService(configService);
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
          status: 'success',
          eventId: 'unknown-001',
          eventType: 'SOME_OTHER_EVENT',
        },
      ],
    });
  });
});
