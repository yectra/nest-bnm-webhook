export interface JwtPayload {
  /** Subject — the authenticated user's unique ID */
  sub: string;

  /** Tenant ID for multi-tenant applications (optional) */
  tenantId?: string;

  /** User's email address (optional) */
  email?: string;

  /** Issued-at timestamp (Unix epoch) */
  iat?: number;

  /** Expiry timestamp (Unix epoch) */
  exp?: number;

  /** Any additional custom claims */
  [key: string]: unknown;
}
