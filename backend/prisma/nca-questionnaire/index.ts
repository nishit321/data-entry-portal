import type { RuleDef, TemplateDef } from '../demo-templates/types';
import { sections1to3 } from './sections-1-3';
import { sections4to7 } from './sections-4-7';
import { sections8to11 } from './sections-8-11';

/**
 * NCA's actual questionnaire, as the portal asks it.
 *
 * Ref NCA/ME/2025/001001, "Questionnaire for Regulatory and Infrastructure Data Tracking", for
 * Mobile Network Operators, Internet Service Providers, and Mobile Digital Financial Services.
 * Transcribed from `ref-doc/NCA Questionnaire MNO ISP MobileDFS Revised.pdf`.
 *
 * Everything before this was a demo. `prisma/demo-templates/` holds thirteen invented returns that
 * mirror the shape of the real thing, and `seedSampleTemplate` in `seed.ts` holds a twelve-field
 * sketch — both exist so that empty screens could be shown to someone, and neither collects what
 * the Authority actually needs. This file is the questionnaire an operator fills in.
 *
 * ## The rules below, and why they are not optional
 *
 * A questionnaire is a set of questions; a *return* is a set of answers that have to agree with
 * each other. The rules are that agreement, and they come from `docs/VALIDATION_SPEC.md` §6 rather
 * than from anyone's idea of what looks sensible. Two of them are worth knowing before reading the
 * list:
 *
 * - **The mobile money float.** Every unit of e-money issued must be backed by real money in the
 *   trust account. A shortfall is a prudential breach and blocks the return; a surplus is untidy
 *   and only warns. The tolerance is deliberately asymmetric for that reason — a symmetric one
 *   would treat over-backing customer funds as an error.
 * - **Cross-network transactions are a subset.** They are already counted inside the other types,
 *   so they are excluded from the sum and checked as "no greater than the total" instead. Adding
 *   them in would double-count, and the operator would be told their arithmetic was wrong when it
 *   was the form that was.
 *
 * ## What is deliberately not a rule
 *
 * Coverage percentages are never summed or averaged (VALIDATION_SPEC §6.3). Urban and rural
 * coverage are percentages of different populations, so any arithmetic across them produces a
 * number about nothing. There is no rule tying them to the population figure, because there is no
 * true relationship to assert.
 */

const HARD_RULES: RuleDef[] = [
  /*
   * Subscriber grids: the parts have to make the whole, per category.
   *
   * Three separate rules rather than one over nine fields. When a figure disagrees, an operator
   * should be told which category is wrong, not that something somewhere in a nine-cell grid does
   * not add up.
   */
  {
    type: 'SUM_EQUALS_TOTAL',
    severity: 'HARD',
    label: 'Mobile subscribers: postpaid and prepaid must equal the total',
    config: {
      total: 'subscribers_mobile_total',
      operands: ['subscribers_mobile_postpaid', 'subscribers_mobile_prepaid'],
    },
  },
  {
    type: 'SUM_EQUALS_TOTAL',
    severity: 'HARD',
    label: 'Fixed subscribers: postpaid and prepaid must equal the total',
    config: {
      total: 'subscribers_fixed_total',
      operands: ['subscribers_fixed_postpaid', 'subscribers_fixed_prepaid'],
    },
  },
  {
    type: 'SUM_EQUALS_TOTAL',
    severity: 'HARD',
    label: 'Broadband subscribers: postpaid and prepaid must equal the total',
    config: {
      total: 'subscribers_broadband_total',
      operands: ['subscribers_broadband_postpaid', 'subscribers_broadband_prepaid'],
    },
  },

  {
    type: 'SUM_EQUALS_TOTAL',
    severity: 'HARD',
    label: 'Revenue by service type must equal total revenue',
    config: {
      total: 'total_revenue',
      operands: [
        'revenue_fixed_telephony',
        'revenue_mobile_voice_sms',
        'revenue_broadband',
        'revenue_vas',
        'revenue_mobile_money',
      ],
    },
  },

  /*
   * Employees, checked down both axes.
   *
   * The grid can be internally wrong in two independent ways — the gender split not adding up, or
   * the citizenship split not adding up — and only checking one would let the other through.
   */
  {
    type: 'SUM_EQUALS_TOTAL',
    severity: 'HARD',
    label: 'Employees: female and male must equal the total',
    config: {
      total: 'employees_total',
      operands: ['employees_female_total', 'employees_male_total'],
    },
  },
  {
    type: 'SUM_EQUALS_TOTAL',
    severity: 'HARD',
    label: 'Employees: nationals and foreigners must equal the total',
    config: {
      total: 'employees_total',
      operands: ['employees_total_nationals', 'employees_total_foreigners'],
    },
  },

  {
    type: 'SUM_EQUALS_TOTAL',
    severity: 'HARD',
    label: 'Network expansion spend by technology must equal the total',
    config: {
      total: 'capex_total',
      operands: [
        'capex_2g',
        'capex_3g',
        'capex_4g',
        'capex_5g',
        'capex_fibre',
        'capex_wireless_broadband',
        'capex_microwave',
        'capex_vsat',
        'capex_other',
      ],
    },
  },

  {
    type: 'LESS_OR_EQUAL',
    severity: 'HARD',
    label: 'Active mobile money users cannot exceed registered accounts',
    config: { left: 'mm_active_users', right: 'mm_registered_accounts' },
  },
  {
    type: 'LESS_OR_EQUAL',
    severity: 'HARD',
    label: 'Active agents cannot exceed registered agents',
    config: { left: 'mm_agents_active', right: 'mm_agents_registered' },
  },

  /*
   * Mobile money transactions, in both volume and value.
   *
   * Cross-network is excluded from the operands and checked separately below, because it is a
   * subset of the lines above it rather than a line of its own.
   */
  {
    type: 'SUM_EQUALS_TOTAL',
    severity: 'HARD',
    label: 'Transaction volumes by type must equal the total volume',
    config: {
      total: 'mm_volume_total',
      operands: [
        'mm_volume_cash_in',
        'mm_volume_cash_out',
        'mm_volume_p2p',
        'mm_volume_merchant',
        'mm_volume_bill',
        'mm_volume_bulk',
      ],
    },
  },
  {
    type: 'SUM_EQUALS_TOTAL',
    severity: 'HARD',
    label: 'Transaction values by type must equal the total value',
    config: {
      total: 'mm_value_total',
      operands: [
        'mm_value_cash_in',
        'mm_value_cash_out',
        'mm_value_p2p',
        'mm_value_merchant',
        'mm_value_bill',
        'mm_value_bulk',
      ],
    },
  },
  {
    type: 'LESS_OR_EQUAL',
    severity: 'HARD',
    label: 'Cross-network volume is part of the total, so it cannot exceed it',
    config: { left: 'mm_volume_cross_network', right: 'mm_volume_total' },
  },
  {
    type: 'LESS_OR_EQUAL',
    severity: 'HARD',
    label: 'Cross-network value is part of the total, so it cannot exceed it',
    config: { left: 'mm_value_cross_network', right: 'mm_value_total' },
  },

  /*
   * The float against the e-money it backs.
   *
   * One rule, two tolerances. A shortfall beyond 1% means customer funds are not fully covered and
   * the return is refused; a surplus beyond 5% is only worth a look. Both numbers are from
   * VALIDATION_SPEC §6.1 and both are configurable, because a prudential margin is policy.
   */
  {
    type: 'FLOAT_RECONCILE',
    severity: 'HARD',
    label: 'The float must cover the e-money issued',
    config: {
      balance: 'mm_float_balance',
      backing: 'mm_emoney_issued',
      shortfallPercent: 1,
      surplusPercent: 5,
    },
  },

  /*
   * Not a rule: fixed internet by access type against a total.
   *
   * VALIDATION_SPEC §6.1 asks for "fixed internet by access type = total fixed internet", and the
   * paper form has no field that plainly is that total. Section 1's subscriber grid has a "Fixed"
   * row and a "Broadband" row; Section 4 lists fixed *internet* subscribers by access type. Which
   * of those two the access types add up to is not stated anywhere, and the two readings are not
   * close: "Fixed" most naturally means fixed lines, "Broadband" may or may not include mobile.
   *
   * Written as a rule against the wrong one, this would have forced `postpaid + prepaid` to equal
   * `DSL + fibre + satellite + wireless` and refused almost every honest return. A blocking rule
   * built on a guess is worse than no rule at all, so this is a question for NCA rather than an
   * assumption here. It is recorded in `docs/REMAINING_WORK.md`.
   */

  /*
   * Spectrum: licensed cannot exceed allocated, band by band.
   *
   * The direction was open when VALIDATION_SPEC was written and NCA settled it on 3 September
   * 2026: "Allocated is what NCA assigns; Licensed is the portion under a current, paid-up
   * licence." A licensed figure above the allocated one therefore describes something impossible.
   * The two field labels say the same thing, so an operator who trips this can see why.
   */
  ...['700', '800', '900', '1800', '2100', '2600', '3500'].map((band): RuleDef => ({
    type: 'LESS_OR_EQUAL',
    severity: 'HARD',
    label: `Spectrum licensed cannot exceed spectrum allocated, ${band} MHz`,
    config: { left: `spectrum_licensed_${band}`, right: `spectrum_allocated_${band}` },
  })),
];

const SOFT_RULES: RuleDef[] = [
  /*
   * Revenue reported as nothing while subscribers are reported.
   *
   * A warning rather than a refusal: it is occasionally true, for an operator in its first weeks
   * or one whose billing ran late. It is far more often a service line left blank.
   */
  {
    type: 'NONZERO_REQUIRES',
    severity: 'SOFT',
    label: 'Subscribers were reported but revenue was not',
    config: { when: 'subscribers_mobile_total', require: 'total_revenue' },
  },
  {
    type: 'NONZERO_REQUIRES',
    severity: 'SOFT',
    label: 'Mobile money accounts were reported but no transactions were',
    config: { when: 'mm_registered_accounts', require: 'mm_volume_total' },
  },

  /*
   * Period-on-period movement, on the figures a sudden swing actually matters in.
   *
   * Not on every number: a warning on all two hundred fields is a warning on none. These are the
   * ones NCA reads for direction — the sector's revenue, its subscriber base, its traffic and the
   * money moving through mobile money — where a 50% jump is either a real event worth knowing
   * about or a misplaced decimal point.
   */
  ...[
    { key: 'total_revenue', label: 'Total revenue' },
    { key: 'subscribers_mobile_total', label: 'Mobile subscribers' },
    { key: 'mobile_broadband_data_gb', label: 'Mobile broadband data traffic' },
    { key: 'mm_value_total', label: 'Mobile money transaction value' },
    { key: 'capex_total', label: 'Network expansion spend' },
  ].map((f): RuleDef => ({
    type: 'PERIOD_ON_PERIOD',
    severity: 'SOFT',
    label: `${f.label} moved sharply from the previous period`,
    config: { field: f.key, thresholdPercent: 50 },
  })),
];

export const ncaQuestionnaire: TemplateDef = {
  name: 'Questionnaire for Regulatory and Infrastructure Data Tracking',
  description:
    "The Authority's return for mobile network operators, internet service providers and mobile " +
    'digital financial services. Report figures for the current period only, give money in South ' +
    'Sudanese Pounds, and complete only the sections that apply to you. Where a figure is nil, ' +
    'enter 0; where it is unavailable, mark it so and give the reason.',
  sections: [...sections1to3, ...sections4to7, ...sections8to11],
  rules: [...HARD_RULES, ...SOFT_RULES],
};
