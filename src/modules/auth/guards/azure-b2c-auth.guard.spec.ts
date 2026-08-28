import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  IS_PUBLIC_KEY,
  REQUIRED_ROLES_KEY,
  REQUIRED_SCOPES_KEY,
} from '../../../common/constants';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { B2cTokenVerifierService } from '../services/b2c-token-verifier.service';
import { AzureB2cAuthGuard } from './azure-b2c-auth.guard';

describe('AzureB2cAuthGuard', () => {
  const user: AuthenticatedUser = {
    userId: 'user-object-id',
    subject: 'user-object-id',
    emails: ['ada@example.com'],
    email: 'ada@example.com',
    scopes: ['api.read'],
    roles: ['catalog.editor'],
    claims: { sub: 'user-object-id' },
  };

  let verify: jest.Mock;
  let verifier: B2cTokenVerifierService;
  /** Metadata the mocked reflector returns, keyed by metadata key. */
  let metadata: Record<string, unknown>;
  let guard: AzureB2cAuthGuard;

  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;

  const buildContext = (
    headers: Record<string, string> = {},
    type: 'http' | 'ws' = 'http',
  ) => {
    const request: Record<string, unknown> = { headers };
    return {
      getType: () => type,
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
      request,
    } as unknown as ExecutionContext & { request: Record<string, unknown> };
  };

  beforeEach(() => {
    metadata = {};
    verify = jest.fn().mockResolvedValue(user);
    verifier = { verify } as unknown as B2cTokenVerifierService;
    guard = new AzureB2cAuthGuard(reflector, verifier);
  });

  it('verifies the bearer token and attaches the caller to the request', async () => {
    const context = buildContext({ authorization: 'Bearer a.valid.token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('a.valid.token');
    expect(context.request.user).toBe(user);
  });

  it('rejects a request with no Authorization header', async () => {
    await expect(guard.canActivate(buildContext())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a malformed Authorization header', async () => {
    const context = buildContext({ authorization: 'Basic dXNlcjpwYXNz' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Authorization header missing or malformed. Expected: Bearer <Azure AD B2C access token>',
    );
  });

  it('surfaces the verifier failure unchanged', async () => {
    verify.mockRejectedValue(
      new UnauthorizedException('Access token has expired'),
    );
    const context = buildContext({ authorization: 'Bearer expired.token' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Access token has expired',
    );
  });

  it('lets @Public() routes through without a token', async () => {
    metadata[IS_PUBLIC_KEY] = true;

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('leaves non-HTTP contexts to their own handshake authentication', async () => {
    await expect(guard.canActivate(buildContext({}, 'ws'))).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('protects a route that declares no metadata at all', async () => {
    // The guard is global: a controller written without any auth decorator
    // must still require a token.
    await expect(guard.canActivate(buildContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('allows a route whose required scopes are all granted', async () => {
    metadata[REQUIRED_SCOPES_KEY] = ['api.read'];
    const context = buildContext({ authorization: 'Bearer a.valid.token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('forbids a route when a required scope is missing', async () => {
    metadata[REQUIRED_SCOPES_KEY] = ['api.read', 'api.admin'];
    const context = buildContext({ authorization: 'Bearer a.valid.token' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Missing required scope(s): api.admin',
    );
  });

  it('allows a route when the caller holds one of the accepted roles', async () => {
    metadata[REQUIRED_ROLES_KEY] = ['catalog.editor', 'catalog.admin'];
    const context = buildContext({ authorization: 'Bearer a.valid.token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('forbids a route when the caller holds none of the accepted roles', async () => {
    metadata[REQUIRED_ROLES_KEY] = ['catalog.admin'];
    const context = buildContext({ authorization: 'Bearer a.valid.token' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Requires one of the following role(s): catalog.admin',
    );
  });

  it('does not attach the caller when authorization fails', async () => {
    metadata[REQUIRED_SCOPES_KEY] = ['api.admin'];
    const context = buildContext({ authorization: 'Bearer a.valid.token' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(context.request.user).toBeUndefined();
  });
});
