import { checkFeedUrl, isPubliclyRoutable } from './feed-url';

describe('isPubliclyRoutable', () => {
  it('allows an ordinary public address', () => {
    expect(isPubliclyRoutable('8.8.8.8').ok).toBe(true);
    expect(isPubliclyRoutable('2001:4860:4860::8888').ok).toBe(true);
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private network'],
    ['172.16.0.1', 'private network'],
    ['172.31.255.254', 'private network'],
    ['192.168.1.1', 'private network'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'this host'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
  ])('refuses %s', (address) => {
    expect(isPubliclyRoutable(address).ok).toBe(false);
  });

  it('refuses the cloud metadata address, which is the whole point of the control', () => {
    const result = isPubliclyRoutable('169.254.169.254');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('metadata');
  });

  it('allows the address just outside a blocked range', () => {
    // 172.16.0.0/12 ends at 172.31.255.255.
    expect(isPubliclyRoutable('172.32.0.1').ok).toBe(true);
    expect(isPubliclyRoutable('11.0.0.1').ok).toBe(true);
  });

  it('refuses IPv6 loopback and internal ranges', () => {
    expect(isPubliclyRoutable('::1').ok).toBe(false);
    expect(isPubliclyRoutable('::').ok).toBe(false);
    expect(isPubliclyRoutable('fc00::1').ok).toBe(false);
    expect(isPubliclyRoutable('fd12:3456::1').ok).toBe(false);
    expect(isPubliclyRoutable('fe80::1').ok).toBe(false);
    expect(isPubliclyRoutable('ff02::1').ok).toBe(false);
  });

  it('sees through an IPv4-mapped IPv6 address', () => {
    // The classic bypass: an internal address dressed as IPv6.
    expect(isPubliclyRoutable('::ffff:127.0.0.1').ok).toBe(false);
    expect(isPubliclyRoutable('::ffff:169.254.169.254').ok).toBe(false);
    expect(isPubliclyRoutable('::ffff:8.8.8.8').ok).toBe(true);
  });

  it('refuses something that is not an address at all', () => {
    expect(isPubliclyRoutable('not-an-address').ok).toBe(false);
    expect(isPubliclyRoutable('').ok).toBe(false);
  });
});

describe('checkFeedUrl', () => {
  it('accepts an ordinary https endpoint', () => {
    const result = checkFeedUrl('https://feeds.operator.example/metrics');
    expect(result.ok).toBe(true);
    expect(result.url?.hostname).toBe('feeds.operator.example');
  });

  it('accepts an explicit port 443', () => {
    expect(checkFeedUrl('https://feeds.operator.example:443/metrics').ok).toBe(true);
  });

  it('refuses plain http, which would carry the token in the clear', () => {
    const result = checkFeedUrl('http://feeds.operator.example/metrics');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('https');
  });

  it('refuses credentials smuggled into the address', () => {
    const result = checkFeedUrl('https://user:secret@feeds.operator.example/metrics');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('access token');
  });

  it('refuses a non-standard port', () => {
    expect(checkFeedUrl('https://feeds.operator.example:8443/metrics').ok).toBe(false);
    // The classic reach for something internal on the same host.
    expect(checkFeedUrl('https://feeds.operator.example:22/metrics').ok).toBe(false);
  });

  it('refuses a literal internal address', () => {
    expect(checkFeedUrl('https://127.0.0.1/metrics').ok).toBe(false);
    expect(checkFeedUrl('https://10.0.0.5/metrics').ok).toBe(false);
    expect(checkFeedUrl('https://169.254.169.254/latest/meta-data/').ok).toBe(false);
  });

  it('refuses a bracketed internal IPv6 host', () => {
    expect(checkFeedUrl('https://[::1]/metrics').ok).toBe(false);
    expect(checkFeedUrl('https://[fd00::1]/metrics').ok).toBe(false);
  });

  it('refuses localhost by name', () => {
    expect(checkFeedUrl('https://localhost/metrics').ok).toBe(false);
    expect(checkFeedUrl('https://api.localhost/metrics').ok).toBe(false);
  });

  it('refuses something that is not a URL', () => {
    expect(checkFeedUrl('not a url').ok).toBe(false);
    expect(checkFeedUrl('').ok).toBe(false);
  });

  it('refuses other schemes that a naive check would let through', () => {
    expect(checkFeedUrl('file:///etc/passwd').ok).toBe(false);
    expect(checkFeedUrl('ftp://feeds.operator.example/metrics').ok).toBe(false);
    expect(checkFeedUrl('gopher://feeds.operator.example/').ok).toBe(false);
  });

  it('allows a public literal address, since the rule is about internal ones', () => {
    expect(checkFeedUrl('https://8.8.8.8/metrics').ok).toBe(true);
  });
});
