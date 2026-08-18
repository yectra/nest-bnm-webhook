/**
 * Small IP/CIDR helpers used to keep internal-only routes reachable from
 * Azure-internal callers alone. Kept dependency-free on purpose: the checks
 * run on every request to the internal event listener.
 */

/** RFC 1918 / RFC 4193 ranges plus the addresses Azure uses internally. */
export const AZURE_INTERNAL_CIDRS = [
  // Loopback: sidecars and anything running on the same App Service instance.
  '127.0.0.0/8',
  '::1/128',
  // Private ranges: VNet integration, private endpoints, App Service internals.
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  'fc00::/7',
  // Azure platform: wire server (health probes, IMDS) and link-local traffic.
  '168.63.129.16/32',
  '169.254.0.0/16',
  'fe80::/10',
];

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_MAPPED_PREFIX = 0xffffn << 32n;

export interface ParsedIp {
  value: bigint;
  bits: 32 | 128;
}

/**
 * Strips the decorations that proxies add to forwarded addresses: brackets
 * around IPv6 literals, a trailing ":port" (Azure Front Ends append one to
 * X-Forwarded-For) and the "::ffff:" prefix of IPv4-mapped IPv6 addresses.
 */
export function normalizeIp(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  let candidate = value.trim().toLowerCase();
  if (!candidate) {
    return null;
  }

  // "[::1]:443" or "[::1]"
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketed) {
    candidate = bracketed[1];
  } else if (candidate.includes(':') && !candidate.slice(1).includes('::')) {
    // "1.2.3.4:5678" — a single colon means an IPv4 address with a port.
    const parts = candidate.split(':');
    if (parts.length === 2 && IPV4_PATTERN.test(parts[0])) {
      candidate = parts[0];
    }
  }

  if (
    candidate.startsWith('::ffff:') &&
    IPV4_PATTERN.test(candidate.slice(7))
  ) {
    candidate = candidate.slice(7);
  }

  return candidate || null;
}

function parseIpv4(value: string): bigint | null {
  const match = IPV4_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  let result = 0n;
  for (let index = 1; index <= 4; index += 1) {
    const octet = Number(match[index]);
    if (octet > 255) {
      return null;
    }
    result = (result << 8n) | BigInt(octet);
  }

  return result;
}

function parseIpv6(value: string): bigint | null {
  if (!value.includes(':')) {
    return null;
  }

  const doubleColonCount = value.split('::').length - 1;
  if (doubleColonCount > 1) {
    return null;
  }

  const [head, tail = ''] = value.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];

  // A trailing IPv4 literal, as in "::ffff:10.0.0.1", expands to two groups.
  const expand = (groups: string[]): string[] | null => {
    const expanded: string[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (IPV4_PATTERN.test(group)) {
        if (index !== groups.length - 1) {
          return null;
        }
        const ipv4 = parseIpv4(group);
        if (ipv4 === null) {
          return null;
        }
        expanded.push(
          (ipv4 >> 16n).toString(16),
          (ipv4 & 0xffffn).toString(16),
        );
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) {
        return null;
      }
      expanded.push(group);
    }
    return expanded;
  };

  const expandedHead = expand(headGroups);
  const expandedTail = expand(tailGroups);
  if (!expandedHead || !expandedTail) {
    return null;
  }

  const missing = 8 - (expandedHead.length + expandedTail.length);
  if (doubleColonCount === 0 ? missing !== 0 : missing < 0) {
    return null;
  }

  const groups = [
    ...expandedHead,
    ...new Array<string>(doubleColonCount === 0 ? 0 : missing).fill('0'),
    ...expandedTail,
  ];

  let result = 0n;
  for (const group of groups) {
    result = (result << 16n) | BigInt(parseInt(group, 16));
  }

  return result;
}

/** Parses an already-normalized address into its numeric form. */
export function parseIp(value: string | undefined | null): ParsedIp | null {
  const normalized = normalizeIp(value);
  if (!normalized) {
    return null;
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4 !== null) {
    return { value: ipv4, bits: 32 };
  }

  const ipv6 = parseIpv6(normalized);
  if (ipv6 !== null) {
    // Treat IPv4-mapped addresses as IPv4 so a single CIDR list covers both.
    if (ipv6 >> 32n === IPV4_MAPPED_PREFIX) {
      return { value: ipv6 & 0xffffffffn, bits: 32 };
    }
    return { value: ipv6, bits: 128 };
  }

  return null;
}

/** Returns true when `ip` falls inside `cidr`. Malformed input returns false. */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [network, prefixText] = cidr.trim().split('/');
  const parsedNetwork = parseIp(network);
  const parsedIp = parseIp(ip);

  if (!parsedNetwork || !parsedIp || parsedNetwork.bits !== parsedIp.bits) {
    return false;
  }

  const prefix = prefixText === undefined ? parsedIp.bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsedIp.bits) {
    return false;
  }

  const hostBits = BigInt(parsedIp.bits - prefix);
  return parsedIp.value >> hostBits === parsedNetwork.value >> hostBits;
}

/** Returns true when `ip` matches any of the supplied CIDRs. */
export function isIpInAnyCidr(ip: string, cidrs: readonly string[]): boolean {
  return cidrs.some((cidr) => isIpInCidr(ip, cidr));
}
