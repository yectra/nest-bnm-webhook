import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

import { INTERNAL_EVENT_KEY_HEADER } from '../constants';
import {
  AZURE_INTERNAL_CIDRS,
  isIpInAnyCidr,
  normalizeIp,
} from '../utils/ip.util';

/**
 * Restricts a route to callers that reach the app from inside Azure.
 *
 * Two independent checks, both of which must pass:
 *
 * 1. Network origin — every address in the request chain (socket peer and each
 *    X-Forwarded-For hop) must sit in a private/Azure-internal range. Traffic
 *    that entered through the App Service public front end carries the caller's
 *    public IP in X-Forwarded-For, so it is rejected here. Only private
 *    endpoint, VNet-integrated, sidecar and loopback traffic survives.
 * 2. Shared secret — the caller must present the internal key. This covers the
 *    case where another workload inside the same VNet is compromised or
 *    misconfigured, and it is what Event Grid attaches as a delivery header.
 *
 * The guard fails closed: when the listener is disabled or no key is
 * configured, no request gets through.
 *
 * This is the in-app half of the control. The Azure-side half (access
 * restrictions / private endpoint) is documented in
 * docs/internal-hello-event-listener.md and should always be configured too.
 */
@Injectable()
export class AzureInternalGuard implements CanActivate {
  private readonly logger = new Logger(AzureInternalGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.get<boolean>('internalEvents.enabled')) {
      throw new ServiceUnavailableException(
        'Internal event listener is disabled',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();

    this.assertInternalNetworkOrigin(request);
    this.assertInternalKey(request);

    return true;
  }

  /** Collects the socket peer plus every forwarded hop, oldest first. */
  private collectRequestChain(request: Request): string[] {
    const forwarded = request.headers['x-forwarded-for'];
    const forwardedValues = Array.isArray(forwarded)
      ? forwarded
      : forwarded
        ? [forwarded]
        : [];

    return [
      ...forwardedValues.flatMap((value) => value.split(',')),
      request.socket?.remoteAddress ?? '',
    ]
      .map((value) => normalizeIp(value))
      .filter((value): value is string => Boolean(value));
  }

  private assertInternalNetworkOrigin(request: Request): void {
    const allowedCidrs = [
      ...AZURE_INTERNAL_CIDRS,
      ...(this.config.get<string[]>('internalEvents.allowedCidrs') ?? []),
    ];

    const chain = this.collectRequestChain(request);

    if (chain.length === 0) {
      this.logger.warn(
        'Rejected internal event request: no client address could be resolved',
      );
      throw new ForbiddenException('Internal endpoint');
    }

    const external = chain.filter((ip) => !isIpInAnyCidr(ip, allowedCidrs));
    if (external.length > 0) {
      this.logger.warn(
        `Rejected internal event request from outside Azure: ${external.join(', ')}`,
      );
      throw new ForbiddenException('Internal endpoint');
    }
  }

  private assertInternalKey(request: Request): void {
    const expected = this.config.get<string>('internalEvents.accessKey');
    if (!expected) {
      this.logger.error(
        'Internal event listener is enabled but no access key is configured',
      );
      throw new ServiceUnavailableException(
        'Internal event listener is not configured',
      );
    }

    const supplied = request.header(INTERNAL_EVENT_KEY_HEADER);
    if (!supplied || !this.matches(supplied, expected)) {
      throw new UnauthorizedException('Invalid internal event key');
    }
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
