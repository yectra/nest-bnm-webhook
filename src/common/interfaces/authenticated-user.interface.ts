import { JwtPayload } from './jwt-payload.interface';

/**
 * The caller behind a request, built from a verified Azure AD B2C access
 * token. Attached to `request.user` by the Azure B2C auth guard and read
 * through the `@CurrentUser()` decorator.
 */
export interface AuthenticatedUser {
  /** The authenticated user's unique ID (`oid`, falling back to `sub`). */
  userId: string;

  /** The raw `sub` claim. */
  subject: string;

  /** The user's object ID in the B2C directory (`oid`). */
  objectId?: string;

  /** Directory (tenant) ID — `tid`, or a `tenantId` custom claim. */
  tenantId?: string;

  /** Primary email address, the first entry of `emails` when there are many. */
  email?: string;

  /** Every verified address on the account. */
  emails: string[];

  /** Display name. */
  name?: string;

  givenName?: string;

  familyName?: string;

  /** Identity provider that authenticated the user (`idp`). */
  identityProvider?: string;

  /** The B2C user flow or custom policy that issued the token (`tfp`/`acr`). */
  policy?: string;

  /** Delegated scopes carried by the token (`scp`, split on whitespace). */
  scopes: string[];

  /** Application roles assigned to the caller (`roles`). */
  roles: string[];

  /** Client ID the token was issued to (`azp`, falling back to `appid`). */
  clientId?: string;

  /** Issuer the token was verified against. */
  issuer?: string;

  /** Expiry as a Unix epoch second (`exp`). */
  expiresAt?: number;

  /** Every claim of the verified token, for anything not mapped above. */
  claims: JwtPayload;
}
