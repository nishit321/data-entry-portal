import type { PublicAggregation } from '@prisma/client';

/**
 * What the public portal could publish from NCA's questionnaire, and what it could not.
 *
 * The allowlist has been live and empty since Phase 2. The reason it stayed empty was not
 * neglect: an entry names one question by key, and until the real questionnaire was transcribed
 * there were no real keys to name. There are now 183, so each thing NCA has asked to publish can
 * be mapped to the answer it comes from, or shown not to have one.
 *
 * ## Nothing here is published by itself
 *
 * Every candidate is seeded **unpublished**. Adding a line to the allowlist and publishing it are
 * two separate decisions, and the second one is the Authority's. What this file changes is that
 * somebody ticks a box instead of typing twenty rows and guessing at field keys.
 *
 * ## Three rules the choices follow
 *
 * - **SUM for a count or an amount, AVERAGE for a rate.** Adding four operators' call-drop rates
 *   gives a number about nothing; adding their subscribers gives the sector.
 * - **Nothing that identifies an operator.** The disclosure threshold refuses any figure resting
 *   on fewer than three contributors, but that is a floor rather than a licence: a figure that
 *   only one operator could plausibly report should not be on this list at all.
 * - **The levy basis is refused outright**, by the service and not only by this list. Q4 names
 *   that revenue figure as commercially sensitive.
 */

export interface IndicatorCandidate {
  fieldKey: string;
  aggregation: PublicAggregation;
  label: string;
  unit?: string;
  description: string;
  order: number;
}

export const INDICATOR_CANDIDATES: IndicatorCandidate[] = [
  // --- How many people the sector reaches -------------------------------------------------------
  {
    fieldKey: 'subscribers_mobile_total',
    aggregation: 'SUM',
    label: 'Mobile subscribers',
    unit: 'subscribers',
    description: 'All mobile subscriptions reported across licensed operators.',
    order: 10,
  },
  {
    fieldKey: 'subscribers_broadband_total',
    aggregation: 'SUM',
    label: 'Broadband subscribers',
    unit: 'subscribers',
    description: 'Broadband subscriptions across the sector, fixed and mobile.',
    order: 20,
  },
  {
    fieldKey: 'mm_registered_accounts',
    aggregation: 'SUM',
    label: 'Registered mobile money accounts',
    unit: 'accounts',
    description: 'Accounts opened with mobile money providers.',
    order: 30,
  },
  {
    fieldKey: 'mm_active_users',
    aggregation: 'SUM',
    label: 'Active mobile money users',
    unit: 'users',
    description: 'Accounts used in the last 90 days, which is a smaller number than those opened.',
    order: 40,
  },

  // --- What technology they are on --------------------------------------------------------------
  ...(
    [
      { key: 'subscriptions_2g', label: '2G', order: 50 },
      { key: 'subscriptions_3g', label: '3G', order: 51 },
      { key: 'subscriptions_4g', label: '4G', order: 52 },
      { key: 'subscriptions_5g', label: '5G', order: 53 },
    ] as const
  ).map((t): IndicatorCandidate => ({
    fieldKey: t.key,
    aggregation: 'SUM',
    label: `Subscriptions on ${t.label}`,
    unit: 'subscriptions',
    description: `Sector subscriptions carried on ${t.label}.`,
    order: t.order,
  })),

  // --- Coverage -------------------------------------------------------------------------------
  /*
   * Coverage is averaged, not summed, and it is the one group on this list where the calculation
   * needs stating on the page as well as in the code.
   *
   * Each operator reports the share of a population it covers. Adding those shares produces a
   * figure over 100%; averaging them produces the mean operator's reach, which is a real thing and
   * is *not* the share of the country with service from somebody. VALIDATION_SPEC §6.3 makes the
   * same point about never combining the urban and rural figures.
   */
  {
    fieldKey: 'coverage_population_pct',
    aggregation: 'AVERAGE',
    label: 'Population coverage, average per operator',
    unit: '%',
    description:
      'The average share of the population an operator covers at 2G or better. Not the share of ' +
      'the country with service from somebody: an area covered by two operators is counted twice.',
    order: 60,
  },
  {
    fieldKey: 'coverage_urban_pct',
    aggregation: 'AVERAGE',
    label: 'Urban coverage, average per operator',
    unit: '%',
    description: 'The average share of urban areas an operator covers.',
    order: 61,
  },
  {
    fieldKey: 'coverage_rural_pct',
    aggregation: 'AVERAGE',
    label: 'Rural coverage, average per operator',
    unit: '%',
    description: 'The average share of rural areas an operator covers.',
    order: 62,
  },

  // --- Infrastructure ---------------------------------------------------------------------------
  {
    fieldKey: 'fibre_km_installed',
    aggregation: 'SUM',
    label: 'Fibre installed',
    unit: 'km',
    description: 'Route kilometres of fibre laid across the sector, whether lit or not.',
    order: 70,
  },
  {
    fieldKey: 'ict_infrastructure_investment',
    aggregation: 'SUM',
    label: 'Investment in ICT infrastructure',
    unit: 'SSP',
    description: 'What licensed operators invested in infrastructure during the period.',
    order: 80,
  },

  // --- Traffic ----------------------------------------------------------------------------------
  {
    fieldKey: 'mobile_broadband_data_gb',
    aggregation: 'SUM',
    label: 'Mobile data traffic',
    unit: 'GB',
    description: 'Data carried over mobile broadband across the sector.',
    order: 90,
  },
  {
    fieldKey: 'sms_sent',
    aggregation: 'SUM',
    label: 'SMS sent',
    unit: 'messages',
    description: 'Text messages sent across the sector.',
    order: 91,
  },

  // --- Quality ----------------------------------------------------------------------------------
  /*
   * Averaged for the same reason as coverage, and worth publishing precisely because a sector
   * average is what a citizen can act on: it says what service is like here, without naming whose
   * network was worst.
   */
  {
    fieldKey: 'call_drop_rate_pct',
    aggregation: 'AVERAGE',
    label: 'Call drop rate',
    unit: '%',
    description: 'The average share of calls that drop. Lower is better.',
    order: 100,
  },
  {
    fieldKey: 'call_setup_success_pct',
    aggregation: 'AVERAGE',
    label: 'Call setup success rate',
    unit: '%',
    description: 'The average share of call attempts that connect.',
    order: 101,
  },
  {
    fieldKey: 'avg_download_mbps',
    aggregation: 'AVERAGE',
    label: 'Average download speed',
    unit: 'Mbps',
    description: 'The average download speed operators report.',
    order: 102,
  },
  {
    fieldKey: 'latency_local_ms',
    aggregation: 'AVERAGE',
    label: 'Local latency',
    unit: 'ms',
    description: 'Round-trip time within the country. Lower is better.',
    order: 103,
  },
];

/**
 * What NCA has asked to publish that no question on this questionnaire answers.
 *
 * Kept in the repository rather than in somebody's head, because each of these is a real request
 * that will come back, and "we looked and there is no field for it" is an answer worth being able
 * to give twice.
 */
export const NOT_EXPRESSIBLE: { want: string; why: string }[] = [
  {
    want: 'Penetration (subscribers per head of population)',
    why:
      'The numerator is on the questionnaire; the denominator is not. Population is not something ' +
      'an operator reports, so this needs a population figure held as reference data and a ' +
      'division. An indicator today names one question and one roll-up, and cannot divide.',
  },
  {
    want: 'Market share',
    why:
      'A share is one operator against the rest, which is the definition of operator-level. The ' +
      'public pages are aggregated and sector-level by instruction, and a chart of shares names ' +
      'every operator on it.',
  },
  {
    want: 'Number of base stations',
    why:
      'The questionnaire does not ask for it. The network site register holds every mast, so the ' +
      'figure exists in the portal, but it comes from the register rather than from a return and ' +
      'an indicator reads returns.',
  },
  {
    want: 'Sector revenue',
    why:
      'Total revenue is the levy basis, and the allowlist refuses a levy-basis field outright. ' +
      'Publishing the component revenue lines instead would publish the same thing by addition, ' +
      'so it is a decision to take deliberately rather than a gap to fill quietly.',
  },
  {
    want: 'Percentage of complaints resolved',
    why:
      'Not a questionnaire answer at all: it comes from the complaint case book. The public ' +
      'portal already publishes it from there, with a median resolution time alongside, so ' +
      'nothing is missing. It simply is not an indicator.',
  },
];
