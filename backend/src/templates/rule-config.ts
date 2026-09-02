import { RuleType } from '@prisma/client';

/**
 * The single source of truth for the shape of each rule type's `config` — specifically, which
 * config keys point at template field keys (single vs. list). The engine, the create/update
 * guards, field-delete protection, and the publish gate all read from here, so a rule can never
 * be saved (or a template published) with a check wired to a field that doesn't exist.
 */
export const RULE_FIELD_REFS: Record<
  RuleType,
  { single: readonly string[]; array: readonly string[] }
> = {
  SUM_EQUALS_TOTAL: { single: ['total'], array: ['operands'] },
  LESS_OR_EQUAL: { single: ['left', 'right'], array: [] },
  FLOAT_RECONCILE: { single: ['balance', 'backing'], array: [] },
  PERIOD_ON_PERIOD: { single: ['field'], array: [] },
  NONZERO_REQUIRES: { single: ['when', 'require'], array: [] },
};

/** Optional numeric threshold keys — validated for range, but never field references. */
const NUMERIC_PARAMS = [
  'tolerancePercent',
  'shortfallPercent',
  'surplusPercent',
  'thresholdPercent',
] as const;

/** Every template field key a rule references (single + list operands). */
export function ruleReferencedKeys(type: RuleType, config: Record<string, unknown>): string[] {
  const refs = RULE_FIELD_REFS[type];
  const keys: string[] = [];
  for (const k of refs.single) {
    if (typeof config[k] === 'string') keys.push(config[k] as string);
  }
  for (const k of refs.array) {
    if (Array.isArray(config[k])) {
      keys.push(...(config[k] as unknown[]).filter((x): x is string => typeof x === 'string'));
    }
  }
  return keys;
}

/** Whether a rule depends on a given field key (used to protect that field from deletion). */
export function ruleReferencesKey(
  type: RuleType,
  config: Record<string, unknown>,
  fieldKey: string,
): boolean {
  return ruleReferencedKeys(type, config).includes(fieldKey);
}

/**
 * Validate a rule's config against the template's numeric fields. Returns a plain-language
 * message when the rule isn't soundly wired (missing operand, unknown field, wrong type, a field
 * used twice, or a bad threshold), or null when it's valid. This is the authoritative check —
 * the editor's dropdowns are only a convenience on top of it.
 */
export function validateRuleConfig(
  type: RuleType,
  config: Record<string, unknown>,
  numericFieldKeys: Set<string>,
): string | null {
  const refs = RULE_FIELD_REFS[type];
  const referenced: string[] = [];

  for (const key of refs.single) {
    const value = config[key];
    if (typeof value !== 'string' || value.trim() === '') return `Choose a field for "${key}".`;
    referenced.push(value);
  }
  for (const key of refs.array) {
    const value = config[key];
    if (!Array.isArray(value) || value.length === 0) {
      return `Choose at least one field for "${key}".`;
    }
    if (!value.every((x) => typeof x === 'string' && x.trim() !== '')) {
      return `"${key}" has an empty entry.`;
    }
    referenced.push(...(value as string[]));
  }

  for (const key of referenced) {
    if (!numericFieldKeys.has(key)) {
      return `"${key}" is not a numeric field on this template.`;
    }
  }

  if (new Set(referenced).size !== referenced.length) {
    return 'A rule cannot use the same field more than once.';
  }

  for (const param of NUMERIC_PARAMS) {
    const raw = config[param];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0) return `"${param}" must be a number of 0 or more.`;
  }

  return null;
}
