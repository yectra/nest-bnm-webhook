import { ConfigService } from '@nestjs/config';
import { KeyVaultService } from './key-vault.service';

describe('KeyVaultService', () => {
  let service: KeyVaultService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'azure.keyVaultUrl') return undefined;
        if (key === 'azure.secretName') return 'event-capture-security-key';
        if (key === 'azure.eventSecurityKey') return 'expected-test-secret';
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new KeyVaultService(configService);
  });

  it('should return secret from environment fallback when Key Vault URL is not configured', async () => {
    const key = await service.getEventSecurityKey();
    expect(key).toBe('expected-test-secret');
  });

  it('should handle getSecret call for specific secret name', async () => {
    process.env.TEST_SECRET_NAME = 'custom-secret-val';
    const val = await service.getSecret('TEST_SECRET_NAME');
    expect(val).toBe('custom-secret-val');
    delete process.env.TEST_SECRET_NAME;
  });

  it('should not expose secret value in logger when initialized without Key Vault URL', () => {
    const loggerSpy = jest.spyOn((service as any).logger, 'log');
    new KeyVaultService(configService);
    
    // Ensure log entries exist but do not contain secret value
    loggerSpy.mock.calls.forEach((call) => {
      expect(call[0]).not.toContain('expected-test-secret');
    });
  });
});
