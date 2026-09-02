import {
  EntityStatus,
  EntityType,
  FieldType,
  FlowOrStock,
  PeriodStatus,
  PrismaClient,
  ReferenceCategory,
  ReportingFrequency,
  Role,
  RuleSeverity,
  RuleType,
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
      status: PeriodStatus.OPEN,
      openedAt: new Date(),
    },
  });
  console.log(`Seeded sample reporting period: ${label} (open, due 2026-04-15)`);
}

async function main() {
  await seedAdmin();
  await seedReviewers();
  await seedDemoOperator();
  await seedReferenceData();
  await seedSampleTemplate();
  await seedSamplePeriod();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
