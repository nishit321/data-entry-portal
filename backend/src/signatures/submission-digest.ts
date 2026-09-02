import { createHash, createPublicKey, createVerify, X509Certificate } from 'crypto';

/**
 * Certificate-based signatures over a filed return (Q6, Phase 3).
 *
 * Q6 asked for a simple electronic signature first, designed so it could be upgraded to a
 * certificate-based one later. This is that upgrade, and it is additive: the simple signature is
 * still recorded, and a return signed with a certificate carries both.
 *
 * The whole value of a PKI signature is that it can be checked again, by someone else, years
 * afterwards, without trusting this portal. That imposes one requirement above all others: the
 * thing that was signed has to be reproducible from the stored return alone. So the digest below
 * is defined in exact, boring terms — a canonical form with no room for two implementations to
 * disagree about ordering, spacing or number formatting. If an operator's own system computes this
 * digest differently, the signature fails, and it should.
 */

/** One answer, as it enters the digest. */
export interface DigestValue {
  fieldKey: string;
  /** The stored text, exactly as filed. Not re-parsed or re-formatted. */
  value: string;
}

export interface DigestInput {
  entityId: string;
  periodId: string;
  templateId: string;
  version: number;
  values: DigestValue[];
}

/** The version of the canonical form. Stored with the signature so a later change stays checkable. */
export const DIGEST_VERSION = 'nca-sig-1';

/**
 * The exact string a return's signature is taken over.
 *
 * Rules, all of which exist because two systems must agree byte for byte:
 *
 * - Fields are sorted by key, so the order they were filled in cannot change the digest.
 * - Values are used as stored, never re-parsed. `1.50` and `1.5` are different answers to a
 *   regulator and must be different to the digest.
 * - Unanswered questions are left out entirely rather than included as empty, so adding a question
 *   nobody answers does not invalidate signatures already made.
 * - Newline-separated with a leading header, so the string is readable when someone is debugging a
 *   mismatch at two in the morning.
 */
export function canonicalForm(input: DigestInput): string {
  const header = [
    DIGEST_VERSION,
    input.entityId,
    input.periodId,
    input.templateId,
    String(input.version),
  ].join('|');

  const lines = input.values
    .filter((v) => v.value !== null && v.value !== undefined && v.value !== '')
    .map((v) => `${v.fieldKey}=${v.value}`)
    .sort();

  return [header, ...lines].join('\n');
}

/** SHA-256 of the canonical form, lower-case hex. This is what gets signed. */
export function submissionDigest(input: DigestInput): string {
  return createHash('sha256').update(canonicalForm(input), 'utf8').digest('hex');
}

export type SignatureAlgorithm = 'RSA-SHA256' | 'ECDSA-SHA256';

/** What the algorithms map to in Node's verifier. */
const VERIFIER: Record<SignatureAlgorithm, string> = {
  'RSA-SHA256': 'RSA-SHA256',
  'ECDSA-SHA256': 'SHA256',
};

export interface CertificateFacts {
  subject: string;
  issuer: string;
  /** SHA-256 of the DER bytes, lower-case hex. The stable identity of this certificate. */
  fingerprint: string;
  publicKeyPem: string;
  algorithm: SignatureAlgorithm;
  notBefore: Date;
  notAfter: Date;
  /** True when the certificate signed itself, which NCA may or may not accept as policy. */
  selfSigned: boolean;
}

export class CertificateError extends Error {}

/**
 * Read a PEM certificate into the facts the portal stores about it.
 *
 * Throws rather than returning null: every failure here is something a person has to fix, and a
 * message naming the problem is worth more than a boolean.
 */
export function readCertificate(pem: string): CertificateFacts {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    throw new CertificateError(
      'That does not look like a certificate. Paste the PEM text, beginning with BEGIN CERTIFICATE.',
    );
  }

  const publicKey = cert.publicKey;
  const type = publicKey.asymmetricKeyType;
  let algorithm: SignatureAlgorithm;
  if (type === 'rsa' || type === 'rsa-pss') {
    const bits = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
    // Below 2048 an RSA key is not a control, it is a formality.
    if (bits < 2048) {
      throw new CertificateError('This certificate uses an RSA key shorter than 2048 bits.');
    }
    algorithm = 'RSA-SHA256';
  } else if (type === 'ec') {
    algorithm = 'ECDSA-SHA256';
  } else {
    throw new CertificateError(
      `This certificate uses a key type the portal cannot verify (${type ?? 'unknown'}).`,
    );
  }

  return {
    subject: cert.subject,
    issuer: cert.issuer,
    fingerprint: createHash('sha256').update(cert.raw).digest('hex'),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    algorithm,
    notBefore: new Date(cert.validFrom),
    notAfter: new Date(cert.validTo),
    selfSigned: cert.subject === cert.issuer,
  };
}

export type VerificationFailure = 'BAD_KEY' | 'BAD_SIGNATURE' | 'DIGEST_MISMATCH' | 'MALFORMED';

export interface VerificationResult {
  ok: boolean;
  reason?: VerificationFailure;
}

/**
 * Check a signature over a digest.
 *
 * The digest is compared *and* the signature verified. Checking only the signature would prove
 * somebody signed something; checking only the digest would prove the content is unchanged. A
 * regulator needs both: this content, signed by this key.
 */
export function verifySubmissionSignature(params: {
  publicKeyPem: string;
  algorithm: SignatureAlgorithm;
  /** The digest recorded against the return when it was signed. */
  signedDigest: string;
  /** The digest recomputed from the return as it stands now. */
  currentDigest: string;
  /** The signature, base64. */
  signature: string;
}): VerificationResult {
  if (params.signedDigest !== params.currentDigest) {
    return { ok: false, reason: 'DIGEST_MISMATCH' };
  }

  let key;
  try {
    key = createPublicKey(params.publicKeyPem);
  } catch {
    return { ok: false, reason: 'BAD_KEY' };
  }

  try {
    const verifier = createVerify(VERIFIER[params.algorithm]);
    verifier.update(params.signedDigest, 'utf8');
    verifier.end();
    const ok = verifier.verify(key, Buffer.from(params.signature, 'base64'));
    return ok ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
  } catch {
    // A signature that is not even well-formed base64, or the wrong length for the key.
    return { ok: false, reason: 'MALFORMED' };
  }
}

export const VERIFICATION_MESSAGES: Record<VerificationFailure, string> = {
  BAD_KEY: 'The certificate on file could not be read.',
  BAD_SIGNATURE: 'The signature does not match the certificate it was signed with.',
  DIGEST_MISMATCH: 'This return has changed since it was signed.',
  MALFORMED: 'The signature is not in a form we can check.',
};
