import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  /**
   * Echoes the caller behind the presented Azure AD B2C access token. Useful
   * to confirm a front end is sending the right token, and to read the
   * claims a user flow actually returns.
   */
  @Get('me')
  @ApiOperation({
    summary: 'The Azure AD B2C user behind the presented access token',
    description:
      'Returns the identity, scopes and roles taken from the verified token. Responds 401 when the token is missing, expired, or issued for another audience or user flow.',
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      user: {
        userId: user.userId,
        subject: user.subject,
        objectId: user.objectId,
        tenantId: user.tenantId,
        email: user.email,
        emails: user.emails,
        name: user.name,
        givenName: user.givenName,
        familyName: user.familyName,
        identityProvider: user.identityProvider,
        policy: user.policy,
        scopes: user.scopes,
        roles: user.roles,
        clientId: user.clientId,
        issuer: user.issuer,
        expiresAt: user.expiresAt,
      },
    };
  }
}
