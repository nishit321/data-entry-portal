import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createSign, generateKeyPairSync, randomUUID, X509Certificate } from 'crypto';
import {
  CertificateError,
  DIGEST_VERSION,
  canonicalForm,
  readCertificate,
  submissionDigest,
  verifySubmissionSignature,
  type DigestInput,
} from './submission-digest';

function input(over: Partial<DigestInput> = {}): DigestInput {
  return {
    entityId: 'entity-1',
    periodId: 'period-1',
    templateId: 'template-1',
    version: 1,
    values: [
      { fieldKey: 'subscribers', value: '1000' },
      { fieldKey: 'revenue', value: '25000.50' },
    ],
    ...over,
  };
}

describe('canonicalForm', () => {
  it('sorts fields, so the order they were filled in does not matter', () => {
    const a = canonicalForm(input());
    const b = canonicalForm(
      input({
        values: [
          { fieldKey: 'revenue', value: '25000.50' },
          { fieldKey: 'subscribers', value: '1000' },
        ],
      }),
    );
    expect(a).toBe(b);
  });

  it('carries the version of the canonical form, so a later change stays checkable', () => {
    expect(canonicalForm(input()).startsWith(DIGEST_VERSION)).toBe(true);
  });

  it('treats values as stored, never re-parsed', () => {
    // To a regulator, 1.50 and 1.5 are different answers; they must be different to the digest.
    const a = canonicalForm(input({ values: [{ fieldKey: 'x', value: '1.50' }] }));
    const b = canonicalForm(input({ values: [{ fieldKey: 'x', value: '1.5' }] }));
    expect(a).not.toBe(b);
  });

  it('leaves unanswered questions out entirely', () => {
    // Adding a question nobody answered must not invalidate signatures already made.
    const answered = canonicalForm(input({ values: [{ fieldKey: 'x', value: '1' }] }));
    const withBlank = canonicalForm(
      input({
        values: [
          { fieldKey: 'x', value: '1' },
          { fieldKey: 'y', value: '' },
        ],
      }),
    );
    expect(answered).toBe(withBlank);
  });

  it('changes when any part of the identity changes', () => {
    const base = canonicalForm(input());
    expect(canonicalForm(input({ entityId: 'entity-2' }))).not.toBe(base);
    expect(canonicalForm(input({ periodId: 'period-2' }))).not.toBe(base);
    expect(canonicalForm(input({ templateId: 'template-2' }))).not.toBe(base);
    expect(canonicalForm(input({ version: 2 }))).not.toBe(base);
  });
});

describe('submissionDigest', () => {
  it('is a sha256 hex digest', () => {
    expect(submissionDigest(input())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls', () => {
    expect(submissionDigest(input())).toBe(submissionDigest(input()));
  });

  it('changes when a single answer changes', () => {
    const changed = input({
      values: [
        { fieldKey: 'subscribers', value: '1001' },
        { fieldKey: 'revenue', value: '25000.50' },
      ],
    });
    expect(submissionDigest(changed)).not.toBe(submissionDigest(input()));
  });
});

/**
 * A self-signed certificate and its key, made with openssl.
 *
 * Node cannot mint an X.509 certificate on its own, and a fixture certificate checked into the
 * repository would expire and start failing the suite on a date nobody chose. When openssl is not
 * on the machine the certificate tests are skipped rather than failing for a reason that has
 * nothing to do with the code.
 */
function makeCertificate(bits = 2048): { pem: string; privateKey: string } | null {
  let keyFile = '';
  try {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: bits });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    // Via a temp file rather than stdin: `/dev/stdin` does not exist on Windows, and the suite
    // has to run on whatever a developer or CI happens to be using.
    keyFile = join(tmpdir(), `nca-sig-test-${randomUUID()}.pem`);
    writeFileSync(keyFile, keyPem);

    const out = execFileSync(
      'openssl',
      [
        'req',
        '-new',
        '-x509',
        '-key',
        keyFile,
        '-subj',
        '/CN=NCA Test Signer/O=Test Operator',
        '-days',
        '365',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return { pem: out, privateKey: keyPem };
  } catch {
    return null;
  } finally {
    if (keyFile) {
      try {
        unlinkSync(keyFile);
      } catch {
        // Nothing to do: a leftover temp key in a test run is not worth failing over.
      }
    }
  }
}

const fixture = makeCertificate();
const withCert = fixture ? describe : describe.skip;

withCert('readCertificate', () => {
  it('reads the facts the portal stores', () => {
    const facts = readCertificate(fixture!.pem);
    expect(facts.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(facts.algorithm).toBe('RSA-SHA256');
    expect(facts.subject).toContain('NCA Test Signer');
    expect(facts.selfSigned).toBe(true);
    expect(facts.notAfter.getTime()).toBeGreaterThan(facts.notBefore.getTime());
    expect(facts.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('gives the same fingerprint the certificate itself reports', () => {
    const facts = readCertificate(fixture!.pem);
    const direct = new X509Certificate(fixture!.pem).fingerprint256.replace(/:/g, '').toLowerCase();
    expect(facts.fingerprint).toBe(direct);
  });

  it('refuses text that is not a certificate', () => {
    expect(() => readCertificate('hello')).toThrow(CertificateError);
    expect(() => readCertificate('')).toThrow(CertificateError);
  });

  it('refuses an RSA key too short to be a control', () => {
    const weak = makeCertificate(1024);
    if (!weak) return;
    expect(() => readCertificate(weak.pem)).toThrow(/2048/);
  });
});

withCert('verifySubmissionSignature', () => {
  const digest = submissionDigest(input());

  function signDigest(value: string, key = fixture!.privateKey): string {
    const signer = createSign('RSA-SHA256');
    signer.update(value, 'utf8');
    signer.end();
    return signer.sign(key).toString('base64');
  }

  it('accepts a signature over the digest it was made for', () => {
    const facts = readCertificate(fixture!.pem);
    const result = verifySubmissionSignature({
      publicKeyPem: facts.publicKeyPem,
      algorithm: facts.algorithm,
      signedDigest: digest,
      currentDigest: digest,
      signature: signDigest(digest),
    });
    expect(result.ok).toBe(true);
  });

  it('refuses when the return has changed since it was signed', () => {
    const facts = readCertificate(fixture!.pem);
    const result = verifySubmissionSignature({
      publicKeyPem: facts.publicKeyPem,
      algorithm: facts.algorithm,
      signedDigest: digest,
      currentDigest: submissionDigest(input({ values: [{ fieldKey: 'x', value: '9' }] })),
      signature: signDigest(digest),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('DIGEST_MISMATCH');
  });

  it('refuses a signature made by a different key', () => {
    const other = makeCertificate();
    if (!other) return;
    const facts = readCertificate(fixture!.pem);
    const result = verifySubmissionSignature({
      publicKeyPem: facts.publicKeyPem,
      algorithm: facts.algorithm,
      signedDigest: digest,
      currentDigest: digest,
      signature: signDigest(digest, other.privateKey),
    });
    expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('refuses a signature that is not even well formed', () => {
    const facts = readCertificate(fixture!.pem);
    const result = verifySubmissionSignature({
      publicKeyPem: facts.publicKeyPem,
      algorithm: facts.algorithm,
      signedDigest: digest,
      currentDigest: digest,
      signature: 'not-a-signature',
    });
    expect(result.ok).toBe(false);
  });

  it('refuses when the certificate on file cannot be read', () => {
    const result = verifySubmissionSignature({
      publicKeyPem: 'not a key',
      algorithm: 'RSA-SHA256',
      signedDigest: digest,
      currentDigest: digest,
      signature: signDigest(digest),
    });
    expect(result.reason).toBe('BAD_KEY');
  });
});
