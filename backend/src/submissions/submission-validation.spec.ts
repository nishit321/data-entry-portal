import { EntityType, FieldType, ReferenceCategory } from '@prisma/client';
import { ValidationSection, validateSubmission } from './submission-validation';

const sections: ValidationSection[] = [
  {
    key: 'general',
    applicableEntityTypes: [EntityType.MNO],
    fields: [
      {
        id: 'name',
        key: 'name',
        label: 'Name',
        dataType: FieldType.TEXT,
        isMandatory: true,
        allowsOther: false,
        minValue: null,
        maxValue: null,
      },
      {
        id: 'subs',
        key: 'subs',
        label: 'Subscribers',
        dataType: FieldType.INTEGER,
        isMandatory: true,
        allowsOther: false,
        minValue: null,
        maxValue: null,
      },
      {
        id: 'pct',
        key: 'pct',
        label: 'Coverage',
        dataType: FieldType.PERCENTAGE,
        isMandatory: false,
        allowsOther: false,
        minValue: null,
        maxValue: null,
      },
      {
        id: 'tech',
        key: 'tech',
        label: 'Technology',
        dataType: FieldType.REFERENCE,
        isMandatory: false,
        allowsOther: true,
        minValue: null,
        maxValue: null,
      },
    ],
  },
];

const codes = (r: { hard: { code: string }[] }) => r.hard.map((i) => i.code);

describe('validateSubmission', () => {
  it('flags missing mandatory fields', () => {
    const r = validateSubmission(sections, EntityType.MNO, {});
    expect(codes(r)).toEqual(expect.arrayContaining(['required']));
    expect(r.hard.filter((i) => i.code === 'required')).toHaveLength(2); // name + subs
  });

  it('rejects a percentage outside 0–100 and a non-integer count and a negative', () => {
    const r = validateSubmission(sections, EntityType.MNO, {
      name: { valueText: 'X' },
      subs: { valueText: '-2.5' },
      pct: { valueText: '140' },
    });
    expect(codes(r)).toEqual(
      expect.arrayContaining(['negative', 'not_integer', 'percentage_range']),
    );
  });

  it('requires a reason when a field is marked unavailable, and accepts it with one', () => {
    const missing = validateSubmission(sections, EntityType.MNO, {
      name: { isUnavailable: true },
      subs: { valueText: '10' },
    });
    expect(codes(missing)).toContain('reason_required');

    const withReason = validateSubmission(sections, EntityType.MNO, {
      name: { isUnavailable: true, unavailableReason: 'System migration' },
      subs: { valueText: '10' },
    });
    expect(withReason.hard).toHaveLength(0);
  });

  it('validates the "Other" controlled pair length', () => {
    const r = validateSubmission(sections, EntityType.MNO, {
      name: { valueText: 'X' },
      subs: { valueText: '10' },
      tech: { otherText: 'ab' }, // too short (min 3)
    });
    expect(codes(r)).toContain('other_length');
  });

  it('skips sections that do not apply to the entity type', () => {
    // Section applies to MNO only; validating for an ISP → no errors at all.
    const r = validateSubmission(sections, EntityType.ISP, {});
    expect(r.hard).toHaveLength(0);
  });
});

/**
 * Service-gated sections (VALIDATION_SPEC §3 and §6.1).
 *
 * The spec is explicit in both directions: a section for a service the operator does not offer is
 * hidden and not required, and a figure reported against a service it has not ticked is a hard
 * error. Both are checked here through the real validator rather than against the helper alone.
 */
const gatedSections: ValidationSection[] = [
  {
    key: 'general',
    applicableEntityTypes: [EntityType.MNO],
    fields: [
      {
        id: 'g-services',
        key: 'services_offered',
        label: 'Services offered',
        dataType: FieldType.REFERENCE,
        isMandatory: true,
        allowsOther: false,
        minValue: null,
        maxValue: null,
        referenceCategory: ReferenceCategory.SERVICE_TYPE,
      },
    ],
  },
  {
    key: 'mobile_money',
    applicableEntityTypes: [EntityType.MNO],
    requiredServiceCode: 'MOBILE_MONEY',
    fields: [
      {
        id: 'm-float',
        key: 'float_balance',
        label: 'Float balance',
        dataType: FieldType.MONETARY,
        // Mandatory *within* the section, which is exactly why the gate has to work: an operator
        // that does not offer the service must not be blocked by it.
        isMandatory: true,
        allowsOther: false,
        minValue: null,
        maxValue: null,
      },
    ],
  },
];

describe('validateSubmission with service-gated sections', () => {
  it('does not require a section whose service was not ticked', () => {
    const r = validateSubmission(gatedSections, EntityType.MNO, {
      'g-services': { valueText: 'VOICE' },
    });
    expect(r.hard.some((i) => i.fieldKey === 'float_balance')).toBe(false);
  });

  it('requires that section once the service is ticked', () => {
    const r = validateSubmission(gatedSections, EntityType.MNO, {
      'g-services': { valueText: 'MOBILE_MONEY' },
    });
    const missing = r.hard.find((i) => i.fieldKey === 'float_balance');
    expect(missing).toBeDefined();
    expect(missing!.code).toBe('required');
  });

  it('accepts the section when the service is ticked and it is filled in', () => {
    const r = validateSubmission(gatedSections, EntityType.MNO, {
      'g-services': { valueText: 'MOBILE_MONEY' },
      'm-float': { valueText: '5000' },
    });
    expect(r.hard).toEqual([]);
  });

  it('is a hard error to report a figure for a service that was not ticked', () => {
    const r = validateSubmission(gatedSections, EntityType.MNO, {
      'g-services': { valueText: 'VOICE' },
      'm-float': { valueText: '5000' },
    });
    const issue = r.hard.find((i) => i.code === 'service_not_declared');
    expect(issue).toBeDefined();
    expect(issue!.fieldKey).toBe('float_balance');
    // Named the way the operator sees it on the form, not by its database key.
    expect(issue!.label).toBe('Float balance');
    // The message names the service in words, and says what to do about it.
    expect(issue!.message).toContain('mobile money');
    expect(issue!.message).toContain('Section 1');
  });

  it('reads a service out of a multi-value answer', () => {
    const r = validateSubmission(gatedSections, EntityType.MNO, {
      'g-services': { valueText: 'VOICE, MOBILE_MONEY' },
      'm-float': { valueText: '5000' },
    });
    expect(r.hard).toEqual([]);
  });

  it('does not treat an unavailable service answer as a tick', () => {
    const r = validateSubmission(gatedSections, EntityType.MNO, {
      'g-services': { valueText: 'MOBILE_MONEY', isUnavailable: true, unavailableReason: 'x' },
    });
    // The section stays hidden, so its mandatory field is not demanded.
    expect(r.hard.some((i) => i.fieldKey === 'float_balance')).toBe(false);
  });
});
