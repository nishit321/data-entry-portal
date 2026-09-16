import {
  certificateMatches,
  fingerprintFromHeader,
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

describe('fingerprintFromHeader', () => {
  /*
   * Mutual TLS behind a proxy (NCA, 16 September 2026).
   *
   * The portal runs behind nginx, and nginx opens the HTTPS connection itself — so the client
   * certificate never reaches the application on the socket. It has to arrive in a header, and
   * this is what reads it.
   *
   * A throwaway self-signed certificate, generated once and pinned here with the SHA-256 of its
   * own DER bytes, taken with openssl rather than with the code under test. A fixture whose
   * expected value came from the implementation would agree with any implementation.
   */
  const CERT = `-----BEGIN CERTIFICATE-----
MIIDYzCCAkugAwIBAgIUXcCsLenqBG8SJN3BOYVn4TaVr5gwDQYJKoZIhvcNAQEL
BQAwQTEMMAoGA1UECgwDTkNBMQ0wCwYDVQQLDARURVNUMSIwIAYDVQQDDBlOQ0Eg
UG9ydGFsIE1hY2hpbmUgQ2xpZW50MB4XDTI2MDkxNjA3MDUyM1oXDTQ2MDkxMTA3
MDUyM1owQTEMMAoGA1UECgwDTkNBMQ0wCwYDVQQLDARURVNUMSIwIAYDVQQDDBlO
Q0EgUG9ydGFsIE1hY2hpbmUgQ2xpZW50MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
MIIBCgKCAQEAzSj504juZKjycbpKB0EIQs46XN1N/Z8CTA9EVMGHT4V23g8zz71Y
Ip896tkw1L4yGfUyV/2QtBOKlhHLpKNN+8KmuPLnJqpJnPA218exfBSY/XUiJ+sX
u8aldCzJwUmLqBIirWo4bBAzcsH8Fy/5G9Ym+P8pwmOmsFWyrwtaLqBTv38h+GxM
G6wW/zPWAl/X6fH+/DMEMEW08nhDJSVjSwzz8Qbgr5G7uCsiYJ8oH4+DB2ak7KhX
j2GKMc5fobx0q08n5BmKxBl8QDYk3f78ng1LWgL25bxu9LypP3Vaeb/in9u47z18
cfmt4u1nruWyI6QkGFjh9sOeaUD5LhiyrQIDAQABo1MwUTAdBgNVHQ4EFgQULuyX
oTPblS4VeWHkzkxQUDu+KzYwHwYDVR0jBBgwFoAULuyXoTPblS4VeWHkzkxQUDu+
KzYwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAbd7FhkX94TRb
tx/B50nM5psikya0OLmiu1RPG9xzW9iHkbXmhd7rTZnz6NgnDfNllUnoTOshWkHg
YokJbFVP7Tl+NyJAt3SMixn15/MgVMhGai17JwdBe9Y0Okf1DWioo9Mzz4mDyi3U
m1M2dnzmmzgTuAlcHVTun/BpbsOzqeOe647Xhp3sgnhGMUHLnEQxKmXn0sHsudOz
/oqjV8qsJLMR8vXtDoIN2NYtbOdnswbjEPr1ESW4LgayK1d4be3VuM+cZQD+NHZR
5HDaF4+i2v/zReUKHE2A41x2IynUt2KVWTW9U3NeEaXNQSaLhcDhG7C/wr/g+ZbZ
/C1tIfj5LA==
-----END CERTIFICATE-----
`;

  /** What `openssl x509 -outform DER | openssl dgst -sha256` says about the certificate above. */
  const FINGERPRINT = '91636d8bf877f4f60cd32e709f4f3aee078d9eced54e288536cd39c69324c23a';

  it('computes the fingerprint from a certificate the proxy forwarded', () => {
    expect(fingerprintFromHeader(CERT)).toBe(FINGERPRINT);
  });

  it('reads the percent-encoded form nginx actually sends', () => {
    // `$ssl_client_escaped_cert` is the PEM with its newlines encoded, because a header cannot
    // carry them. This is the shape the live deployment will present, so it is the shape that
    // matters most in this file.
    expect(fingerprintFromHeader(encodeURIComponent(CERT))).toBe(FINGERPRINT);
  });

  it('accepts a fingerprint from a proxy that computed one itself', () => {
    expect(fingerprintFromHeader(FINGERPRINT)).toBe(FINGERPRINT);
    expect(fingerprintFromHeader(FINGERPRINT.toUpperCase())).toBe(FINGERPRINT);
    expect(fingerprintFromHeader(`SHA256:${FINGERPRINT}`)).toBe(FINGERPRINT);
  });

  it('refuses a SHA-1 fingerprint rather than half-matching it', () => {
    /*
     * The trap this function exists to close. nginx's own `$ssl_client_fingerprint` is SHA-1, and
     * a deployment that wired that up would send 40 hex characters where 64 are expected. Refusing
     * it means the request is turned away; quietly accepting a prefix or a different hash would
     * mean a certificate check that passes on the wrong certificate.
     */
    expect(fingerprintFromHeader('da39a3ee5e6b4b0d3255bfef95601890afd80709')).toBeNull();
  });

  it('refuses anything that is not a certificate', () => {
    // All of these arrive from callers who have not authenticated yet, so the answer is null and a
    // refused request, never an exception.
    expect(fingerprintFromHeader('')).toBeNull();
    expect(fingerprintFromHeader(undefined)).toBeNull();
    expect(fingerprintFromHeader('hello')).toBeNull();
    expect(fingerprintFromHeader('%E0%A4%A')).toBeNull(); // broken percent-encoding
    expect(
      fingerprintFromHeader('-----BEGIN CERTIFICATE-----\nnot base64\n-----END CERTIFICATE-----'),
    ).toBeNull();
  });

  it('gives a different certificate a different fingerprint', () => {
    // Worth stating: the whole control rests on two certificates never agreeing. Built by moving
    // one byte of the DER, which is the smallest change a forger could try.
    const tampered = CERT.replace('MIIDYzCCAkug', 'MIIDYzCCAkuh');
    expect(fingerprintFromHeader(tampered)).not.toBe(FINGERPRINT);
  });
});
