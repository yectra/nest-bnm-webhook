import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IS_PUBLIC_KEY, API_KEY_HEADER } from '../constants';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers[API_KEY_HEADER];
    const configuredApiKey = this.configService.get<string>('API_KEY');

    if (!configuredApiKey) {
      // If API key is not configured, bypass guard
      return true;
    }

    if (apiKey !== configuredApiKey) {
      throw new UnauthorizedException('Invalid API Key');
    }

    return true;
  }
}
