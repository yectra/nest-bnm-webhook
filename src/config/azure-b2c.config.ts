import { registerAs } from '@nestjs/config';

/** Comma/space separated env lists (scopes, audiences) as a clean array. */
function toList(value: string | undefined): string[] {
  return (value || '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Azure AD B2C configuration for validating bearer access tokens.
 *
 * This app is a resource server: it never signs users in and never holds a
 * client secret. It only verifies the access tokens that the front end
 * obtains from the B2C user flow, using the OpenID Connect discovery
 * document of that user flow (`openid-client`) and the published JWKS.
 */
export interface AzureB2cConfig {
  tenantName: string;
  tenantDomain: string;
  instance: string;
  policy: string;
  clientId: string;
  audiences: string[];
  discoveryUrl: string;
  issuer?: string;
  requiredScopes: string[];
  clockSkewSeconds: number;
  jwksCacheMaxAgeMs: number;
  discoveryCacheMs: number;
}

export const AZURE_B2C_CONFIG_NAMESPACE = 'azureB2c';

export default registerAs(AZURE_B2C_CONFIG_NAMESPACE, (): AzureB2cConfig => {
  const tenantName = (process.env.AZURE_B2C_TENANT_NAME || '').trim();
  // b2clogin.com is the documented host; a B2C custom domain (for example
  // https://login.example.com) overrides it via AZURE_B2C_INSTANCE.
  const instance = (
    process.env.AZURE_B2C_INSTANCE || `https://${tenantName}.b2clogin.com`
  )
    .trim()
    .replace(/\/+$/, '');
  // The directory the user flow lives in. Defaults to the tenant's own
  // onmicrosoft.com domain, which is what B2C uses in its metadata URLs.
  const tenantDomain = (
    process.env.AZURE_B2C_TENANT_DOMAIN || `${tenantName}.onmicrosoft.com`
  ).trim();
  const policy = (process.env.AZURE_B2C_POLICY || '').trim();
  const clientId = (process.env.AZURE_B2C_CLIENT_ID || '').trim();

  const discoveryUrl =
    (process.env.AZURE_B2C_DISCOVERY_URL || '').trim() ||
    `${instance}/${tenantDomain}/${policy}/v2.0/.well-known/openid-configuration`;

  // The API's own application ID is the audience of its access tokens; extra
  // audiences cover clients migrating between app registrations.
  const audiences = Array.from(
    new Set(
      [clientId, ...toList(process.env.AZURE_B2C_AUDIENCE)].filter(Boolean),
    ),
  );

  return {
    tenantName,
    tenantDomain,
    instance,
    policy,
    clientId,
    audiences,
    discoveryUrl,
    /**
     * Issuer override. Normally left unset: the issuer is taken from the
     * discovery document, which is the only value B2C guarantees to match
     * the `iss` claim (it embeds the tenant GUID, not the tenant name).
     */
    issuer: (process.env.AZURE_B2C_ISSUER || '').trim() || undefined,
    /** Scopes every request must carry, on top of a valid signature. */
    requiredScopes: toList(process.env.AZURE_B2C_REQUIRED_SCOPES),
    /** Tolerated clock drift between B2C and this host, in seconds. */
    clockSkewSeconds: toInt(process.env.AZURE_B2C_CLOCK_SKEW_SECONDS, 60),
    /** How long a fetched signing key stays usable before it is re-fetched. */
    jwksCacheMaxAgeMs: toInt(
      process.env.AZURE_B2C_JWKS_CACHE_MS,
      10 * 60 * 1000,
    ),
    /** How long the discovery document is reused before re-discovery. */
    discoveryCacheMs: toInt(
      process.env.AZURE_B2C_DISCOVERY_CACHE_MS,
      12 * 60 * 60 * 1000,
    ),
  };
});
