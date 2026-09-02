import { expect, test } from '@playwright/test';

/**
 * What the first load actually costs (FRONTEND_STANDARDS §7).
 *
 * §7 opens with "the app must stay responsive for users on intermittent, low-bandwidth
 * connections", and the frontend audit names the "low-bandwidth audience" three times. None of it
 * had ever been measured. A budget nobody measures is a wish.
 *
 * So: a cold load of the sign-in page — no cache, no session — over a throttled connection, in
 * the production build. The numbers are printed on every run, because the point is to know them,
 * and the assertions are ceilings with headroom rather than targets: they exist to catch the day
 * somebody imports a charting library into the shell, not to police a few kilobytes.
 */

/**
 * Roughly a good 3G link, which is a fair stand-in for the connection this portal is built for.
 * Chrome's own "Slow 3G" preset is 400kbps down with 2s of latency; this is the "Fast 3G" one.
 */
const THROTTLE = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8, // 1.6 Mbps
  uploadThroughput: (750 * 1024) / 8, // 750 kbps
  latency: 150, // ms round trip
};

/** Ceilings, not targets. Generous on purpose — a regression, not a rounding, should trip these. */
const BUDGET = {
  // Measured at 255 kB and 1.6s on 2026-08-30. Roughly half again, so an ordinary change never
  // trips it and a new dependency in the shell does.
  transferredKb: 400,
  interactiveSeconds: 6,
};

test('the sign-in page loads on a slow connection', async ({ page, context }) => {
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', THROTTLE);
  // A first visit: nothing cached, which is the load that decides whether someone stays.
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });

  const started = Date.now();
  await page.goto('/login', { waitUntil: 'commit' });
  // Usable, not merely painted: the form is on screen and can be typed into.
  await page.getByLabel('Email').waitFor({ state: 'visible' });
  const interactive = (Date.now() - started) / 1000;

  await page.waitForLoadState('networkidle');

  /*
   * Measured from the Resource Timing API, not from `content-length`.
   *
   * The first version of this counted response headers and reported 95 kB with "js 0kB" — which
   * would have been a lovely number and a false one. The server sends the bundle with chunked
   * encoding and no `content-length`, so the only thing being counted was the fonts. `transferSize`
   * is what actually crossed the wire, compression included.
   */
  const { bytes, byType } = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation') as PerformanceResourceTiming[];
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const all = [...nav, ...res];
    const groups: Record<string, number> = {};
    for (const entry of all) {
      const kind = new URL(entry.name).pathname.split('.').pop() ?? 'document';
      groups[kind] = (groups[kind] ?? 0) + entry.transferSize;
    }
    return {
      bytes: all.reduce((sum, e) => sum + e.transferSize, 0),
      byType: groups,
    };
  });

  const kb = Math.round(bytes / 1024);
  const breakdown = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([kind, size]) => `${kind} ${Math.round(size / 1024)}kB`)
    .join(', ');

  // eslint-disable-next-line no-console -- printing the numbers is the point of this test
  console.log(
    `\n  First load, cold, on a 1.6 Mbps link with 150ms latency:\n` +
      `    usable after   ${interactive.toFixed(1)}s\n` +
      `    transferred    ${kb} kB\n` +
      `    largest        ${breakdown}\n`,
  );

  expect(kb, `first load transferred ${kb} kB — ${breakdown}`).toBeLessThan(BUDGET.transferredKb);
  expect(
    interactive,
    `the sign-in form took ${interactive.toFixed(1)}s to become usable`,
  ).toBeLessThan(BUDGET.interactiveSeconds);
});

test('the map is not part of the first load', async ({ page }) => {
  // Leaflet plus its tiles is the largest thing in the product. §7 requires it to be split out,
  // so that an operator who never opens the map never pays for it.
  const chunks: string[] = [];
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.endsWith('.js')) chunks.push(path);
  });

  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  const map = chunks.filter((c) => /map|leaflet/i.test(c));
  expect(map, `the map came down with the sign-in page: ${map.join(', ')}`).toEqual([]);
});
