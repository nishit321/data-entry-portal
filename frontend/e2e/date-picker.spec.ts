import { expect, test, type Locator, type Page } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * The calendar itself, opened.
 *
 * Every other sweep in this suite measures a page, and a date picker's panel is not on the page
 * until someone clicks it. That is how it kept a real defect for as long as it did: the only way
 * to reach a date in an earlier year was to press the month arrow once per month, which put a
 * licence issued in 2015 about a hundred and thirty clicks from today.
 */
test.use({ storageState: sessionFile('admin') });

/** Open the reporting-period dialog, which carries three date fields. */
async function openCalendar(page: Page): Promise<Locator> {
  await page.goto('/reporting-periods');
  const trigger = page.getByRole('button', { name: /^Open a period$/i });
  await trigger.waitFor({ state: 'visible', timeout: 10_000 });
  await trigger.click();

  const dialog = page.locator('[role="dialog"]').filter({ visible: true }).first();
  await expect(dialog).toBeVisible();

  // By `aria-haspopup`, not by the `dd/mm/yyyy` the trigger displays: the field is labelled, so
  // its accessible name is the label ("Starts on"), and matching on the visible placeholder finds
  // nothing at all.
  await dialog.locator('button[aria-haspopup="dialog"]').first().click();
  const calendar = page.getByRole('dialog', { name: /Choose a date|Choose date/i });
  await expect(calendar).toBeVisible();
  return calendar;
}

test('a year is reachable in one step, in both directions', async ({ page }) => {
  const calendar = await openCalendar(page);
  const heading = calendar.locator('[aria-live="polite"]').first();

  const read = async () => {
    const text = (await heading.textContent())?.trim() ?? '';
    const [month, year] = text.split(/\s+/);
    return { month: month ?? '', year: Number(year) };
  };

  const start = await read();

  await calendar.getByRole('button', { name: 'Previous year' }).click();
  const back = await read();
  expect(back.year, 'previous year moves the view back one year').toBe(start.year - 1);
  expect(back.month, 'and leaves the month alone').toBe(start.month);

  await calendar.getByRole('button', { name: 'Next year' }).click();
  await calendar.getByRole('button', { name: 'Next year' }).click();
  const forward = await read();
  expect(forward.year).toBe(start.year + 1);
  expect(forward.month).toBe(start.month);
});

test('shift with page up and page down moves a year from the keyboard', async ({ page }) => {
  const calendar = await openCalendar(page);
  const heading = calendar.locator('[aria-live="polite"]').first();
  const year = async () => Number(((await heading.textContent()) ?? '').trim().split(/\s+/)[1]);

  const start = await year();
  // Focus is already on a day cell when the calendar opens.
  await page.keyboard.press('Shift+PageUp');
  expect(await year()).toBe(start - 1);
  await page.keyboard.press('Shift+PageDown');
  expect(await year()).toBe(start);
});

test('today is one click away and fills the field', async ({ page }) => {
  const calendar = await openCalendar(page);
  const dialog = page.locator('[role="dialog"]').filter({ visible: true }).first();
  const field = dialog.locator('button[aria-haspopup="dialog"]').first();

  // Wander off first, so the shortcut has something to undo.
  await calendar.getByRole('button', { name: 'Previous year' }).click();
  await calendar.getByRole('button', { name: 'Today' }).click();

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');

  // The field is labelled, so its accessible name is the label. What changed is the text it shows.
  await expect(field).toHaveText(`${dd}/${mm}/${now.getFullYear()}`);
});

test('the calendar panel stays inside the viewport', async ({ page }) => {
  const calendar = await openCalendar(page);
  const box = await calendar.boundingBox();
  const size = page.viewportSize();
  expect(box).not.toBeNull();
  expect(size).not.toBeNull();

  expect(box!.x, 'not cut off on the left').toBeGreaterThanOrEqual(0);
  expect(box!.y, 'not cut off at the top').toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, 'not cut off on the right').toBeLessThanOrEqual(size!.width);
  expect(box!.y + box!.height, 'not cut off at the bottom').toBeLessThanOrEqual(size!.height);
});

test('the header controls sit on one line with the month and year', async ({ page }) => {
  const calendar = await openCalendar(page);
  const names = ['Previous year', 'Previous month', 'Next month', 'Next year'];

  const centres: number[] = [];
  for (const name of names) {
    const box = await calendar.getByRole('button', { name }).boundingBox();
    expect(box, `${name} is present`).not.toBeNull();
    centres.push(box!.y + box!.height / 2);
  }
  const label = await calendar.locator('[aria-live="polite"]').first().boundingBox();
  centres.push(label!.y + label!.height / 2);

  const drift = Math.max(...centres) - Math.min(...centres);
  expect(drift, 'calendar header is one row').toBeLessThanOrEqual(1);
});
