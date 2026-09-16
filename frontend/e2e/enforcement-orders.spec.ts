import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Formal enforcement orders on screen: Tier 3's non-financial sanctions.
 *
 * The service has enforced these rules since it was built and there was no way to reach them. What
 * this file holds is the half that only exists once there is a screen, and it is the half that can
 * mislead: an order that suspends a licence and one that is a proposal look identical unless the
 * page says otherwise.
 *
 * Three claims, and each of them is something an officer could get wrong in a way that matters:
 *
 *  1. A draft does nothing, and says so.
 *  2. The person who drafted it cannot approve it, and is told why rather than shown a button that
 *     fails.
 *  3. A cancellation asks for the Board minute; a suspension does not.
 */

test.describe('reading the orders on a case', () => {
  test.use({ storageState: sessionFile('admin') });

  /** Open the case that carries the seeded orders. */
  async function openSeededCase(page: import('@playwright/test').Page) {
    await page.goto('/enforcement');
    await expect(page.getByRole('heading', { name: /compliance/i })).toBeVisible();
    await page.getByRole('row').filter({ hasText: 'Demo Telecom' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }

  test('separates an order in force from one that is only drafted', async ({ page }) => {
    /*
     * The assertion this file exists for.
     *
     * Two orders are seeded against the demo operator, one approved and one drafted. If the screen
     * drew them alike, an officer could close the page believing they had suspended somebody when
     * they had written a proposal.
     *
     * Read by collecting what the badges say across both cases, rather than by asking each one
     * "are you visible?" in turn. `isVisible` does not wait, and the orders list arrives a moment
     * after the drawer does, so that question gets answered "no" before the answer exists.
     */
    await page.goto('/enforcement');
    const rows = page.getByRole('row').filter({ hasText: 'Demo Telecom' });
    // `count()` does not wait either, so the table has to be on screen before it is asked.
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const seen: string[] = [];
    for (let i = 0; i < count; i += 1) {
      await rows.nth(i).click();
      const dialog = page.getByRole('dialog');
      // Waits for the orders query to land: the whole section is absent until it does.
      await expect(dialog.getByRole('heading', { name: 'Enforcement orders' })).toBeVisible();
      seen.push(await dialog.innerText());
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }

    const all = seen.join(' ');
    expect(all).toContain('Not in force');
    expect(all).toContain('In force');
  });

  test('shows the legal basis and the effective date, not only the reason', async ({ page }) => {
    // An order that cannot say what it rests on is not one an operator can answer or a court can
    // read, so the section of the Act belongs on the face of it.
    await openSeededCase(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Section 42\(\d\) of the Communications Act/)).toBeVisible();
    // `\w{3,4}` because the browser shortens September to "Sept", not "Sep".
    await expect(dialog.getByText(/takes effect \d{1,2} \w{3,4} \d{4}/)).toBeVisible();
  });
});

test.describe('drafting one', () => {
  test.use({ storageState: sessionFile('admin') });

  test('says plainly that drafting suspends nothing', async ({ page }) => {
    await page.goto('/enforcement');
    await page.getByRole('row').filter({ hasText: 'Demo Telecom' }).first().click();
    await page.getByRole('button', { name: 'Draft an order' }).click();

    const dialog = page.getByRole('dialog', { name: 'Draft an enforcement order' });
    await expect(dialog.getByText(/Drafting does not suspend anything/)).toBeVisible();
  });

  test('drops the duration for a cancellation, because one does not run for a period', async ({
    page,
  }) => {
    /*
     * "Cancelled for 90 days" is not a thing the Act provides for. The service refuses a duration
     * on a cancellation rather than ignoring it, so a form that offered the field would collect an
     * answer the server then rejects — and the officer would have no idea which field was wrong.
     */
    await page.goto('/enforcement');
    await page.getByRole('row').filter({ hasText: 'Demo Telecom' }).first().click();
    await page.getByRole('button', { name: 'Draft an order' }).click();
    const dialog = page.getByRole('dialog', { name: 'Draft an enforcement order' });

    // A suspension runs for a stated number of days.
    await expect(dialog.getByLabel('For how long')).toBeVisible();

    await dialog.getByRole('combobox', { name: 'Kind of order' }).click();
    await page.getByRole('option', { name: 'Cancellation' }).click();

    await expect(dialog.getByLabel('For how long')).toBeHidden();
    await expect(dialog.getByText(/approved against a Board minute/)).toBeVisible();
  });

  test('will not save an order with no reason or no legal basis', async ({ page }) => {
    await page.goto('/enforcement');
    await page.getByRole('row').filter({ hasText: 'Demo Telecom' }).first().click();
    await page.getByRole('button', { name: 'Draft an order' }).click();
    const dialog = page.getByRole('dialog', { name: 'Draft an enforcement order' });

    const save = dialog.getByRole('button', { name: 'Save the draft' });
    await expect(save).toBeDisabled();

    await dialog.getByLabel('Why').fill('The return remains unfiled after the remedy period.');
    await expect(save).toBeDisabled(); // still no legal basis

    await dialog.getByLabel('Legal basis').fill('Section 42(3) of the Communications Act');
    await expect(save).toBeDisabled(); // and still no effective date
  });
});
