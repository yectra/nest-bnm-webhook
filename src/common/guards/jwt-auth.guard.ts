import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../constants';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * JWT Auth Guard
 *
 * Decodes the Bearer token from the Authorization header and attaches
 * the authenticated user (userId, tenantId, email) to request.user.
 *
 * NOTE: This guard performs DECODE-ONLY (no signature verification).
 * Signature verification is assumed to be handled by an upstream API
 * gateway or Azure API Management layer.
 *
 * If full signature verification is needed inside NestJS, install
 * `jsonwebtoken` and replace the decode logic below.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Skip guard for routes decorated with @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Authorization header missing or malformed. Expected: Bearer <token>',
      );
    }

    const token = authHeader.slice(7); // Remove "Bearer " prefix

    try {
      const payload = this.decodeJwt(token);

      if (!payload.sub) {
        throw new UnauthorizedException(
          'Invalid token: missing subject (sub) claim',
        );
      }

      const user: AuthenticatedUser = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        email: payload.email,
      };

      // Attach to request so @CurrentUser() decorator can access it
      (request as any).user = user;

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or malformed JWT token');
    }
  }

  /**
   * Decode a JWT token (base64url decode the payload segment).
   * Does NOT verify the signature.
   */
  private decodeJwt(token: string): JwtPayload {
    const parts = token.split('.');

    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid JWT format: expected 3 segments');
    }

    const payloadBase64 = parts[1];

    // base64url → base64 → JSON
    const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf-8');

    return JSON.parse(json) as JwtPayload;
  }
}
