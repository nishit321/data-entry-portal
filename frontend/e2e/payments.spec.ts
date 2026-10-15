import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Payments, on screen (NCA, October 2026: "amounts paid, outstanding balances, and payment
 * rates").
 *
 * The rules about who may record and reverse money, and what the database refuses, are held by
 * the API suite. What is measured here is the half those cannot see: that an officer can find the
 * charge, record what the bank statement says, and get a receipt; and that an operator sees its own
 * money and nothing it could use to enter any.
 *
 * The demonstration seed puts a few payments on the demo operator, including one reversed, so the
 * screen has something on it before this test adds anything.
 */

test.describe('an Authority administrator', () => {
  test.use({ storageState: sessionFile('admin') });

  test('sees what is owed, what has arrived, and the rate', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.getByRole('heading', { name: 'Payments', level: 2 })).toBeVisible();
    for (const label of ['Due', 'Received', 'Outstanding', 'Payment rate']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    // The table by operator, which only the Authority gets.
    await expect(page.getByRole('heading', { name: 'By operator' })).toBeVisible();
  });

  test('keeps a reversed payment on the list, marked as reversed', async ({ page }) => {
    // One recorded in error is reversed, not removed. The seed has one.
    await page.goto('/payments');
    const payments = page.getByRole('group', { name: 'Payments' });
    await expect(payments.getByText('Reversed').first()).toBeVisible();
  });

  test('records a payment against a charge and issues a receipt', async ({ page }) => {
    await page.goto('/payments');
    const record = page.getByRole('button', { name: /^Record a payment for Demo Telecom/ }).first();
    await expect(record).toBeVisible();
    await record.click();

    const dialog = page.getByRole('dialog', { name: 'Record a payment' });
    await expect(dialog).toBeVisible();
    // The amount starts at what is outstanding, which is what an operator usually sends.
    await expect(dialog.getByLabel('Amount received (SSP)')).not.toHaveValue('');

    // A reference unique to this run: the same transfer typed twice is refused, by design.
    await dialog.getByLabel('Bank reference').fill(`FT-BROWSER-${Date.now()}`);
    await dialog.getByRole('button', { name: 'Record and issue a receipt' }).click();

    await expect(page.getByText(/^Receipt NCA\/RCT\/\d{4}\/\d{6} issued\.$/)).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  test('will not let an officer reverse a payment they recorded themselves', async ({ page }) => {
    /*
     * The seed's reversed payment was recorded by the administrator and reversed by the
     * supervisor. The one this suite just recorded is the administrator's own, so its reverse
     * button is there but disabled, and says why rather than leaving the officer to guess.
     */
    await page.goto('/payments');
    // An explained disabled control keeps its focus and uses aria-disabled, so it can still be
    // reached and its reason heard.
    await expect(
      page.locator('button[aria-label^="Reverse receipt"][aria-disabled="true"]').first(),
    ).toBeVisible();
  });

  test('hands over the receipt as a PDF', async ({ page }) => {
    await page.goto('/payments');
    const download = page.waitForEvent('download');
    await page
      .getByRole('button', { name: /^Download receipt NCA\/RCT\// })
      .first()
      .click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^receipt-NCA-RCT-\d{4}-\d{6}\.pdf$/);
  });
});

test.describe('an operator', () => {
  test.use({ storageState: sessionFile('operator') });

  test('sees its own balance and receipts, and nothing to enter money with', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.getByRole('heading', { name: 'Payments', level: 2 })).toBeVisible();
    await expect(page.getByText('Outstanding', { exact: true }).first()).toBeVisible();

    // No recording, no reversing, and no table of other operators.
    await expect(page.getByRole('button', { name: /^Record a payment/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Reverse receipt/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'By operator' })).toHaveCount(0);

    // Its own receipts are there to download.
    await expect(page.getByRole('button', { name: /^Download receipt/ }).first()).toBeVisible();
  });
});
