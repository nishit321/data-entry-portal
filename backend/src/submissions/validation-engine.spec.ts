import { EntityType, FieldType, RuleSeverity, RuleType } from '@prisma/client';
import { ValidationField, ValidationSection } from './submission-validation';
import { RuleInput, runValidation } from './validation-engine';

/**
 * Unit coverage for the cross-field / period-on-period rule engine
 * (VALIDATION_SPEC §6). Fields are non-mandatory so field-level checks stay out
 * of the way and each test isolates one operator.
 */

function field(key: string, dataType: FieldType = FieldType.INTEGER): ValidationField {
  return {
    id: key,
    key,
    label: key,
    dataType,
    isMandatory: false,
    allowsOther: false,
    minValue: null,
    maxValue: null,
  };
}

function section(...keys: string[]): ValidationSection {
  return {
    key: 'main',
    applicableEntityTypes: [EntityType.MMO],
    fields: keys.map((k) => field(k)),
  };
}

/** Build the id-keyed value map + fieldKeyById from a plain key→text map. */
function build(sections: ValidationSection[], byKey: Record<string, string | null>) {
  const values: Record<string, { valueText?: string | null; isUnavailable?: boolean }> = {};
  const fieldKeyById: Record<string, string> = {};
  for (const s of sections) {
    for (const f of s.fields) {
      fieldKeyById[f.id] = f.key;
      if (f.key in byKey) values[f.id] = { valueText: byKey[f.key] };
    }
  }
  return { values, fieldKeyById };
}

function run(
  keys: string[],
  byKey: Record<string, string | null>,
  rules: RuleInput[],
  priorNumericByKey?: Record<string, number | null> | null,
) {
  const sections = [section(...keys)];
  const { values, fieldKeyById } = build(sections, byKey);
  return runValidation({
    sections,
    entityType: EntityType.MMO,
    values,
    rules,
    fieldKeyById,
    priorNumericByKey: priorNumericByKey ?? null,
  });
}

describe('runValidation — cross-field rules', () => {
  describe('SUM_EQUALS_TOTAL', () => {
    const rule: RuleInput = {
      type: RuleType.SUM_EQUALS_TOTAL,
      severity: RuleSeverity.HARD,
      label: 'parts must sum to total',
      config: { operands: ['prepaid', 'postpaid'], total: 'total' },
    };

    it('passes when parts sum to the total within tolerance', () => {
      const r = run(
        ['prepaid', 'postpaid', 'total'],
        { prepaid: '600', postpaid: '400', total: '1000' },
        [rule],
      );
      expect(r.hard).toHaveLength(0);
    });

    it('tolerates a difference within 0.5%', () => {
      const r = run(
        ['prepaid', 'postpaid', 'total'],
        { prepaid: '600', postpaid: '404', total: '1000' },
        [rule],
      );
      expect(r.hard).toHaveLength(0);
    });

    it('flags a difference beyond tolerance', () => {
      const r = run(
        ['prepaid', 'postpaid', 'total'],
        { prepaid: '600', postpaid: '450', total: '1000' },
        [rule],
      );
      expect(r.hard).toHaveLength(1);
    });

    it('skips when an operand is missing', () => {
      const r = run(['prepaid', 'postpaid', 'total'], { prepaid: '600', total: '1000' }, [rule]);
      expect(r.hard).toHaveLength(0);
    });
  });

  describe('LESS_OR_EQUAL', () => {
    const rule: RuleInput = {
      type: RuleType.LESS_OR_EQUAL,
      severity: RuleSeverity.HARD,
      label: 'active ≤ registered',
      config: { left: 'active', right: 'registered' },
    };

    it('passes when left ≤ right', () => {
      const r = run(['active', 'registered'], { active: '80', registered: '100' }, [rule]);
      expect(r.hard).toHaveLength(0);
    });

    it('flags when left > right', () => {
      const r = run(['active', 'registered'], { active: '120', registered: '100' }, [rule]);
      expect(r.hard).toHaveLength(1);
      // The message is a plain-language sentence, not a repeat of the rule label.
      expect(r.hard[0].message).toBe('Active cannot be greater than Registered.');
      expect(r.hard[0].message).not.toBe(r.hard[0].label);
    });
  });

  describe('FLOAT_RECONCILE (asymmetric)', () => {
    const rule: RuleInput = {
      type: RuleType.FLOAT_RECONCILE,
      severity: RuleSeverity.HARD,
      label: 'float must back e-money',
      config: { balance: 'float', backing: 'emoney' },
    };

    it('passes when fully backed', () => {
      const r = run(['float', 'emoney'], { float: '1000', emoney: '1000' }, [rule]);
      expect(r.hard).toHaveLength(0);
      expect(r.soft).toHaveLength(0);
    });

    it('is HARD when the balance falls short by more than 1%', () => {
      const r = run(['float', 'emoney'], { float: '980', emoney: '1000' }, [rule]);
      expect(r.hard).toHaveLength(1);
      expect(r.soft).toHaveLength(0);
    });

    it('is SOFT when the balance exceeds backing by more than 5%', () => {
      const r = run(['float', 'emoney'], { float: '1100', emoney: '1000' }, [rule]);
      expect(r.hard).toHaveLength(0);
      expect(r.soft).toHaveLength(1);
    });

    it('tolerates a small surplus within 5%', () => {
      const r = run(['float', 'emoney'], { float: '1030', emoney: '1000' }, [rule]);
      expect(r.hard).toHaveLength(0);
      expect(r.soft).toHaveLength(0);
    });
  });

  describe('PERIOD_ON_PERIOD', () => {
    const rule: RuleInput = {
      type: RuleType.PERIOD_ON_PERIOD,
      severity: RuleSeverity.SOFT,
      label: 'subscribers moved > 50%',
      config: { field: 'subs', thresholdPercent: 50 },
    };

    it('warns when the value changed by more than the threshold', () => {
      const r = run(['subs'], { subs: '200' }, [rule], { subs: 100 });
      expect(r.soft).toHaveLength(1);
    });

    it('passes within the threshold', () => {
      const r = run(['subs'], { subs: '120' }, [rule], { subs: 100 });
      expect(r.soft).toHaveLength(0);
    });

    it('skips when there is no prior baseline', () => {
      const r = run(['subs'], { subs: '200' }, [rule], null);
      expect(r.soft).toHaveLength(0);
    });
  });

  describe('NONZERO_REQUIRES', () => {
    const rule: RuleInput = {
      type: RuleType.NONZERO_REQUIRES,
      severity: RuleSeverity.SOFT,
      label: 'subscribers reported but revenue is zero',
      config: { when: 'subs', require: 'revenue' },
    };

    it('warns when the trigger is set but the requirement is zero', () => {
      const r = run(['subs', 'revenue'], { subs: '500', revenue: '0' }, [rule]);
      expect(r.soft).toHaveLength(1);
    });

    it('passes when both are present', () => {
      const r = run(['subs', 'revenue'], { subs: '500', revenue: '1000' }, [rule]);
      expect(r.soft).toHaveLength(0);
    });

    it('passes when the trigger itself is zero', () => {
      const r = run(['subs', 'revenue'], { subs: '0', revenue: '0' }, [rule]);
      expect(r.soft).toHaveLength(0);
    });
  });

  it('composes field-level and cross-field checks in one result', () => {
    const sections = [
      {
        key: 'main',
        applicableEntityTypes: [EntityType.MMO],
        fields: [{ ...field('active'), isMandatory: true }, field('registered')],
      },
    ];
    const { values, fieldKeyById } = build(sections, { registered: '100' }); // 'active' missing → mandatory hard
    const r = runValidation({
      sections,
      entityType: EntityType.MMO,
      values,
      rules: [
        {
          type: RuleType.LESS_OR_EQUAL,
          severity: RuleSeverity.HARD,
          label: 'active ≤ registered',
          config: { left: 'active', right: 'registered' },
        },
      ],
      fieldKeyById,
      priorNumericByKey: null,
    });
    // Only the mandatory field-level error fires (cross-field skips on missing operand).
    expect(r.hard.some((h) => h.fieldKey === 'active')).toBe(true);
  });
});
