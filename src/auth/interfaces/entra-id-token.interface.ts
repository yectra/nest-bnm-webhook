export interface EntraIdTokenPayload {
  /**
   * Issuer URL
   * e.g. https://login.microsoftonline.com/{tenantId}/v2.0 or https://sts.windows.net/{tenantId}/
   */
  iss: string;

  /**
   * Audience (Application ID URI or client ID)
   */
  aud: string;

  /**
   * Tenant ID (GUID)
   */
  tid: string;

  /**
   * Subject (Unique identifier for the principal)
   */
  sub: string;

  /**
   * Client ID / Application ID of the caller (v1 tokens)
   */
  appid?: string;

  /**
   * Authorized Party / Client ID of the caller (v2 tokens)
   */
  azp?: string;

  /**
   * Object ID of the service principal / managed identity in Microsoft Entra ID
   */
  oid?: string;

  /**
   * Assigned Application Roles (for daemon / service-to-service / managed identity calls)
   */
  roles?: string[];

  /**
   * Delegated permissions / Scopes (space-delimited string)
   */
  scp?: string;

  /**
   * Expiration time (seconds since Unix epoch)
   */
  exp: number;

  /**
   * Not before time (seconds since Unix epoch)
   */
  nbf?: number;

  /**
   * Issued at time (seconds since Unix epoch)
   */
  iat?: number;

  [key: string]: any;
}
