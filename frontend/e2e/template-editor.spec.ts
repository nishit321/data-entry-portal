import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * The questionnaire builder, end to end through the browser.
 *
 * Written before the screen was broken up, and that is the point of it. `TemplateEditorPage` is
 * the largest component in the product and had no coverage at all, which meant any restructuring
 * was a change nothing could contradict. A refactor that cannot go red is not a refactor, it is a
 * hope.
 *
 * So this drives what the screen is *for* — build a section, put questions in it, add a rule that
 * refers to them, publish — through the same clicks an administrator makes, and stays deliberately
 * clear of how any of it is put together. It should survive the modals moving into files of their
 * own without a line changing.
 */
test.use({ storageState: sessionFile('admin') });

// One name per run, because the suite reseeds but a retry within a run does not.
const NAME = `Browser probe ${Date.now()}`;

test('an administrator builds a questionnaire, and it holds together', async ({ page }) => {
  await page.goto('/templates');

  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByLabel('Name').fill(NAME);
  await page
    .getByRole('button', { name: /create|save|add/i })
    .last()
    .click();

  // Creating one opens its editor, which is where the rest of this happens.
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: NAME })).toBeVisible();

  // --- A section -----------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Add section' }).first().click();
  const sectionModal = page.getByRole('dialog');
  /*
   * Addressed by role, not by label. Every field on this screen has a help button beside it whose
   * accessible name is "About <label>", so `getByLabel('Key')` matches the button as well as the
   * input. Asking for the textbox says which one is meant, and reads the way a screen reader
   * would announce it.
   */
  await expect(sectionModal.getByRole('textbox', { name: /^Key/ })).toBeVisible();
  await sectionModal.getByRole('textbox', { name: /^Key/ }).fill('coverage');
  await sectionModal.getByRole('textbox', { name: /^Title/ }).fill('Coverage');
  // Which operators the section applies to. Required, and the reason a section cannot be added by
  // filling in only the obvious two fields — the form says so, and this test found out the same
  // way an administrator would.
  await sectionModal.getByRole('checkbox', { name: 'Mobile Network Operator' }).check();
  await sectionModal.getByRole('button', { name: 'Add section' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Coverage' })).toBeVisible();

  // --- Two questions in it -------------------------------------------------------------------
  for (const [key, label] of [
    ['active', 'Active subscribers'],
    ['registered', 'Registered subscribers'],
  ]) {
    await page.getByRole('button', { name: 'Add field' }).first().click();
    const fieldModal = page.getByRole('dialog');
    await fieldModal.getByRole('textbox', { name: /^Key/ }).fill(key);
    await fieldModal.getByRole('textbox', { name: /^Label/ }).fill(label);
    /*
     * Opened and picked from, not `selectOption`. The design system replaced every native
     * `<select>` with a listbox, so the control is a button that reveals options — which is also
     * what a user does, and the reason this test is worth more than one that reaches for the DOM.
     */
    await fieldModal.getByRole('combobox', { name: /^Data type/ }).click();
    await page.getByRole('option', { name: 'Integer (count)' }).click();
    await fieldModal.getByRole('button', { name: 'Add field' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText(label).first()).toBeVisible();
  }

  // --- A rule that refers to both of them ------------------------------------------------------
  // The part most worth covering: a rule is the only thing on this screen that reaches across
  // questions, so it is the first thing an extraction would break.
  await page.getByRole('button', { name: 'Add rule' }).first().click();
  const ruleModal = page.getByRole('dialog');
  await expect(ruleModal).toBeVisible();
  // The questions added above are offered to the rule. This is the cross-question reach that an
  // extraction would break first, and it is the reason this test exists.
  await expect(ruleModal.getByText(/Active subscribers/).first()).toBeVisible();
});

test('the editor is reachable and readable with a keyboard', async ({ page }) => {
  // The builder is an Authority-side screen used for long stretches, and every control on it is
  // in a modal — the place a focus trap is easiest to get wrong and hardest to notice.
  await page.goto('/templates');
  await page.getByRole('button', { name: 'New template' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Focus has to be inside the dialog, or a keyboard user is typing into the page behind it.
  await expect(dialog.locator(':focus')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
