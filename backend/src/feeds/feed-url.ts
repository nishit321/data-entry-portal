import { isIP } from 'net';

/**
 * Deciding whether NCA's server may call a URL an operator supplied (Q10, Phase 3).
 *
 * This is the sharpest edge in the whole feed feature. The portal sits inside NCA's network and is
 * about to make an outbound request to an address somebody else chose. Without a check, "fetch this
 * URL for me" is a request to probe NCA's own internal network from the inside — the database, the
 * metadata service, the admin interfaces on the same subnet — and to report back what it finds.
 *
 * The rules are therefore deliberately strict, and each is a class of attack rather than a
 * preference:
 *
 * - **HTTPS only.** A feed carries an operator's traffic figures across the public internet, and
 *   `http://` would carry a bearer token with them.
 * - **No credentials in the URL.** `https://user:pass@host` is a way of smuggling a secret past a
 *   review that only looks at the host.
 * - **No literal private, loopback, link-local or reserved address.** This is the direct form of
 *   the attack.
 * - **Standard ports only.** A feed lives on 443. Anything else is reaching for something that is
 *   not a public API.
 *
 * What this module cannot do on its own is stop a hostname that *resolves* to a private address —
 * DNS is not consulted here. The caller resolves the host and passes every address back through
 * `isPubliclyRoutable` before connecting, and again on each redirect, which is where a rebinding
 * attack would otherwise land.
 */

/** Ranges no outbound feed may reach. Each entry is a real class of internal target. */
const BLOCKED_V4: ReadonlyArray<{ cidr: string; why: string }> = [
  { cidr: '0.0.0.0/8', why: 'this host' },
  { cidr: '10.0.0.0/8', why: 'private network' },
  { cidr: '100.64.0.0/10', why: 'carrier-grade NAT' },
  { cidr: '127.0.0.0/8', why: 'loopback' },
  { cidr: '169.254.0.0/16', why: 'link-local, including cloud metadata services' },
  { cidr: '172.16.0.0/12', why: 'private network' },
  { cidr: '192.0.0.0/24', why: 'reserved' },
  { cidr: '192.0.2.0/24', why: 'documentation range' },
  { cidr: '192.168.0.0/16', why: 'private network' },
  { cidr: '198.18.0.0/15', why: 'benchmarking range' },
  { cidr: '198.51.100.0/24', why: 'documentation range' },
  { cidr: '203.0.113.0/24', why: 'documentation range' },
  { cidr: '224.0.0.0/4', why: 'multicast' },
  { cidr: '240.0.0.0/4', why: 'reserved' },
];

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

function inV4Range(ip: number, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const target = ipv4ToInt(range);
  if (target === null) return false;
  const bits = Number(bitsRaw);
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (target & mask);
}

export interface RoutableResult {
  ok: boolean;
  /** Why it was refused, in words that go in front of an administrator. */
  reason?: string;
}

/**
 * Whether a resolved address is one the portal may connect out to.
 *
 * Called on every address a hostname resolves to, and again after any redirect. Checking the
 * hostname alone would miss the ordinary case where `feeds.operator.example` has an A record
 * pointing at `10.0.0.5`.
 */
export function isPubliclyRoutable(address: string): RoutableResult {
  const family = isIP(address);
  if (family === 0) return { ok: false, reason: 'That is not an address we can reach.' };

  if (family === 4) {
    const value = ipv4ToInt(address);
    if (value === null) return { ok: false, reason: 'That is not an address we can reach.' };
    const blocked = BLOCKED_V4.find((range) => inV4Range(value, range.cidr));
    return blocked
      ? { ok: false, reason: `That address is on an internal network (${blocked.why}).` }
      : { ok: true };
  }

  const lower = address.toLowerCase();
  // An IPv4-mapped IPv6 address is an IPv4 address wearing a hat; judge it as one.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPubliclyRoutable(mapped[1]);

  if (lower === '::' || lower === '::1') {
    return { ok: false, reason: 'That address is on an internal network (loopback).' };
  }
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
  if (/^f[cd]/.test(lower)) {
    return { ok: false, reason: 'That address is on an internal network (unique local).' };
  }
  if (/^fe[89ab]/.test(lower)) {
    return { ok: false, reason: 'That address is on an internal network (link-local).' };
  }
  if (/^ff/.test(lower)) {
    return { ok: false, reason: 'That address is a multicast address.' };
  }
  return { ok: true };
}

export interface FeedUrlResult {
  ok: boolean;
  reason?: string;
  /** The parsed URL, when it passed. */
  url?: URL;
}

/**
 * Whether a feed URL is one the portal is willing to call, judged on the URL alone.
 *
 * Resolution is the caller's job — see `isPubliclyRoutable`. This is the first gate, and it is the
 * one that runs when an administrator saves the feed, so an obviously wrong address is refused
 * while somebody is looking at the screen rather than at three in the morning.
 */
export function checkFeedUrl(raw: string): FeedUrlResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'That is not a valid web address.' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'A feed address must start with https, so the data is encrypted.' };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'Do not put a username or password in the address. Use the access token field.',
    };
  }
  if (url.port && url.port !== '443') {
    return { ok: false, reason: 'A feed address must use the standard HTTPS port.' };
  }

  // A bare address as the host is the direct form of the attack, and is caught here rather than
  // waiting for resolution.
  if (isIP(url.hostname) !== 0) {
    const routable = isPubliclyRoutable(url.hostname);
    if (!routable.ok) return { ok: false, reason: routable.reason };
  }
  // Bracketed IPv6 hosts arrive with the brackets still attached.
  const unbracketed = url.hostname.replace(/^\[|\]$/g, '');
  if (unbracketed !== url.hostname && isIP(unbracketed) !== 0) {
    const routable = isPubliclyRoutable(unbracketed);
    if (!routable.ok) return { ok: false, reason: routable.reason };
  }

  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    return { ok: false, reason: 'That address is on an internal network (loopback).' };
  }

  return { ok: true, url };
}
