import {
  EntityStatus,
  EntityType,
  FieldType,
  FlowOrStock,
  NetworkSiteKind,
  NetworkSiteStatus,
  PeriodStatus,
  Prisma,
  PrismaClient,
  PublicAggregation,
  ReferenceCategory,
  ReportingFrequency,
  Role,
  RuleSeverity,
  RuleType,
  SubmissionStatus,
  TemplateStatus,
} from '@prisma/client';
import { hashPassword } from '../src/common/utils/password.util';

const prisma = new PrismaClient();

/** Create the initial ADMIN account if it does not exist. */
async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@nca.gov.ss').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';

  if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`Admin already exists: ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      firstName: 'System',
      lastName: 'Administrator',
      role: Role.ADMIN,
      isActive: true,
    },
  });

  console.log('Seeded admin account:');
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log('  (change this password after first login)');
}

/**
 * The three Authority reviewers (Checker → Verifier → Approver) so the review workflow can be
 * exercised end to end. Each is a distinct account — separation of duties needs different people.
 */
async function seedReviewers() {
  const password = 'Reviewer@12345';
  const reviewers: { email: string; firstName: string; role: Role }[] = [
    { email: 'checker@nca.gov.ss', firstName: 'Checker', role: Role.CHECKER },
    { email: 'verifier@nca.gov.ss', firstName: 'Verifier', role: Role.VERIFIER },
    { email: 'approver@nca.gov.ss', firstName: 'Approver', role: Role.APPROVER },
  ];
  for (const r of reviewers) {
    if (await prisma.user.findUnique({ where: { email: r.email } })) {
      console.log(`Reviewer already exists: ${r.email}`);
      continue;
    }
    await prisma.user.create({
      data: {
        email: r.email,
        passwordHash: await hashPassword(password),
        firstName: r.firstName,
        lastName: 'Authority',
        role: r.role,
        isActive: true,
      },
    });
    console.log(`Seeded reviewer: ${r.email} / ${password} (${r.role})`);
  }
}

/**
 * Create one demo operator entity, its operator-admin user, and a sample agent
 * so data segregation can be exercised end to end. Safe to re-run.
 */
async function seedDemoOperator() {
  const licenceNumber = 'NCA/MNO/2026/001';
  const operatorEmail = 'operator@demo-telecom.ss';
  const operatorPassword = 'Operator@12345';

  const entity = await prisma.entity.upsert({
    where: { licenceNumber },
    update: {},
    create: {
      name: 'Demo Telecom (MNO)',
      type: EntityType.MNO,
      status: EntityStatus.ACTIVE,
      licenceNumber,
      geographicScope: 'National',
      headquartersAddress: 'Juba, South Sudan',
    },
  });

  if (!(await prisma.user.findUnique({ where: { email: operatorEmail } }))) {
    await prisma.user.create({
      data: {
        email: operatorEmail,
        passwordHash: await hashPassword(operatorPassword),
        firstName: 'Demo',
        lastName: 'Operator',
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
        isActive: true,
      },
    });
    console.log('Seeded operator-admin account:');
    console.log(`  email:    ${operatorEmail}`);
    console.log(`  password: ${operatorPassword}`);
  }

  await prisma.agent.upsert({
    where: { entityId_agentReference: { entityId: entity.id, agentReference: 'AG-0001' } },
    update: {},
    create: {
      entityId: entity.id,
      agentReference: 'AG-0001',
      name: 'Juba Central Agent',
      location: 'Juba',
    },
  });
}

/**
 * Seed the managed lookup lists from the questionnaire's controlled fields.
 * Idempotent and non-destructive: existing rows (incl. admin edits) are left
 * untouched. "Other" is handled as a controlled free-text pair, not seeded here.
 */
async function seedReferenceData() {
  const lists: Record<ReferenceCategory, { code: string; label: string }[]> = {
    SPECTRUM_BAND: [
      { code: 'MHZ_700', label: '700 MHz' },
      { code: 'MHZ_800', label: '800 MHz' },
      { code: 'MHZ_900', label: '900 MHz' },
      { code: 'MHZ_1800', label: '1800 MHz' },
      { code: 'MHZ_2100', label: '2100 MHz' },
      { code: 'MHZ_2600', label: '2600 MHz' },
      { code: 'MHZ_3500', label: '3500 MHz' },
    ],
    TECHNOLOGY: [
      { code: '2G', label: '2G' },
      { code: '3G', label: '3G' },
      { code: '4G', label: '4G' },
      { code: '5G', label: '5G' },
      { code: 'FIBER', label: 'Fibre' },
      { code: 'WIRELESS_BROADBAND', label: 'Wireless Broadband' },
      { code: 'MICROWAVE', label: 'Microwave' },
      { code: 'VSAT', label: 'VSAT' },
    ],
    SERVICE_TYPE: [
      { code: 'MOBILE_VOICE', label: 'Mobile Voice' },
      { code: 'MOBILE_DATA', label: 'Mobile Data' },
      { code: 'MOBILE_MONEY', label: 'Mobile Money Services' },
      { code: 'FIXED_INTERNET', label: 'Fixed Internet' },
      { code: 'VAS', label: 'Value-Added Services (VAS)' },
    ],
    GEO_CLASSIFICATION: [
      { code: 'URBAN', label: 'Urban' },
      { code: 'PERI_URBAN', label: 'Peri-urban' },
      { code: 'RURAL', label: 'Rural' },
    ],
    ENERGY_GENERATION_TYPE: [
      { code: 'DIESEL', label: 'Diesel' },
      { code: 'WIND', label: 'Wind' },
      { code: 'SOLAR', label: 'Solar' },
      { code: 'HYBRID', label: 'Hybrid' },
    ],
    ENERGY_STORAGE_TYPE: [
      { code: 'LITHIUM_ION', label: 'Lithium-ion storage' },
      { code: 'OTHER_CHEMICAL', label: 'Other chemical storage' },
      { code: 'CAPACITIVE', label: 'Capacitive storage' },
    ],
    FIXED_ACCESS_TYPE: [
      { code: 'DSL', label: 'DSL' },
      { code: 'FIBER', label: 'Fibre' },
      { code: 'SATELLITE_LEO', label: 'Satellite — LEO' },
      { code: 'SATELLITE_GEO', label: 'Satellite — Geostationary' },
      { code: 'WIRELESS_BROADBAND', label: 'Wireless Broadband' },
    ],
    TRANSACTION_TYPE: [
      { code: 'CASH_IN', label: 'Cash-in' },
      { code: 'CASH_OUT', label: 'Cash-out' },
      { code: 'P2P', label: 'Peer-to-peer (P2P) transfers' },
      { code: 'MERCHANT_PAYMENT', label: 'Merchant payments' },
      { code: 'BILL_PAYMENT', label: 'Bill payments' },
      { code: 'BULK_DISBURSEMENT', label: 'Bulk disbursements' },
      { code: 'CROSS_NETWORK', label: 'Cross-network (interoperable)' },
    ],
  };

  let count = 0;
  for (const [category, items] of Object.entries(lists) as [
    ReferenceCategory,
    { code: string; label: string }[],
  ][]) {
    for (let i = 0; i < items.length; i++) {
      await prisma.referenceItem.upsert({
        where: { category_code: { category, code: items[i].code } },
        update: {},
        create: { category, code: items[i].code, label: items[i].label, sortOrder: i },
      });
      count++;
    }
  }
  console.log(
    `Seeded reference data (${count} items across ${Object.keys(lists).length} categories).`,
  );
}

/**
 * Seed one representative PUBLISHED questionnaire template so downstream work
 * (reporting periods, submissions, the validation engine) has something real to
 * build against. Idempotent: skipped if a template of this name already exists.
 * Not the full 11-section questionnaire — a demonstrative subset covering the
 * field types, flow/stock variants, a reference dropdown, and "Other".
 */
/** The configurable validation rules for the sample template (VALIDATION_SPEC §6). */
const SAMPLE_RULES = [
  {
    type: RuleType.LESS_OR_EQUAL,
    severity: RuleSeverity.HARD,
    label: 'Active mobile money users cannot exceed registered accounts',
    order: 1,
    config: { left: 'active_users', right: 'registered_accounts' },
  },
  {
    type: RuleType.FLOAT_RECONCILE,
    severity: RuleSeverity.HARD,
    label: 'Float / trust balance must back the e-money issued',
    order: 2,
    config: { balance: 'float_balance', backing: 'emoney_issued' },
  },
  {
    type: RuleType.NONZERO_REQUIRES,
    severity: RuleSeverity.SOFT,
    label: 'Active subscribers reported but total revenue is zero',
    order: 3,
    config: { when: 'active_subscribers_mobile', require: 'total_revenue' },
  },
  {
    type: RuleType.PERIOD_ON_PERIOD,
    severity: RuleSeverity.SOFT,
    label: 'Active mobile subscribers changed by more than 50% since the prior period',
    order: 4,
    config: { field: 'active_subscribers_mobile', thresholdPercent: 50 },
  },
];

async function seedSampleTemplate() {
  const name = 'ICT Indicators Return';
  const existing = await prisma.reportingTemplate.findFirst({
    where: { name },
    select: { id: true, _count: { select: { rules: true } } },
  });
  if (existing) {
    // Backfill rules onto a template seeded before rules existed.
    if (existing._count.rules === 0) {
      await prisma.templateRule.createMany({
        data: SAMPLE_RULES.map((r) => ({ ...r, templateId: existing.id })),
      });
      console.log(`Backfilled ${SAMPLE_RULES.length} validation rules onto: ${name}`);
    } else {
      console.log(`Sample template already exists: ${name}`);
    }
    return;
  }

  const ALL: EntityType[] = [
    EntityType.MNO,
    EntityType.ISP,
    EntityType.MMO,
    EntityType.VENDOR,
    EntityType.OTHER,
  ];

  await prisma.reportingTemplate.create({
    data: {
      name,
      version: 1,
      status: TemplateStatus.PUBLISHED,
      publishedAt: new Date(),
      description: 'Sample published questionnaire template (demo subset).',
      sections: {
        create: [
          {
            key: 'general',
            title: 'General Information',
            order: 1,
            applicableEntityTypes: ALL,
            frequency: ReportingFrequency.QUARTERLY_AND_ANNUAL,
            fields: {
              create: [
                {
                  key: 'operator_name',
                  label: 'Name of Operator',
                  order: 1,
                  dataType: FieldType.TEXT,
                  isMandatory: true,
                },
                {
                  key: 'years_in_operation',
                  label: 'Years in Operation',
                  order: 2,
                  dataType: FieldType.INTEGER,
                },
                {
                  key: 'active_subscribers_mobile',
                  label: 'Active Mobile Subscribers',
                  order: 3,
                  dataType: FieldType.INTEGER,
                  isMandatory: true,
                  flowOrStock: FlowOrStock.STOCK,
                },
                {
                  key: 'urban_coverage_pct',
                  label: 'Urban Population Coverage',
                  order: 4,
                  dataType: FieldType.PERCENTAGE,
                  unit: '%',
                  minValue: 0,
                  maxValue: 100,
                },
              ],
            },
          },
          {
            key: 'financial',
            title: 'Financial Information',
            order: 2,
            applicableEntityTypes: ALL,
            frequency: ReportingFrequency.QUARTERLY_AND_ANNUAL,
            fields: {
              create: [
                {
                  key: 'total_revenue',
                  label: 'Total Revenue',
                  order: 1,
                  dataType: FieldType.MONETARY,
                  unit: 'SSP',
                  isMandatory: true,
                  flowOrStock: FlowOrStock.FLOW_ENTERED,
                  minValue: 0,
                  /*
                   * The figure the levy is charged on, and the one a percentage penalty is a share
                   * of. Without it the levy screen assesses every operator at zero and looks broken
                   * on a fresh database — which it did, until a separate demo script had to patch
                   * it in by hand afterwards.
                   */
                  isLevyBasis: true,
                },
                {
                  key: 'capex',
                  label: 'Capital Expenditure',
                  order: 2,
                  dataType: FieldType.MONETARY,
                  unit: 'SSP',
                  flowOrStock: FlowOrStock.FLOW_ENTERED,
                  frequencyOverride: ReportingFrequency.ANNUAL,
                },
              ],
            },
          },
          {
            key: 'mobile_money',
            title: 'Mobile Money Services',
            order: 3,
            applicableEntityTypes: [EntityType.MMO],
            frequency: ReportingFrequency.QUARTERLY_AND_ANNUAL,
            requiredServiceCode: 'MOBILE_MONEY',
            fields: {
              create: [
                {
                  key: 'registered_accounts',
                  label: 'Registered Mobile Money Accounts',
                  order: 1,
                  dataType: FieldType.INTEGER,
                  isMandatory: true,
                  flowOrStock: FlowOrStock.STOCK,
                },
                {
                  key: 'active_users',
                  label: 'Active Mobile Money Users (90-day)',
                  order: 2,
                  dataType: FieldType.INTEGER,
                  flowOrStock: FlowOrStock.STOCK,
                },
                {
                  key: 'float_balance',
                  label: 'Float / Trust Account Balance',
                  order: 3,
                  dataType: FieldType.MONETARY,
                  unit: 'SSP',
                  flowOrStock: FlowOrStock.STOCK,
                },
                {
                  key: 'emoney_issued',
                  label: 'E-money Issued',
                  order: 4,
                  dataType: FieldType.MONETARY,
                  unit: 'SSP',
                  flowOrStock: FlowOrStock.STOCK,
                },
                {
                  key: 'primary_technology',
                  label: 'Primary Technology',
                  order: 5,
                  dataType: FieldType.REFERENCE,
                  referenceCategory: ReferenceCategory.TECHNOLOGY,
                  allowsOther: true,
                },
              ],
            },
          },
        ],
      },
      // Configurable cross-field / period-on-period rules (VALIDATION_SPEC §6).
      // These are DATA, not code — NCA can add or adjust them per template.
      rules: { create: SAMPLE_RULES },
    },
  });
  console.log(`Seeded sample template: ${name} (v1, published)`);
}

/** Open one sample reporting period against the seeded published template. */
async function seedSamplePeriod() {
  const template = await prisma.reportingTemplate.findFirst({
    where: { name: 'ICT Indicators Return', status: TemplateStatus.PUBLISHED },
    select: { id: true },
  });
  if (!template) {
    console.log('Sample template not published yet — skipping sample period.');
    return;
  }
  const label = '2026 Q1';
  const existing = await prisma.reportingPeriod.findFirst({
    where: { templateId: template.id, frequency: ReportingFrequency.QUARTERLY, label },
  });
  if (existing) {
    console.log(`Sample period already exists: ${label}`);
    return;
  }
  await prisma.reportingPeriod.create({
    data: {
      templateId: template.id,
      frequency: ReportingFrequency.QUARTERLY,
      label,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-03-31'),
      dueDate: new Date('2026-04-15'),
      graceDays: 5,
      /*
       * SSP per USD for this cycle. NCA's figure, given on 3 September 2026.
       *
       * Seeded so a fresh database shows the two-currency view working rather than a column of
       * dashes. The rate lives on the period for the reason NCA gave: updating today's rate must
       * never restate a year that has already been audited.
       */
      usdRate: 7000,
      usdRateAt: new Date(),
      status: PeriodStatus.OPEN,
      openedAt: new Date(),
    },
  });
  console.log(`Seeded sample reporting period: ${label} (open, due 2026-04-15)`);
}

/**
 * Enough published history for the public open-data page to have something on it.
 *
 * Without this the page is correct and empty, because nothing is published until NCA puts a figure
 * on the allowlist and no figure exists until a period has been closed with approved returns
 * behind it. Correct and empty is a poor thing to demonstrate, and it hides the two behaviours
 * that are worth seeing.
 *
 * So the data is chosen to show both of them at once:
 *
 *  - Two closed quarters, so a figure has a direction and the period filter has a choice to make.
 *  - Four operators reporting subscribers and coverage, which is above the disclosure threshold,
 *    so those figures publish.
 *  - One operator reporting capital expenditure, which is below it, so that figure is withheld.
 *    A demonstration where nothing is ever withheld does not show the rule working at all.
 */
async function seedPublicPortal() {
  const template = await prisma.reportingTemplate.findFirst({
    where: { name: 'ICT Indicators Return', status: TemplateStatus.PUBLISHED },
    select: {
      id: true,
      sections: { select: { fields: { select: { id: true, key: true } } } },
    },
  });
  if (!template) {
    console.log('Sample template not published yet, skipping the public portal data.');
    return;
  }

  const fields = new Map(
    template.sections.flatMap((section) => section.fields.map((f) => [f.key, f.id] as const)),
  );
  const fieldId = (key: string) => fields.get(key);

  // The demo operator plus three more, so a sector total rests on enough of them to publish.
  const peers = [
    { licence: 'NCA/ISP/2026/002', name: 'Nile Connect (ISP)', type: EntityType.ISP },
    { licence: 'NCA/MNO/2026/003', name: 'Equatoria Mobile (MNO)', type: EntityType.MNO },
    { licence: 'NCA/MNO/2026/004', name: 'Bahr Telecom (MNO)', type: EntityType.MNO },
  ];

  const entities = [
    await prisma.entity.findUniqueOrThrow({
      where: { licenceNumber: 'NCA/MNO/2026/001' },
      select: { id: true },
    }),
  ];
  for (const peer of peers) {
    entities.push(
      await prisma.entity.upsert({
        where: { licenceNumber: peer.licence },
        update: {},
        create: {
          name: peer.name,
          type: peer.type,
          status: EntityStatus.ACTIVE,
          licenceNumber: peer.licence,
          geographicScope: 'National',
          headquartersAddress: 'Juba, South Sudan',
        },
        select: { id: true },
      }),
    );
  }

  /*
   * A user per operator, rather than attributing every return to the demo account.
   *
   * A return records who filed it, and a case file that says one company's officer filed another
   * company's return is the kind of detail that costs a demonstration its credibility.
   */
  const filedBy: string[] = [];
  const passwordHash = await hashPassword('Operator@12345');
  for (let i = 0; i < entities.length; i += 1) {
    const email = i === 0 ? 'operator@demo-telecom.ss' : `operator${i + 1}@demo-telecom.ss`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        firstName: 'Demo',
        lastName: `Operator ${i + 1}`,
        role: Role.OPERATOR_ADMIN,
        entityId: entities[i].id,
        isActive: true,
      },
      select: { id: true },
    });
    filedBy.push(user.id);
  }

  /** Two closed quarters, oldest first, with the figures each operator reported in them. */
  const quarters = [
    {
      label: '2025 Q3',
      start: new Date('2025-07-01'),
      end: new Date('2025-09-30'),
      due: new Date('2025-10-15'),
      subscribers: [820_000, 310_000, 455_000, 180_000],
      coverage: [61, 44, 53, 38],
      // Reported by the first operator alone, which is what puts it below the threshold.
      capex: [4_200_000_000, null, null, null],
    },
    {
      label: '2025 Q4',
      start: new Date('2025-10-01'),
      end: new Date('2025-12-31'),
      due: new Date('2026-01-15'),
      subscribers: [905_000, 344_000, 498_000, 205_000],
      coverage: [64, 47, 56, 41],
      capex: [5_100_000_000, null, null, null],
    },
  ];

  let reference = 250_000;
  for (const quarter of quarters) {
    const existing = await prisma.reportingPeriod.findFirst({
      where: { templateId: template.id, label: quarter.label },
      select: { id: true },
    });
    if (existing) {
      console.log(`Closed period already exists: ${quarter.label}`);
      continue;
    }

    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: template.id,
        frequency: ReportingFrequency.QUARTERLY,
        label: quarter.label,
        periodStart: quarter.start,
        periodEnd: quarter.end,
        dueDate: quarter.due,
        graceDays: 5,
        usdRate: 6500,
        usdRateAt: quarter.due,
        status: PeriodStatus.CLOSED,
        openedAt: quarter.start,
        closedAt: quarter.due,
      },
      select: { id: true },
    });

    for (let i = 0; i < entities.length; i += 1) {
      const values: { fieldId: string; valueText: string }[] = [];
      const add = (key: string, value: number | null) => {
        const id = fieldId(key);
        if (id && value !== null) values.push({ fieldId: id, valueText: String(value) });
      };
      add('active_subscribers_mobile', quarter.subscribers[i]);
      add('urban_coverage_pct', quarter.coverage[i]);
      add('capex', quarter.capex[i]);
      // The levy basis, so the levy screen has closed quarters to assess as well.
      add('total_revenue', quarter.subscribers[i] * 1_200);

      await prisma.submission.create({
        data: {
          entityId: entities[i].id,
          periodId: period.id,
          templateId: template.id,
          createdById: filedBy[i],
          status: SubmissionStatus.APPROVED,
          isLate: false,
          submittedAt: quarter.due,
          lockedAt: quarter.due,
          referenceNumber: `NCA/SUB/${quarter.label.slice(0, 4)}/${String(++reference).padStart(6, '0')}`,
          values: { create: values },
        },
      });
    }
    console.log(`Seeded closed period ${quarter.label} with ${entities.length} approved returns.`);
  }

  /*
   * The allowlist. Nothing is public until a figure is on it, so a demonstration of the public
   * page needs entries here or it has nothing to show.
   */
  const published = [
    {
      fieldKey: 'active_subscribers_mobile',
      aggregation: PublicAggregation.SUM,
      label: 'Mobile subscribers',
      unit: 'subscribers',
      description: 'Active mobile subscriptions across all licensed operators.',
      order: 1,
    },
    {
      fieldKey: 'urban_coverage_pct',
      aggregation: PublicAggregation.AVERAGE,
      label: 'Urban population covered',
      unit: '%',
      description: 'Share of the urban population within reach of a mobile network, averaged.',
      order: 2,
    },
    {
      fieldKey: 'capex',
      aggregation: PublicAggregation.SUM,
      label: 'Capital investment',
      unit: 'SSP',
      description: 'What operators spent on building and upgrading their networks.',
      order: 3,
    },
  ];

  for (const indicator of published) {
    const existing = await prisma.publicIndicator.findFirst({
      where: { fieldKey: indicator.fieldKey, aggregation: indicator.aggregation, deletedAt: null },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.publicIndicator.create({ data: { ...indicator, isPublished: true } });
  }
  console.log(`Published ${published.length} sector figures on the open-data page.`);
}

/**
 * A few nodes and the fibre between them, so the network map has a network on it.
 *
 * Without this the map is a correct and empty grey rectangle, which demonstrates nothing and hides
 * the one distinction the feature turns on. So there are two routes, deliberately different:
 *
 *  - Juba to Yei, with the survey supplied. Drawn solid, as the cable actually runs.
 *  - Juba to Bor, with no survey. Drawn as a dashed straight line, and labelled as one on the map
 *    and in the register.
 *
 * A demonstration where every route is surveyed would show a map that cannot be wrong, and the
 * whole point of the dashes is that some of them are.
 */
async function seedNetwork() {
  const entity = await prisma.entity.findUnique({
    where: { licenceNumber: 'NCA/MNO/2026/001' },
    select: { id: true },
  });
  if (!entity) {
    console.log('Demo operator not seeded yet, skipping the network map data.');
    return;
  }

  const nodes = [
    { siteReference: 'JUB-FN-01', name: 'Juba exchange', lat: 4.8594, lng: 31.5713 },
    { siteReference: 'YEI-FN-01', name: 'Yei node', lat: 4.0949, lng: 30.6774 },
    { siteReference: 'BOR-FN-01', name: 'Bor node', lat: 6.2088, lng: 31.5591 },
    { siteReference: 'JUB-BTS-01', name: 'Juba central mast', lat: 4.8517, lng: 31.5825 },
  ];

  const ids = new Map<string, string>();
  for (const node of nodes) {
    const site = await prisma.networkSite.upsert({
      where: {
        entityId_siteReference: { entityId: entity.id, siteReference: node.siteReference },
      },
      update: {},
      create: {
        entityId: entity.id,
        siteReference: node.siteReference,
        name: node.name,
        kind: node.siteReference.includes('BTS')
          ? NetworkSiteKind.BASE_STATION
          : NetworkSiteKind.FIBRE_NODE,
        status: NetworkSiteStatus.ACTIVE,
        latitude: new Prisma.Decimal(node.lat),
        longitude: new Prisma.Decimal(node.lng),
        location: node.name.replace(/ (exchange|node|central mast)$/, ''),
        ...(node.siteReference.includes('BTS') ? { technology: '4G', coverageM: 8000 } : {}),
      },
      select: { id: true },
    });
    ids.set(node.siteReference, site.id);
  }

  const routes = [
    {
      linkReference: 'JUB-YEI-01',
      name: 'Juba to Yei backbone',
      from: 'JUB-FN-01',
      to: 'YEI-FN-01',
      lengthKm: 181.4,
      capacityGbps: 100,
      // Bends where the cable follows the road rather than the crow.
      path: [
        [4.8594, 31.5713],
        [4.6702, 31.3068],
        [4.3891, 31.0125],
        [4.0949, 30.6774],
      ],
    },
    {
      linkReference: 'JUB-BOR-01',
      name: 'Juba to Bor link',
      from: 'JUB-FN-01',
      to: 'BOR-FN-01',
      lengthKm: 198.2,
      capacityGbps: 40,
      path: null,
    },
  ];

  for (const route of routes) {
    await prisma.fibreLink.upsert({
      where: {
        entityId_linkReference: { entityId: entity.id, linkReference: route.linkReference },
      },
      update: {},
      create: {
        entityId: entity.id,
        linkReference: route.linkReference,
        name: route.name,
        status: NetworkSiteStatus.ACTIVE,
        fromSiteId: ids.get(route.from)!,
        toSiteId: ids.get(route.to)!,
        lengthKm: new Prisma.Decimal(route.lengthKm),
        capacityGbps: route.capacityGbps,
        path: route.path ?? Prisma.DbNull,
      },
    });
  }
  console.log(`Seeded ${nodes.length} network sites and ${routes.length} fibre routes.`);
}

async function main() {
  await seedAdmin();
  await seedReviewers();
  await seedDemoOperator();
  await seedReferenceData();
  await seedSampleTemplate();
  await seedSamplePeriod();
  await seedPublicPortal();
  await seedNetwork();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
