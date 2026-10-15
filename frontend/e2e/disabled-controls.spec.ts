import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Nothing is greyed out without saying why (FRONTEND_STANDARDS §3.14).
 *
 * The failure this guards against is quiet: a button the user can see, cannot press, and is given
 * no way to understand. It shipped three times here before anyone went looking, because a disabled
 * control looks deliberate.
 */
test.use({ storageState: sessionFile('admin') });
test.setTimeout(240_000);

const ROUTES = [
  '/',
  '/agents',
  '/analytics',
  '/api-credentials',
  '/audit',
  '/benchmarking',
  '/complaints',
  '/documents',
  '/enforcement',
  '/entities',
  '/levy',
  '/network-feeds',
  '/network-map',
  '/notifications',
  '/open-data',
  '/open-data-admin',
  '/profile',
  '/reference-data',
  '/reporting-periods',
  '/scheduled-reports',
  '/signing-certificates',
  '/submissions',
  '/system',
  '/templates',
  '/users',
];

/**
 * Controls whose unavailability is self-evident from where they sit.
 *
 * Pagination arrows are the whole list on purpose. "First page" greyed out while you are looking
 * at page one explains itself, and a tooltip saying so would be noise on every list in the
 * product. Anything else earns its exemption by argument, in a review, not by being added here.
 */
const SELF_EVIDENT = [/^First page$/, /^Previous page$/, /^Next page$/, /^Last page$/];

test('no control is disabled without an explanation', async ({ page }) => {
  const offenders: string[] = [];

  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole('main')).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const unexplained = await page.evaluate(() => {
      const out: { name: string; explained: boolean }[] = [];
      const controls = document.querySelectorAll<HTMLElement>(
        'button[disabled], button[aria-disabled="true"], [role="button"][aria-disabled="true"]',
      );

      for (const el of Array.from(controls)) {
        if (el.offsetParent === null) continue;

        const name = (el.getAttribute('aria-label') || el.textContent || '').trim();

        // Two ways to be explained, both declared rather than inferred.
        //
        // An earlier version looked for an alert "near" the control and counted that. It guessed
        // wrong in both directions: it missed the one real case, where the alert sits outside the
        // control's own `<form>`, and it would have accepted any unrelated status message that
        // happened to share an ancestor. Proximity is not a statement.
        const describedBy = el.getAttribute('aria-describedby');
        const describedText = (describedBy ? describedBy.split(/\s+/) : [])
          .map((id) => document.getElementById(id))
          .filter((node): node is HTMLElement => node !== null && node.offsetParent !== null)
          .map((node) => node.textContent?.trim() ?? '')
          .join(' ')
          .trim();

        // `disabledReason` on Button/IconButton stamps the reason onto the control itself.
        //
        // Reading the tooltip wrapper instead was tried, and it was worthless: every IconButton is
        // wrapped in a tooltip for its *label*, so the wrapper is there whether a reason was given
        // or not. Proved by deleting a reason from UsersPage and watching this spec pass anyway.
        const stamped = (el.getAttribute('data-disabled-reason') ?? '').trim();

        // A submit sitting under a form the user has not filled in yet explains itself: the empty
        // field is right there, above the button, and a tooltip repeating "fill this in" would be
        // noise on every form in the product. Narrow on purpose: it must be a submit, and its own
        // form must actually have a visible empty field in it.
        const form = el.closest('form');
        const awaitingInput =
          el.getAttribute('type') === 'submit' &&
          form !== null &&
          Array.from(
            form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
              'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea',
            ),
          ).some((field) => field.offsetParent !== null && field.value.trim() === '');

        out.push({
          name,
          explained: describedText.length > 0 || stamped.length > 0 || awaitingInput,
        });
      }
      return out;
    });

    for (const { name, explained } of unexplained) {
      if (explained) continue;
      if (SELF_EVIDENT.some((re) => re.test(name))) continue;
      offenders.push(`${route}: "${name}"`);
    }
  }

  expect(offenders, 'disabled controls with no stated reason').toEqual([]);
});
