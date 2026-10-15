import { expect, test } from '@playwright/test';
import { auditConventions, describeFindings, settle } from './conventions';
import { sessionFile } from './helpers';
import { API_URL } from '../playwright.config';

/**
 * The two full-page editors and the detail drawers.
 *
 * These are the longest forms in the product and the last surface no sweep had reached. A list
 * sweep cannot get to them: both editors need a record to open, and a drawer only exists once a
 * row has been clicked. So each test navigates the way a person would.
 */
test.setTimeout(240_000);

test.describe('as operator', () => {
  test.use({ storageState: sessionFile('operator') });

  test('the return editor follows the label, placeholder and alignment rules', async ({ page }) => {
    // A filed return opens read-only, so opening any old row measures nothing: the editable form
    // is the point. Take an existing draft if there is one, and start a return if there is not.
    //
    // Both paths are needed, and finding that out cost a run. The first version always started a
    // return, which worked once and then never again: it had used up the only period the operator
    // had left, so the next run met a different dialog and timed out waiting for a control that
    // was no longer there. A test that spends its own precondition passes exactly once.
    await page.goto('/submissions?status=DRAFT');
    await settle(page);

    const draftRow = page.getByRole('row').nth(1);
    // Whether this test made the draft it is about to measure, so it can take it away again.
    let startedHere = false;
    if (await draftRow.isVisible().catch(() => false)) {
      await draftRow.click();
    } else {
      startedHere = true;
      await page.goto('/submissions');
      await settle(page);

      const start = page.getByRole('button', { name: /^Start a return$/ }).first();
      await start.waitFor({ state: 'visible', timeout: 15_000 });
      await start.click();

      // The chooser is a form of its own, so it gets audited on the way through.
      const chooser = page.locator('[role="dialog"]').filter({ visible: true }).first();
      await expect(chooser).toBeVisible({ timeout: 15_000 });

      const inDialog = await auditConventions(page, 'visible-dialog');
      expect(describeFindings('start a return', inDialog), 'start a return').toEqual([]);

      // Every wait here is bounded. `isEnabled()` and friends auto-wait to the *test* timeout, so
      // asking about a control that never appears costs four minutes and then reports the timeout
      // rather than the missing control.
      // A combobox, not a button: the shared Select announces itself as one. Looking for a button
      // found nothing and, being unbounded, cost the full four minutes before saying so.
      await chooser.getByRole('combobox', { name: /Reporting period/i }).click({ timeout: 10_000 });
      await page.getByRole('option').first().click({ timeout: 10_000 });

      const openDraft = chooser.getByRole('button', { name: /^Open draft$/ });
      await expect(openDraft).toBeEnabled({ timeout: 10_000 });
      await openDraft.click();
    }

    await page.waitForURL(/\/submissions\/[^/]+/, { timeout: 20_000 });
    await settle(page);

    const findings = await auditConventions(page);

    // The example-placeholder rule does not reach this screen, and should not.
    //
    // These fields are not written by us. They are whatever questions the Authority put in the
    // questionnaire, rendered from the template, so there is no example the portal could supply
    // for "Name of Operator" that would not be a guess. Guidance for a question belongs to the
    // question, and the template editor has a field for exactly that. Inventing placeholders here
    // would put the portal's words in the regulator's mouth.
    expect(describeFindings('return editor', findings, ['noPlaceholder']), 'return editor').toEqual(
      [],
    );

    /*
     * Put the period back the way it was found.
     *
     * The suite shares one database, and starting a return spends the operator's only open
     * period. While this test could not get past the period picker that never mattered; once it
     * could, journey.spec (which runs later and starts that same return itself) found a draft
     * already there and failed for a reason that had nothing to do with the journey.
     */
    if (startedHere) {
      const id = new URL(page.url()).pathname.split('/').pop();
      const token = await page.evaluate(() => localStorage.getItem('nca_access_token'));
      const removed = await page.request.delete(`${API_URL}/submissions/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(removed.ok(), `deleting the draft this test started (${removed.status()})`).toBe(true);
    }
  });
});

test.describe('as admin', () => {
  test.use({ storageState: sessionFile('admin') });

  test('the template editor follows the label, placeholder and alignment rules', async ({
    page,
  }) => {
    await page.goto('/templates');

    // A published questionnaire opens read-only, with nothing to measure. Editing one means
    // starting a version, so that is what this does: the editable editor is the longest form in
    // the product and the point of the test. It only adds a draft, and the next run of the suite
    // rebuilds the database anyway.
    const newVersion = page.getByRole('button', { name: /^Start a new version$/ }).first();
    await newVersion.waitFor({ state: 'visible', timeout: 15_000 });
    await newVersion.click();

    await page.waitForURL(/\/templates\/[^/]+/, { timeout: 15_000 });
    await settle(page);

    // The editor itself is a structure view: sections and fields with reorder and edit actions,
    // and no inputs of its own. Every form it owns opens as a dialog, so that is where the rules
    // have to be measured. Asserting on the structure view alone measured nothing and passed,
    // which is worse than not testing it.
    const structure = await auditConventions(page);
    expect(describeFindings('template structure', structure), 'template structure').toEqual([]);

    for (const action of [/^Edit details$/, /^Edit this section$/, /^Edit this field$/]) {
      const trigger = page.getByRole('button', { name: action }).first();
      await trigger.waitFor({ state: 'visible', timeout: 15_000 });
      await trigger.click();

      const dialog = page.locator('[role="dialog"]').filter({ visible: true }).first();
      await expect(dialog, `${action} opens a dialog`).toBeVisible({ timeout: 10_000 });

      const findings = await auditConventions(page, 'visible-dialog');
      expect(findings.measured, `${action} has controls to measure`).toBeGreaterThan(0);
      expect(describeFindings(`template ${action.source}`, findings)).toEqual([]);

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden({ timeout: 10_000 });
    }
  });

  test('the audit log detail drawer follows the same rules', async ({ page }) => {
    await page.goto('/audit');
    await settle(page);

    const firstRow = page.getByRole('row').nth(1);
    await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
    await firstRow.click();

    const drawer = page.locator('[role="dialog"]').filter({ visible: true }).first();
    await expect(drawer, 'clicking a row opens the detail drawer').toBeVisible({ timeout: 10_000 });

    const findings = await auditConventions(page, 'visible-dialog');
    expect(describeFindings('audit drawer', findings), 'audit drawer').toEqual([]);
    // No control count asserted here: the drawer is a read-only detail view, so having no form
    // controls in it is the correct outcome, not a missed navigation. The dialog being visible is
    // what proves the drawer opened.
  });
});
