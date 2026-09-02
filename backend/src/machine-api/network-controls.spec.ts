import {
  certificateMatches,
  ipAllowed,
  ipInCidr,
  isValidCidr,
  normaliseFingerprint,
  normaliseIp,
} from './network-controls';

describe('normaliseIp', () => {
  it('unwraps an IPv4 address delivered over an IPv6 socket', () => {
    expect(normaliseIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
  });

  it('leaves a plain address alone', () => {
    expect(normaliseIp('203.0.113.5')).toBe('203.0.113.5');
    expect(normaliseIp('2001:db8::1')).toBe('2001:db8::1');
  });
});

describe('ipInCidr', () => {
  it('matches inside a /24', () => {
    expect(ipInCidr('203.0.113.5', '203.0.113.0/24')).toBe(true);
    expect(ipInCidr('203.0.113.255', '203.0.113.0/24')).toBe(true);
  });

  it('does not match outside it', () => {
    expect(ipInCidr('203.0.114.5', '203.0.113.0/24')).toBe(false);
  });

  it('treats a bare address as a single host', () => {
    expect(ipInCidr('203.0.113.5', '203.0.113.5')).toBe(true);
    expect(ipInCidr('203.0.113.6', '203.0.113.5')).toBe(false);
  });

  it('handles a /32 and a /0', () => {
    expect(ipInCidr('203.0.113.5', '203.0.113.5/32')).toBe(true);
    expect(ipInCidr('203.0.113.6', '203.0.113.5/32')).toBe(false);
    expect(ipInCidr('8.8.8.8', '0.0.0.0/0')).toBe(true);
  });

  it('matches an IPv4-mapped address against an IPv4 range', () => {
    // Node reports this shape behind an IPv6 socket; an operator writes the plain form.
    expect(ipInCidr('::ffff:203.0.113.5', '203.0.113.0/24')).toBe(true);
  });

  it('matches IPv6 ranges', () => {
    expect(ipInCidr('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(ipInCidr('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(ipInCidr('2001:db8::1', '2001:db8::1/128')).toBe(true);
  });

  it('never matches across address families', () => {
    expect(ipInCidr('203.0.113.5', '2001:db8::/32')).toBe(false);
    expect(ipInCidr('2001:db8::1', '203.0.113.0/24')).toBe(false);
  });

  it('refuses nonsense rather than matching it', () => {
    expect(ipInCidr('203.0.113.5', 'not-a-range')).toBe(false);
    expect(ipInCidr('not-an-ip', '203.0.113.0/24')).toBe(false);
    expect(ipInCidr('203.0.113.5', '203.0.113.0/99')).toBe(false);
    expect(ipInCidr('999.0.0.1', '999.0.0.0/24')).toBe(false);
  });
});

describe('ipAllowed', () => {
  it('allows anything when no restriction is set', () => {
    expect(ipAllowed('203.0.113.5', [])).toBe(true);
  });

  it('allows an address in any one of the ranges', () => {
    expect(ipAllowed('198.51.100.7', ['203.0.113.0/24', '198.51.100.0/24'])).toBe(true);
  });

  it('refuses an address in none of them', () => {
    expect(ipAllowed('192.0.2.1', ['203.0.113.0/24', '198.51.100.0/24'])).toBe(false);
  });
});

describe('normaliseFingerprint', () => {
  const HEX = 'a'.repeat(64);

  it('accepts a bare lower-case fingerprint', () => {
    expect(normaliseFingerprint(HEX)).toBe(HEX);
  });

  it('accepts the colon-separated upper-case form openssl prints', () => {
    const colons = HEX.toUpperCase().match(/.{2}/g)!.join(':');
    expect(normaliseFingerprint(colons)).toBe(HEX);
  });

  it('accepts a sha256: prefix', () => {
    expect(normaliseFingerprint(`sha256:${HEX}`)).toBe(HEX);
    expect(normaliseFingerprint(`SHA-256=${HEX.toUpperCase()}`)).toBe(HEX);
  });

  it('refuses anything that is not a SHA-256 fingerprint', () => {
    expect(normaliseFingerprint('')).toBeNull();
    expect(normaliseFingerprint(null)).toBeNull();
    expect(normaliseFingerprint('abc')).toBeNull();
    // A SHA-1 fingerprint is the right shape but the wrong length, and must not slip through.
    expect(normaliseFingerprint('a'.repeat(40))).toBeNull();
  });
});

describe('certificateMatches', () => {
  const HEX = 'b'.repeat(64);

  it('passes when the credential is not bound to a certificate', () => {
    expect(certificateMatches(null, undefined)).toBe(true);
    expect(certificateMatches(null, HEX)).toBe(true);
  });

  it('accepts the bound certificate however it is written', () => {
    expect(certificateMatches(HEX, HEX.toUpperCase().match(/.{2}/g)!.join(':'))).toBe(true);
  });

  it('refuses a different certificate', () => {
    expect(certificateMatches(HEX, 'c'.repeat(64))).toBe(false);
  });

  it('refuses a missing certificate when one is required', () => {
    expect(certificateMatches(HEX, undefined)).toBe(false);
    expect(certificateMatches(HEX, '')).toBe(false);
    // A malformed value must not be treated as "no certificate required".
    expect(certificateMatches(HEX, 'not-a-fingerprint')).toBe(false);
  });
});

describe('isValidCidr', () => {
  it('accepts an ordinary IPv4 range', () => {
    expect(isValidCidr('203.0.113.0/24')).toBe(true);
    // A range that contains none of the addresses one would think to probe with is still valid.
    expect(isValidCidr('198.51.100.0/24')).toBe(true);
    expect(isValidCidr('10.0.0.0/8')).toBe(true);
  });

  it('accepts a bare address of either family', () => {
    expect(isValidCidr('203.0.113.5')).toBe(true);
    expect(isValidCidr('2001:db8::1')).toBe(true);
  });

  it('accepts an IPv6 range', () => {
    expect(isValidCidr('2001:db8::/32')).toBe(true);
    expect(isValidCidr('::/0')).toBe(true);
  });

  it('accepts the address form Node reports behind an IPv6 socket', () => {
    expect(isValidCidr('::ffff:203.0.113.5')).toBe(true);
  });

  it('refuses a prefix length outside the family range', () => {
    expect(isValidCidr('203.0.113.0/33')).toBe(false);
    expect(isValidCidr('2001:db8::/129')).toBe(false);
  });

  it('refuses a malformed prefix', () => {
    expect(isValidCidr('203.0.113.0/')).toBe(false);
    expect(isValidCidr('203.0.113.0/8/8')).toBe(false);
    expect(isValidCidr('203.0.113.0/ 8')).toBe(false);
    expect(isValidCidr('203.0.113.0/eight')).toBe(false);
  });

  it('refuses anything that is not an address', () => {
    expect(isValidCidr('')).toBe(false);
    expect(isValidCidr('not-a-range')).toBe(false);
    expect(isValidCidr('999.0.0.1/24')).toBe(false);
  });
});
