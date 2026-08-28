import { extractBearerToken } from './bearer-token.util';

describe('extractBearerToken', () => {
  it('returns the token from a well-formed header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepts the scheme in any casing', () => {
    expect(extractBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('BEARER abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(extractBearerToken('  Bearer   abc.def.ghi  ')).toBe('abc.def.ghi');
  });

  it('reads the first value when the header arrives repeated', () => {
    expect(extractBearerToken(['Bearer first', 'Bearer second'])).toBe('first');
  });

  it('returns undefined when the header is absent', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken('')).toBeUndefined();
  });

  it('rejects other authentication schemes', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeUndefined();
  });

  it('rejects a header with no token or with extra parts', () => {
    expect(extractBearerToken('Bearer')).toBeUndefined();
    expect(extractBearerToken('Bearer one two')).toBeUndefined();
  });
});
