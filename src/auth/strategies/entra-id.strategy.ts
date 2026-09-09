import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import axios from 'axios';
import { EntraIdTokenPayload } from '../interfaces/entra-id-token.interface';

interface MicrosoftJwk {
  kid: string;
  kty: string;
  use?: string;
  n?: string;
  e?: string;
  x5c?: string[];
}

@Injectable()
export class EntraIdStrategy {
  private readonly logger = new Logger(EntraIdStrategy.name);
  private jwkCache: Map<string, string> = new Map(); // kid -> PEM string
  private jwkCacheTimestamp = 0;
  private currentTenantId: string | null = null;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(private readonly configService: ConfigService) {}

  /**
   * Validate incoming Microsoft Entra ID Bearer JWT.
   *
   * Validates:
   * 1. Signature against Microsoft Entra ID OpenID Connect keys (JWKS)
   * 2. Token expiration (exp) and not-before (nbf)
   * 3. Tenant ID (tid)
   * 4. Issuer (iss - accepts both v2.0 and v1.0 sts.windows.net format)
   * 5. Audience (aud - matches configured AZURE_EVENT_GRID_AUDIENCE)
   */
  async validateToken(
    token: string,
    mockSigningKey?: string,
  ): Promise<EntraIdTokenPayload> {
    const tenantId =
      this.configService.get<string>('azure.tenantId') ||
      this.configService.get<string>('AZURE_TENANT_ID') ||
      process.env.AZURE_TENANT_ID;

    const audience =
      this.configService.get<string>('azure.eventGridAudience') ||
      this.configService.get<string>('AZURE_EVENT_GRID_AUDIENCE') ||
      process.env.AZURE_EVENT_GRID_AUDIENCE;

    if (!tenantId || !audience) {
      this.logger.error(
        'Azure Entra ID configuration missing: AZURE_TENANT_ID and AZURE_EVENT_GRID_AUDIENCE must be set.',
      );
      throw new UnauthorizedException(
        'Azure Entra ID authentication is not configured on the server',
      );
    }

    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded !== 'object' || !decoded.header) {
      this.logger.warn('Token rejected: Malformed JWT');
      throw new UnauthorizedException('Invalid or malformed token');
    }

    const kid = decoded.header.kid;
    if (!kid && !mockSigningKey) {
      this.logger.warn('Token rejected: Missing kid in JWT header');
      throw new UnauthorizedException('Invalid token: missing key ID (kid) in header');
    }

    const validIssuers: [string, ...string[]] = [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ];

    let signingKey: string;
    if (mockSigningKey) {
      signingKey = mockSigningKey;
    } else {
      signingKey = await this.getSigningKey(tenantId, kid!);
    }

    const validAudiences: [string, ...string[]] = [
      audience,
      audience.startsWith('api://')
        ? audience.replace('api://', '')
        : `api://${audience}`,
    ];

    try {
      const verified = jwt.verify(token, signingKey, {
        algorithms: ['RS256'],
        audience: validAudiences,
        issuer: validIssuers,
        clockTolerance: 5,
      });

      const payload = verified as unknown as EntraIdTokenPayload;

      // Validate Tenant ID
      if (!payload.tid || payload.tid !== tenantId) {
        this.logger.warn(
          `Token tenant ID mismatch. Expected "${tenantId}", got "${payload.tid}"`,
        );
        throw new UnauthorizedException('Invalid token: tenant ID mismatch');
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (error instanceof jwt.TokenExpiredError) {
        this.logger.warn(`Token expired: ${error.message}`);
        throw new UnauthorizedException('Token has expired');
      }

      if (error instanceof jwt.JsonWebTokenError) {
        this.logger.warn(`JWT verification error: ${error.message}`);
        if (error.message.includes('jwt audience invalid')) {
          this.logger.warn(
            `Audience mismatch: expected one of [${validAudiences.join(', ')}], token audience was: ${JSON.stringify((decoded as any)?.payload?.aud)}`,
          );
          throw new UnauthorizedException('Invalid token: audience mismatch');
        }
        if (error.message.includes('jwt issuer invalid')) {
          this.logger.warn(
            `Issuer mismatch: expected one of [${validIssuers.join(', ')}], token issuer was: ${JSON.stringify((decoded as any)?.payload?.iss)}`,
          );
          throw new UnauthorizedException('Invalid token: issuer mismatch');
        }
        if (error.message.includes('invalid signature')) {
          throw new UnauthorizedException('Invalid token signature');
        }
        throw new UnauthorizedException(`Invalid token: ${error.message}`);
      }


      this.logger.warn(`Token validation failed: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid or malformed token');
    }
  }

  private async getSigningKey(tenantId: string, kid: string): Promise<string> {
    const now = Date.now();
    const isCacheExpired =
      this.currentTenantId !== tenantId ||
      now - this.jwkCacheTimestamp > this.CACHE_TTL_MS;

    if (!isCacheExpired && this.jwkCache.has(kid)) {
      return this.jwkCache.get(kid)!;
    }

    await this.refreshJwks(tenantId);

    const key = this.jwkCache.get(kid);
    if (!key) {
      this.logger.warn(`Signing key with kid "${kid}" not found in Entra ID JWKS`);
      throw new UnauthorizedException('Invalid token signature: unknown signing key ID');
    }

    return key;
  }

  private async refreshJwks(tenantId: string): Promise<void> {
    try {
      const jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
      const response = await axios.get<{ keys: MicrosoftJwk[] }>(jwksUri, {
        timeout: 10000,
      });

      const keys = response.data?.keys || [];
      const newCache = new Map<string, string>();

      for (const jwk of keys) {
        if (!jwk.kid) continue;

        try {
          if (jwk.x5c && jwk.x5c.length > 0) {
            const cert = `-----BEGIN CERTIFICATE-----\n${jwk.x5c[0]}\n-----END CERTIFICATE-----`;
            newCache.set(jwk.kid, cert);
          } else if (jwk.n && jwk.e) {
            const pubKey = crypto.createPublicKey({
              key: jwk as any,
              format: 'jwk',
            });
            const pem = pubKey.export({ type: 'spki', format: 'pem' }) as string;
            newCache.set(jwk.kid, pem);
          }
        } catch (e) {
          this.logger.warn(`Failed to parse JWK with kid "${jwk.kid}": ${(e as Error).message}`);
        }
      }

      this.jwkCache = newCache;
      this.jwkCacheTimestamp = Date.now();
      this.currentTenantId = tenantId;
    } catch (error) {
      this.logger.error(
        `Failed to fetch Entra ID JWKS from Microsoft endpoint: ${(error as Error).message}`,
      );
      throw new UnauthorizedException('Failed to retrieve Azure public signing keys');
    }
  }
}
