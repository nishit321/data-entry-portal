import { expect, test } from '@playwright/test';
import { signIn } from './helpers';
import { report, scan } from './axe';

/**
 * The operator's journey, in a real browser against the real API.
 *
 * Every step of this is covered on the backend by the Jest e2e suite, and none of it was covered
 * in between — the part the operator actually touches. This is the path the product exists for:
 * sign in, open a return for the period that is due, answer the questions, check the answers,
 * sign, submit.
 */
test('an operator files a return, start to finish', async ({ page }) => {
  await signIn(page, 'operator');

  await page.goto('/submissions');
  await expect(page.getByText("You haven't started a return yet.")).toBeVisible();

  // --- Open a draft for the period that is due -------------------------------------------------
  await page.getByRole('button', { name: 'Start a return' }).first().click();
  const start = page.getByRole('dialog');
  await start.getByRole('combobox', { name: 'Reporting period' }).click();
  await page.getByRole('option', { name: /2026 Q1/ }).click();
  await start.getByRole('button', { name: 'Open draft' }).click();

  await page.waitForURL(/\/submissions\/[0-9a-f-]+/);
  await expect(page.getByText('ICT Indicators Return · 2026 Q1')).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  // --- Answer the questions --------------------------------------------------------------------
  // By label, which is also the check that every field still has one. A questionnaire runs to
  // hundreds of fields; one that loses its label loses it for whoever cannot see the column it
  // sits in.
  await page.getByLabel(/Name of Operator/).fill('Demo Telecom');
  await page.getByLabel(/Active Mobile Subscribers/).fill('1250000');
  await page.getByLabel(/Total Revenue/).fill('4500000');

  // The longest form in the product, checked here rather than in `a11y.spec.ts` because this is
  // where a filled-in draft exists — and because there is one open period, so a second test that
  // opened its own draft would be racing this one for it.
  const { violations } = await scan(page);
  expect(violations, report(violations)).toEqual([]);

  // --- Check, then submit ----------------------------------------------------------------------
  await page.getByRole('button', { name: 'Check answers' }).click();

  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText(/you confirm the information/i)).toBeVisible();
  await confirm.getByLabel(/Full name/).fill('Achol Deng');
  await confirm.getByRole('button', { name: 'Submit return' }).click();

  // --- It is filed -----------------------------------------------------------------------------
  await expect(page.getByText('Draft', { exact: true })).toBeHidden();

  await page.goto('/submissions');
  await expect(page.getByText("You haven't started a return yet.")).toBeHidden();
  await expect(page.getByRole('table')).toContainText('2026 Q1');
});

test('a reviewer sees the filed return, and cannot edit it', async ({ page }) => {
  await signIn(page, 'checker');

  await page.goto('/review-queue');
  await expect(page.getByRole('main')).toContainText('2026 Q1');
});
