import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Blocks every incoming request when the application runs in the "main"
 * environment. The env defaults to "main" when APP_ENV is not set, so the
 * API is blocked unless APP_ENV=dev or APP_ENV=stage is configured.
 *
 * Registered as a global guard and intentionally ignores the @Public()
 * metadata, so it covers all API routes — public and protected alike.
 */
@Injectable()
export class MainEnvBlockGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    const appEnv = (
      this.config.get<string>('app.appEnv') ?? 'main'
    ).toLowerCase();

    if (appEnv === 'main') {
      throw new ForbiddenException(
        'API access is blocked in the main environment',
      );
    }

    return true;
  }
}
