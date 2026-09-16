import { expect, test } from '@playwright/test';
import { report, scan } from './axe';
import { sessionFile } from './helpers';

/**
 * An administrator resetting somebody else's authenticator app.
 *
 * The screen matters as much as the endpoint here. This is the action support reaches for when a
 * person has lost their phone and their recovery codes — and it is also the shape of an account
 * takeover, so what the screen says before it happens is part of the control. It has to be clear
 * what is about to be done, that the person will find out, and that it is not for casual use.
 */
test.use({ storageState: sessionFile('admin') });

test('is offered on every user except yourself', async ({ page }) => {
  await page.goto('/users');
  await page.waitForLoadState('networkidle');

  const buttons = page.getByRole('button', { name: "Reset this user's authenticator app" });
  await expect(buttons.first()).toBeVisible();

  // Exactly one row is the signed-in administrator, and theirs is disabled: an administrator who
  // could reset their own second factor could shed it from a session already open.
  const disabled = await buttons.evaluateAll(
    (els) => els.filter((el) => (el as HTMLButtonElement).disabled).length,
  );
  expect(disabled).toBe(1);
});

test('says what it will do, and that the person will be told', async ({ page }) => {
  await page.goto('/users');
  await page.waitForLoadState('networkidle');

  // The first enabled one, so this never asks about the administrator's own row.
  const buttons = page.getByRole('button', { name: "Reset this user's authenticator app" });
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    if (await buttons.nth(i).isEnabled()) {
      await buttons.nth(i).click();
      break;
    }
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/lost both their phone and their recovery codes/i);
  await expect(dialog).toContainText(/they will be told that you did this/i);

  // Left without doing it: the test proves the warning, not the reset.
  await dialog.getByRole('button', { name: /cancel/i }).click();
  await expect(dialog).toBeHidden();
});

test('has no accessibility violations, dialog included', async ({ page }) => {
  await page.goto('/users');
  await page.waitForLoadState('networkidle');
  const { violations } = await scan(page);
  expect(violations, report(violations)).toEqual([]);
});
