import type { SectionDef } from '../demo-templates/types';

/**
 * Sections 8 to 11 of NCA's questionnaire: what the operator plans to build, how it protects the
 * data it holds, what it does about its waste, and anything it wants to tell the Authority.
 *
 * These four are mostly narrative, and that is the source document's choice rather than a shortcut
 * here. A plan for rural expansion is a paragraph; forcing it into a number would produce a figure
 * nobody could act on. Where the paper does ask for a measurable — e-waste collected in tonnes, a
 * carbon estimate — it is a number, and the surrounding description stays beside it.
 */
export const sections8to11: SectionDef[] = [
  {
    key: 'expansion_plans',
    title: 'Section 8: Future Network Expansion Plans',
    description: 'What you intend to build, and roughly when.',
    applicableEntityTypes: ['MNO', 'ISP'],
    frequency: 'ANNUAL',
    fields: [
      {
        key: 'plans_4g_5g',
        label: 'Investments in 4G and 5G deployment',
        dataType: 'TEXTAREA',
        description: 'Name the regions and the timelines you expect.',
      },
      {
        key: 'plans_iot_ai',
        label: 'Investments in IoT and AI-driven network capability',
        dataType: 'TEXTAREA',
        description: 'Say whether you are investing, and give details if you are.',
      },
      {
        key: 'plans_rural',
        label: 'Expansion plans for underserved or rural areas',
        dataType: 'TEXTAREA',
      },
      {
        key: 'plans_data_centres',
        label: 'Investments in private data centres in South Sudan',
        dataType: 'TEXTAREA',
      },
      {
        key: 'plans_cloud_edge',
        label: 'Investments in cloud and edge computing',
        dataType: 'TEXTAREA',
      },
    ],
  },

  {
    key: 'security_privacy',
    title: 'Section 9: Security and Privacy',
    description: 'How you protect your network and the personal data you hold.',
    applicableEntityTypes: ['MNO', 'ISP', 'MMO', 'OTHER'],
    frequency: 'QUARTERLY_AND_ANNUAL',
    fields: [
      /*
       * The paper offers four ticks: encryption, firewalls, intrusion detection, and other.
       *
       * Held as three separate yes-or-no answers rather than one multi-select, because there is no
       * SECURITY_MEASURE lookup to choose from and inventing a reference category for four fixed
       * options would put a list in the database that nobody will ever add to. Three booleans also
       * read better on a return: each one is a question the operator answers, rather than a list
       * they skim.
       */
      {
        key: 'security_encryption',
        label: 'Encryption in use',
        dataType: 'BOOLEAN',
      },
      {
        key: 'security_firewalls',
        label: 'Firewalls in use',
        dataType: 'BOOLEAN',
      },
      {
        key: 'security_intrusion_detection',
        label: 'Intrusion detection in use',
        dataType: 'BOOLEAN',
      },
      {
        key: 'security_other',
        label: 'Other security measures',
        dataType: 'TEXT',
        description: 'Name anything else you rely on.',
        allowsOther: true,
      },
      {
        key: 'privacy_local_compliant',
        label: 'Compliant with local data protection regulation',
        dataType: 'BOOLEAN',
      },
      {
        key: 'privacy_gdpr_compliant',
        label: 'Compliant with GDPR',
        dataType: 'BOOLEAN',
        description: 'Answer for the parts of your business where it applies.',
      },
      {
        key: 'privacy_other',
        label: 'Other privacy regimes you comply with',
        dataType: 'TEXT',
        allowsOther: true,
      },
    ],
  },

  {
    key: 'environmental_sustainability',
    title: 'Section 10: Environmental Sustainability',
    description: 'Electronic waste, and what you are doing about your carbon footprint.',
    applicableEntityTypes: ['MNO', 'ISP', 'MMO', 'OTHER'],
    frequency: 'ANNUAL',
    fields: [
      {
        key: 'ewaste_takeback',
        label: 'Take-back arrangements for electronic waste',
        dataType: 'TEXTAREA',
        description:
          'How consumer and operator equipment is collected at the end of its life. Describe the ' +
          'arrangement.',
      },
      {
        key: 'ewaste_collected_tonnes',
        label: 'Electronic waste collected in the period',
        dataType: 'DECIMAL',
        unit: 'tonnes',
        decimals: 3,
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'carbon_initiatives',
        label: 'Initiatives to reduce your environmental impact',
        dataType: 'TEXTAREA',
      },
      {
        key: 'carbon_footprint_tco2e',
        label: 'Estimated carbon footprint',
        dataType: 'DECIMAL',
        description: 'Leave blank if you do not yet measure this.',
        unit: 'tCO2e',
        decimals: 2,
        minValue: 0,
        flowOrStock: 'FLOW_ENTERED',
      },
      {
        key: 'ewaste_guideline_compliance',
        label: "Steps taken to comply with the Authority's e-waste guidelines",
        dataType: 'TEXTAREA',
      },
    ],
  },

  {
    key: 'comments',
    title: 'Section 11: Comments and Recommendations',
    description:
      'Anything you want the Authority to know. This is also where you explain any figure you ' +
      'could not provide.',
    applicableEntityTypes: ['MNO', 'ISP', 'MMO', 'VENDOR', 'OTHER'],
    frequency: 'QUARTERLY_AND_ANNUAL',
    fields: [
      {
        key: 'challenges',
        label: 'Challenges you faced in the reporting period',
        dataType: 'TEXTAREA',
      },
      {
        key: 'recommendations',
        label: 'Suggestions for improving the regulatory environment',
        dataType: 'TEXTAREA',
      },
      /*
       * The instruction at the top of the paper form: "Where data is unavailable, enter 'N/A' and
       * explain in Section 11."
       *
       * The portal has a better mechanism than a box of prose — a value can be marked unavailable
       * with its own mandatory reason, field by field, which is what VALIDATION_SPEC §3 requires.
       * This field is kept anyway, because it is what the paper asks for and because an operator
       * working from the printed form will look for it. It catches the explanation that covers
       * several fields at once.
       */
      {
        key: 'unavailable_data_explanation',
        label: 'Anything you could not report, and why',
        dataType: 'TEXTAREA',
        description:
          'You can also mark an individual figure unavailable and give the reason beside it.',
      },
    ],
  },
];
