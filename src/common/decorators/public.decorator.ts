import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../constants';

/**
 * Opts a route out of Azure AD B2C authentication.
 *
 * Reserve it for endpoints that cannot present a user token — platform
 * probes and third-party webhooks, which authenticate themselves by their
 * own means (Twilio request signatures, Event Grid keys, Bot Framework JWTs).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
