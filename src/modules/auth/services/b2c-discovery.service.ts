import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Issuer } from 'openid-client';

import {
  AZURE_B2C_CONFIG_NAMESPACE,
  type AzureB2cConfig,
} from '../../../config/azure-b2c.config';

/** The parts of the OIDC metadata this resource server needs. */
export interface B2cMetadata {
  /** The exact value the `iss` claim must equal. */
  issuer: string;
  /** Where the signing keys are published. */
  jwksUri: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  endSessionEndpoint?: string;
}

/**
 * Reads the OpenID Connect discovery document of the configured Azure AD B2C
 * user flow with `openid-client` (no MSAL involved).
 *
 * Discovery matters here for one reason: B2C's `iss` claim contains the
 * tenant GUID, which the tenant name in the configuration does not give us.
 * Taking the issuer and the JWKS URI from the metadata is what lets token
 * verification pin both values instead of guessing them.
 *
 * The document is fetched lazily on the first request, cached, and refreshed
 * once the cache window passes. Concurrent callers share one in-flight fetch.
 */
@Injectable()
export class B2cDiscoveryService {
  private readonly logger = new Logger(B2cDiscoveryService.name);

  private cached?: B2cMetadata;
  private cachedAt = 0;
  private inFlight?: Promise<B2cMetadata>;

  constructor(private readonly config: ConfigService) {}

  get settings(): AzureB2cConfig {
    const settings = this.config.get<AzureB2cConfig>(
      AZURE_B2C_CONFIG_NAMESPACE,
    );

    if (!settings) {
      throw new ServiceUnavailableException(
        'Azure AD B2C configuration is not loaded',
      );
    }

    return settings;
  }

  /** Discovery metadata, from cache when it is still fresh. */
  async getMetadata(): Promise<B2cMetadata> {
    if (
      this.cached &&
      Date.now() - this.cachedAt < this.settings.discoveryCacheMs
    ) {
      return this.cached;
    }

    // One fetch per cache miss, however many requests arrive at once.
    this.inFlight ??= this.discover().finally(() => {
      this.inFlight = undefined;
    });

    try {
      return await this.inFlight;
    } catch (error) {
      // A stale document still verifies tokens correctly (the issuer and the
      // JWKS URI of a user flow do not move), so a B2C outage degrades to
      // "keep using what we have" rather than locking every user out.
      if (this.cached) {
        this.logger.warn(
          `Reusing cached Azure AD B2C metadata after a discovery failure: ${this.describe(error)}`,
        );
        return this.cached;
      }
      throw error;
    }
  }

  /** Drops the cached document so the next call re-reads it. */
  reset(): void {
    this.cached = undefined;
    this.cachedAt = 0;
  }

  private async discover(): Promise<B2cMetadata> {
    const { discoveryUrl, issuer: issuerOverride } = this.settings;

    this.logger.log(`Discovering Azure AD B2C metadata at ${discoveryUrl}`);

    let issuer: Issuer;
    try {
      issuer = await Issuer.discover(discoveryUrl);
    } catch (error) {
      throw new ServiceUnavailableException(
        `Unable to read the Azure AD B2C discovery document at ${discoveryUrl}: ${this.describe(error)}`,
      );
    }

    const jwksUri = issuer.metadata.jwks_uri;
    const discoveredIssuer = issuerOverride || issuer.metadata.issuer;

    if (!jwksUri || !discoveredIssuer) {
      throw new ServiceUnavailableException(
        'The Azure AD B2C discovery document is missing "issuer" or "jwks_uri"',
      );
    }

    const metadata: B2cMetadata = {
      issuer: discoveredIssuer,
      jwksUri,
      authorizationEndpoint: issuer.metadata.authorization_endpoint,
      tokenEndpoint: issuer.metadata.token_endpoint,
      endSessionEndpoint: issuer.metadata.end_session_endpoint,
    };

    this.cached = metadata;
    this.cachedAt = Date.now();
    this.logger.log(`Azure AD B2C issuer resolved: ${metadata.issuer}`);

    return metadata;
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
