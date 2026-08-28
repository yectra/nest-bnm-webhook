import { UnauthorizedException } from '@nestjs/common';
import { SignJWT, exportJWK, generateKeyPair, importJWK, type JWK } from 'jose';

import type { AzureB2cConfig } from '../../../config/azure-b2c.config';
import { B2cDiscoveryService } from './b2c-discovery.service';
import { B2cTokenVerifierService } from './b2c-token-verifier.service';

// The signing keys live in the test rather than on b2clogin.com, so the
// remote JWKS is swapped for a resolver over the generated public key. Every
// other part of the verification (signature, issuer, audience, expiry) runs
// for real.
const publicJwks: JWK[] = [];

jest.mock('jose', () => {
  const actual: typeof import('jose') = jest.requireActual('jose');
  return {
    ...actual,
    createRemoteJWKSet: jest.fn(() => async () => importJwkFromStore()),
  };
});

async function importJwkFromStore() {
  const jwk = publicJwks[0];
  if (!jwk) {
    throw new Error('No signing key registered for this test');
  }
  return importJWK(jwk, 'RS256');
}

const ISSUER =
  'https://contoso.b2clogin.com/11111111-2222-3333-4444-555555555555/v2.0/';
const CLIENT_ID = '99999999-8888-7777-6666-555555555555';
const POLICY = 'B2C_1_signupsignin';

describe('B2cTokenVerifierService', () => {
  let privateKey: CryptoKey;
  let service: B2cTokenVerifierService;
  let settings: AzureB2cConfig;

  const buildSettings = (
    overrides: Partial<AzureB2cConfig> = {},
  ): AzureB2cConfig => ({
    tenantName: 'contoso',
    tenantDomain: 'contoso.onmicrosoft.com',
    instance: 'https://contoso.b2clogin.com',
    policy: POLICY,
    clientId: CLIENT_ID,
    audiences: [CLIENT_ID],
    discoveryUrl: `https://contoso.b2clogin.com/contoso.onmicrosoft.com/${POLICY}/v2.0/.well-known/openid-configuration`,
    issuer: undefined,
    requiredScopes: [],
    clockSkewSeconds: 60,
    jwksCacheMaxAgeMs: 600_000,
    discoveryCacheMs: 3_600_000,
    ...overrides,
  });

  /** Mints a token signed by the test key, valid unless overridden. */
  const signToken = async (
    claims: Record<string, unknown> = {},
    { issuer = ISSUER, audience = CLIENT_ID, expiresIn = '5m' } = {},
  ) =>
    new SignJWT({ tfp: POLICY, ...claims })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject((claims.sub as string) ?? 'user-object-id')
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey);

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey as CryptoKey;
    publicJwks[0] = await exportJWK(keyPair.publicKey);
  });

  beforeEach(() => {
    settings = buildSettings();
    const discovery = {
      get settings() {
        return settings;
      },
      getMetadata: jest.fn().mockResolvedValue({
        issuer: ISSUER,
        jwksUri:
          'https://contoso.b2clogin.com/contoso.onmicrosoft.com/discovery/v2.0/keys',
      }),
    } as unknown as B2cDiscoveryService;

    service = new B2cTokenVerifierService(discovery);
  });

  it('accepts a token from the configured tenant, audience and user flow', async () => {
    const token = await signToken({
      sub: 'user-object-id',
      oid: 'user-object-id',
      tid: '11111111-2222-3333-4444-555555555555',
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
      emails: ['ada@example.com'],
      idp: 'local',
      scp: 'api.read api.write',
      azp: CLIENT_ID,
    });

    const user = await service.verify(token);

    expect(user).toMatchObject({
      userId: 'user-object-id',
      subject: 'user-object-id',
      objectId: 'user-object-id',
      tenantId: '11111111-2222-3333-4444-555555555555',
      email: 'ada@example.com',
      emails: ['ada@example.com'],
      name: 'Ada Lovelace',
      givenName: 'Ada',
      familyName: 'Lovelace',
      identityProvider: 'local',
      policy: POLICY,
      scopes: ['api.read', 'api.write'],
      roles: [],
      clientId: CLIENT_ID,
      issuer: ISSUER,
    });
  });

  it('falls back to sub when the token carries no oid', async () => {
    const token = await signToken({ sub: 'only-a-subject' });

    await expect(service.verify(token)).resolves.toMatchObject({
      userId: 'only-a-subject',
      objectId: undefined,
    });
  });

  it('reads a single email claim when the user flow emits no list', async () => {
    const token = await signToken({ email: 'grace@example.com' });

    await expect(service.verify(token)).resolves.toMatchObject({
      email: 'grace@example.com',
      emails: ['grace@example.com'],
    });
  });

  it('rejects a missing or blank token', async () => {
    await expect(service.verify('')).rejects.toThrow(UnauthorizedException);
    await expect(service.verify('   ')).rejects.toThrow(
      'Bearer token is missing',
    );
  });

  it('rejects a token that is not a JWT', async () => {
    await expect(service.verify('not-a-token')).rejects.toThrow(
      'Access token is malformed or could not be verified',
    );
  });

  it('rejects a token signed by another key', async () => {
    const other = await generateKeyPair('RS256', { extractable: true });
    const forged = await new SignJWT({ tfp: POLICY })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('user-object-id')
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setExpirationTime('5m')
      .sign(other.privateKey);

    await expect(service.verify(forged)).rejects.toThrow(
      'Access token signature is not valid',
    );
  });

  it('rejects a token from another issuer', async () => {
    const token = await signToken(
      {},
      { issuer: 'https://evil.b2clogin.com/tenant/v2.0/' },
    );

    await expect(service.verify(token)).rejects.toThrow(
      'Access token claim "iss" is not valid for this API',
    );
  });

  it('rejects a token minted for another audience', async () => {
    const token = await signToken({}, { audience: 'some-other-api' });

    await expect(service.verify(token)).rejects.toThrow(
      'Access token claim "aud" is not valid for this API',
    );
  });

  it('rejects an expired token', async () => {
    const token = await signToken({}, { expiresIn: '-10m' });

    await expect(service.verify(token)).rejects.toThrow(
      'Access token has expired',
    );
  });

  it('accepts an expiry inside the configured clock skew', async () => {
    settings = buildSettings({ clockSkewSeconds: 300 });
    const token = await signToken({}, { expiresIn: '-30s' });

    await expect(service.verify(token)).resolves.toMatchObject({
      subject: 'user-object-id',
    });
  });

  it('rejects a token issued by a different user flow', async () => {
    const token = await signToken({ tfp: 'B2C_1_profileedit' });

    await expect(service.verify(token)).rejects.toThrow(
      'Token was issued by user flow "B2C_1_profileedit", not "B2C_1_signupsignin"',
    );
  });

  it('accepts the policy from the acr claim used by custom policies', async () => {
    const token = await signToken({ tfp: undefined, acr: POLICY });

    await expect(service.verify(token)).resolves.toMatchObject({
      policy: POLICY,
    });
  });

  it('rejects an ID token presented as a credential', async () => {
    const token = await signToken({ nonce: 'sign-in-nonce' });

    await expect(service.verify(token)).rejects.toThrow(
      'ID tokens are not accepted; send the access token issued for this API',
    );
  });

  it('rejects a token missing a required scope', async () => {
    settings = buildSettings({ requiredScopes: ['api.read', 'api.write'] });
    const token = await signToken({ scp: 'api.read' });

    await expect(service.verify(token)).rejects.toThrow(
      'Token is missing the required scope(s): api.write',
    );
  });

  it('accepts a token carrying every required scope', async () => {
    settings = buildSettings({ requiredScopes: ['api.read'] });
    const token = await signToken({ scp: 'api.read api.write' });

    await expect(service.verify(token)).resolves.toMatchObject({
      scopes: ['api.read', 'api.write'],
    });
  });

  it('skips the user flow check when no policy is configured', async () => {
    settings = buildSettings({ policy: '' });
    const token = await signToken({ tfp: 'B2C_1_anything' });

    await expect(service.verify(token)).resolves.toMatchObject({
      policy: 'B2C_1_anything',
    });
  });

  it('accepts an additional audience configured for a migrating client', async () => {
    settings = buildSettings({ audiences: [CLIENT_ID, 'legacy-app-id'] });
    const token = await signToken({}, { audience: 'legacy-app-id' });

    await expect(service.verify(token)).resolves.toMatchObject({
      subject: 'user-object-id',
    });
  });
});
