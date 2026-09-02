import { EntityType, RuleSeverity, RuleType } from '@prisma/client';
import {
  SubmittedValue,
  ValidationIssue,
  ValidationResult,
  ValidationSection,
  validateSubmission,
} from './submission-validation';

/**
 * The validation engine (VALIDATION_SPEC §6). It composes the per-field checks
 * (submission-validation.ts, which also decides which sections apply at all) with the template's
 * configurable cross-field rules,
 * and the period-on-period comparison against the prior period's values. Rules
 * are DATA on the template, so NCA's specific checks (Postpaid+Prepaid=Total,
 * float reconciliation, …) need no code change — only configuration.
 */

export interface RuleInput {
  type: RuleType;
  severity: RuleSeverity;
  label: string;
  config: unknown;
}

export interface RunValidationParams {
  sections: ValidationSection[];
  entityType: EntityType;
  /** Submitted values keyed by field id. */
  values: Record<string, SubmittedValue>;
  rules: RuleInput[];
  /** Map of field id → field key, to evaluate key-based rules. */
  fieldKeyById: Record<string, string>;
  /** Map of field key → human label, so rule messages name the fields the operator sees. */
  fieldLabelByKey?: Record<string, string>;
  /** Prior period's numeric values keyed by field key (null if no prior period). */
  priorNumericByKey?: Record<string, number | null> | null;
}

const DEFAULT_SUM_TOLERANCE = 0.5; // percent (VALIDATION_SPEC §6)
const DEFAULT_SHORTFALL = 1; // percent — hard
const DEFAULT_SURPLUS = 5; // percent — soft
const DEFAULT_POP_THRESHOLD = 50; // percent — soft

export function runValidation(params: RunValidationParams): ValidationResult {
  const { sections, entityType, values, rules, fieldKeyById, priorNumericByKey } = params;
  const labels = params.fieldLabelByKey ?? {};

  // 1) Per-field checks.
  const result = validateSubmission(sections, entityType, values);

  // 2) Numeric value keyed by field key (null when unavailable/blank/non-numeric).
  const numericByKey: Record<string, number | null> = {};
  for (const [fieldId, key] of Object.entries(fieldKeyById)) {
    const v = values[fieldId];
    if (!v || v.isUnavailable) {
      numericByKey[key] = null;
      continue;
    }
    const raw = (v.valueText ?? '').trim();
    const n = Number(raw);
    numericByKey[key] = raw !== '' && !Number.isNaN(n) ? n : null;
  }

  // 3) Cross-field / period-on-period rules.
  for (const rule of rules) {
    evaluateRule(rule, numericByKey, priorNumericByKey ?? null, result, labels);
  }
  return result;
}

/**
 * Turn a stored key into something readable, for the fallback below: `active_subscribers` reads
 * as "Active subscribers" rather than appearing raw mid-sentence.
 */
function humaniseKey(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Field key → the label the operator sees on the form. Every validation message is built from
 * this, so when a rule references a field that carries no label the fallback still has to read as
 * English: an operator should never be told "active_subscribers cannot be greater than
 * registered_accounts".
 */
function label(labels: Record<string, string>, key: string | undefined): string {
  if (!key) return 'this field';
  return labels[key] ?? humaniseKey(key);
}

function issue(rule: RuleInput, fieldKey: string, message: string): ValidationIssue {
  // `label` keeps the rule's own name for reviewers; `message` is the plain-language
  // explanation shown to the operator, so the two never read as a repeated phrase.
  return { sectionKey: 'rules', fieldKey, label: rule.label, code: rule.type, message };
}

function push(result: ValidationResult, severity: RuleSeverity, i: ValidationIssue): void {
  (severity === RuleSeverity.HARD ? result.hard : result.soft).push(i);
}

function num(map: Record<string, number | null>, key: string | undefined): number | null {
  if (!key) return null;
  return map[key] ?? null;
}

function evaluateRule(
  rule: RuleInput,
  values: Record<string, number | null>,
  prior: Record<string, number | null> | null,
  result: ValidationResult,
  labels: Record<string, string>,
): void {
  const cfg = (rule.config ?? {}) as Record<string, unknown>;

  switch (rule.type) {
    case RuleType.SUM_EQUALS_TOTAL: {
      const operands = Array.isArray(cfg.operands) ? (cfg.operands as string[]) : [];
      const totalKey = typeof cfg.total === 'string' ? cfg.total : undefined;
      const total = num(values, totalKey);
      const parts = operands.map((k) => num(values, k));
      if (total == null || parts.some((p) => p == null)) return; // incomplete → field-level handles
      const sum = parts.reduce<number>((a, b) => a + (b as number), 0);
      const tolPct =
        typeof cfg.tolerancePercent === 'number' ? cfg.tolerancePercent : DEFAULT_SUM_TOLERANCE;
      const allowed = (tolPct / 100) * Math.abs(total) + 1e-9;
      if (Math.abs(sum - total) > allowed) {
        const partLabels = operands.map((k) => label(labels, k)).join(' + ');
        const message = `${partLabels} should add up to ${label(labels, totalKey)}, but they currently total ${sum} against ${total}. Please check these figures.`;
        push(result, rule.severity, issue(rule, totalKey!, message));
      }
      return;
    }
    case RuleType.LESS_OR_EQUAL: {
      const leftKey = typeof cfg.left === 'string' ? cfg.left : undefined;
      const rightKey = typeof cfg.right === 'string' ? cfg.right : undefined;
      const left = num(values, leftKey);
      const right = num(values, rightKey);
      if (left == null || right == null) return;
      if (left > right) {
        const message = `${label(labels, leftKey)} cannot be greater than ${label(labels, rightKey)}.`;
        push(result, rule.severity, issue(rule, String(cfg.left), message));
      }
      return;
    }
    case RuleType.FLOAT_RECONCILE: {
      const balanceKey = typeof cfg.balance === 'string' ? cfg.balance : undefined;
      const backingKey = typeof cfg.backing === 'string' ? cfg.backing : undefined;
      const balance = num(values, balanceKey);
      const backing = num(values, backingKey);
      if (balance == null || backing == null) return;
      const shortfallPct =
        typeof cfg.shortfallPercent === 'number' ? cfg.shortfallPercent : DEFAULT_SHORTFALL;
      const surplusPct =
        typeof cfg.surplusPercent === 'number' ? cfg.surplusPercent : DEFAULT_SURPLUS;
      const key = String(cfg.balance);
      if (balance < backing * (1 - shortfallPct / 100)) {
        // Under-backing is a prudential breach — always hard.
        const message = `${label(labels, balanceKey)} is lower than ${label(labels, backingKey)}. The balance held must fully cover the e-money issued.`;
        push(result, RuleSeverity.HARD, issue(rule, key, message));
      } else if (balance > backing * (1 + surplusPct / 100)) {
        // Over-backing is not a compliance problem — soft only.
        const message = `${label(labels, balanceKey)} is noticeably higher than ${label(labels, backingKey)}. Please confirm both figures are correct.`;
        push(result, RuleSeverity.SOFT, issue(rule, key, message));
      }
      return;
    }
    case RuleType.PERIOD_ON_PERIOD: {
      const key = typeof cfg.field === 'string' ? cfg.field : undefined;
      const cur = num(values, key);
      const before = prior ? num(prior, key) : null;
      if (key == null || cur == null || before == null || before === 0) return; // no baseline
      const thresholdPct =
        typeof cfg.thresholdPercent === 'number' ? cfg.thresholdPercent : DEFAULT_POP_THRESHOLD;
      const changePct = (Math.abs(cur - before) / Math.abs(before)) * 100;
      if (changePct > thresholdPct) {
        const direction = cur > before ? 'risen' : 'fallen';
        const message = `${label(labels, key)} has ${direction} by about ${Math.round(changePct)}% since the previous period. Please confirm this is correct.`;
        push(result, rule.severity, issue(rule, key, message));
      }
      return;
    }
    case RuleType.NONZERO_REQUIRES: {
      const whenKey = typeof cfg.when === 'string' ? cfg.when : undefined;
      const requireKey = typeof cfg.require === 'string' ? cfg.require : undefined;
      const whenVal = num(values, whenKey);
      const requireVal = num(values, requireKey);
      if (whenVal != null && whenVal > 0 && (requireVal == null || requireVal === 0)) {
        const message = `${label(labels, requireKey)} is zero even though ${label(labels, whenKey)} is greater than zero. Please review.`;
        push(result, rule.severity, issue(rule, String(requireKey), message));
      }
      return;
    }
  }
}
