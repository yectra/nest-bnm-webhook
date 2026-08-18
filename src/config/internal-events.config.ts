import { registerAs } from '@nestjs/config';

const parseCidrList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export default registerAs('internalEvents', () => ({
  // The internal listener is opt-in: it stays disabled (and returns 503)
  // unless the deployment explicitly turns it on.
  enabled:
    (process.env.INTERNAL_EVENTS_ENABLED || 'false').toLowerCase() === 'true',
  // Shared secret Azure-internal callers must present in x-internal-event-key.
  accessKey: process.env.INTERNAL_EVENTS_KEY,
  // Extra CIDRs on top of the built-in private/Azure-internal ranges, for
  // example the subnet of a private endpoint or a VNet-integrated caller.
  allowedCidrs: parseCidrList(process.env.INTERNAL_EVENTS_ALLOWED_CIDRS),
  // Origin echoed back during the CloudEvents v1.0 abuse-protection handshake.
  allowedOrigin:
    process.env.INTERNAL_EVENTS_ALLOWED_ORIGIN || 'eventgrid.azure.net',
}));
