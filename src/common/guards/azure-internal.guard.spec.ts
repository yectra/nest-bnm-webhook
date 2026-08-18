import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AzureInternalGuard } from './azure-internal.guard';

const KEY = 'a'.repeat(32);

interface RequestOptions {
  remoteAddress?: string;
  forwardedFor?: string | string[];
  key?: string;
}

const buildContext = (options: RequestOptions = {}): ExecutionContext => {
  // "key" and "remoteAddress" are only defaulted when absent, so a test can
  // pass them as undefined to model a missing header or socket address.
  const remoteAddress =
    'remoteAddress' in options ? options.remoteAddress : '10.0.0.4';
  const key = 'key' in options ? options.key : KEY;
  const forwardedFor = options.forwardedFor;

  const headers: Record<string, string | string[] | undefined> = {};
  if (forwardedFor !== undefined) {
    headers['x-forwarded-for'] = forwardedFor;
  }
  if (key !== undefined) {
    headers['x-internal-event-key'] = key;
  }

  const request = {
    headers,
    socket: { remoteAddress },
    header: (name: string) => headers[name.toLowerCase()] as string | undefined,
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

const buildGuard = (
  overrides: Record<string, unknown> = {},
): AzureInternalGuard => {
  const values: Record<string, unknown> = {
    'internalEvents.enabled': true,
    'internalEvents.accessKey': KEY,
    'internalEvents.allowedCidrs': [],
    ...overrides,
  };

  const config = {
    get: jest.fn((path: string) => values[path]),
  } as unknown as ConfigService;

  return new AzureInternalGuard(config);
};

describe('AzureInternalGuard', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows a private-network caller presenting the internal key', () => {
    expect(buildGuard().canActivate(buildContext())).toBe(true);
  });

  it('allows loopback callers such as sidecars', () => {
    expect(
      buildGuard().canActivate(buildContext({ remoteAddress: '::1' })),
    ).toBe(true);
  });

  it('rejects a caller that came through the public front end', () => {
    // App Service records the real client IP in X-Forwarded-For.
    expect(() =>
      buildGuard().canActivate(
        buildContext({ forwardedFor: '203.0.113.7:41234' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a chain where any hop is public', () => {
    expect(() =>
      buildGuard().canActivate(
        buildContext({ forwardedFor: '203.0.113.7, 10.0.0.9' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('accepts a fully internal forwarded chain', () => {
    expect(
      buildGuard().canActivate(
        buildContext({ forwardedFor: '10.0.0.9, 10.0.0.10' }),
      ),
    ).toBe(true);
  });

  it('honours extra allowed CIDRs from configuration', () => {
    const guard = buildGuard({
      'internalEvents.allowedCidrs': ['100.64.0.0/10'],
    });

    expect(
      guard.canActivate(buildContext({ remoteAddress: '100.64.1.1' })),
    ).toBe(true);
  });

  it('rejects an internal caller without the key', () => {
    expect(() =>
      buildGuard().canActivate(buildContext({ key: undefined })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an internal caller with a wrong key', () => {
    expect(() =>
      buildGuard().canActivate(buildContext({ key: 'b'.repeat(32) })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a key of a different length without leaking timing', () => {
    expect(() =>
      buildGuard().canActivate(buildContext({ key: 'short' })),
    ).toThrow(UnauthorizedException);
  });

  it('fails closed when the listener is disabled', () => {
    const guard = buildGuard({ 'internalEvents.enabled': false });

    expect(() => guard.canActivate(buildContext())).toThrow(
      ServiceUnavailableException,
    );
  });

  it('fails closed when no key is configured', () => {
    const guard = buildGuard({ 'internalEvents.accessKey': undefined });

    expect(() => guard.canActivate(buildContext())).toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects a request with no resolvable client address', () => {
    expect(() =>
      buildGuard().canActivate(buildContext({ remoteAddress: undefined })),
    ).toThrow(ForbiddenException);
  });

  it('checks the network before the key, so the key is never probed publicly', () => {
    expect(() =>
      buildGuard().canActivate(
        buildContext({ forwardedFor: '203.0.113.7', key: undefined }),
      ),
    ).toThrow(ForbiddenException);
  });
});
