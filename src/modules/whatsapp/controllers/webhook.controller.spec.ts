import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { WebhookService } from '../services/webhook.service';
import { CallbackService } from '../services/callback.service';
import { EventGridService } from '../services/event-grid.service';
import { KeyVaultService } from '../../../common/services/key-vault.service';
import { EventSecurityGuard } from '../../../common/guards/event-security.guard';

describe('WebhookController', () => {
  let controller: WebhookController;
  let eventGridService: jest.Mocked<EventGridService>;

  beforeEach(async () => {
    const mockWebhookService = {
      receive: jest.fn().mockReturnValue({ xml: '<Response/>' }),
    };

    const mockCallbackService = {
      handleStatusCallback: jest.fn().mockReturnValue({ status: 'ok' }),
    };

    const mockEventGridService = {
      processEvent: jest.fn().mockReturnValue({
        message: 'Event Grid payload processed successfully',
        processedCount: 1,
        results: [{ status: 'success' }],
      }),
    };

    const mockKeyVaultService = {
      getEventSecurityKey: jest.fn().mockResolvedValue('test-key'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: CallbackService, useValue: mockCallbackService },
        { provide: EventGridService, useValue: mockEventGridService },
        { provide: KeyVaultService, useValue: mockKeyVaultService },
        EventSecurityGuard,
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
    eventGridService = module.get(EventGridService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should process Event Grid event when invoked', () => {
    const body = [
      { id: 'evt-1', eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT' },
    ];
    const result: unknown = controller.receiveEventGridEvent(body);

    expect(eventGridService.processEvent).toHaveBeenLastCalledWith(body);
    expect(result).toEqual({
      message: 'Event Grid payload processed successfully',
      processedCount: 1,
      results: [{ status: 'success' }],
    });
  });
});
