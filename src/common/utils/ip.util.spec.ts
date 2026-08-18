import {
  AZURE_INTERNAL_CIDRS,
  isIpInAnyCidr,
  isIpInCidr,
  normalizeIp,
} from './ip.util';

describe('normalizeIp', () => {
  it('strips a port from an IPv4 address', () => {
    expect(normalizeIp('13.107.42.14:52011')).toBe('13.107.42.14');
  });

  it('strips brackets and port from an IPv6 address', () => {
    expect(normalizeIp('[2603:1030::1]:443')).toBe('2603:1030::1');
  });

  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIp('::ffff:10.0.0.4')).toBe('10.0.0.4');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeIp('  10.0.0.4 ')).toBe('10.0.0.4');
  });

  it('returns null for empty input', () => {
    expect(normalizeIp(undefined)).toBeNull();
    expect(normalizeIp('   ')).toBeNull();
  });
});

describe('isIpInCidr', () => {
  it('matches IPv4 addresses inside a range', () => {
    expect(isIpInCidr('10.4.2.9', '10.0.0.0/8')).toBe(true);
    expect(isIpInCidr('172.16.5.1', '172.16.0.0/12')).toBe(true);
  });

  it('rejects IPv4 addresses outside a range', () => {
    expect(isIpInCidr('11.4.2.9', '10.0.0.0/8')).toBe(false);
    expect(isIpInCidr('172.32.0.1', '172.16.0.0/12')).toBe(false);
  });

  it('matches IPv6 addresses inside a range', () => {
    expect(isIpInCidr('fd00::1', 'fc00::/7')).toBe(true);
    expect(isIpInCidr('fe80::1', 'fe80::/10')).toBe(true);
    expect(isIpInCidr('2603:1030::1', 'fc00::/7')).toBe(false);
  });

  it('treats a bare address as a full-length prefix', () => {
    expect(isIpInCidr('168.63.129.16', '168.63.129.16')).toBe(true);
    expect(isIpInCidr('168.63.129.17', '168.63.129.16')).toBe(false);
  });

  it('does not mix address families', () => {
    expect(isIpInCidr('::1', '10.0.0.0/8')).toBe(false);
    expect(isIpInCidr('10.0.0.1', 'fc00::/7')).toBe(false);
  });

  it('returns false for malformed input', () => {
    expect(isIpInCidr('not-an-ip', '10.0.0.0/8')).toBe(false);
    expect(isIpInCidr('10.0.0.1', '10.0.0.0/64')).toBe(false);
    expect(isIpInCidr('999.1.1.1', '10.0.0.0/8')).toBe(false);
  });
});

describe('AZURE_INTERNAL_CIDRS', () => {
  it('covers Azure-internal callers', () => {
    for (const ip of [
      '127.0.0.1',
      '::1',
      '10.0.0.4',
      '172.20.1.9',
      '192.168.1.5',
      '169.254.130.3',
      '168.63.129.16',
      '::ffff:10.0.0.4',
    ]) {
      expect(isIpInAnyCidr(ip, AZURE_INTERNAL_CIDRS)).toBe(true);
    }
  });

  it('does not cover public addresses', () => {
    for (const ip of ['13.107.42.14', '8.8.8.8', '2603:1030::1']) {
      expect(isIpInAnyCidr(ip, AZURE_INTERNAL_CIDRS)).toBe(false);
    }
  });
});
