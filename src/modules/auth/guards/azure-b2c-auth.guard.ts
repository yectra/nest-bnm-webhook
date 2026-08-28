import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import {
  IS_PUBLIC_KEY,
  REQUIRED_ROLES_KEY,
  REQUIRED_SCOPES_KEY,
} from '../../../common/constants';
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { extractBearerToken } from '../bearer-token.util';
import { B2cTokenVerifierService } from '../services/b2c-token-verifier.service';

/** An Express request once this guard has authenticated the caller. */
export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

/**
 * Requires a valid Azure AD B2C access token on every HTTP route.
 *
 * Registered globally, so a new controller is protected the moment it is
 * added: a route is only reachable without a token when it is explicitly
 * marked `@Public()`. On success the caller is attached to `request.user`
 * for the `@CurrentUser()` decorator.
 *
 * WebSocket connections are authenticated at the handshake instead (see
 * `WsAuthService`), which is why non-HTTP contexts pass through here.
 */
@Injectable()
export class AzureB2cAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenVerifier: B2cTokenVerifierService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException(
        'Authorization header missing or malformed. Expected: Bearer <Azure AD B2C access token>',
      );
    }

    const user = await this.tokenVerifier.verify(token);

    this.assertScopes(context, user);
    this.assertRoles(context, user);

    request.user = user;

    return true;
  }

  private assertScopes(
    context: ExecutionContext,
    user: AuthenticatedUser,
  ): void {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) {
      return;
    }

    const granted = new Set(user.scopes);
    const missing = required.filter((scope) => !granted.has(scope));

    if (missing.length) {
      throw new ForbiddenException(
        `Missing required scope(s): ${missing.join(', ')}`,
      );
    }
  }

  private assertRoles(
    context: ExecutionContext,
    user: AuthenticatedUser,
  ): void {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) {
      return;
    }

    // Roles are alternatives: any one of them opens the route.
    const granted = new Set(user.roles);
    if (!required.some((role) => granted.has(role))) {
      throw new ForbiddenException(
        `Requires one of the following role(s): ${required.join(', ')}`,
      );
    }
  }
}
