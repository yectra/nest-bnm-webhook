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

    // Allow Azure Event Grid Subscription Validation Handshake
    if (this.isSubscriptionValidationEvent(request)) {
      this.logger.log(
        'Bypassing security guard for Azure Event Grid Subscription Validation Handshake',
      );
      return true;
    }

    // Signature validation temporarily disabled per user request
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

    // 2. Check query parameters (e.g. ?signature=... or ?securityKey=...)
    const query = (request.query || {}) as Record<string, any>;
    const queryKey =
      query.signature ||
      query.securityKey ||
      query.key ||
      query.apiKey ||
      query['x-signature'] ||
      query['x-security-key'];

    if (queryKey && typeof queryKey === 'string' && queryKey.trim() !== '') {
      return queryKey.trim();
    }

    // 3. Check body payload
    const body = request.body as Record<string, any> | Array<Record<string, any>> | undefined;
    if (body) {
      if (Array.isArray(body)) {
        for (const item of body) {
          if (item && typeof item === 'object') {
            const innerObj =
              (item.payload && typeof item.payload === 'object' ? (item.payload as Record<string, any>) : null) ||
              (item.data && typeof item.data === 'object' ? (item.data as Record<string, any>) : {});
            const key =
              item.securityKey ||
              item.signature ||
              item.key ||
              item.apiKey ||
              innerObj.securityKey ||
              innerObj.signature ||
              innerObj.key ||
              innerObj.apiKey;

            if (typeof key === 'string' && key.trim() !== '') {
              return key.trim();
            }
          }
        }
      } else if (typeof body === 'object') {
        const bodyObj = body as Record<string, any>;
        const innerObj =
          (bodyObj.payload && typeof bodyObj.payload === 'object' ? (bodyObj.payload as Record<string, any>) : null) ||
          (bodyObj.data && typeof bodyObj.data === 'object' ? (bodyObj.data as Record<string, any>) : {});
        const key =
          bodyObj.securityKey ||
          bodyObj.signature ||
          bodyObj.key ||
          bodyObj.apiKey ||
          innerObj.securityKey ||
          innerObj.signature ||
          innerObj.key ||
          innerObj.apiKey;

        if (typeof key === 'string' && key.trim() !== '') {
          return key.trim();
        }
      }
    }

    return null;
  }

  private isSubscriptionValidationEvent(request: Request): boolean {
    const headers = request.headers || {};
    const aegEventType =
      (headers['aeg-event-type'] as string) ||
      (headers['aef-eventtype'] as string);

    if (aegEventType && /^SubscriptionValidation/i.test(aegEventType)) {
      return true;
    }

    const body = request.body as Record<string, any> | Array<Record<string, any>> | undefined;
    if (!body) return false;
    const events = Array.isArray(body) ? body : [body];
    return events.some(
      (event) =>
        event &&
        typeof event === 'object' &&
        (event.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent' ||
          event.eventName === 'Microsoft.EventGrid.SubscriptionValidationEvent' ||
          event.eventType === 'SubscriptionValidation' ||
          event.eventName === 'SubscriptionValidation'),
    );
  }
}
