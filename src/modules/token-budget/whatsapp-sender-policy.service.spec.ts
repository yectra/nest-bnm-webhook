import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WhatsAppSenderPolicyService } from './whatsapp-sender-policy.service';

describe('WhatsAppSenderPolicyService', () => {
  let service: WhatsAppSenderPolicyService;
  let configMap: Record<string, any>;

  beforeEach(async () => {
    configMap = {
      AI_TOKEN_BUDGET_SENDER_MODE: 'allowlist',
      AI_TOKEN_BUDGET_ALLOWED_WHATSAPP_NUMBERS:
        '+14155552671,+919876543210,+447700900077,+61491570156,+819012345678',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppSenderPolicyService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configMap[key]),
          },
        },
      ],
    }).compile();

    service = module.get<WhatsAppSenderPolicyService>(
      WhatsAppSenderPolicyService,
    );
  });

  describe('Phone number normalization (Scenario 10)', () => {
    it('normalizes Twilio whatsapp: prefix correctly', () => {
      expect(service.normalizePhoneNumber('whatsapp:+14155552671')).toBe(
        '+14155552671',
      );
    });

    it('normalizes spaces, parentheses, hyphens, and leading zeros', () => {
      expect(service.normalizePhoneNumber(' +91 (987) 654-3210 ')).toBe(
        '+919876543210',
      );
      expect(service.normalizePhoneNumber('00447700900077')).toBe(
        '+447700900077',
      );
    });

    it('prepends + to bare international digits', () => {
      expect(service.normalizePhoneNumber('14155552671')).toBe('+14155552671');
    });

    it('returns null for invalid strings', () => {
      expect(service.normalizePhoneNumber('')).toBeNull();
      expect(service.normalizePhoneNumber('not-a-number')).toBeNull();
      expect(service.normalizePhoneNumber(null)).toBeNull();
      expect(service.normalizePhoneNumber(undefined)).toBeNull();
    });

    it('masks phone numbers safely for logging', () => {
      expect(service.maskPhoneNumber('+14155552671')).toBe('+1415***2671');
      expect(service.maskPhoneNumber('whatsapp:+919876543210')).toBe(
        '+9198***3210',
      );
      expect(service.maskPhoneNumber(null)).toBe('unknown');
    });
  });

  describe('Sender payload extraction (Scenario 11)', () => {
    it('extracts from Twilio From field', () => {
      expect(
        service.extractSenderFromPayload({ From: 'whatsapp:+14155552671' }),
      ).toBe('whatsapp:+14155552671');
    });

    it('extracts from Event Grid data.from', () => {
      expect(
        service.extractSenderFromPayload({
          data: { from: '+919876543210', textMessage: 'Hello' },
        }),
      ).toBe('+919876543210');
    });

    it('extracts from Event Grid data.contact or data.phone', () => {
      expect(
        service.extractSenderFromPayload({
          data: { contact: '+447700900077' },
        }),
      ).toBe('+447700900077');

      expect(
        service.extractSenderFromPayload({
          data: { phone: '+61491570156' },
        }),
      ).toBe('+61491570156');
    });

    it('extracts from nested customer object', () => {
      expect(
        service.extractSenderFromPayload({
          data: { customer: { phone: '+819012345678' } },
        }),
      ).toBe('+819012345678');
    });
  });

  describe('Allowlist mode validation (Scenarios 8, 9, 12, 14)', () => {
    it('Scenario 8: permits configured authorized senders', () => {
      const result = service.validateSender('whatsapp:+14155552671');
      expect(result.allowed).toBe(true);
      expect(result.normalizedSender).toBe('+14155552671');
      expect(result.maskedSender).toBe('+1415***2671');
    });

    it('Scenario 9: skips sender not in the allowlist', () => {
      const result = service.validateSender('whatsapp:+19998887766');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in allowlist');
    });

    it('Scenario 12: fails closed if allowlist is empty in allowlist mode', () => {
      configMap.AI_TOKEN_BUDGET_ALLOWED_WHATSAPP_NUMBERS = '';
      const result = service.validateSender('+14155552671');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('fail-closed');
    });

    it('Scenario 12: fails closed if allowlist contains only whitespace', () => {
      configMap.AI_TOKEN_BUDGET_ALLOWED_WHATSAPP_NUMBERS = '  ,  ';
      const result = service.validateSender('+14155552671');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('fail-closed');
    });

    it('fails closed if raw sender is missing or malformed', () => {
      expect(service.validateSender(null).allowed).toBe(false);
      expect(service.validateSender('').allowed).toBe(false);
      expect(service.validateSender('invalid').allowed).toBe(false);
    });
  });

  describe('All mode validation (Scenario 13)', () => {
    it('permits valid senders regardless of allowlist when mode is "all"', () => {
      configMap.AI_TOKEN_BUDGET_SENDER_MODE = 'all';
      configMap.AI_TOKEN_BUDGET_ALLOWED_WHATSAPP_NUMBERS = ''; // empty allowlist

      const result = service.validateSender('whatsapp:+19998887766');
      expect(result.allowed).toBe(true);
      expect(result.normalizedSender).toBe('+19998887766');
    });

    it('still rejects completely invalid sender even in "all" mode', () => {
      configMap.AI_TOKEN_BUDGET_SENDER_MODE = 'all';
      const result = service.validateSender('not-a-phone');
      expect(result.allowed).toBe(false);
    });
  });
});
