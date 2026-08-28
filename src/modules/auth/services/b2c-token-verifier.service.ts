import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { B2cDiscoveryService } from './b2c-discovery.service';

/**
 * Verifies Azure AD B2C access tokens against the signing keys published by
 * the tenant, and turns a valid token into an `AuthenticatedUser`.
 *
 * Everything the verification pins — issuer and JWKS URI — comes from the
 * user flow's OpenID Connect discovery document, so a key rollover on the
 * B2C side needs no change or restart here.
 */
@Injectable()
export class B2cTokenVerifierService {
  private readonly logger = new Logger(B2cTokenVerifierService.name);

  /** One JWKS per URI; it caches keys and rate-limits refetches internally. */
  private jwks?: JWTVerifyGetKey;
  private jwksUri?: string;

  constructor(private readonly discovery: B2cDiscoveryService) {}

  /**
   * Verifies a raw bearer token and returns the caller it identifies.
   *
   * @throws UnauthorizedException when the token is missing, malformed,
   * expired, signed by an unknown key, or issued for another audience,
   * user flow, or purpose.
   */
  async verify(token: string): Promise<AuthenticatedUser> {
    if (!token || !token.trim()) {
      throw new UnauthorizedException('Bearer token is missing');
    }

    const settings = this.discovery.settings;
    const metadata = await this.discovery.getMetadata();
    const keyStore = this.getKeyStore(
      metadata.jwksUri,
      settings.jwksCacheMaxAgeMs,
    );

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token.trim(), keyStore, {
        issuer: metadata.issuer,
        audience: settings.audiences.length ? settings.audiences : undefined,
        clockTolerance: settings.clockSkewSeconds,
        // B2C signs with RS256; naming it stops an attacker from choosing
        // a weaker algorithm the library would otherwise accept.
        algorithms: ['RS256'],
      }));
    } catch (error) {
      throw new UnauthorizedException(this.describeFailure(error));
    }

    const claims = payload as JwtPayload;

    this.assertIsAccessToken(claims);
    this.assertPolicy(claims, settings.policy);
    this.assertScopes(claims, settings.requiredScopes);

    return this.toUser(claims, metadata.issuer);
  }

  /** Maps verified claims onto the shape the application reads. */
  toUser(claims: JwtPayload, issuer?: string): AuthenticatedUser {
    const emails = this.readEmails(claims);

    return {
      userId: claims.oid || claims.sub,
      subject: claims.sub,
      objectId: claims.oid,
      tenantId:
        claims.tid ||
        (typeof claims.tenantId === 'string' ? claims.tenantId : undefined),
      email: emails[0],
      emails,
      name: claims.name,
      givenName: claims.given_name,
      familyName: claims.family_name,
      identityProvider: claims.idp,
      policy: claims.tfp || claims.acr,
      scopes: this.readScopes(claims),
      roles: Array.isArray(claims.roles) ? claims.roles : [],
      clientId: claims.azp || claims.appid,
      issuer: issuer || claims.iss,
      expiresAt: claims.exp,
      claims,
    };
  }

  /** Scopes carried by a token, as a list. */
  readScopes(claims: JwtPayload): string[] {
    return (claims.scp || '')
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }

  private readEmails(claims: JwtPayload): string[] {
    const fromList = Array.isArray(claims.emails)
      ? claims.emails.filter(
          (entry): entry is string =>
            typeof entry === 'string' && entry.length > 0,
        )
      : [];
    const single = typeof claims.email === 'string' ? [claims.email] : [];

    return Array.from(new Set([...fromList, ...single]));
  }

  /**
   * An ID token proves who signed in to a client; it is not a credential for
   * this API. B2C mints it for the same audience as the access token when a
   * single app registration serves both, so the `nonce` claim that every
   * OIDC sign-in request carries is what separates the two.
   */
  private assertIsAccessToken(claims: JwtPayload): void {
    if (claims.nonce !== undefined) {
      throw new UnauthorizedException(
        'ID tokens are not accepted; send the access token issued for this API',
      );
    }

    if (!claims.sub) {
      throw new UnauthorizedException(
        'Invalid token: missing subject (sub) claim',
      );
    }
  }

  /**
   * Tokens from another user flow of the same tenant carry a valid signature
   * and audience, so the policy has to be checked explicitly — otherwise a
   * token from, say, a profile-edit flow would pass as a sign-in token.
   */
  private assertPolicy(claims: JwtPayload, expected: string): void {
    if (!expected) {
      return;
    }

    const actual = claims.tfp || claims.acr;
    if (!actual || actual.toLowerCase() !== expected.toLowerCase()) {
      throw new UnauthorizedException(
        `Token was issued by user flow "${actual ?? 'unknown'}", not "${expected}"`,
      );
    }
  }

  private assertScopes(claims: JwtPayload, required: string[]): void {
    if (!required.length) {
      return;
    }

    const granted = new Set(this.readScopes(claims));
    const missing = required.filter((scope) => !granted.has(scope));

    if (missing.length) {
      throw new UnauthorizedException(
        `Token is missing the required scope(s): ${missing.join(', ')}`,
      );
    }
  }

  private getKeyStore(jwksUri: string, cacheMaxAge: number): JWTVerifyGetKey {
    if (!this.jwks || this.jwksUri !== jwksUri) {
      this.logger.log(`Loading Azure AD B2C signing keys from ${jwksUri}`);
      this.jwks = createRemoteJWKSet(new URL(jwksUri), {
        cacheMaxAge,
        // Floor between refetches, so an unknown `kid` cannot be used to
        // hammer the B2C keys endpoint.
        cooldownDuration: 30_000,
      });
      this.jwksUri = jwksUri;
    }

    return this.jwks;
  }

  /** Turns a jose failure into a message a caller can act on. */
  private describeFailure(error: unknown): string {
    if (error instanceof joseErrors.JWTExpired) {
      return 'Access token has expired';
    }
    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      return `Access token claim "${error.claim}" is not valid for this API`;
    }
    if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
      return 'Access token signature is not valid';
    }
    if (error instanceof joseErrors.JWKSNoMatchingKey) {
      return 'Access token was signed by an unknown key';
    }
    if (error instanceof joseErrors.JOSEError) {
      return 'Access token is malformed or could not be verified';
    }

    this.logger.error(
      `Unexpected failure while verifying an Azure AD B2C token: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return 'Access token could not be verified';
  }
}
