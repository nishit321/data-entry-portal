import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests (FRONTEND_STANDARDS §6, §7).
 *
 * Everything else in `frontend/` runs in jsdom, which is not a browser: it has no layout engine,
 * no cascade, and no network. That was not a theoretical limitation. The accessibility harness
 * reported twenty-three passing tests while checking an empty document, because a component that
 * measures its own position closed itself the instant it opened. A real browser would have caught
 * that in one run.
 *
 * So these cover exactly what jsdom cannot answer:
 *
 *  - colour contrast as painted, rather than as computed from the palette
 *  - reflow at 320px and at 400% zoom (WCAG 1.4.10), which needs a real viewport
 *  - the operator's journey end to end, through the real API
 *  - what the first load actually costs on a slow connection
 *
 * **The production build is what gets tested**, not the dev server. The bundle the operator
 * downloads is the thing under question in §7, and a dev build answers a different question.
 */

/**
 * Its own database, deliberately. These tests sign in and file a return, so they write. Pointing
 * them at the development database would mean a test run quietly editing the data someone was
 * demonstrating with; pointing them at the Jest e2e database would mean two suites racing for the
 * same rows. A separate one costs a few seconds at startup and removes both problems.
 */
const UI_TEST_DB =
  process.env.UI_TEST_DATABASE_URL ??
  'postgresql://postgres:root@localhost:5432/nca_portal_uitest?schema=public';

const API_PORT = 4100;
const WEB_PORT = 4173;

export const API_URL = `http://localhost:${API_PORT}/api/v1`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // These share one database and one server, so they run in order rather than racing each other.
  workers: 1,
  fullyParallel: false,
  // A failure here is usually a real one; a retry would only hide a flake worth knowing about.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],

  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Signs in once per role and parks the session; everything else starts already signed in.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      // Reset, seed, then run. Chained into the server command rather than done in a
      // `globalSetup`, because Playwright starts the web servers *first* — a setup hook would be
      // reaching for a database the backend had already failed to connect to.
      //
      // A full reset, not just a migrate: this suite files a return, so on a second run the
      // period it wants would already be taken and the test would fail for a reason that has
      // nothing to do with the product. Deterministic beats fast. Safe because the database is
      // this suite's own — nothing else points at it.
      //
      // `nest start` compiles, so there is no separate build step to forget.
      command:
        'npx prisma migrate reset --force --skip-seed && npm run prisma:seed && npm run start',
      cwd: '../backend',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL: UI_TEST_DB,
        // The provisioning script reads this one; the app and the seed read DATABASE_URL.
        TEST_DATABASE_URL: UI_TEST_DB,
        PORT: String(API_PORT),
        // Not production: the seeded accounts and the static OTP are what make an automated
        // sign-in possible at all.
        NODE_ENV: 'development',
        CORS_ORIGIN: WEB_URL,
      },
    },
    {
      command: `npm run build && npx vite preview --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_API_URL: API_URL },
    },
  ],
});
