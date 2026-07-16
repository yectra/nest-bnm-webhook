export interface AuthenticatedUser {
  /** The authenticated user's unique ID (from JWT `sub` claim) */
  userId: string;

  /** Tenant ID (optional, for multi-tenant setups) */
  tenantId?: string;

  /** Email address (optional) */
  email?: string;
}
