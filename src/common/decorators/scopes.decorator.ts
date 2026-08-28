import { SetMetadata } from '@nestjs/common';
import { REQUIRED_SCOPES_KEY } from '../constants';

/**
 * Requires the Azure AD B2C access token to carry every listed scope, on top
 * of being valid. Route metadata overrides controller metadata.
 */
export const Scopes = (...scopes: string[]) =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);
