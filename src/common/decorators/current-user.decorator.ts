import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Injects the caller established by the Azure AD B2C guard, or one of its
 * properties: `@CurrentUser()` for the whole object, `@CurrentUser('userId')`
 * for a single field.
 *
 * Undefined on `@Public()` routes, which run without a token.
 */
export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedUser | undefined,
    ctx: ExecutionContext,
  ): unknown => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    return data && user ? user[data] : user;
  },
);
