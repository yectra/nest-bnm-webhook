import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventGridAuthGuard } from './event-grid-auth.guard';
import { EntraIdStrategy } from '../strategies/entra-id.strategy';
import { EventGridEventValidator } from '../events/event-grid-event.validator';
import { EntraIdTokenPayload } from '../interfaces/entra-id-token.interface';

describe('EventGridAuthGuard', () => {
  let guard: EventGridAuthGuard;
  let entraIdStrategy: jest.Mocked<EntraIdStrategy>;
  let eventValidator: EventGridEventValidator;
  let configService: jest.Mocked<ConfigService>;

  const TENANT_ID = 'tenant-1234-uuid';
  const AUDIENCE = 'api://my-event-grid-webhook';
  const REQUIRED_ROLE = 'EventGrid.Deliver';
  const ALLOWED_APP_ID = 'app-5678-uuid';

  const validTokenPayload: EntraIdTokenPayload = {
    iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    aud: AUDIENCE,
    tid: TENANT_ID,
    sub: 'sub-user-1',
    azp: ALLOWED_APP_ID,
    oid: ALLOWED_APP_ID,
    roles: [REQUIRED_ROLE],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const validJavaEvent = [
    {
      id: 'evt-java-001',
      eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT',
      subject: 'whatsapp/java/incoming',
      data: {
        messageId: 'msg-999',
        content: 'Hello from Java app',
      },
    },
  ];

  const createMockContext = (
    headers: Record<string, string> = {},
    body: any = validJavaEvent,
  ): ExecutionContext => {
    const request: any = {
      headers: { ...headers },
      body,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    entraIdStrategy = {
      validateToken: jest.fn().mockResolvedValue(validTokenPayload),
    } as unknown as jest.Mocked<EntraIdStrategy>;

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'azure.tenantId' || key === 'AZURE_TENANT_ID') return TENANT_ID;
        if (key === 'azure.eventGridAudience' || key === 'AZURE_EVENT_GRID_AUDIENCE') return AUDIENCE;
        if (key === 'azure.eventGridRequiredRole' || key === 'AZURE_EVENT_GRID_REQUIRED_ROLE') return REQUIRED_ROLE;
        if (key === 'azure.eventGridAllowedAppId' || key === 'AZURE_EVENT_GRID_ALLOWED_APP_ID') return ALLOWED_APP_ID;
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    eventValidator = new EventGridEventValidator(configService);
    guard = new EventGridAuthGuard(entraIdStrategy, eventValidator, configService);
  });

  describe('Unauthenticated & Malformed Token Scenarios (401)', () => {
    it('should throw 401 Unauthorized when Authorization header is missing', async () => {
      const context = createMockContext({});
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException(
          'Authorization header missing or malformed. Expected: Bearer <token>',
        ),
      );
    });

    it('should throw 401 Unauthorized when Authorization header does not start with Bearer', async () => {
      const context = createMockContext({ authorization: 'Basic dXNlcjpwYXNz' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException(
          'Authorization header missing or malformed. Expected: Bearer <token>',
        ),
      );
    });

    it('should throw 401 Unauthorized when Bearer token is empty', async () => {
      const context = createMockContext({ authorization: 'Bearer   ' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Bearer token is empty'),
      );
    });
  });

  describe('JWT Validation Failure Scenarios (401)', () => {
    it('should throw 401 Unauthorized when token signature is invalid', async () => {
      entraIdStrategy.validateToken.mockRejectedValueOnce(
        new UnauthorizedException('Invalid token signature'),
      );
      const context = createMockContext({ authorization: 'Bearer invalid.sig.token' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid token signature'),
      );
    });

    it('should throw 401 Unauthorized when token is expired', async () => {
      entraIdStrategy.validateToken.mockRejectedValueOnce(
        new UnauthorizedException('Token has expired'),
      );
      const context = createMockContext({ authorization: 'Bearer expired.jwt.token' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Token has expired'),
      );
    });

    it('should throw 401 Unauthorized when token has wrong audience', async () => {
      entraIdStrategy.validateToken.mockRejectedValueOnce(
        new UnauthorizedException('Invalid token: audience mismatch'),
      );
      const context = createMockContext({ authorization: 'Bearer wrong.aud.token' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid token: audience mismatch'),
      );
    });

    it('should throw 401 Unauthorized when token has wrong tenant ID', async () => {
      entraIdStrategy.validateToken.mockRejectedValueOnce(
        new UnauthorizedException('Invalid token: tenant ID mismatch'),
      );
      const context = createMockContext({ authorization: 'Bearer wrong.tid.token' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid token: tenant ID mismatch'),
      );
    });
  });

  describe('Authorization & Permissions Scenarios (403)', () => {
    it('should throw 403 Forbidden when token lacks the required app role', async () => {
      entraIdStrategy.validateToken.mockResolvedValueOnce({
        ...validTokenPayload,
        roles: ['Other.Role'], // Missing EventGrid.Deliver
      });

      const context = createMockContext({ authorization: 'Bearer valid.jwt.token' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new ForbiddenException(
          `Forbidden: caller is missing required application role "${REQUIRED_ROLE}"`,
        ),
      );
    });

    it('should throw 403 Forbidden when token has no roles property at all', async () => {
      entraIdStrategy.validateToken.mockResolvedValueOnce({
        ...validTokenPayload,
        roles: undefined,
      });

      const context = createMockContext({ authorization: 'Bearer valid.jwt.token' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new ForbiddenException(
          `Forbidden: caller is missing required application role "${REQUIRED_ROLE}"`,
        ),
      );
    });

    it('should throw 403 Forbidden when caller ID does not match allowed app ID', async () => {
      entraIdStrategy.validateToken.mockResolvedValueOnce({
        ...validTokenPayload,
        azp: 'different-client-id',
        appid: 'different-client-id',
        oid: 'different-client-id',
        sub: 'different-client-id',
      });

      const context = createMockContext({ authorization: 'Bearer valid.jwt.token' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        new ForbiddenException('Forbidden: unauthorized caller identity'),
      );
    });
  });

  describe('Event Payload Validation Scenarios (400)', () => {
    it('should throw 400 Bad Request when request body is empty or not an object', async () => {
      const context = createMockContext({ authorization: 'Bearer valid.jwt.token' }, null);
      await expect(guard.canActivate(context)).rejects.toThrow(BadRequestException);
    });

    it('should throw 400 Bad Request when event payload array is empty', async () => {
      const context = createMockContext({ authorization: 'Bearer valid.jwt.token' }, []);
      await expect(guard.canActivate(context)).rejects.toThrow(BadRequestException);
    });

    it('should throw 400 Bad Request when event missing eventType', async () => {
      const context = createMockContext(
        { authorization: 'Bearer valid.jwt.token' },
        [{ id: 'evt-1', data: { message: 'hello' } }],
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        new BadRequestException('Invalid Event Grid payload at index 0: missing required "eventType"'),
      );
    });

    it('should throw 400 Bad Request when event missing id', async () => {
      const context = createMockContext(
        { authorization: 'Bearer valid.jwt.token' },
        [{ eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT', data: { message: 'hello' } }],
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        new BadRequestException('Invalid Event Grid payload at index 0: missing required "id"'),
      );
    });

    it('should throw 400 Bad Request when event type is unauthorized / unexpected', async () => {
      const context = createMockContext(
        { authorization: 'Bearer valid.jwt.token' },
        [{ id: 'evt-1', eventType: 'UNAUTHORIZED_ATTACKER_EVENT', data: { foo: 'bar' } }],
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        new BadRequestException(
          'Unexpected Event Grid event type: "UNAUTHORIZED_ATTACKER_EVENT" is not authorized',
        ),
      );
    });

    it('should throw 400 Bad Request when Java event data payload is empty', async () => {
      const context = createMockContext(
        { authorization: 'Bearer valid.jwt.token' },
        [{ id: 'evt-1', eventType: 'BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT', data: {} }],
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        new BadRequestException(
          'Invalid BNM_WHATSAPP_RECEIVED_FROM_JAVA_EVENT: data object cannot be empty',
        ),
      );
    });
  });

  describe('Authorized Event Grid Delivery Scenarios (Success)', () => {
    it('should allow valid Event Grid request with valid JWT, role, and Java event payload', async () => {
      const context = createMockContext({ authorization: 'Bearer valid.jwt.token' });
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      const req: any = context.switchToHttp().getRequest();
      expect(req.user).toEqual(validTokenPayload);
      expect(req.azureCaller).toEqual({
        appId: ALLOWED_APP_ID,
        objectId: ALLOWED_APP_ID,
        tenantId: TENANT_ID,
        roles: [REQUIRED_ROLE],
      });
    });

    it('should allow valid Event Grid subscription validation handshake when authenticated', async () => {
      const validationPayload = [
        {
          id: 'validation-event-1',
          eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
          data: { validationCode: 'azure-code-12345' },
        },
      ];

      const context = createMockContext(
        { authorization: 'Bearer valid.jwt.token' },
        validationPayload,
      );
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });
});
