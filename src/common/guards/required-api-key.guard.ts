import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

import { API_KEY_HEADER } from '../constants';

/** Protects costly and data-mutating operational endpoints. */
@Injectable()
export class RequiredApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('API_KEY');
    if (!expected) {
      throw new ServiceUnavailableException(
        'Administrative API key is not configured',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.header(API_KEY_HEADER);
    if (!supplied || !this.matches(supplied, expected)) {
      throw new UnauthorizedException('Invalid API key');
    }
    return true;
  }

  private matches(supplied: string, expected: string): boolean {
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    return (
      suppliedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(suppliedBuffer, expectedBuffer)
    );
  }
}
