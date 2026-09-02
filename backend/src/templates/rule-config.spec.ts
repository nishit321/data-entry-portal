import { RuleType } from '@prisma/client';
import { ruleReferencedKeys, ruleReferencesKey, validateRuleConfig } from './rule-config';

const NUMERIC = new Set(['a', 'b', 'c', 'total']);

describe('rule-config', () => {
  describe('validateRuleConfig', () => {
    it('accepts a sound LESS_OR_EQUAL rule', () => {
      expect(
        validateRuleConfig(RuleType.LESS_OR_EQUAL, { left: 'a', right: 'b' }, NUMERIC),
      ).toBeNull();
    });

    it('rejects a missing operand', () => {
      expect(validateRuleConfig(RuleType.LESS_OR_EQUAL, { left: 'a' }, NUMERIC)).toMatch(/right/);
    });

    it('rejects a field that is not on the template', () => {
      expect(
        validateRuleConfig(RuleType.LESS_OR_EQUAL, { left: 'a', right: 'ghost' }, NUMERIC),
      ).toMatch(/ghost/);
    });

    it('rejects a non-numeric (unknown) field even if the shape is right', () => {
      const smaller = new Set(['a']);
      expect(
        validateRuleConfig(RuleType.LESS_OR_EQUAL, { left: 'a', right: 'b' }, smaller),
      ).toMatch(/numeric/);
    });

    it('rejects using the same field twice', () => {
      expect(
        validateRuleConfig(RuleType.LESS_OR_EQUAL, { left: 'a', right: 'a' }, NUMERIC),
      ).toMatch(/same field/);
    });

    it('accepts SUM_EQUALS_TOTAL with distinct operands and total', () => {
      expect(
        validateRuleConfig(
          RuleType.SUM_EQUALS_TOTAL,
          { operands: ['a', 'b'], total: 'total' },
          NUMERIC,
        ),
      ).toBeNull();
    });

    it('rejects SUM_EQUALS_TOTAL with an empty operand list', () => {
      expect(
        validateRuleConfig(RuleType.SUM_EQUALS_TOTAL, { operands: [], total: 'total' }, NUMERIC),
      ).toMatch(/at least one/);
    });

    it('rejects SUM_EQUALS_TOTAL when the total is also an operand', () => {
      expect(
        validateRuleConfig(
          RuleType.SUM_EQUALS_TOTAL,
          { operands: ['a', 'total'], total: 'total' },
          NUMERIC,
        ),
      ).toMatch(/same field/);
    });

    it('rejects a negative threshold', () => {
      expect(
        validateRuleConfig(
          RuleType.PERIOD_ON_PERIOD,
          { field: 'a', thresholdPercent: -5 },
          NUMERIC,
        ),
      ).toMatch(/thresholdPercent/);
    });

    it('accepts an optional threshold left blank', () => {
      expect(validateRuleConfig(RuleType.PERIOD_ON_PERIOD, { field: 'a' }, NUMERIC)).toBeNull();
    });
  });

  describe('ruleReferencedKeys / ruleReferencesKey', () => {
    it('lists single + array field references', () => {
      const keys = ruleReferencedKeys(RuleType.SUM_EQUALS_TOTAL, {
        operands: ['a', 'b'],
        total: 'total',
      });
      expect(keys.sort()).toEqual(['a', 'b', 'total']);
    });

    it('detects whether a specific field is used', () => {
      const config = { balance: 'a', backing: 'b' };
      expect(ruleReferencesKey(RuleType.FLOAT_RECONCILE, config, 'a')).toBe(true);
      expect(ruleReferencesKey(RuleType.FLOAT_RECONCILE, config, 'c')).toBe(false);
    });
  });
});
