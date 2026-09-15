import { z } from 'zod';
import {
  RULE_SEVERITIES,
  RULE_SEVERITY_LABELS,
  RULE_TYPE_LABELS,
  RULE_TYPES,
  type TemplateRule,
} from '../../lib/types';
import type { RuleInput } from '../../lib/templates.api';
import type { SelectOption } from '../../components/ui';

/**
 * A validation rule, everything except how it looks.
 *
 * The shape it takes in the form, what makes one valid, how it becomes a payload, and how it
 * reads back in plain words. Kept apart from `RuleModal` because three of the four are useful
 * without a dialog open — the rule list on the editor renders `ruleFormula`, and the page builds
 * the payload — and because a schema buried inside a 1,800-line screen is a schema nobody finds.
 */

/** Numbers arrive from inputs as strings; an empty one means "not set", not zero. */
const numOrUndef = (v: unknown) =>
  v === '' || v === null || v === undefined ? undefined : Number(v);

export const RULE_TYPE_OPTIONS: SelectOption[] = RULE_TYPES.map((t) => ({
  value: t,
  label: RULE_TYPE_LABELS[t],
}));
export const RULE_SEVERITY_OPTIONS: SelectOption[] = RULE_SEVERITIES.map((s) => ({
  value: s,
  label: RULE_SEVERITY_LABELS[s],
}));

export const ruleSchema = z
  .object({
    type: z.enum(RULE_TYPES),
    severity: z.enum(RULE_SEVERITIES),
    label: z.string().min(1, 'Label is required').max(200),
    order: z.preprocess(numOrUndef, z.number().int().min(0).optional()),
    operands: z.array(z.string()).optional(),
    total: z.string().max(100).optional(),
    tolerancePercent: z.preprocess(numOrUndef, z.number().min(0).optional()),
    left: z.string().max(100).optional(),
    right: z.string().max(100).optional(),
    balance: z.string().max(100).optional(),
    backing: z.string().max(100).optional(),
    shortfallPercent: z.preprocess(numOrUndef, z.number().min(0).optional()),
    surplusPercent: z.preprocess(numOrUndef, z.number().min(0).optional()),
    field: z.string().max(100).optional(),
    thresholdPercent: z.preprocess(numOrUndef, z.number().min(0).optional()),
    when: z.string().max(100).optional(),
    require: z.string().max(100).optional(),
  })
  .superRefine((v, ctx) => {
    const need = (key: keyof RuleForm, message: string) => {
      const val = v[key];
      const empty = val === undefined || val === '' || (Array.isArray(val) && val.length === 0);
      if (empty) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
    };
    switch (v.type) {
      case 'SUM_EQUALS_TOTAL':
        need('operands', 'Pick at least one field');
        need('total', 'Pick the total field');
        break;
      case 'LESS_OR_EQUAL':
        need('left', 'Pick a field');
        need('right', 'Pick a field');
        break;
      case 'FLOAT_RECONCILE':
        need('balance', 'Pick a field');
        need('backing', 'Pick a field');
        break;
      case 'PERIOD_ON_PERIOD':
        need('field', 'Pick a field');
        break;
      case 'NONZERO_REQUIRES':
        need('when', 'Pick a field');
        need('require', 'Pick a field');
        break;
    }
  });
export type RuleForm = z.infer<typeof ruleSchema>;

/** Build a rule payload, packing only the config keys the chosen type uses (RULE_TYPE_CONFIG_KEYS). */
/**
 * The body for adding or editing a rule. `type` is create-only: the operator a rule applies is
 * what gives its config meaning, so it is fixed once set, and the update endpoint rejects the
 * field outright. Sending it on an edit made every rule edit fail.
 */
export function toRuleInput(v: RuleForm, isEdit = false): RuleInput {
  const config: Record<string, unknown> = {};
  switch (v.type) {
    case 'SUM_EQUALS_TOTAL':
      config.operands = v.operands ?? [];
      config.total = v.total;
      if (v.tolerancePercent !== undefined) config.tolerancePercent = v.tolerancePercent;
      break;
    case 'LESS_OR_EQUAL':
      config.left = v.left;
      config.right = v.right;
      break;
    case 'FLOAT_RECONCILE':
      config.balance = v.balance;
      config.backing = v.backing;
      if (v.shortfallPercent !== undefined) config.shortfallPercent = v.shortfallPercent;
      if (v.surplusPercent !== undefined) config.surplusPercent = v.surplusPercent;
      break;
    case 'PERIOD_ON_PERIOD':
      config.field = v.field;
      if (v.thresholdPercent !== undefined) config.thresholdPercent = v.thresholdPercent;
      break;
    case 'NONZERO_REQUIRES':
      config.when = v.when;
      config.require = v.require;
      break;
  }
  const body: RuleInput = { severity: v.severity, label: v.label, config };
  if (!isEdit) body.type = v.type;
  if (v.order !== undefined) body.order = v.order;
  return body;
}

/**
 * A plain-language formula for a rule, built from the fields' human labels and simple math symbols
 * (not the raw config keys) so anyone reading the list can see exactly what the check does.
 */
export function ruleFormula(rule: TemplateRule, label: (key: string) => string): string {
  const c = rule.config;
  const one = (k: string) => (typeof c[k] === 'string' ? label(c[k] as string) : '—');
  const pct = (k: string, fallback: number) =>
    typeof c[k] === 'number' ? (c[k] as number) : fallback;

  switch (rule.type) {
    case 'SUM_EQUALS_TOTAL': {
      const parts = Array.isArray(c.operands)
        ? (c.operands as string[]).map(label).join(' + ')
        : '—';
      const tol = typeof c.tolerancePercent === 'number' ? ` (±${c.tolerancePercent}%)` : '';
      return `${parts} = ${one('total')}${tol}`;
    }
    case 'LESS_OR_EQUAL':
      return `${one('left')} ≤ ${one('right')}`;
    case 'FLOAT_RECONCILE':
      return `${one('balance')} ≥ ${one('backing')}`;
    case 'PERIOD_ON_PERIOD':
      return `Flag if ${one('field')} changes by more than ${pct('thresholdPercent', 50)}% from the previous period`;
    case 'NONZERO_REQUIRES':
      return `If ${one('when')} is above 0, then ${one('require')} must be filled in`;
    default:
      return '';
  }
}
