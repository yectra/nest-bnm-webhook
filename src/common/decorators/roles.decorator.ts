import { SetMetadata } from '@nestjs/common';
import { REQUIRED_ROLES_KEY } from '../constants';

/**
 * Requires the Azure AD B2C access token to carry at least one of the listed
 * application roles. Route metadata overrides controller metadata.
 */
export const Roles = (...roles: string[]) =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);
