import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { EventSecurityGuard } from './event-security.guard';
import { KeyVaultService } from '../services/key-vault.service';

describe('EventSecurityGuard', () => {
  let guard: EventSecurityGuard;
  let keyVaultService: jest.Mocked<KeyVaultService>;
  const SECRET_KEY = 'super-secret-vault-key-12345';

  const createMockContext = (headers: Record<string, any> = {}, body: any = null): ExecutionContext => {
    const request = {
      headers,
      body,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    keyVaultService = {
      getEventSecurityKey: jest.fn().mockResolvedValue(SECRET_KEY),
      getSecret: jest.fn(),
    } as unknown as jest.Mocked<KeyVaultService>;

    guard = new EventSecurityGuard(keyVaultService);
  });

  describe('Valid Key Scenarios', () => {
    it('should allow request when valid key is in x-security-key header', async () => {
      const context = createMockContext({ 'x-security-key': SECRET_KEY });
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow request when valid key is in x-signature header', async () => {
      const context = createMockContext({ 'x-signature': SECRET_KEY });
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow request when valid key is in Authorization Bearer header', async () => {
      const context = createMockContext({ authorization: `Bearer ${SECRET_KEY}` });
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow request when valid key is in body payload object', async () => {
      const context = createMockContext({}, { securityKey: SECRET_KEY });
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow request when valid key is in event array payload data', async () => {
      const context = createMockContext(
        {},
        [
          {
            id: 'evt-1',
            data: { signature: SECRET_KEY },
          },
        ],
      );
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow Azure Event Grid SubscriptionValidationEvent without security key', async () => {
      const context = createMockContext(
        {},
        [
          {
            id: 'validation-id-123',
            eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
            data: { validationCode: 'code-xyz-123' },
          },
        ],
      );
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('Invalid Key Scenarios', () => {
    it('should reject request when header key is invalid', async () => {
      const context = createMockContext({ 'x-security-key': 'wrong-key-value' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid signature'),
      );
    });

    it('should reject request when payload signature is invalid', async () => {
      const context = createMockContext({}, { signature: 'wrong-signature' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid signature'),
      );
    });
  });

  describe('Missing Key Scenarios', () => {
    it('should reject request when no security key is provided', async () => {
      const context = createMockContext({}, {});
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid signature'),
      );
    });

    it('should reject request when expected key from Key Vault is null', async () => {
      keyVaultService.getEventSecurityKey.mockResolvedValueOnce(null);
      const context = createMockContext({ 'x-security-key': SECRET_KEY });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid signature'),
      );
    });
  });
});
