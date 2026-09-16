import { FieldType } from '@prisma/client';
import { validateRuleConfig } from '../../src/templates/rule-config';
import { ncaQuestionnaire } from './index';
import { INDICATOR_CANDIDATES, NOT_EXPRESSIBLE } from './public-indicators';

/**
 * Does the transcribed questionnaire hold together?
 *
 * One hundred and eighty-three fields were typed out of a PDF by hand, and the failures that kind
 * of work produces are not loud ones. A rule naming `total_revenu` does not crash; it silently
 * never runs, and six months later somebody notices that revenue has not been checked against its
 * parts since the portal went live. A section keyed to a service code nobody can tick is a section
 * no operator is ever shown, and nothing says so.
 *
 * So these are the checks that only a machine will do reliably: every rule points at a field that
 * exists and is numeric, no key is used twice, and the shape matches what the paper form says.
 *
 * What these tests deliberately do **not** do is assert the content of every field. A test listing
 * all 183 labels would be the same transcription typed a second time, and would agree with the
 * first whether or not either matched the PDF. Checking the transcription against the source is a
 * person's job, done once, against `ref-doc/NCA Questionnaire MNO ISP MobileDFS Revised.pdf`.
 */

const NUMERIC: FieldType[] = [
  FieldType.INTEGER,
  FieldType.DECIMAL,
  FieldType.MONETARY,
  FieldType.PERCENTAGE,
];

const allFields = ncaQuestionnaire.sections.flatMap((s) => s.fields);
const fieldKeys = new Set(allFields.map((f) => f.key));
const numericKeys = new Set(
  allFields.filter((f) => NUMERIC.includes(f.dataType)).map((f) => f.key),
);

describe('the transcribed questionnaire', () => {
  it('has the eleven sections the paper form has', () => {
    // The count and the order both matter: an operator working from the printed form finds their
    // place by section number, so Section 6 has to be the sixth thing they see.
    expect(ncaQuestionnaire.sections).toHaveLength(11);
    expect(ncaQuestionnaire.sections.map((s) => s.title)).toEqual([
      'Section 1: General Information',
      'Section 2: Financial Information',
      'Section 3: Regulatory Compliance',
      'Section 4: Network Infrastructure and Coverage',
      'Section 5: Mobile and Fixed Traffic Data',
      'Section 6: Mobile Money Services',
      'Section 7: Quality of Service',
      'Section 8: Future Network Expansion Plans',
      'Section 9: Security and Privacy',
      'Section 10: Environmental Sustainability',
      'Section 11: Comments and Recommendations',
    ]);
  });

  it('uses every section key and field key exactly once', () => {
    /*
     * A duplicate key does not fail at seed time. The second field quietly overwrites the first in
     * anything that maps by key — the validator, the machine API, the workbook export — and the
     * question that vanished is whichever one happened to be read first.
     */
    const sectionKeys = ncaQuestionnaire.sections.map((s) => s.key);
    expect(new Set(sectionKeys).size).toBe(sectionKeys.length);
    expect(fieldKeys.size).toBe(allFields.length);
  });

  it('points every rule at a numeric field that exists', () => {
    // The check that catches a typo in a key. `validateRuleConfig` is the same function the
    // template screen runs when an administrator writes a rule by hand.
    for (const rule of ncaQuestionnaire.rules ?? []) {
      const problem = validateRuleConfig(rule.type, rule.config, numericKeys);
      expect(problem ? `${rule.label}: ${problem}` : null).toBeNull();
    }
  });

  it('gates the mobile money section on a service rather than on an operator type', () => {
    /*
     * The most consequential piece of applicability on the form, and the one most easily got
     * wrong. Keying Section 6 to MMO would miss an MNO that runs a mobile money arm — which in
     * this market is most of them — and would keep asking an operator that has stopped.
     */
    const section = ncaQuestionnaire.sections.find((s) => s.key === 'mobile_money');
    expect(section?.requiredServiceCode).toBe('MOBILE_MONEY');
    expect(section?.applicableEntityTypes).toContain('MNO');
  });

  it('collects quality of service quarterly only', () => {
    // The one section on the form with a single frequency. A year's average would hide the bad
    // quarter these figures exist to surface.
    const qos = ncaQuestionnaire.sections.find((s) => s.key === 'quality_of_service');
    expect(qos?.frequency).toBe('QUARTERLY');
  });

  it('keeps every percentage inside nought to a hundred', () => {
    // VALIDATION_SPEC §2.1: percentages are stored as 0 to 100, not as a fraction. A field without
    // the bound would accept 9,500 and a field bounded at 1 would refuse every honest answer.
    const percentages = allFields.filter((f) => f.dataType === 'PERCENTAGE');
    expect(percentages.length).toBeGreaterThan(0);
    for (const f of percentages) {
      expect({ key: f.key, min: f.minValue, max: f.maxValue }).toEqual({
        key: f.key,
        min: 0,
        max: 100,
      });
    }
  });

  it('gives the three latency figures the three different ceilings the spec sets', () => {
    // One shared bound would either wave through a local figure that is plainly wrong, or refuse
    // an international one that is merely poor.
    const ceiling = (key: string) => allFields.find((f) => f.key === key)?.maxValue;
    expect(ceiling('latency_local_ms')).toBe(500);
    expect(ceiling('latency_regional_ms')).toBe(1000);
    expect(ceiling('latency_international_ms')).toBe(2000);
  });

  it('never adds coverage percentages together', () => {
    /*
     * VALIDATION_SPEC §6.3, asserted as an absence.
     *
     * Urban and rural coverage are percentages of different populations, so any rule summing them
     * would be arithmetic about nothing — and it is exactly the rule somebody would add in good
     * faith on seeing four percentages and a total beside them.
     */
    const coverage = ['coverage_urban_pct', 'coverage_peri_urban_pct', 'coverage_rural_pct'];
    for (const rule of ncaQuestionnaire.rules ?? []) {
      const operands = (rule.config.operands as string[] | undefined) ?? [];
      expect(operands.filter((k) => coverage.includes(k))).toHaveLength(0);
    }
  });

  it('treats cross-network mobile money as a subset, not an eighth transaction type', () => {
    /*
     * VALIDATION_SPEC §6.1 is explicit that these are already counted inside the other types.
     * Including them in the sum would double-count, and the operator would be told their
     * arithmetic was wrong when it was the form that was.
     */
    const sums = (ncaQuestionnaire.rules ?? []).filter((r) => r.type === 'SUM_EQUALS_TOTAL');
    for (const rule of sums) {
      const operands = (rule.config.operands as string[] | undefined) ?? [];
      expect(operands).not.toContain('mm_volume_cross_network');
      expect(operands).not.toContain('mm_value_cross_network');
    }

    // And it is checked the other way instead: part of the total, so never larger than it.
    const bounded = (ncaQuestionnaire.rules ?? []).filter(
      (r) => r.type === 'LESS_OR_EQUAL' && String(r.config.left).includes('cross_network'),
    );
    expect(bounded).toHaveLength(2);
  });

  it('checks the float asymmetrically, because over-backing is not a breach', () => {
    // A shortfall means customer funds are not fully covered; a surplus means the operator is
    // holding more than it owes. A symmetric tolerance would refuse the second as though it were
    // the first.
    const float = (ncaQuestionnaire.rules ?? []).find((r) => r.type === 'FLOAT_RECONCILE');
    expect(float?.severity).toBe('HARD');
    expect(float?.config.shortfallPercent).toBe(1);
    expect(float?.config.surplusPercent).toBe(5);
  });

  it('marks exactly one field as the levy basis', () => {
    /*
     * Four parts of the portal read this flag and none of them can guess: the levy assessment has
     * nothing to compute from without it, the enforcement engine cannot price a
     * percentage-of-revenue penalty, benchmarking cannot rank anyone, and the public allowlist
     * refuses a levy-basis field outright because Q4 names it commercially sensitive.
     *
     * A questionnaire with none set fails silently. The levy screen reports that no basis is
     * marked, for every period, forever, and nothing anywhere says which field it wanted. Two set
     * is worse: the assessment would then rest on whichever the query returned first.
     */
    const basis = allFields.filter((f) => f.isLevyBasis);
    expect(basis.map((f) => f.key)).toEqual(['total_revenue']);
  });

  it('carries NCA definitions in the spectrum labels, not only in the rule', () => {
    /*
     * NCA, 3 September 2026: "Allocated is what NCA assigns; Licensed is the portion under a
     * current, paid-up licence." An operator who reads Allocated as "what we are using" reports
     * licensed above allocated, trips the rule, and has no idea why. The rule is right; a rule
     * doing a label's job is not.
     */
    const allocated = allFields.find((f) => f.key === 'spectrum_allocated_900');
    const licensed = allFields.find((f) => f.key === 'spectrum_licensed_900');
    expect(allocated?.description).toMatch(/Authority has assigned/i);
    expect(licensed?.description).toMatch(/paid-up licence/i);
  });
});

describe('the public indicator candidates', () => {
  /*
   * The allowlist decides what leaves the building, so the failure that matters here is drift: a
   * candidate naming a question that was renamed, or one that quietly becomes publishable when
   * somebody moves the levy basis.
   *
   * The seeder runs the same three checks against the database before it writes anything. These
   * run against the source, so a rename is caught by `npm test` rather than by somebody noticing
   * a blank line on the public page.
   */
  it('names a question that exists on the questionnaire', () => {
    for (const c of INDICATOR_CANDIDATES) {
      expect({ key: c.fieldKey, onTheForm: fieldKeys.has(c.fieldKey) }).toEqual({
        key: c.fieldKey,
        onTheForm: true,
      });
    }
  });

  it('publishes only figures', () => {
    // A text answer has nothing to aggregate. An allowlist entry naming one publishes nothing and
    // nobody finds out until a citizen asks why the page is blank.
    for (const c of INDICATOR_CANDIDATES) {
      expect({ key: c.fieldKey, numeric: numericKeys.has(c.fieldKey) }).toEqual({
        key: c.fieldKey,
        numeric: true,
      });
    }
  });

  it('never names the levy basis', () => {
    /*
     * Q4 names that revenue figure as commercially sensitive, and the service refuses it outright.
     * Asserted here as well because this list is where somebody would add it by hand, months from
     * now, meaning no harm.
     */
    const levyBasis = allFields.filter((f) => f.isLevyBasis).map((f) => f.key);
    for (const c of INDICATOR_CANDIDATES) expect(levyBasis).not.toContain(c.fieldKey);
  });

  it('averages rates and sums counts', () => {
    /*
     * The arithmetic that makes a sector figure mean something. Adding four operators' call-drop
     * rates gives a number about nothing; adding their subscribers gives the sector.
     *
     * Percentages are the clear case and the one worth holding: every one of them must be
     * averaged, and a SUM over a percentage is always wrong.
     */
    const percentages = new Set(
      allFields.filter((f) => f.dataType === 'PERCENTAGE').map((f) => f.key),
    );
    for (const c of INDICATOR_CANDIDATES) {
      if (percentages.has(c.fieldKey)) {
        expect({ key: c.fieldKey, aggregation: c.aggregation }).toEqual({
          key: c.fieldKey,
          aggregation: 'AVERAGE',
        });
      }
    }
  });

  it('does not list the same question twice with the same roll-up', () => {
    // The database has a unique index on the pair, so a duplicate here fails at seed time rather
    // than on the screen. Better to fail in a test than halfway through seeding a live server.
    const pairs = INDICATOR_CANDIDATES.map((c) => `${c.fieldKey}::${c.aggregation}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('records what cannot be published, with a reason', () => {
    // Each of these is a real request that will come back. "We looked and there is no field for
    // it" is an answer worth being able to give twice, without looking again.
    expect(NOT_EXPRESSIBLE.length).toBeGreaterThan(0);
    for (const n of NOT_EXPRESSIBLE) expect(n.why.length).toBeGreaterThan(40);
  });
});
