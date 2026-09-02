import { isIP } from 'net';

/**
 * The network half of Q10: IP allow-listing and mutual TLS.
 *
 * Both are checks a deployment could in principle do for us — a firewall in front, TLS terminated
 * at a proxy — but neither is something to *assume* has been done. A credential that says it is
 * restricted to one address should be restricted to that address whatever the deployment looks
 * like, and the only place that is true for every deployment is here.
 */

/** IPv4 and IPv6 CIDR matching, without a dependency. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

/** An IPv6 address to its 16 bytes, or null when it is not one. */
function ipv6ToBytes(ip: string): Uint8Array | null {
  if (isIP(ip) !== 6) return null;
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (ip.includes('::') ? missing < 0 : headParts.length !== 8) return null;

  const groups = ip.includes('::')
    ? [...headParts, ...Array(missing).fill('0'), ...tailParts]
    : headParts;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const value = parseInt(groups[i] || '0', 16);
    if (Number.isNaN(value)) return null;
    bytes[i * 2] = (value >> 8) & 0xff;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

/**
 * Normalise the address Express reports.
 *
 * Node hands back IPv4 addresses over an IPv6 socket as `::ffff:203.0.113.5`. An operator entering
 * their address in an allow-list will write `203.0.113.5`, and the two must be the same address or
 * the control silently blocks everybody.
 */
export function normaliseIp(ip: string): string {
  const trimmed = (ip ?? '').trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

/** Whether `ip` falls inside `cidr`. A bare address is treated as a single-host range. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const address = normaliseIp(ip);
  const [range, bitsRaw] = cidr.trim().split('/');
  const target = normaliseIp(range);

  const v4 = ipv4ToInt(address);
  const v4Target = ipv4ToInt(target);
  if (v4 !== null && v4Target !== null) {
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;
    const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
    return (v4 & mask) === (v4Target & mask);
  }

  const v6 = ipv6ToBytes(address);
  const v6Target = ipv6ToBytes(target);
  if (v6 && v6Target) {
    const bits = bitsRaw === undefined ? 128 : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 128) return false;
    const fullBytes = Math.floor(bits / 8);
    for (let i = 0; i < fullBytes; i++) if (v6[i] !== v6Target[i]) return false;
    const remaining = bits % 8;
    if (remaining === 0) return true;
    const mask = (0xff << (8 - remaining)) & 0xff;
    return (v6[fullBytes] & mask) === (v6Target[fullBytes] & mask);
  }

  // Two addresses of different families never match, and neither does anything unparseable.
  return false;
}

/**
 * Whether a string is an address or range this module can match against.
 *
 * Validated by its own shape rather than by testing whether it happens to contain some sample
 * address: `198.51.100.0/24` is perfectly well-formed and contains none of the addresses one would
 * think to probe with. Getting that wrong means refusing an operator's real range at the moment
 * they try to lock a credential down, which is precisely when they must not be turned away.
 */
export function isValidCidr(value: string): boolean {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return false;

  const slashes = trimmed.split('/');
  if (slashes.length > 2) return false;
  const [rangeRaw, bitsRaw] = slashes;
  const range = normaliseIp(rangeRaw);

  if (bitsRaw !== undefined) {
    // A prefix length has to be a plain number: "/024" and "/8 " are typos, not ranges.
    if (!/^\d{1,3}$/.test(bitsRaw)) return false;
  }
  const bits = bitsRaw === undefined ? null : Number(bitsRaw);

  if (isIP(range) === 4) return bits === null || (bits >= 0 && bits <= 32);
  if (isIP(range) === 6) return bits === null || (bits >= 0 && bits <= 128);
  return false;
}

/**
 * Whether a caller's address is allowed.
 *
 * An empty list means no restriction. That is a deliberate choice rather than a fail-closed one:
 * an operator's outbound address is often unknown at the moment a credential is issued, and a
 * credential that cannot be used until somebody discovers it is a credential nobody adopts. The
 * screen that issues one says plainly when no restriction is set.
 */
export function ipAllowed(ip: string, allowedCidrs: readonly string[]): boolean {
  if (allowedCidrs.length === 0) return true;
  return allowedCidrs.some((cidr) => ipInCidr(ip, cidr));
}

/**
 * Normalise a certificate fingerprint for comparison.
 *
 * The same fingerprint is written half a dozen ways depending on the tool that printed it —
 * `AB:CD:...`, lower case, with or without a `sha256:` prefix. Comparing them as typed would refuse
 * a correct certificate because somebody pasted from openssl rather than from a browser.
 */
export function normaliseFingerprint(value: string | undefined | null): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^sha-?256[:=]/, '')
    .replace(/[:\s]/g, '');
  return /^[0-9a-f]{64}$/.test(cleaned) ? cleaned : null;
}

/** Whether the certificate presented is the one this credential is bound to. */
export function certificateMatches(
  expected: string | null,
  presented: string | null | undefined,
): boolean {
  const want = normaliseFingerprint(expected);
  // No certificate bound to the credential: mutual TLS is not being required of this client.
  if (want === null) return true;
  const got = normaliseFingerprint(presented);
  return got !== null && got === want;
}
