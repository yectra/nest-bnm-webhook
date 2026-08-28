/**
 * Claims of an Azure AD B2C access token.
 *
 * Only the claims this application reads are named; B2C also emits any
 * custom attribute configured on the user flow, which stays reachable
 * through the index signature.
 */
export interface JwtPayload {
  /** Subject — the user's immutable object ID within the B2C tenant. */
  sub: string;

  /** Object ID of the user. B2C emits it alongside `sub` with the same value. */
  oid?: string;

  /** Directory (tenant) ID. */
  tid?: string;

  /** Display name, when the user flow returns it. */
  name?: string;

  given_name?: string;
  family_name?: string;

  /** B2C returns verified addresses as a list, not a single `email` claim. */
  emails?: string[];

  /** Some user flows and custom policies emit a single `email` claim instead. */
  email?: string;

  /** Identity provider that authenticated the user (local, google.com, ...). */
  idp?: string;

  /** The user flow that issued the token (user flows use `tfp`). */
  tfp?: string;

  /** The user flow that issued the token (custom policies use `acr`). */
  acr?: string;

  /** Space separated delegated scopes granted to the calling application. */
  scp?: string;

  /** Application roles assigned to the caller. */
  roles?: string[];

  /** Authorized party — the client ID the token was issued to. */
  azp?: string;

  /** Application ID of the caller, as emitted by v1.0 style tokens. */
  appid?: string;

  /** Audience — the API this token is meant for. */
  aud?: string | string[];

  /** Issuer — `https://<tenant>.b2clogin.com/<tenantId>/v2.0/`. */
  iss?: string;

  /** Present on ID tokens; an API must never accept those as credentials. */
  nonce?: string;

  /** Issued-at timestamp (Unix epoch). */
  iat?: number;

  /** Not-before timestamp (Unix epoch). */
  nbf?: number;

  /** Expiry timestamp (Unix epoch). */
  exp?: number;

  /** Multi-tenant setups may carry a tenant ID as a custom claim. */
  tenantId?: string;

  /** Any additional custom claim configured on the user flow. */
  [key: string]: unknown;
}
