import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { KeyVaultService } from '../services/key-vault.service';
import { CryptoUtil } from '../utils/crypto.util';

@Injectable()
export class EventSecurityGuard implements CanActivate {
  private readonly logger = new Logger(EventSecurityGuard.name);

  constructor(private readonly keyVaultService: KeyVaultService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const incomingKey = this.extractSecurityKey(request);

    if (!incomingKey) {
      this.logger.warn('Event security validation failed: Missing security key');
      throw new UnauthorizedException('Invalid signature');
    }

    const expectedKey = await this.keyVaultService.getEventSecurityKey();

    if (!expectedKey) {
      this.logger.warn('Event security validation failed: Expected key not configured or unavailable');
      throw new UnauthorizedException('Invalid signature');
    }

    const isValid = CryptoUtil.compareStringSecure(incomingKey, expectedKey);

    if (!isValid) {
      this.logger.warn('Event security validation failed: Security key mismatch');
      throw new UnauthorizedException('Invalid signature');
    }

    return true;
  }

  private extractSecurityKey(request: Request): string | null {
    const headers = request.headers || {};

    // 1. Check custom headers
    const headerKey =
      (headers['x-security-key'] as string) ||
      (headers['x-signature'] as string) ||
      (headers['x-api-key'] as string);

    if (headerKey && typeof headerKey === 'string' && headerKey.trim() !== '') {
      return headerKey.trim();
    }

    // Check authorization header
    const authHeader = headers['authorization'] as string;
    if (authHeader && typeof authHeader === 'string') {
      const parts = authHeader.trim().split(' ');
      if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
        return parts[1].trim();
      }
      if (parts.length === 1 && parts[0] !== '') {
        return parts[0].trim();
      }
    }

    // 2. Check body payload
    const body = request.body as Record<string, any> | Array<Record<string, any>> | undefined;
    if (body) {
      if (Array.isArray(body)) {
        for (const item of body) {
          if (item && typeof item === 'object') {
            const dataObj = item.data && typeof item.data === 'object' ? (item.data as Record<string, any>) : {};
            const key =
              item.securityKey ||
              item.signature ||
              item.key ||
              item.apiKey ||
              dataObj.securityKey ||
              dataObj.signature ||
              dataObj.key;

            if (typeof key === 'string' && key.trim() !== '') {
              return key.trim();
            }
          }
        }
      } else if (typeof body === 'object') {
        const bodyObj = body as Record<string, any>;
        const dataObj = bodyObj.data && typeof bodyObj.data === 'object' ? (bodyObj.data as Record<string, any>) : {};
        const key =
          bodyObj.securityKey ||
          bodyObj.signature ||
          bodyObj.key ||
          bodyObj.apiKey ||
          dataObj.securityKey ||
          dataObj.signature ||
          dataObj.key;

        if (typeof key === 'string' && key.trim() !== '') {
          return key.trim();
        }
      }
    }

    return null;
  }
}
