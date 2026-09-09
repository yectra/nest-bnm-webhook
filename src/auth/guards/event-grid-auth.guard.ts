import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { EntraIdStrategy } from '../strategies/entra-id.strategy';
import { EventGridEventValidator } from '../events/event-grid-event.validator';

@Injectable()
export class EventGridAuthGuard implements CanActivate {
  private readonly logger = new Logger(EventGridAuthGuard.name);

  constructor(
    private readonly entraIdStrategy: EntraIdStrategy,
    private readonly eventValidator: EventGridEventValidator,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    // 1. Check Authorization header existence and Bearer prefix
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      this.logger.warn('Event Grid request rejected: Authorization header missing or malformed');
      throw new UnauthorizedException(
        'Authorization header missing or malformed. Expected: Bearer <token>',
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      this.logger.warn('Event Grid request rejected: Bearer token is empty');
      throw new UnauthorizedException('Bearer token is empty');
    }

    // 2. Validate Entra ID JWT (signature, tenant, audience, issuer, expiry)
    // Throws UnauthorizedException (401) on any token validation failure
    const tokenPayload = await this.entraIdStrategy.validateToken(token);

    this.logger.log(
      `Entra ID token validated successfully. Caller: oid=${tokenPayload.oid}, azp=${tokenPayload.azp}, appid=${tokenPayload.appid}, roles=[${(tokenPayload.roles || []).join(', ')}]`,
    );

    // 3. Validate Required Application Role (HTTP 403 Forbidden if missing)

    const requiredRole =
      this.configService.get<string>('azure.eventGridRequiredRole') ||
      this.configService.get<string>('AZURE_EVENT_GRID_REQUIRED_ROLE') ||
      process.env.AZURE_EVENT_GRID_REQUIRED_ROLE;

    if (requiredRole) {
      const roles = tokenPayload.roles || [];
      if (!roles.includes(requiredRole)) {
        this.logger.warn(
          `Event Grid request rejected: Caller missing required app role "${requiredRole}". Available roles: [${roles.join(', ')}]`,
        );
        throw new ForbiddenException(
          `Forbidden: caller is missing required application role "${requiredRole}"`,
        );
      }
    }

    // 4. Validate Allowed Caller Identity (HTTP 403 Forbidden if mismatched)
    const allowedAppId =
      this.configService.get<string>('azure.eventGridAllowedAppId') ||
      this.configService.get<string>('AZURE_EVENT_GRID_ALLOWED_APP_ID') ||
      process.env.AZURE_EVENT_GRID_ALLOWED_APP_ID;

    if (allowedAppId) {
      const matchesCaller =
        tokenPayload.azp === allowedAppId ||
        tokenPayload.appid === allowedAppId ||
        tokenPayload.oid === allowedAppId ||
        tokenPayload.sub === allowedAppId;

      if (!matchesCaller) {
        this.logger.warn(
          `Event Grid request rejected: Caller ID mismatch. Allowed: "${allowedAppId}", got azp="${tokenPayload.azp}", appid="${tokenPayload.appid}", oid="${tokenPayload.oid}"`,
        );
        throw new ForbiddenException('Forbidden: unauthorized caller identity');
      }
    }

    // 5. Validate Event Grid payload structure and event types (HTTP 400 Bad Request if invalid)
    this.eventValidator.validate(request.body);

    // Attach validated token to request
    (request as any).user = tokenPayload;
    (request as any).azureCaller = {
      appId: tokenPayload.azp || tokenPayload.appid,
      objectId: tokenPayload.oid,
      tenantId: tokenPayload.tid,
      roles: tokenPayload.roles || [],
    };

    return true;
  }
}
