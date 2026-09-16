import { ConfigService } from '@nestjs/config';
import { EventGridService } from './event-grid.service';
import { PostYourRequirementsAgentService } from '../../whatsapp-agent/services/post-your-requirements-agent.service';

describe('EventGridService', () => {
  let service: EventGridService;
  let configService: ConfigService;
  let postYourRequirementsAgentService: { processEvent: jest.Mock };

  beforeEach(() => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'app.appEnv') return 'dev';
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    } as unknown as ConfigService;

    postYourRequirementsAgentService = {
      processEvent: jest.fn().mockResolvedValue({ status: 'processed_by_agent' }),
    };

    const mockRequestAQuoteAgentService = {
      processEvent: jest.fn().mockResolvedValue('quote processed'),
    };

    service = new EventGridService(
      configService,
      postYourRequirementsAgentService as any,
      mockRequestAQuoteAgentService as any,
    );
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

  it('should log unknown event types without throwing errors and mark status as ignored', async () => {
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

  it('should invoke the PostYourRequirements agent and include agentReply in result', async () => {
    const eventPayload = [
      {
        id: 'pyr-evt-001',
        eventType: 'POST_YOUR_REQUIREMENTS',
        subject: 'requirements/new',
        eventTime: '2026-08-20T07:00:00Z',
        data: {
          requirementId: 'req-123',
          description: 'Looking for 3BHK in Bangalore',
          budget: '80L',
        },
      },
    ];

    const result = await service.processEvent(eventPayload);

    expect(postYourRequirementsAgentService.processEvent).toHaveBeenCalledWith(
      eventPayload[0],
    );
    expect(result).toEqual({
      message: 'Event Grid payload processed successfully',
      processedCount: 1,
      results: [
        {
          status: 'success',
          eventId: 'pyr-evt-001',
          eventType: 'POST_YOUR_REQUIREMENTS',
          agentReply: { status: 'processed_by_agent' },
        },
      ],
    });
  });

  it('should handle singular POST_YOUR_REQUIREMENT and invoke PostYourRequirements agent', async () => {
    const eventPayload = [
      {
        id: 'pyr-single-001',
        eventType: 'POST_YOUR_REQUIREMENT',
        data: { message: 'Need 2BHK flat' },
      },
    ];

    const result = await service.processEvent(eventPayload);
    expect(postYourRequirementsAgentService.processEvent).toHaveBeenCalledWith(eventPayload[0]);
    expect(result).toEqual({
      message: 'Event Grid payload processed successfully',
      processedCount: 1,
      results: [
        {
          status: 'success',
          eventId: 'pyr-single-001',
          eventType: 'POST_YOUR_REQUIREMENT',
          agentReply: { status: 'processed_by_agent' },
        },
      ],
    });
  });

  it('should handle QUOTE_CREATED_EVENT and invoke ONLY RequestAQuote agent', async () => {
    const eventPayload = [
      {
        id: 'quote-001',
        eventType: 'QUOTE_CREATED_EVENT',
        data: { quoteId: 'q-101', message: 'Need painting quote' },
      },
    ];

    const result = await service.processEvent(eventPayload);
    expect(postYourRequirementsAgentService.processEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: 'Event Grid payload processed successfully',
      processedCount: 1,
      results: [
        {
          status: 'success',
          eventId: 'quote-001',
          eventType: 'QUOTE_CREATED_EVENT',
          agentReply: 'quote processed',
        },
      ],
    });
  });

  it('should process BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT without invoking any agent', async () => {
    const eventPayload = [
      {
        id: 'wa-001',
        eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
        data: { messageId: 'm-1' },
      },
    ];

    const result = await service.processEvent(eventPayload);
    expect(postYourRequirementsAgentService.processEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: 'Event Grid payload processed successfully',
      processedCount: 1,
      results: [
        {
          status: 'success',
          eventId: 'wa-001',
          eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
        },
      ],
    });
  });
});
