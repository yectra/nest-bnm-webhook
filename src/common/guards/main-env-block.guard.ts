import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Blocks every incoming request when the application runs in the "main"
 * environment (APP_ENV=main).
 *
 * Registered as a global guard and intentionally ignores the @Public()
 * metadata, so it covers all API routes — public and protected alike.
 */
@Injectable()
export class MainEnvBlockGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    const appEnv = (this.config.get<string>('app.appEnv') ?? '').toLowerCase();

    if (appEnv === 'main') {
      throw new ForbiddenException(
        'API access is blocked in the main environment',
      );
    }

    return true;
  }
}
