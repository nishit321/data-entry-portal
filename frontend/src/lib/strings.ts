/**
 * Copy that appears on more than one screen.
 *
 * Named `strings`, not `copy`: `copy` is already a local function on more than one page — the one
 * that puts a value on the clipboard — and an import that shadows it is a confusing bug rather
 * than a compile error waiting to happen.
 *
 * Two reasons this exists, and the second one is the reason it is worth reading.
 *
 * The stated one is Q9: English for the first release, built so another language can be added
 * without a rewrite. A translator needs somewhere to look, and "somewhere" cannot be a hundred
 * components.
 *
 * The one that pays today is consistency. "Cancel" was written out twenty-seven times, "Clear
 * filters" eight, "Filter by status" eleven. Nothing kept them the same, and copy that drifts is
 * how a product ends up with a Cancel here and a Close there on the two halves of the same job —
 * which reads, to somebody using it, as two different products.
 *
 * **What belongs here:** words that appear on more than one screen. **What does not:** a sentence
 * written for one place. Moving those here would trade a readable component for a lookup, and
 * `strings.templateEditor.ruleHelpTextForSumEqualsTotal` helps nobody. `strings.test.ts` holds the line
 * from the other side — it fails when one of these is written out by hand again.
 */
export const strings = {
  /** Buttons and links that do the same thing wherever they appear. */
  action: {
    cancel: 'Cancel',
    close: 'Close',
    clearFilters: 'Clear filters',
    backToSignIn: 'Back to sign in',
  },

  /** Field labels. The same thing is called the same thing on every screen. */
  field: {
    name: 'Name',
    email: 'Email',
    role: 'Role',
    status: 'Status',
    type: 'Type',
    label: 'Label',
    entity: 'Entity',
    operator: 'Operator',
    firstName: 'First name',
    lastName: 'Last name',
    descriptionOptional: 'Description (optional)',
    reportingPeriod: 'Reporting period',
    template: 'Template',
  },

  /** The accessible names on filter controls — what a screen reader announces, not visible text. */
  filter: {
    byStatus: 'Filter by status',
    byEntity: 'Filter by entity',
    byOperator: 'Filter by operator',
  },

  /** Search box prompts. The ellipsis is the single character, not three dots. */
  search: {
    entities: 'Search entities…',
    operators: 'Search operators…',
    periods: 'Search periods…',
  },

  /**
   * Placeholders that are examples rather than instructions.
   *
   * Kept together because they are the ones most likely to drift into saying something different
   * on two screens that ask for the same thing.
   */
  example: {
    email: 'you@example.com',
    oneTimeCode: '123456',
  },
} as const;
