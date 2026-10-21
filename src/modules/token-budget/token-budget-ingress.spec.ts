import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventGridService } from '../whatsapp/services/event-grid.service';
import { WebhookService } from '../whatsapp/services/webhook.service';
import { WhatsAppSenderPolicyService } from './whatsapp-sender-policy.service';
import { TokenBudgetService } from './token-budget.service';
import { PostYourRequirementsAgentService } from '../whatsapp-agent/services/post-your-requirements-agent.service';
import { RequestAQuoteAgentService } from '../whatsapp-agent/services/request-a-quote-agent.service';
import { LeadValidatorService } from '../agent-crew/lead-validator/lead-validator.service';

describe('Ingress Sender Policy & Budget Exhaustion Enforcement (Scenarios 9, 26)', () => {
  let eventGridService: EventGridService;
  let webhookService: WebhookService;
  let postYourRequirementsMock: any;
  let requestAQuoteMock: any;
  let leadValidatorMock: any;
  let senderPolicyService: WhatsAppSenderPolicyService;
  let tokenBudgetService: TokenBudgetService;

  let configMap: Record<string, any>;
  let budgetAvailable = true;

  beforeEach(async () => {
    budgetAvailable = true;
    configMap = {
      AI_TOKEN_BUDGET_SENDER_MODE: 'allowlist',
      AI_TOKEN_BUDGET_ALLOWED_WHATSAPP_NUMBERS: '+14155552671',
      EVENT_GRID_EVENT_TYPES_REQUIREMENTS:
        'POST_YOUR_REQUIREMENT,POST_YOUR_REQUIREMENTS',
      EVENT_GRID_EVENT_TYPES_QUOTES: 'QUOTE_CREATED_EVENT',
      EVENT_GRID_EVENT_TYPES_WHATSAPP: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
      TWILIO_AUTH_TOKEN: 'mock-auth-token',
      TWILIO_ACCOUNT_SID: 'ACmock',
    };

    postYourRequirementsMock = {
      processEvent: jest.fn().mockResolvedValue('Agent processed requirement'),
    };
    requestAQuoteMock = {
      processEvent: jest.fn().mockResolvedValue('Agent processed quote'),
    };
    leadValidatorMock = {
      validateLead: jest.fn().mockResolvedValue({ status: 'VALID' }),
    };

    const mockTokenBudgetService = {
      checkBudgetAvailable: jest.fn(async () => {
        if (!budgetAvailable) {
          return {
            allowed: false,
            reason: 'AI_TOKEN_BUDGET_EXHAUSTED',
            currentUsage: 10000,
            currentReserved: 0,
            remainingTokens: 0,
            limit: 10000,
            windowStart: new Date().toISOString(),
            windowEnd: new Date().toISOString(),
          };
        }
        return {
          allowed: true,
          currentUsage: 2000,
          currentReserved: 0,
          remainingTokens: 8000,
          limit: 10000,
          windowStart: new Date().toISOString(),
          windowEnd: new Date().toISOString(),
        };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventGridService,
        WebhookService,
        WhatsAppSenderPolicyService,
        {
          provide: TokenBudgetService,
          useValue: mockTokenBudgetService,
        },
        {
          provide: PostYourRequirementsAgentService,
          useValue: postYourRequirementsMock,
        },
        {
          provide: RequestAQuoteAgentService,
          useValue: requestAQuoteMock,
        },
        {
          provide: LeadValidatorService,
          useValue: leadValidatorMock,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configMap[key]),
          },
        },
      ],
    }).compile();

    eventGridService = module.get<EventGridService>(EventGridService);
    webhookService = module.get<WebhookService>(WebhookService);
    senderPolicyService = module.get<WhatsAppSenderPolicyService>(
      WhatsAppSenderPolicyService,
    );
    tokenBudgetService = module.get<TokenBudgetService>(TokenBudgetService);
  });

  describe('EventGrid Ingress', () => {
    it('Scenario 9: skips Event Grid event from unauthorized sender without calling AI agents', async () => {
      const event = {
        id: 'evt_unauthorized_1',
        eventType: 'POST_YOUR_REQUIREMENTS',
        data: {
          from: '+19998887766', // NOT in allowlist (+14155552671 is allowed)
          message: 'Need 3BHK flat',
        },
      };

      const result = await eventGridService.processEvent(event);

      expect(result.results[0].status).toBe('skipped');
      expect(result.results[0].reason).toBe('AI_SENDER_NOT_ALLOWED');
      // Crucial assertion: AI models and LeadValidator were NEVER invoked!
      expect(postYourRequirementsMock.processEvent).not.toHaveBeenCalled();
      expect(leadValidatorMock.validateLead).not.toHaveBeenCalled();
    });

    it('Scenario 26: skips Event Grid event when budget is exhausted without error or retries', async () => {
      budgetAvailable = false; // Budget exhausted

      const event = {
        id: 'evt_exhausted_1',
        eventType: 'POST_YOUR_REQUIREMENTS',
        data: {
          from: '+14155552671', // Authorized sender
          message: 'Need 3BHK flat',
        },
      };

      const result = await eventGridService.processEvent(event);

      expect(result.results[0].status).toBe('skipped');
      expect(result.results[0].reason).toBe('AI_TOKEN_BUDGET_EXHAUSTED');
      // Model mock was NOT called!
      expect(postYourRequirementsMock.processEvent).not.toHaveBeenCalled();
      expect(leadValidatorMock.validateLead).not.toHaveBeenCalled();
    });

    it('processes event when sender is authorized and budget is available', async () => {
      budgetAvailable = true;

      const event = {
        id: 'evt_valid_1',
        eventType: 'POST_YOUR_REQUIREMENTS',
        data: {
          from: '+14155552671', // Authorized
          message: 'Need villa in Whitefield',
        },
      };

      const result = await eventGridService.processEvent(event);

      expect(result.results[0].status).toBe('success');
      expect(postYourRequirementsMock.processEvent).toHaveBeenCalledTimes(1);
    });

    it('preserves system infrastructure events like SubscriptionValidation', async () => {
      const handshakeEvent = {
        id: 'hs_1',
        eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
        data: {
          validationCode: 'handshake-secret-code-999',
        },
      };

      const result = (await eventGridService.processEvent(
        handshakeEvent,
      )) as any;
      expect(result.validationResponse).toBe('handshake-secret-code-999');
    });
  });

  describe('Twilio Webhook Ingress', () => {
    it('returns valid TwiML acknowledgment without AI when sender not in allowlist', async () => {
      const mockReq = {
        protocol: 'https',
        get: jest.fn((header: string) => {
          if (header === 'host') return 'api.example.com';
          if (header === 'x-twilio-signature') return 'mock-sig';
          return undefined;
        }),
        originalUrl: '/api/webhook/whatsapp',
      } as any;

      // Mock validateTwilioRequest to pass
      jest
        .spyOn(webhookService, 'validateTwilioRequest')
        .mockImplementation(() => {});

      const response = await webhookService.receive(mockReq, {
        From: 'whatsapp:+19998887766', // unauthorized
        Body: 'Hello',
        ProfileName: 'TestUser',
      });

      expect(response.xml).toBeDefined();
      expect(response.xml).toContain('<Response');
      // No message body sent to unauthorized sender
      expect(response.xml).not.toContain('Hello TestUser');
    });

    it('returns valid TwiML acknowledgment without AI when budget is exhausted', async () => {
      budgetAvailable = false;

      const mockReq = {
        protocol: 'https',
        get: jest.fn((header: string) => {
          if (header === 'host') return 'api.example.com';
          if (header === 'x-twilio-signature') return 'mock-sig';
          return undefined;
        }),
        originalUrl: '/api/webhook/whatsapp',
      } as any;

      jest
        .spyOn(webhookService, 'validateTwilioRequest')
        .mockImplementation(() => {});

      const response = await webhookService.receive(mockReq, {
        From: 'whatsapp:+14155552671', // authorized sender
        Body: 'Hello',
        ProfileName: 'TestUser',
      });

      expect(response.xml).toBeDefined();
      expect(response.xml).toContain('<Response');
      expect(response.xml).not.toContain('Hello TestUser');
    });
  });
});
