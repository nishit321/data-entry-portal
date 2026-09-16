import type { SectionDef } from '../demo-templates/types';

/**
 * Sections 1 to 3 of NCA's questionnaire: who the operator is, what it earned, and whether it is
 * in good standing.
 *
 * Transcribed from `ref-doc/NCA Questionnaire MNO ISP MobileDFS Revised.pdf`, Ref
 * NCA/ME/2025/001001. Section numbers, titles, applicability and frequency all come from the
 * headings in that document rather than from anyone's judgement, so a reader with the PDF beside
 * them can check this file line by line.
 *
 * The one transformation that is not a copy: the paper form asks several questions as small
 * tables, and the portal stores one value per field. A table therefore becomes one field per cell,
 * named `<subject>_<row>_<column>`. Question 8's subscriber grid is three rows by three columns, so
 * it is nine fields. That is the only way a flat store can hold a grid, and it is what makes the
 * figures addable, comparable and checkable later — a single free-text box holding a whole table
 * would look closer to the paper and be worth nothing.
 */
export const sections1to3: SectionDef[] = [
  {
    key: 'general_information',
    title: 'Section 1: General Information',
    description:
      'Who you are, how large you are, and which services you offer. The services you tick here ' +
      'decide which later sections you are asked to complete.',
    applicableEntityTypes: ['MNO', 'ISP', 'MMO', 'OTHER'],
    frequency: 'QUARTERLY_AND_ANNUAL',
    fields: [
      {
        key: 'operator_name',
        label: 'Name of operator',
        dataType: 'TEXT',
        isMandatory: true,
      },
      {
        key: 'operator_type',
        label: 'Type of operator',
        dataType: 'TEXT',
        description: 'MNO, ISP, MMO, or another type. State which if it is another.',
        allowsOther: true,
        isMandatory: true,
      },
      {
        key: 'years_in_operation',
        label: 'Years in operation',
        dataType: 'INTEGER',
        minValue: 0,
        maxValue: 200,
        isMandatory: true,
        flowOrStock: 'STOCK',
      },
      {
        key: 'geographic_scope',
        label: 'Geographic scope of operations',
        dataType: 'TEXT',
        description: 'National, regional, or another scope. State which if it is another.',
        allowsOther: true,
        isMandatory: true,
      },
      /*
       * "License Number and Date of Issuance" is one line on the paper and two facts. Split,
       * because a date kept as part of a sentence cannot be sorted, filtered or checked against a
       * licence's expiry — and the licence repository already holds real dates to compare it to.
       */
      {
        key: 'licence_number',
        label: 'Licence number',
        dataType: 'TEXT',
        isMandatory: true,
      },
      {
        key: 'licence_issued_on',
        label: 'Date the licence was issued',
        dataType: 'DATE',
        isMandatory: true,
      },
      {
        key: 'headquarters_address',
        label: 'Headquarters address',
        dataType: 'TEXTAREA',
        isMandatory: true,
      },
      {
        key: 'branch_office_addresses',
        label: 'Branch office addresses',
        dataType: 'TEXTAREA',
        description: 'One address per line. Leave blank if you have no branch offices.',
      },

      /*
       * Question 8, the subscriber grid: three categories by three columns.
       *
       * "Prepaid" on the paper reads "Prepaid (active last 90 days)", and that qualifier is kept in
       * the label rather than dropped into a note. It is the difference between a SIM that exists
       * and a SIM that is used, which is the whole reason the column is there.
       */
      {
        key: 'subscribers_mobile_postpaid',
        label: 'Mobile subscribers, postpaid',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscribers_mobile_prepaid',
        label: 'Mobile subscribers, prepaid and active in the last 90 days',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscribers_mobile_total',
        label: 'Mobile subscribers, total',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscribers_fixed_postpaid',
        label: 'Fixed subscribers, postpaid',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscribers_fixed_prepaid',
        label: 'Fixed subscribers, prepaid and active in the last 90 days',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscribers_fixed_total',
        label: 'Fixed subscribers, total',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscribers_broadband_postpaid',
        label: 'Broadband subscribers, postpaid',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscribers_broadband_prepaid',
        label: 'Broadband subscribers, prepaid and active in the last 90 days',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscribers_broadband_total',
        label: 'Broadband subscribers, total',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },

      // Question 9: the person NCA writes to when a return needs a query.
      {
        key: 'contact_name',
        label: 'Primary contact, name',
        dataType: 'TEXT',
        isMandatory: true,
      },
      {
        key: 'contact_title',
        label: 'Primary contact, job title',
        dataType: 'TEXT',
        isMandatory: true,
      },
      {
        key: 'contact_email',
        label: 'Primary contact, email address',
        dataType: 'TEXT',
        isMandatory: true,
      },
      {
        key: 'contact_phone',
        label: 'Primary contact, phone number',
        dataType: 'TEXT',
        isMandatory: true,
      },

      /*
       * Question 10, and the most consequential answer on the form.
       *
       * It is not only a description of the operator: it decides which later sections exist at all.
       * Tick Mobile Money and Section 6 appears; leave it unticked and Section 6 is not shown, not
       * required, and a figure reported into it is a hard error. `SERVICE_TYPE` is the lookup those
       * codes come from, so the ticked value and the code that gates the section are the same
       * string rather than two spellings of one idea.
       */
      {
        key: 'services_offered',
        label: 'Services offered',
        dataType: 'REFERENCE',
        description:
          'Tick every service you provide. This decides which sections of the return you are ' +
          'asked to complete.',
        referenceCategory: 'SERVICE_TYPE',
        allowsOther: true,
        isMandatory: true,
      },
    ],
  },

  {
    key: 'financial_information',
    title: 'Section 2: Financial Information',
    description:
      'Revenue, investment and staffing for the reporting period. All money in South Sudanese ' +
      'Pounds.',
    applicableEntityTypes: ['MNO', 'ISP', 'MMO', 'OTHER'],
    frequency: 'QUARTERLY_AND_ANNUAL',
    fields: [
      /*
       * Question 1: revenue by service type, with a stated total.
       *
       * The total is entered rather than calculated, and then checked against the parts by a rule.
       * Calculating it would hide a disagreement; checking it surfaces one, which is the point —
       * a total that does not match its parts is usually a service line somebody forgot.
       *
       * FLOW_ENTERED, not FLOW_DERIVED: VALIDATION_SPEC §4.1 is explicit that the annual revenue
       * figure comes from audited accounts rather than from adding up four quarters, and that the
       * two are reconciled with an explanation when they differ.
       */
      {
        key: 'revenue_fixed_telephony',
        label: 'Revenue from fixed telephony services',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'revenue_mobile_voice_sms',
        label: 'Revenue from mobile voice and SMS',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'revenue_broadband',
        label: 'Revenue from fixed and mobile broadband services',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'revenue_vas',
        label: 'Revenue from value-added services',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'revenue_mobile_money',
        label: 'Revenue from mobile money services',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'total_revenue',
        label: 'Total revenue',
        dataType: 'MONETARY',
        description: 'All service lines together. It should equal the five figures above.',
        unit: 'SSP',
        minValue: 0,
        isMandatory: true,
        flowOrStock: 'FLOW_ENTERED',
        /*
         * The figure the levy is assessed on, and the only field on this questionnaire that
         * carries the flag.
         *
         * Q14 assesses the levy as a percentage of assessable revenue, and "assessable revenue" has
         * to be one named answer rather than a sum the portal works out for itself: an operator
         * disputing a levy is entitled to point at the line it was taken from. It also keeps this
         * figure off the public portal, which refuses a levy-basis field outright.
         */
        isLevyBasis: true,
      },

      {
        key: 'ict_infrastructure_investment',
        label: 'Total investment in ICT infrastructure',
        dataType: 'MONETARY',
        description: 'Invested during the reporting period.',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },

      /*
       * Question 3: employees by gender and citizenship, three rows by three columns.
       *
       * Kept as counts rather than a narrative because this is what the Employment and
       * Localisation reporting rests on: the share of Nationals is a policy measure, and a
       * percentage cannot be recomputed from a sentence.
       */
      {
        key: 'employees_female_nationals',
        label: 'Employees, female, nationals',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'employees_female_foreigners',
        label: 'Employees, female, foreigners',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'employees_female_total',
        label: 'Employees, female, total',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'employees_male_nationals',
        label: 'Employees, male, nationals',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'employees_male_foreigners',
        label: 'Employees, male, foreigners',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'employees_male_total',
        label: 'Employees, male, total',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'employees_total_nationals',
        label: 'Employees, total, nationals',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'employees_total_foreigners',
        label: 'Employees, total, foreigners',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'employees_total',
        label: 'Employees, total',
        dataType: 'INTEGER',
        description: 'Everyone employed at the end of the reporting period.',
        minValue: 0,
        isMandatory: true,
        flowOrStock: 'STOCK',
      },

      // Question 4: network expansion and upgrade spend, by technology.
      {
        key: 'capex_2g',
        label: 'Network expansion and upgrades, 2G',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'capex_3g',
        label: 'Network expansion and upgrades, 3G',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'capex_4g',
        label: 'Network expansion and upgrades, 4G',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'capex_5g',
        label: 'Network expansion and upgrades, 5G',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'capex_fibre',
        label: 'Network expansion and upgrades, fibre',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'capex_wireless_broadband',
        label: 'Network expansion and upgrades, wireless broadband',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'capex_microwave',
        label: 'Network expansion and upgrades, microwave',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'capex_vsat',
        label: 'Network expansion and upgrades, VSAT',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'capex_other',
        label: 'Network expansion and upgrades, other technology',
        dataType: 'MONETARY',
        description: 'State the technology in the box beside the figure.',
        unit: 'SSP',
        minValue: 0,
        allowsOther: true,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'capex_total',
        label: 'Network expansion and upgrades, total',
        dataType: 'MONETARY',
        description: 'All technologies together. It should equal the figures above.',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },

      /*
       * Question 5: energy generation and storage.
       *
       * The paper asks operators to "state capacity / investment" on one line, which is two
       * different measures in two different units. Recorded as text rather than guessed at: a
       * numeric field would force every operator into whichever of the two we picked, and half of
       * them would answer the other one anyway. Flagged for NCA in `docs/REMAINING_WORK.md`; if
       * they confirm one measure, these become numbers and gain a unit.
       */
      {
        key: 'energy_generation_diesel',
        label: 'Energy generation, diesel',
        dataType: 'TEXT',
        description: 'State the capacity added, or the amount invested.',
      },
      {
        key: 'energy_generation_wind',
        label: 'Energy generation, wind',
        dataType: 'TEXT',
        description: 'State the capacity added, or the amount invested.',
      },
      {
        key: 'energy_generation_solar',
        label: 'Energy generation, solar',
        dataType: 'TEXT',
        description: 'State the capacity added, or the amount invested.',
      },
      {
        key: 'energy_generation_hybrid',
        label: 'Energy generation, hybrid',
        dataType: 'TEXT',
        description: 'State the capacity added, or the amount invested.',
      },
      {
        key: 'energy_generation_other',
        label: 'Energy generation, other',
        dataType: 'TEXT',
        description: 'Name the source, and state the capacity added or the amount invested.',
        allowsOther: true,
      },
      {
        key: 'energy_storage_lithium_ion',
        label: 'Energy storage, lithium-ion',
        dataType: 'TEXT',
        description: 'State the capacity added, or the amount invested.',
      },
      {
        key: 'energy_storage_other_chemical',
        label: 'Energy storage, other chemical',
        dataType: 'TEXT',
        description: 'State the capacity added, or the amount invested.',
      },
      {
        key: 'energy_storage_capacitive',
        label: 'Energy storage, capacitive',
        dataType: 'TEXT',
        description: 'State the capacity added, or the amount invested.',
      },
      {
        key: 'energy_storage_other',
        label: 'Energy storage, other',
        dataType: 'TEXT',
        description: 'Name the type, and state the capacity added or the amount invested.',
        allowsOther: true,
      },
    ],
  },

  {
    key: 'regulatory_compliance',
    title: 'Section 3: Regulatory Compliance',
    description:
      'Your standing with national and international regulation. Questions 3 and 4 are for mobile ' +
      'network operators.',
    applicableEntityTypes: ['MNO', 'ISP', 'MMO', 'OTHER'],
    frequency: 'ANNUAL',
    fields: [
      {
        key: 'compliance_level',
        label: 'Compliance with national and international regulations',
        dataType: 'TEXT',
        description: 'Fully compliant, partially compliant, or non-compliant. Explain below.',
        allowsOther: true,
        isMandatory: true,
      },
      {
        key: 'compliance_explanation',
        label: 'Explanation of your compliance level',
        dataType: 'TEXTAREA',
      },
      {
        key: 'regulatory_fines_paid',
        label: 'Regulatory fines or penalties paid',
        dataType: 'MONETARY',
        description: 'Enter 0 if none were paid in the period.',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'regulatory_fines_reasons',
        label: 'What those fines or penalties were for',
        dataType: 'TEXTAREA',
      },
      {
        key: 'spectrum_licence_status',
        label: 'Spectrum licence status',
        dataType: 'TEXT',
        description: 'Up to date, pending renewal, or something else. State which.',
        allowsOther: true,
      },

      /*
       * Question 4: spectrum allocated against spectrum licensed, band by band.
       *
       * NCA's own definitions are in the labels rather than only in the validation rule, on their
       * instruction of 3 September 2026: "Allocated is what NCA assigns; Licensed is the portion
       * under a current, paid-up licence." An operator who reads "Allocated" as "what we are
       * actually using" will report licensed above allocated, trip the rule, and have no idea why.
       * The rule that catches it is right; a rule doing the work a label should have done is not.
       */
      ...[
        { code: '700', label: '700 MHz' },
        { code: '800', label: '800 MHz' },
        { code: '900', label: '900 MHz' },
        { code: '1800', label: '1800 MHz' },
        { code: '2100', label: '2100 MHz' },
        { code: '2600', label: '2600 MHz' },
        { code: '3500', label: '3500 MHz' },
      ].flatMap((band) => [
        {
          key: `spectrum_allocated_${band.code}`,
          label: `Spectrum allocated, ${band.label}`,
          dataType: 'DECIMAL' as const,
          description: 'What the Authority has assigned to you in this band.',
          unit: 'MHz',
          decimals: 2,
          minValue: 0,
          maxValue: 2000,
          flowOrStock: 'STOCK' as const,
        },
        {
          key: `spectrum_licensed_${band.code}`,
          label: `Spectrum licensed, ${band.label}`,
          dataType: 'DECIMAL' as const,
          description: 'The portion of that assignment under a current, paid-up licence.',
          unit: 'MHz',
          decimals: 2,
          minValue: 0,
          maxValue: 2000,
          flowOrStock: 'STOCK' as const,
        },
      ]),
      {
        key: 'spectrum_allocated_other',
        label: 'Spectrum allocated, other band',
        dataType: 'DECIMAL',
        description: 'Name the band, and give what the Authority has assigned to you in it.',
        unit: 'MHz',
        decimals: 2,
        minValue: 0,
        maxValue: 2000,
        allowsOther: true,
        flowOrStock: 'STOCK',
      },
      {
        key: 'spectrum_licensed_other',
        label: 'Spectrum licensed, other band',
        dataType: 'DECIMAL',
        description: 'The portion of that assignment under a current, paid-up licence.',
        unit: 'MHz',
        decimals: 2,
        minValue: 0,
        maxValue: 2000,
        allowsOther: true,
        flowOrStock: 'STOCK',
      },
    ],
  },
];
