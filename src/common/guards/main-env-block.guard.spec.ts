import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MainEnvBlockGuard } from './main-env-block.guard';

describe('MainEnvBlockGuard', () => {
  const buildGuard = (appEnv: string | undefined) => {
    const config = {
      get: jest.fn().mockReturnValue(appEnv),
    } as unknown as ConfigService;
    return new MainEnvBlockGuard(config);
  };

  it('throws a ForbiddenException when the env is main', () => {
    const guard = buildGuard('main');

    expect(() => guard.canActivate()).toThrow(ForbiddenException);
    expect(() => guard.canActivate()).toThrow(
      'API access is blocked in the main environment',
    );
  });

  it('is case-insensitive about the env value', () => {
    const guard = buildGuard('MAIN');

    expect(() => guard.canActivate()).toThrow(ForbiddenException);
  });

  it('allows requests in the dev environment', () => {
    const guard = buildGuard('dev');

    expect(guard.canActivate()).toBe(true);
  });

  it('allows requests in the stage environment', () => {
    const guard = buildGuard('stage');

    expect(guard.canActivate()).toBe(true);
  });

  it('blocks requests when the env is not configured (defaults to main)', () => {
    const guard = buildGuard(undefined);

    expect(() => guard.canActivate()).toThrow(ForbiddenException);
  });
});
