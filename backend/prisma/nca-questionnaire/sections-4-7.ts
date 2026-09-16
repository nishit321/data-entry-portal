import type { SectionDef } from '../demo-templates/types';

/**
 * Sections 4 to 7 of NCA's questionnaire: the network itself, what runs over it, mobile money, and
 * how well any of it works.
 *
 * Two applicability rules in here are worth reading before the fields, because they are the reason
 * the portal shows different operators different forms:
 *
 *  - **Section 6 is gated by a service, not by an operator type.** The paper says it is for Mobile
 *    DFS providers, and the portal reads that from the return's own answer to question 10 of
 *    Section 1 rather than from what the operator was licensed as. An MNO that runs a mobile money
 *    arm ticks the service and gets the section; one that stops offering it next quarter does not.
 *    `requiredServiceCode` is what expresses that.
 *  - **Section 7 is quarterly only.** It is the one section on the form with a single frequency,
 *    and quality figures averaged over a year would hide exactly the bad quarter they exist to
 *    surface.
 */
export const sections4to7: SectionDef[] = [
  {
    key: 'network_coverage',
    title: 'Section 4: Network Infrastructure and Coverage',
    description: 'Where your network reaches, and what it is built from.',
    applicableEntityTypes: ['MNO', 'ISP'],
    frequency: 'QUARTERLY_AND_ANNUAL',
    fields: [
      {
        key: 'technology_stack',
        label: 'Technology stack',
        dataType: 'REFERENCE',
        description: 'Tick every generation you operate.',
        referenceCategory: 'TECHNOLOGY',
        allowsOther: true,
        isMandatory: true,
      },

      /*
       * Question 2: coverage by geographic classification.
       *
       * These four percentages must never be added or averaged together. VALIDATION_SPEC §6.3 is
       * unusually blunt about it, and the reason is arithmetic rather than policy: urban and rural
       * coverage are percentages of different populations, so their mean is a number about nothing.
       * The portal holds them as four separate figures for that reason, and the total population
       * figure below is the operator's own, not one the portal derives.
       */
      {
        key: 'coverage_urban_pct',
        label: 'Coverage of urban areas',
        dataType: 'PERCENTAGE',
        unit: '%',
        decimals: 2,
        minValue: 0,
        maxValue: 100,
        flowOrStock: 'STOCK',
      },
      {
        key: 'coverage_peri_urban_pct',
        label: 'Coverage of peri-urban areas',
        dataType: 'PERCENTAGE',
        unit: '%',
        decimals: 2,
        minValue: 0,
        maxValue: 100,
        flowOrStock: 'STOCK',
      },
      {
        key: 'coverage_rural_pct',
        label: 'Coverage of rural areas',
        dataType: 'PERCENTAGE',
        unit: '%',
        decimals: 2,
        minValue: 0,
        maxValue: 100,
        flowOrStock: 'STOCK',
      },
      {
        key: 'coverage_population_pct',
        label: 'Total population covered, at 2G or better',
        dataType: 'PERCENTAGE',
        description:
          'Your own figure for the share of the population within coverage. Do not add the three ' +
          'figures above together: each is a percentage of a different population.',
        unit: '%',
        decimals: 2,
        minValue: 0,
        maxValue: 100,
        flowOrStock: 'STOCK',
      },

      {
        key: 'fibre_km_installed',
        label: 'Fibre installed',
        dataType: 'DECIMAL',
        description: 'Total route kilometres laid, whether lit or not.',
        unit: 'km',
        decimals: 2,
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'fibre_active_connections',
        label: 'Active fibre connections',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },

      /*
       * Question 4: fixed internet subscribers by access type.
       *
       * "Satellite" is two rows on the paper, LEO and geostationary, and they are kept apart here
       * for the same reason the paper separates them: the two have entirely different latency, and
       * a single satellite figure would make the quality numbers in Section 7 unreadable.
       */
      {
        key: 'fixed_subscribers_dsl',
        label: 'Fixed internet subscribers, DSL',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'fixed_subscribers_fibre',
        label: 'Fixed internet subscribers, fibre',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'fixed_subscribers_satellite_leo',
        label: 'Fixed internet subscribers, satellite (low earth orbit)',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'fixed_subscribers_satellite_geo',
        label: 'Fixed internet subscribers, satellite (geostationary)',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'fixed_subscribers_wireless_broadband',
        label: 'Fixed internet subscribers, wireless broadband',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
    ],
  },

  {
    key: 'traffic_data',
    title: 'Section 5: Mobile and Fixed Traffic Data',
    description: 'What actually ran over the network during the reporting period.',
    applicableEntityTypes: ['MNO', 'ISP'],
    frequency: 'QUARTERLY_AND_ANNUAL',
    fields: [
      // Question 1: voice traffic, domestic and international.
      {
        key: 'voice_minutes_mobile_to_mobile',
        label: 'Voice traffic, mobile to mobile',
        dataType: 'DECIMAL',
        unit: 'minutes',
        decimals: 0,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
      {
        key: 'voice_minutes_mobile_to_fixed',
        label: 'Voice traffic, mobile to fixed',
        dataType: 'DECIMAL',
        unit: 'minutes',
        decimals: 0,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
      {
        key: 'voice_minutes_fixed_to_mobile',
        label: 'Voice traffic, fixed to mobile',
        dataType: 'DECIMAL',
        unit: 'minutes',
        decimals: 0,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
      {
        key: 'voice_minutes_international_incoming',
        label: 'Voice traffic, international incoming',
        dataType: 'DECIMAL',
        unit: 'minutes',
        decimals: 0,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
      {
        key: 'voice_minutes_international_outgoing',
        label: 'Voice traffic, international outgoing',
        dataType: 'DECIMAL',
        unit: 'minutes',
        decimals: 0,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
      {
        key: 'voice_minutes_voip',
        label: 'Voice traffic, VoIP',
        dataType: 'DECIMAL',
        unit: 'minutes',
        decimals: 0,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },

      // Question 2: subscriptions by technology and by what the subscription is for.
      {
        key: 'subscriptions_mobile_broadband_bundled',
        label: 'Mobile broadband subscriptions, data and voice bundled',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscriptions_mobile_broadband_data_only',
        label: 'Mobile broadband subscriptions, data only',
        dataType: 'INTEGER',
        description: 'Dongles, tablets and anything else that carries no voice plan.',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscriptions_2g',
        label: 'Subscriptions on 2G',
        dataType: 'INTEGER',
        description: 'GSM, GPRS or EDGE.',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscriptions_3g',
        label: 'Subscriptions on 3G',
        dataType: 'INTEGER',
        description: 'UMTS or HSPA.',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscriptions_4g',
        label: 'Subscriptions on 4G',
        dataType: 'INTEGER',
        description: 'LTE or LTE-Advanced.',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscriptions_5g',
        label: 'Subscriptions on 5G',
        dataType: 'INTEGER',
        description: 'Leave blank if you do not operate 5G.',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'subscriptions_m2m_iot',
        label: 'Machine-to-machine and Internet of Things connections',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },

      {
        key: 'mobile_broadband_data_gb',
        label: 'Total mobile broadband data traffic',
        dataType: 'DECIMAL',
        unit: 'GB',
        decimals: 2,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
      {
        key: 'sms_sent',
        label: 'Total SMS sent',
        dataType: 'DECIMAL',
        unit: 'messages',
        decimals: 0,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
      {
        key: 'mms_sent',
        label: 'Total MMS sent',
        dataType: 'DECIMAL',
        unit: 'messages',
        decimals: 0,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
      {
        key: 'ott_data_gb',
        label: 'Over-the-top data usage',
        dataType: 'DECIMAL',
        description: 'IPTV, video on demand and similar services.',
        unit: 'GB',
        decimals: 2,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
      {
        key: 'ott_data_explanation',
        label: 'What that over-the-top usage covers',
        dataType: 'TEXTAREA',
        description: 'The paper form asks for an explanation alongside the figure.',
      },
    ],
  },

  {
    key: 'mobile_money',
    title: 'Section 6: Mobile Money Services',
    description:
      'For operators offering mobile money. You are asked this section because you ticked Mobile ' +
      'Money Services in Section 1.',
    applicableEntityTypes: ['MNO', 'MMO', 'OTHER'],
    frequency: 'QUARTERLY_AND_ANNUAL',
    /*
     * The gate, and the reason this section is not simply keyed to MMO.
     *
     * An MNO with a mobile money arm has to complete it; an MMO that has stopped offering the
     * service should not be asked to. Both follow from the return's own answer rather than from
     * the licence, which is what `requiredServiceCode` reads. The consequence runs both ways: the
     * section is hidden when the service is not ticked, and a figure reported into it anyway is a
     * hard error rather than a quietly accepted contradiction.
     */
    requiredServiceCode: 'MOBILE_MONEY',
    fields: [
      {
        key: 'mm_registered_accounts',
        label: 'Registered mobile money accounts',
        dataType: 'INTEGER',
        minValue: 0,
        isMandatory: true,
        flowOrStock: 'STOCK',
      },
      {
        key: 'mm_active_users',
        label: 'Active mobile money users',
        dataType: 'INTEGER',
        description: 'Users with activity in the last 90 days. Cannot exceed registered accounts.',
        minValue: 0,
        isMandatory: true,
        flowOrStock: 'STOCK',
      },
      {
        key: 'mm_interoperability',
        label: 'Cross-network interoperability',
        dataType: 'BOOLEAN',
        description: 'Can your customers transact with accounts on other networks?',
      },

      /*
       * Question 4: transactions by type, in volume and in value.
       *
       * Both columns, because they answer different questions and neither substitutes for the
       * other: volume is how many people use the service, value is how much money moves. A total
       * is asked for as well, and checked against the parts rather than computed from them.
       */
      ...[
        { code: 'cash_in', label: 'cash-in' },
        { code: 'cash_out', label: 'cash-out' },
        { code: 'p2p', label: 'peer-to-peer transfers' },
        { code: 'merchant', label: 'merchant payments' },
        { code: 'bill', label: 'bill payments' },
        { code: 'bulk', label: 'bulk disbursements' },
        // Relabelled on VALIDATION_SPEC's instruction: this line is a subset of the types above
        // it, not an eighth type. An operator who reads it as a separate category double-counts,
        // and the total stops matching its parts for a reason nobody can find.
        { code: 'cross_network', label: 'of which cross-network (interoperable)' },
      ].flatMap((kind) => [
        {
          key: `mm_volume_${kind.code}`,
          label: `Transaction volume, ${kind.label}`,
          dataType: 'DECIMAL' as const,
          unit: 'transactions',
          decimals: 0,
          minValue: 0,
          flowOrStock: 'FLOW_DERIVED' as const,
        },
        {
          key: `mm_value_${kind.code}`,
          label: `Transaction value, ${kind.label}`,
          dataType: 'MONETARY' as const,
          unit: 'SSP',
          minValue: 0,
          flowOrStock: 'FLOW_ENTERED' as const,
        },
      ]),
      {
        key: 'mm_volume_total',
        label: 'Transaction volume, total',
        dataType: 'DECIMAL',
        description: 'All transaction types together.',
        unit: 'transactions',
        decimals: 0,
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
      {
        key: 'mm_value_total',
        label: 'Transaction value, total',
        dataType: 'MONETARY',
        description: 'All transaction types together.',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },

      /*
       * Question 5: the float, and what backs it.
       *
       * The single most consequential pair on this section. Every shilling of e-money issued must
       * be backed by a shilling in the trust account; a shortfall means customer funds are not
       * fully covered, which is why VALIDATION_SPEC §6.1 makes it a hard error rather than a
       * warning. A surplus is only a warning: holding more than you have issued is untidy, not
       * unsafe.
       */
      {
        key: 'mm_float_balance',
        label: 'Float or trust account balance at period end',
        dataType: 'MONETARY',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'mm_emoney_issued',
        label: 'E-money issued and outstanding at period end',
        dataType: 'MONETARY',
        description: 'The float must cover this. A shortfall is not accepted.',
        unit: 'SSP',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'mm_float_reconciliation',
        label: 'How the float reconciles to e-money issued',
        dataType: 'TEXTAREA',
      },

      {
        key: 'mm_agents_registered',
        label: 'Registered mobile money agents',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'STOCK',
      },
      {
        key: 'mm_agents_active',
        label: 'Active mobile money agents',
        dataType: 'INTEGER',
        description: 'Agents with activity in the last 90 days.',
        minValue: 0,
        flowOrStock: 'STOCK',
      },

      // Question 7: the anti-money-laundering measures NCA tracks.
      {
        key: 'mm_kyc_verified_pct',
        label: 'Accounts fully KYC-verified',
        dataType: 'PERCENTAGE',
        unit: '%',
        decimals: 2,
        minValue: 0,
        maxValue: 100,
        flowOrStock: 'STOCK',
      },
      {
        key: 'mm_suspicious_reports',
        label: 'Suspicious transaction reports filed in the period',
        dataType: 'INTEGER',
        minValue: 0,
        flowOrStock: 'FLOW_DERIVED',
      },
    ],
  },

  {
    key: 'quality_of_service',
    title: 'Section 7: Quality of Service',
    description: 'How the network performed. Question 4 is for operators offering mobile money.',
    applicableEntityTypes: ['MNO', 'ISP', 'MMO'],
    // Quarterly only, as the paper says. A year's average would hide the bad quarter.
    frequency: 'QUARTERLY',
    fields: [
      {
        key: 'call_drop_rate_pct',
        label: 'Call drop rate',
        dataType: 'PERCENTAGE',
        unit: '%',
        decimals: 2,
        minValue: 0,
        maxValue: 100,
        flowOrStock: 'NONE',
      },
      {
        key: 'call_setup_success_pct',
        label: 'Call setup success rate',
        dataType: 'PERCENTAGE',
        unit: '%',
        decimals: 2,
        minValue: 0,
        maxValue: 100,
        flowOrStock: 'NONE',
      },
      {
        key: 'avg_download_mbps',
        label: 'Average download speed',
        dataType: 'DECIMAL',
        unit: 'Mbps',
        decimals: 2,
        minValue: 0,
        maxValue: 10000,
        flowOrStock: 'NONE',
      },
      {
        key: 'avg_upload_mbps',
        label: 'Average upload speed',
        dataType: 'DECIMAL',
        unit: 'Mbps',
        decimals: 2,
        minValue: 0,
        maxValue: 10000,
        flowOrStock: 'NONE',
      },
      /*
       * The three latency figures carry different ceilings, from VALIDATION_SPEC §2.1: local 500
       * ms, regional 1,000, international 2,000. One shared bound would either wave through a
       * local figure that is plainly wrong or refuse an international one that is merely poor.
       */
      {
        key: 'latency_local_ms',
        label: 'Latency, local',
        dataType: 'DECIMAL',
        unit: 'ms',
        decimals: 1,
        minValue: 0,
        maxValue: 500,
        flowOrStock: 'NONE',
      },
      {
        key: 'latency_regional_ms',
        label: 'Latency, regional',
        dataType: 'DECIMAL',
        unit: 'ms',
        decimals: 1,
        minValue: 0,
        maxValue: 1000,
        flowOrStock: 'NONE',
      },
      {
        key: 'latency_international_ms',
        label: 'Latency, international',
        dataType: 'DECIMAL',
        unit: 'ms',
        decimals: 1,
        minValue: 0,
        maxValue: 2000,
        flowOrStock: 'NONE',
      },

      /*
       * Question 2: consumer complaints, by category, with how long each took to settle.
       *
       * Both halves matter and the second is the one operators find harder: a service can have few
       * complaints because it is good, or because complaining about it is hopeless. Resolution
       * time separates those two.
       */
      ...[
        { code: 'voice', label: 'voice' },
        { code: 'data', label: 'data' },
        { code: 'mobile_money', label: 'mobile money' },
        { code: 'vas', label: 'value-added services' },
        { code: 'sms_mms', label: 'SMS and MMS' },
        { code: 'other', label: 'other' },
      ].flatMap((kind) => [
        {
          key: `complaints_${kind.code}_count`,
          label: `Complaints received, ${kind.label}`,
          dataType: 'INTEGER' as const,
          description: 'In the last 90 days.',
          minValue: 0,
          flowOrStock: 'FLOW_DERIVED' as const,
        },
        {
          key: `complaints_${kind.code}_hours`,
          label: `Average time to resolve, ${kind.label}`,
          dataType: 'DECIMAL' as const,
          description: 'Against your service level agreement.',
          unit: 'hours',
          decimals: 1,
          minValue: 0,
          flowOrStock: 'NONE' as const,
        },
      ]),

      {
        key: 'broadband_target_compliance',
        label: 'Compliance with national mobile broadband coverage targets',
        dataType: 'TEXTAREA',
      },

      /*
       * Question 4: the mobile money quality and fraud indicators.
       *
       * On the paper these sit inside Section 7 and are marked "Applicable to Mobile DFS
       * providers". They stay here rather than moving to Section 6, because the section numbering
       * is how an operator with the paper form beside them finds their place — and because
       * Section 7 is quarterly while Section 6 is quarterly and annual, so moving them would
       * quietly change how often they are collected.
       */
      ...[
        { code: 'transaction_success', label: 'Transaction success rate', unit: '%', max: 100 },
        { code: 'uptime', label: 'System uptime and availability', unit: '%', max: 100 },
        { code: 'interoperability', label: 'Interoperability performance', unit: '%', max: 100 },
        {
          code: 'user_experience',
          label: 'User experience and accessibility',
          unit: '%',
          max: 100,
        },
        { code: 'security', label: 'Overall security and fraud prevention', unit: '%', max: 100 },
        {
          code: 'suspicious_accuracy',
          label: 'Suspicious activity reported accurately and on time',
          unit: '%',
          max: 100,
        },
        {
          code: 'suspicious_escalation',
          label: 'Suspicious activity escalated through the right channels',
          unit: '%',
          max: 100,
        },
        { code: 'fraud_sla', label: 'Fraud cases resolved within the SLA', unit: '%', max: 100 },
      ].map((kpi) => ({
        key: `mm_kpi_${kpi.code}_pct`,
        label: `Mobile money: ${kpi.label.toLowerCase()}`,
        dataType: 'PERCENTAGE' as const,
        unit: kpi.unit,
        decimals: 2,
        minValue: 0,
        maxValue: kpi.max,
        flowOrStock: 'NONE' as const,
      })),
      {
        key: 'mm_kpi_processing_seconds',
        label: 'Mobile money: transaction processing time',
        dataType: 'DECIMAL',
        // Seconds, not a percentage: the paper's column header reads "Value (%) / sec" because one
        // row of the table is a duration and the rest are rates.
        unit: 'seconds',
        decimals: 2,
        minValue: 0,
        flowOrStock: 'NONE',
      },
    ],
  },
];
