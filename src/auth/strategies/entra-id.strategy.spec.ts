import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { EntraIdStrategy } from './entra-id.strategy';

describe('EntraIdStrategy', () => {
  let strategy: EntraIdStrategy;
  let configService: jest.Mocked<ConfigService>;

  const TENANT_ID = '00000000-1111-2222-3333-444444444444';
  const AUDIENCE = 'api://test-event-grid-api';
  const ISSUER_V2 = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;

  let privateKey: string;
  let publicKeyPem: string;

  beforeAll(() => {
    const keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }) as string;
  });

  beforeEach(() => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'azure.tenantId' || key === 'AZURE_TENANT_ID') return TENANT_ID;
        if (key === 'azure.eventGridAudience' || key === 'AZURE_EVENT_GRID_AUDIENCE') return AUDIENCE;
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    strategy = new EntraIdStrategy(configService);
  });

  it('should throw 401 when tenant ID or audience configuration is missing', async () => {
    configService.get.mockReturnValue(undefined);
    await expect(strategy.validateToken('dummy.token', publicKeyPem)).rejects.toThrow(
      new UnauthorizedException(
        'Azure Entra ID authentication is not configured on the server',
      ),
    );
  });

  it('should successfully validate a properly signed, non-expired token', async () => {
    const token = jwt.sign(
      {
        tid: TENANT_ID,
        sub: 'service-principal-1',
        roles: ['EventGrid.Deliver'],
        azp: 'client-app-1',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-id-1',
        issuer: ISSUER_V2,
        audience: AUDIENCE,
        expiresIn: '1h',
      },
    );

    const result = await strategy.validateToken(token, publicKeyPem);
    expect(result).toBeDefined();
    expect(result.tid).toBe(TENANT_ID);
    expect(result.aud).toBe(AUDIENCE);
    expect(result.roles).toContain('EventGrid.Deliver');
  });

  it('should accept v1 token issuer (sts.windows.net)', async () => {
    const v1Issuer = `https://sts.windows.net/${TENANT_ID}/`;
    const token = jwt.sign(
      {
        tid: TENANT_ID,
        sub: 'service-principal-1',
        roles: ['EventGrid.Deliver'],
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-id-1',
        issuer: v1Issuer,
        audience: AUDIENCE,
        expiresIn: '1h',
      },
    );

    const result = await strategy.validateToken(token, publicKeyPem);
    expect(result).toBeDefined();
    expect(result.iss).toBe(v1Issuer);
  });

  it('should throw 401 when token is expired', async () => {
    const expiredToken = jwt.sign(
      {
        tid: TENANT_ID,
        sub: 'service-principal-1',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-id-1',
        issuer: ISSUER_V2,
        audience: AUDIENCE,
        expiresIn: -10, // expired 10 seconds ago
      },
    );

    await expect(strategy.validateToken(expiredToken, publicKeyPem)).rejects.toThrow(
      new UnauthorizedException('Token has expired'),
    );
  });

  it('should throw 401 when token audience does not match configured audience', async () => {
    const wrongAudienceToken = jwt.sign(
      {
        tid: TENANT_ID,
        sub: 'service-principal-1',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-id-1',
        issuer: ISSUER_V2,
        audience: 'api://different-audience',
        expiresIn: '1h',
      },
    );

    await expect(strategy.validateToken(wrongAudienceToken, publicKeyPem)).rejects.toThrow(
      new UnauthorizedException('Invalid token: audience mismatch'),
    );
  });

  it('should throw 401 when token tenant ID does not match configured tenant ID', async () => {
    const wrongTenantToken = jwt.sign(
      {
        tid: 'wrong-tenant-id',
        sub: 'service-principal-1',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-id-1',
        issuer: ISSUER_V2,
        audience: AUDIENCE,
        expiresIn: '1h',
      },
    );

    await expect(strategy.validateToken(wrongTenantToken, publicKeyPem)).rejects.toThrow(
      new UnauthorizedException('Invalid token: tenant ID mismatch'),
    );
  });

  it('should throw 401 when token issuer is invalid', async () => {
    const wrongIssuerToken = jwt.sign(
      {
        tid: TENANT_ID,
        sub: 'service-principal-1',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-id-1',
        issuer: 'https://rogue-identity-provider.com/v2.0',
        audience: AUDIENCE,
        expiresIn: '1h',
      },
    );

    await expect(strategy.validateToken(wrongIssuerToken, publicKeyPem)).rejects.toThrow(
      new UnauthorizedException('Invalid token: issuer mismatch'),
    );
  });

  it('should throw 401 when signature is invalid (signed by another key)', async () => {
    const otherKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otherPrivateKey = otherKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const invalidSigToken = jwt.sign(
      {
        tid: TENANT_ID,
        sub: 'service-principal-1',
      },
      otherPrivateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-id-1',
        issuer: ISSUER_V2,
        audience: AUDIENCE,
        expiresIn: '1h',
      },
    );

    await expect(strategy.validateToken(invalidSigToken, publicKeyPem)).rejects.toThrow(
      new UnauthorizedException('Invalid token signature'),
    );
  });
});
