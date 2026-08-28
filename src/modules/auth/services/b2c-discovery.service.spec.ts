import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Issuer } from 'openid-client';

import {
  AZURE_B2C_CONFIG_NAMESPACE,
  type AzureB2cConfig,
} from '../../../config/azure-b2c.config';
import { B2cDiscoveryService } from './b2c-discovery.service';

jest.mock('openid-client', () => ({
  Issuer: { discover: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- the mocked static is the assertion target, never called as a method
const discover = Issuer.discover as unknown as jest.Mock;

const DISCOVERY_URL =
  'https://contoso.b2clogin.com/contoso.onmicrosoft.com/B2C_1_signupsignin/v2.0/.well-known/openid-configuration';
const ISSUER =
  'https://contoso.b2clogin.com/11111111-2222-3333-4444-555555555555/v2.0/';
const JWKS_URI =
  'https://contoso.b2clogin.com/contoso.onmicrosoft.com/b2c_1_signupsignin/discovery/v2.0/keys';

describe('B2cDiscoveryService', () => {
  let settings: AzureB2cConfig;
  let service: B2cDiscoveryService;

  const buildSettings = (
    overrides: Partial<AzureB2cConfig> = {},
  ): AzureB2cConfig => ({
    tenantName: 'contoso',
    tenantDomain: 'contoso.onmicrosoft.com',
    instance: 'https://contoso.b2clogin.com',
    policy: 'B2C_1_signupsignin',
    clientId: 'client-id',
    audiences: ['client-id'],
    discoveryUrl: DISCOVERY_URL,
    issuer: undefined,
    requiredScopes: [],
    clockSkewSeconds: 60,
    jwksCacheMaxAgeMs: 600_000,
    discoveryCacheMs: 3_600_000,
    ...overrides,
  });

  const metadataResponse = (metadata: Record<string, unknown>) => ({
    metadata,
  });

  beforeEach(() => {
    discover.mockReset();
    discover.mockResolvedValue(
      metadataResponse({
        issuer: ISSUER,
        jwks_uri: JWKS_URI,
        authorization_endpoint: 'https://contoso.b2clogin.com/authorize',
        token_endpoint: 'https://contoso.b2clogin.com/token',
      }),
    );

    settings = buildSettings();
    const config = {
      get: jest.fn((key: string) =>
        key === AZURE_B2C_CONFIG_NAMESPACE ? settings : undefined,
      ),
    } as unknown as ConfigService;

    service = new B2cDiscoveryService(config);
  });

  it('takes the issuer and the JWKS URI from the discovery document', async () => {
    await expect(service.getMetadata()).resolves.toMatchObject({
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      authorizationEndpoint: 'https://contoso.b2clogin.com/authorize',
      tokenEndpoint: 'https://contoso.b2clogin.com/token',
    });
    expect(discover).toHaveBeenCalledWith(DISCOVERY_URL);
  });

  it('caches the document instead of re-reading it on every request', async () => {
    await service.getMetadata();
    await service.getMetadata();

    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('re-reads the document once the cache window passes', async () => {
    settings = buildSettings({ discoveryCacheMs: 0 });

    await service.getMetadata();
    await service.getMetadata();

    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('shares one fetch between concurrent callers', async () => {
    await Promise.all([
      service.getMetadata(),
      service.getMetadata(),
      service.getMetadata(),
    ]);

    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('prefers a configured issuer over the discovered one', async () => {
    settings = buildSettings({
      issuer: 'https://login.example.com/tenant/v2.0/',
    });

    await expect(service.getMetadata()).resolves.toMatchObject({
      issuer: 'https://login.example.com/tenant/v2.0/',
    });
  });

  it('fails when the tenant cannot be reached and nothing is cached', async () => {
    discover.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    await expect(service.getMetadata()).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(service.getMetadata()).rejects.toThrow(
      'getaddrinfo ENOTFOUND',
    );
  });

  it('rejects a document that omits the issuer or the JWKS URI', async () => {
    discover.mockResolvedValue(metadataResponse({ issuer: ISSUER }));

    await expect(service.getMetadata()).rejects.toThrow(
      'The Azure AD B2C discovery document is missing "issuer" or "jwks_uri"',
    );
  });

  it('keeps serving the cached document through a discovery outage', async () => {
    settings = buildSettings({ discoveryCacheMs: 0 });
    await service.getMetadata();

    discover.mockRejectedValue(new Error('503 Service Unavailable'));

    // Tokens still verify against the values a user flow never changes,
    // rather than every caller being locked out by a B2C blip.
    await expect(service.getMetadata()).resolves.toMatchObject({
      issuer: ISSUER,
      jwksUri: JWKS_URI,
    });
  });

  it('re-reads the document after a reset', async () => {
    await service.getMetadata();
    service.reset();
    await service.getMetadata();

    expect(discover).toHaveBeenCalledTimes(2);
  });
});
