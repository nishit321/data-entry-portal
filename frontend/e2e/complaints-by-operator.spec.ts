import { expect, test, type APIRequestContext } from '@playwright/test';
import { ACCOUNTS, sessionFile } from './helpers';
import { API_URL } from '../playwright.config';

/**
 * Complaints per operator, on screen (NCA, October 2026).
 *
 * The API suite holds who may see what and what the public is never shown. What is measured here
 * is that the Authority can get from the case list to the figures and back to one operator's cases,
 * and that the public page grows a section only when an administrator has decided it should.
 */

/**
 * A token for the switch, so this file can turn publication on and, without fail, off again.
 *
 * Fetched once and kept. Signing in is limited to five attempts a minute, and that limit is live in
 * this suite; a first version signed in for every switch and was refused by the fourth.
 */
let cachedToken: string | null = null;
async function adminToken(request: APIRequestContext): Promise<string> {
  if (cachedToken) return cachedToken;
  const login = await request.post(`${API_URL}/auth/login`, {
    data: { email: ACCOUNTS.admin.email, password: ACCOUNTS.admin.password },
  });
  const first = (await login.json()) as { accessToken?: string; challengeId?: string };
  if (first.accessToken) {
    cachedToken = first.accessToken;
    return cachedToken;
  }
  const verified = await request.post(`${API_URL}/auth/verify-otp`, {
    data: { challengeId: first.challengeId, code: '123456' },
  });
  cachedToken = ((await verified.json()) as { accessToken: string }).accessToken;
  return cachedToken;
}

async function setPublication(request: APIRequestContext, on: boolean) {
  const token = await adminToken(request);
  const res = await request.patch(`${API_URL}/settings/public.complaintsByOperator`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { value: on },
  });
  expect(res.ok()).toBe(true);
}

test.describe('the Authority', () => {
  test.use({ storageState: sessionFile('admin') });

  test('goes from the case list to the figures by operator', async ({ page }) => {
    await page.goto('/complaints');
    await page.getByRole('link', { name: 'By operator' }).click();
    await expect(page).toHaveURL(/\/complaints\/by-operator$/);
    await expect(page.getByRole('heading', { name: 'Complaints by operator' })).toBeVisible();

    /*
     * The demonstration seed files twelve complaints about the demo operator. At least twelve,
     * not exactly: the suite shares one database, and complaint-attachments.spec files one more
     * about the same operator before this runs. The exact arithmetic is the API suite's job.
     */
    const row = page.getByRole('row').filter({ hasText: 'Demo Telecom' }).first();
    await expect(row).toBeVisible();
    const received = Number(await row.locator('td').nth(1).innerText());
    expect(received).toBeGreaterThanOrEqual(12);

    // And back again, to that operator's own cases.
    await row.click();
    await expect(page).toHaveURL(/\/complaints\?aboutEntityId=/);
  });

  test('keeps the complaints that named nobody, on a line of their own', async ({ page }) => {
    await page.goto('/complaints/by-operator');
    await expect(page.getByText('Operator not named')).toBeVisible();
  });

  test('can look further back, or less far', async ({ page }) => {
    await page.goto('/complaints/by-operator');
    await page.getByRole('combobox', { name: 'How far back to count' }).click();
    await page.getByRole('option', { name: 'Last 3 months' }).click();
    await expect(page.getByRole('combobox', { name: 'How far back to count' })).toContainText(
      'Last 3 months',
    );
  });
});

test.describe('the public page', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Whatever happens in a test, publication ends this file switched off, as the portal ships.
  test.afterEach(async ({ request }) => {
    await setPublication(request, false);
  });

  test('shows sector totals only, until the Authority publishes', async ({ page }) => {
    await page.goto('/open-data');
    await expect(page.getByRole('heading', { name: 'Citizen reports' })).toBeVisible();
    // The summary is there; the section per operator is not.
    await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By operator' })).toHaveCount(0);
  });

  test('grows a section per operator once an administrator turns it on', async ({
    page,
    request,
  }) => {
    await setPublication(request, true);
    await page.goto('/open-data');
    await expect(page.getByRole('heading', { name: 'By operator' })).toBeVisible();
    // And says how to read it, because a total on its own would be read as a league table.
    await expect(page.getByText(/compare how many reach an end and how quickly/)).toBeVisible();
  });
});
