import {
  SIGNATURE_WINDOW_MS,
  sign,
  signaturesMatch,
  signingString,
  verifySignature,
  type SignatureInput,
} from './request-signing';

const SECRET = 'a-machine-secret-that-is-long-enough-to-be-real';
const NOW = new Date('2026-08-30T10:00:00.000Z');

function request(over: Partial<SignatureInput> = {}): SignatureInput {
  return {
    timestamp: NOW.toISOString(),
    nonce: 'nonce-1',
    method: 'POST',
    path: '/api/v1/machine/returns',
    body: '{"periodId":"p1"}',
    ...over,
  };
}

describe('signingString', () => {
  it('hashes the body rather than carrying it, so the signed string stays a fixed size', () => {
    const short = signingString(request({ body: 'x' }));
    const long = signingString(request({ body: 'x'.repeat(100_000) }));
    expect(short.length).toBe(long.length);
  });

  it('treats an absent body the same as an empty one', () => {
    expect(signingString(request({ body: '' }))).toBe(
      signingString({ ...request(), body: undefined as unknown as string }),
    );
  });

  it('upper-cases the method, so "post" and "POST" sign alike', () => {
    expect(signingString(request({ method: 'post' }))).toBe(signingString(request()));
  });
});

describe('sign', () => {
  it('is stable for the same input and secret', () => {
    expect(sign(SECRET, request())).toBe(sign(SECRET, request()));
  });

  it('changes when any part of the request changes', () => {
    const base = sign(SECRET, request());
    expect(sign(SECRET, request({ body: '{"periodId":"p2"}' }))).not.toBe(base);
    expect(sign(SECRET, request({ path: '/api/v1/machine/returns/submit' }))).not.toBe(base);
    expect(sign(SECRET, request({ method: 'PUT' }))).not.toBe(base);
    expect(sign(SECRET, request({ nonce: 'nonce-2' }))).not.toBe(base);
    expect(sign(SECRET, request({ timestamp: '2026-08-30T10:00:01.000Z' }))).not.toBe(base);
  });

  it('changes with the secret', () => {
    expect(sign('another-secret', request())).not.toBe(sign(SECRET, request()));
  });
});

describe('signaturesMatch', () => {
  it('accepts an identical signature', () => {
    expect(signaturesMatch('abc123', 'abc123')).toBe(true);
  });

  it('rejects a different one', () => {
    expect(signaturesMatch('abc123', 'abc124')).toBe(false);
  });

  it('does not throw on a signature of a different length', () => {
    // A raw timingSafeEqual would throw here, and the throw would leak the expected length.
    expect(signaturesMatch('abc123', '')).toBe(false);
    expect(signaturesMatch('abc123', 'x'.repeat(500))).toBe(false);
  });
});

describe('verifySignature', () => {
  const verify = (over: Partial<SignatureInput> = {}, at: Date = NOW, secret = SECRET) => {
    const input = request(over);
    return verifySignature(secret, { ...input, signature: sign(SECRET, input) }, at);
  };

  it('accepts a correctly signed request', () => {
    const result = verify();
    expect(result.ok).toBe(true);
    expect(result.nonceExpiresAt).toEqual(new Date(NOW.getTime() + SIGNATURE_WINDOW_MS));
  });

  it('refuses a request with nothing signed', () => {
    expect(verifySignature(SECRET, {}, NOW)).toEqual({ ok: false, reason: 'MISSING' });
  });

  it('refuses a request missing only the nonce', () => {
    const input = request();
    const result = verifySignature(
      SECRET,
      { ...input, nonce: undefined, signature: sign(SECRET, input) },
      NOW,
    );
    expect(result.reason).toBe('MISSING');
  });

  it('refuses a timestamp that is not a date', () => {
    expect(verify({ timestamp: 'yesterday' }).reason).toBe('BAD_TIMESTAMP');
  });

  it('accepts a request at the very edge of the window', () => {
    const at = new Date(NOW.getTime() + SIGNATURE_WINDOW_MS);
    expect(verify({}, at).ok).toBe(true);
  });

  it('refuses a request one millisecond past the window', () => {
    const at = new Date(NOW.getTime() + SIGNATURE_WINDOW_MS + 1);
    expect(verify({}, at).reason).toBe('STALE');
  });

  it('refuses a request dated in the future beyond the window', () => {
    const at = new Date(NOW.getTime() - SIGNATURE_WINDOW_MS - 1);
    expect(verify({}, at).reason).toBe('FUTURE');
  });

  it('allows a little clock skew in both directions', () => {
    expect(verify({}, new Date(NOW.getTime() + 30_000)).ok).toBe(true);
    expect(verify({}, new Date(NOW.getTime() - 30_000)).ok).toBe(true);
  });

  it('refuses a signature made with the wrong secret', () => {
    const input = request();
    const result = verifySignature(
      SECRET,
      { ...input, signature: sign('wrong-secret', input) },
      NOW,
    );
    expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('refuses a body that changed after it was signed', () => {
    const input = request();
    const signature = sign(SECRET, input);
    const tampered = verifySignature(
      SECRET,
      { ...input, body: '{"periodId":"someone-elses"}', signature },
      NOW,
    );
    expect(tampered.reason).toBe('BAD_SIGNATURE');
  });

  it('refuses a signed body replayed against a different endpoint', () => {
    const input = request();
    const signature = sign(SECRET, input);
    const moved = verifySignature(
      SECRET,
      { ...input, path: '/api/v1/machine/returns/submit', signature },
      NOW,
    );
    expect(moved.reason).toBe('BAD_SIGNATURE');
  });

  it('refuses a signed request replayed with a different method', () => {
    const input = request();
    const signature = sign(SECRET, input);
    expect(verifySignature(SECRET, { ...input, method: 'DELETE', signature }, NOW).reason).toBe(
      'BAD_SIGNATURE',
    );
  });
});
