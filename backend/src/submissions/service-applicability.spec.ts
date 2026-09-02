import { EntityType, ReferenceCategory } from '@prisma/client';
import {
  appliesToEntityType,
  declaredServices,
  hasAnswer,
  normaliseServiceCode,
  sectionApplies,
  undeclaredAnswers,
  type ApplicabilitySection,
  type ApplicabilityValue,
} from './service-applicability';

/** Section 1: the question that declares which services the operator offers. */
const section1: ApplicabilitySection = {
  key: 'general',
  applicableEntityTypes: [EntityType.MNO, EntityType.ISP, EntityType.MMO],
  fields: [
    { id: 'f-name', key: 'operator_name' },
    {
      id: 'f-services',
      key: 'services_offered',
      referenceCategory: ReferenceCategory.SERVICE_TYPE,
    },
  ],
};

/** Section 6: exists only for operators who tick mobile money. */
const section6: ApplicabilitySection = {
  key: 'mobile_money',
  applicableEntityTypes: [EntityType.MNO, EntityType.ISP, EntityType.MMO],
  requiredServiceCode: 'MOBILE_MONEY',
  fields: [
    { id: 'f-float', key: 'float_balance' },
    { id: 'f-agents', key: 'active_agents' },
  ],
};

/** Section 4: ungated, but only for MNOs and ISPs. */
const section4: ApplicabilitySection = {
  key: 'network',
  applicableEntityTypes: [EntityType.MNO, EntityType.ISP],
  fields: [{ id: 'f-sites', key: 'base_stations' }],
};

const SECTIONS = [section1, section6, section4];

const values = (v: Record<string, ApplicabilityValue>) => v;

describe('normaliseServiceCode', () => {
  it('treats the same service written differently as one service', () => {
    expect(normaliseServiceCode('mobile money')).toBe('MOBILE_MONEY');
    expect(normaliseServiceCode('Mobile-Money')).toBe('MOBILE_MONEY');
    expect(normaliseServiceCode('  MOBILE_MONEY  ')).toBe('MOBILE_MONEY');
  });
});

describe('declaredServices', () => {
  it('reads a single ticked service', () => {
    const declared = declaredServices(
      SECTIONS,
      values({ 'f-services': { valueText: 'MOBILE_MONEY' } }),
    );
    expect([...declared]).toEqual(['MOBILE_MONEY']);
  });

  it('reads several services from one multi-value answer', () => {
    const declared = declaredServices(
      SECTIONS,
      values({ 'f-services': { valueText: 'VOICE, DATA, MOBILE_MONEY' } }),
    );
    expect(declared.has('VOICE')).toBe(true);
    expect(declared.has('DATA')).toBe(true);
    expect(declared.has('MOBILE_MONEY')).toBe(true);
  });

  it('reads several services from one field per service', () => {
    // The other shape the questionnaire might reasonably take.
    const perService: ApplicabilitySection = {
      ...section1,
      fields: [
        { id: 's1', key: 'offers_voice', referenceCategory: ReferenceCategory.SERVICE_TYPE },
        { id: 's2', key: 'offers_money', referenceCategory: ReferenceCategory.SERVICE_TYPE },
      ],
    };
    const declared = declaredServices(
      [perService],
      values({ s1: { valueText: 'VOICE' }, s2: { valueText: 'MOBILE_MONEY' } }),
    );
    expect([...declared].sort()).toEqual(['MOBILE_MONEY', 'VOICE']);
  });

  it('ignores answers that are not service questions', () => {
    const declared = declaredServices(
      SECTIONS,
      values({ 'f-name': { valueText: 'MOBILE_MONEY' }, 'f-float': { valueText: 'MOBILE_MONEY' } }),
    );
    expect(declared.size).toBe(0);
  });

  it('declares nothing from a blank or unavailable answer', () => {
    expect(declaredServices(SECTIONS, values({ 'f-services': { valueText: '' } })).size).toBe(0);
    expect(declaredServices(SECTIONS, values({ 'f-services': { valueText: '  ' } })).size).toBe(0);
    // "I cannot tell you" is not "yes".
    expect(
      declaredServices(
        SECTIONS,
        values({ 'f-services': { valueText: 'MOBILE_MONEY', isUnavailable: true } }),
      ).size,
    ).toBe(0);
  });

  it('declares nothing when the return is empty', () => {
    expect(declaredServices(SECTIONS, values({})).size).toBe(0);
  });
});

describe('appliesToEntityType', () => {
  it('keeps a section away from an operator type it was not written for', () => {
    expect(appliesToEntityType(section4, EntityType.MMO)).toBe(false);
    expect(appliesToEntityType(section4, EntityType.MNO)).toBe(true);
  });
});

describe('sectionApplies', () => {
  const none = new Set<string>();
  const money = new Set(['MOBILE_MONEY']);

  it('applies an ungated section to everyone of the right type', () => {
    expect(sectionApplies(section1, EntityType.ISP, none)).toBe(true);
    expect(sectionApplies(section4, EntityType.MNO, none)).toBe(true);
  });

  it('hides a gated section when the service is not ticked', () => {
    expect(sectionApplies(section6, EntityType.MNO, none)).toBe(false);
  });

  it('shows a gated section once the service is ticked', () => {
    expect(sectionApplies(section6, EntityType.MNO, money)).toBe(true);
  });

  it('still respects the operator type on a gated section', () => {
    // Ticking a service cannot pull in a section written for a different kind of operator.
    const mnoOnly = { ...section6, applicableEntityTypes: [EntityType.MNO] };
    expect(sectionApplies(mnoOnly, EntityType.ISP, money)).toBe(false);
  });

  it('matches the service code however it was written on the section', () => {
    const spaced = { ...section6, requiredServiceCode: 'mobile money' };
    expect(sectionApplies(spaced, EntityType.MNO, money)).toBe(true);
  });

  it('treats a blank requiredServiceCode as no gate at all', () => {
    expect(sectionApplies({ ...section6, requiredServiceCode: '   ' }, EntityType.MNO, none)).toBe(
      true,
    );
    expect(sectionApplies({ ...section6, requiredServiceCode: null }, EntityType.MNO, none)).toBe(
      true,
    );
  });
});

describe('hasAnswer', () => {
  it('counts a filled value and an explicit unavailable', () => {
    expect(hasAnswer({ valueText: '5' })).toBe(true);
    expect(hasAnswer({ isUnavailable: true })).toBe(true);
  });

  it('does not count a blank the form left behind', () => {
    expect(hasAnswer(undefined)).toBe(false);
    expect(hasAnswer({})).toBe(false);
    expect(hasAnswer({ valueText: '' })).toBe(false);
    expect(hasAnswer({ valueText: '   ' })).toBe(false);
  });
});

describe('undeclaredAnswers', () => {
  const none = new Set<string>();
  const money = new Set(['MOBILE_MONEY']);

  it('finds a figure reported against a service the operator did not tick', () => {
    const found = undeclaredAnswers(
      SECTIONS,
      EntityType.MNO,
      none,
      values({ 'f-float': { valueText: '1000' } }),
    );
    expect(found).toHaveLength(1);
    expect(found[0].field.key).toBe('float_balance');
    expect(found[0].section.key).toBe('mobile_money');
  });

  it('names every offending figure, not just the section', () => {
    const found = undeclaredAnswers(
      SECTIONS,
      EntityType.MNO,
      none,
      values({ 'f-float': { valueText: '1000' }, 'f-agents': { valueText: '20' } }),
    );
    expect(found.map((f) => f.field.key).sort()).toEqual(['active_agents', 'float_balance']);
  });

  it('says nothing once the service is ticked', () => {
    expect(
      undeclaredAnswers(
        SECTIONS,
        EntityType.MNO,
        money,
        values({ 'f-float': { valueText: '1000' } }),
      ),
    ).toEqual([]);
  });

  it('says nothing when the gated section is simply left empty', () => {
    expect(undeclaredAnswers(SECTIONS, EntityType.MNO, none, values({}))).toEqual([]);
  });

  it('counts an explicit "unavailable" as an answer that should not be there', () => {
    // Marking a mobile-money figure unavailable still asserts the section applies.
    const found = undeclaredAnswers(
      SECTIONS,
      EntityType.MNO,
      none,
      values({ 'f-float': { isUnavailable: true } }),
    );
    expect(found).toHaveLength(1);
  });

  it('does not complain about a section that is out of scope by operator type', () => {
    // An MMO never sees the network section; that is not the operator contradicting itself.
    expect(
      undeclaredAnswers(SECTIONS, EntityType.MMO, none, values({ 'f-sites': { valueText: '3' } })),
    ).toEqual([]);
  });

  it('does not complain about ungated sections', () => {
    expect(
      undeclaredAnswers(SECTIONS, EntityType.MNO, none, values({ 'f-sites': { valueText: '3' } })),
    ).toEqual([]);
  });
});
