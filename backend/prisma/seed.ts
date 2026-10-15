/* eslint-disable no-console -- a command-line tool reports by printing */
/**
 * The demonstration.
 *
 *   npm run prisma:seed
 *
 * An invented operator and its users, a twelve-field sample questionnaire, two closed quarters of
 * approved returns so the charts draw something, published open-data figures, four network sites
 * and two fibre routes, a penalty schedule line, two compliance cases with an enforcement order on
 * each, and a 250-agent register.
 *
 * None of it belongs on a live server. It exists so that every screen has something on it: an
 * empty portal demonstrates nothing, and a browser test needs something to look at.
 *
 * **For a real deployment, run `npm run seed:production` instead.** That creates the administrator
 * and the reference lists and stops. This file calls those same two functions first, so a
 * developer still gets one command.
 */
import {
  EntityStatus,
  EntityType,
  FieldType,
  EnforcementOrderStatus,
  EnforcementOrderType,
  EnforcementReason,
  FlowOrStock,
  NetworkSiteKind,
  NetworkSiteStatus,
  PaymentKind,
  PaymentMethod,
  PeriodStatus,
  Prisma,
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
import { prisma, seedAdmin, seedReferenceData } from './seed-core';

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
    /*
     * A supervisor, and an analyst.
     *
     * Added because without them two things in the product cannot be shown at all. Sign-off on an
     * enforcement order escalates to a second person, and with one administrator in the whole
     * demonstration there is no second person to escalate to. The analyst is who drafts one: they
     * read the case book but cannot approve their own proposal, which is the separation the rule
     * exists for.
     */
    { email: 'supervisor@nca.gov.ss', firstName: 'Supervisor', role: Role.SUPERVISOR },
    { email: 'analyst@nca.gov.ss', firstName: 'Analyst', role: Role.ANALYST },
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
    console.log('Sample template not published yet, so the sample period was skipped.');
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

/**
 * A penalty schedule line, and two compliance cases that show what it produces.
 *
 * Two cases rather than one, and they are deliberately in different states, because the thing this
 * screen has to get across is a distinction rather than a number:
 *
 *  - One still inside its thirty-day remedy notice. The figure is real and growing, and the
 *    operator does not owe it yet. The screen says so and gives the date it becomes payable.
 *  - One whose notice has lapsed unremedied. The same kind of figure, now payable.
 *
 * A demonstration with only the second would show an amount and a date and teach nobody the
 * difference, which is exactly how the screen read before 16 September 2026.
 */
async function seedEnforcement() {
  const entity = await prisma.entity.findUnique({
    where: { licenceNumber: 'NCA/MNO/2026/001' },
    select: { id: true },
  });
  if (!entity) {
    console.log('Demo operator not seeded yet, skipping the compliance cases.');
    return;
  }

  const periods = await prisma.reportingPeriod.findMany({
    where: { deletedAt: null, status: PeriodStatus.CLOSED },
    orderBy: { periodEnd: 'desc' },
    take: 2,
    select: { id: true, label: true, dueDate: true },
  });
  if (periods.length < 2) {
    console.log('Fewer than two closed periods, skipping the compliance cases.');
    return;
  }

  /*
   * Tier 1 of NCA's schedule: a fixed charge plus a daily one, capped.
   *
   * Seeded so the demo prices its cases at all. Without a line in force every case reads "Not
   * priced", which is correct and shows nothing.
   */
  const existingRule = await prisma.penaltyRule.findFirst({
    where: { label: 'Tier 1: late return', deletedAt: null },
    select: { id: true },
  });
  const rule =
    existingRule ??
    (await prisma.penaltyRule.create({
      data: {
        reason: EnforcementReason.MISSED_DEADLINE,
        entityType: null,
        fixedAmount: new Prisma.Decimal(500000),
        dailyAmount: new Prisma.Decimal(50000),
        maxAmount: new Prisma.Decimal(10000000),
        label: 'Tier 1: late return',
        effectiveFrom: new Date('2025-01-01'),
      },
      select: { id: true },
    }));

  const day = 86_400_000;
  const now = Date.now();

  const cases = [
    {
      // Still inside its notice: opened a fortnight ago, sixteen days left to run.
      period: periods[0],
      daysLate: 22,
      remedyNoticeAt: new Date(now - 14 * day),
      remedyDueAt: new Date(now + 16 * day),
      penaltyAssessedAt: null,
    },
    {
      // Notice lapsed unremedied, so the same kind of figure is now payable.
      period: periods[1],
      daysLate: 68,
      remedyNoticeAt: new Date(now - 58 * day),
      remedyDueAt: new Date(now - 28 * day),
      penaltyAssessedAt: new Date(now - 28 * day),
    },
  ];

  for (const c of cases) {
    const amount = 500000 + 50000 * c.daysLate;
    await prisma.enforcementCase.upsert({
      where: {
        entityId_periodId_reason: {
          entityId: entity.id,
          periodId: c.period.id,
          reason: EnforcementReason.MISSED_DEADLINE,
        },
      },
      update: {},
      create: {
        entityId: entity.id,
        periodId: c.period.id,
        reason: EnforcementReason.MISSED_DEADLINE,
        note: `The return for ${c.period.label} was not filed by the deadline.`,
        penaltyRuleId: rule.id,
        penaltyAmount: new Prisma.Decimal(Math.min(amount, 10000000)),
        penaltyDays: c.daysLate,
        penaltyAssessedAt: c.penaltyAssessedAt,
        defaultStartedAt: new Date(now - c.daysLate * day),
        remedyNoticeAt: c.remedyNoticeAt,
        remedyDueAt: c.remedyDueAt,
      },
    });
  }
  console.log(`Seeded a penalty schedule line and ${cases.length} compliance cases.`);
  await seedEnforcementOrders();
}

/**
 * One drafted order and one in force, so the screen shows the difference.
 *
 * That difference is the whole point of the screen and the easiest thing to miss. A draft carries
 * no legal effect at all; an approved order stops an operator trading. They sit in the same list,
 * and a demonstration with only one of them would teach nobody which is which.
 *
 * Drafted by one officer and approved by another, because that is the rule the service enforces:
 * sign-off escalates to a second person, and an order approved by the person who wrote it would be
 * a demonstration of something the portal refuses to do.
 */
async function seedEnforcementOrders() {
  const [officer, director] = await Promise.all([
    prisma.user.findFirst({ where: { role: Role.ANALYST }, select: { id: true } }),
    prisma.user.findFirst({ where: { role: Role.SUPERVISOR }, select: { id: true } }),
  ]);
  const drafter =
    officer ?? (await prisma.user.findFirst({ where: { role: Role.ADMIN }, select: { id: true } }));
  if (!drafter || !director) {
    console.log('No officer and supervisor pair, so the enforcement orders were skipped.');
    return;
  }

  const cases = await prisma.enforcementCase.findMany({
    where: { status: 'OPEN', entity: { licenceNumber: 'NCA/MNO/2026/001' } },
    orderBy: { openedAt: 'asc' },
    take: 2,
    select: { id: true, period: { select: { label: true } } },
  });
  if (cases.length < 2) {
    console.log('Fewer than two open cases for the demo operator, so the orders were skipped.');
    return;
  }

  const day = 86_400_000;
  const orders = [
    {
      caseId: cases[0].id,
      type: EnforcementOrderType.SUSPENSION_PARTIAL,
      status: EnforcementOrderStatus.APPROVED,
      reason:
        `The return for ${cases[0].period.label} remains unfiled after the remedy period. ` +
        'New subscriber activations are suspended until it is filed and approved.',
      legalBasis: 'Section 42(3) of the Communications Act',
      effectiveFrom: new Date(Date.now() - 6 * day),
      durationDays: 90,
      approvedById: director.id,
      approvedAt: new Date(Date.now() - 6 * day),
    },
    {
      caseId: cases[1].id,
      type: EnforcementOrderType.SUSPENSION_FULL,
      status: EnforcementOrderStatus.DRAFT,
      reason:
        'Proposed escalation: a second consecutive unfiled return following a partial suspension ' +
        'that produced no response.',
      legalBasis: 'Section 42(4) of the Communications Act',
      effectiveFrom: new Date(Date.now() + 14 * day),
      durationDays: 30,
      approvedById: null,
      approvedAt: null,
    },
  ];

  let made = 0;
  for (const order of orders) {
    const already = await prisma.enforcementOrder.findFirst({
      where: { caseId: order.caseId },
      select: { id: true },
    });
    if (already) continue;
    await prisma.enforcementOrder.create({
      data: { ...order, draftedById: drafter.id },
    });
    made += 1;
  }
  if (made > 0) console.log(`Seeded ${made} enforcement orders, one in force and one drafted.`);
}

/**
 * An agent register at something like real size.
 *
 * A mobile money operator has hundreds of cash-in and cash-out agents, and the demo had one. That
 * is not only a thin demonstration: the agent register is the screen the portal's longest list
 * lives on, and a one-row table answers no question about whether the list holds up. With a real
 * number in it, a page of 100 can be measured rather than guessed at.
 *
 * Spread across South Sudan's states with coordinates, because the map reads this table too, and a
 * register where every agent sits on the same point demonstrates nothing about either screen.
 */
async function seedAgentRegister() {
  // The demo operator, which offers mobile money as well as voice and data. There is no
  // standalone MMO in the demonstration, and an agent register belongs to whoever runs the float.
  const entity = await prisma.entity.findUnique({
    where: { licenceNumber: 'NCA/MNO/2026/001' },
    select: { id: true },
  });
  if (!entity) {
    console.log('Demo operator not seeded yet, skipping the agent register.');
    return;
  }

  const existing = await prisma.agent.count({ where: { entityId: entity.id, deletedAt: null } });
  if (existing >= 200) {
    console.log(`Agent register already seeded (${existing} agents).`);
    return;
  }

  /** Towns with real coordinates, so the map shows a network rather than a pile. */
  const towns = [
    { name: 'Juba', lat: 4.8594, lng: 31.5713 },
    { name: 'Wau', lat: 7.7, lng: 27.9898 },
    { name: 'Malakal', lat: 9.5334, lng: 31.6605 },
    { name: 'Yei', lat: 4.0949, lng: 30.6774 },
    { name: 'Bor', lat: 6.2088, lng: 31.5591 },
    { name: 'Aweil', lat: 8.7667, lng: 27.4 },
    { name: 'Torit', lat: 4.4133, lng: 32.5703 },
    { name: 'Rumbek', lat: 6.8, lng: 29.6772 },
    { name: 'Yambio', lat: 4.5721, lng: 28.3955 },
    { name: 'Bentiu', lat: 9.2333, lng: 29.8 },
  ];
  const kinds = ['Kiosk', 'Store', 'Pharmacy', 'Market stall', 'Filling station', 'Supermarket'];

  const AGENTS = 250;
  const rows = Array.from({ length: AGENTS }, (_, i) => {
    const town = towns[i % towns.length];
    // A deterministic scatter of a few kilometres, so a re-seed produces the same register.
    const jitter = (n: number) => ((((i * 37 + n * 17) % 100) - 50) / 1000) * 3;
    return {
      entityId: entity.id,
      agentReference: `AG-${String(i + 1).padStart(4, '0')}`,
      name: `${town.name} ${kinds[i % kinds.length]} ${Math.floor(i / kinds.length) + 1}`,
      location: town.name,
      latitude: new Prisma.Decimal((town.lat + jitter(1)).toFixed(6)),
      longitude: new Prisma.Decimal((town.lng + jitter(2)).toFixed(6)),
      // Roughly one in nine closed, because a register of only active agents hides the state the
      // list filters on.
      isActive: i % 9 !== 0,
    };
  });

  await prisma.agent.createMany({ data: rows, skipDuplicates: true });
  console.log(`Seeded ${AGENTS} agents across ${towns.length} towns.`);
}

/**
 * Refuse to invent an operator on a live server.
 *
 * The demonstration data is indistinguishable from real data once it is in: "Demo Telecom" appears
 * in the operator list, its returns count towards sector figures, and its 250 agents are on the
 * map. Removing it afterwards is a manual job on a running system, which is exactly the situation
 * this refusal exists to prevent.
 */
function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'This is the demonstration seed and NODE_ENV is production. It would create an invented ' +
        'operator, its returns and 250 agents on a live server.\n' +
        'Run `npm run seed:production` instead: the administrator and the reference lists, and ' +
        'nothing else.',
    );
  }
}

async function main() {
  assertNotProduction();
  await seedAdmin();
  await seedReviewers();
  await seedDemoOperator();
  await seedReferenceData();
  await seedSampleTemplate();
  await seedSamplePeriod();
  await seedPublicPortal();
  await seedNetwork();
  await seedEnforcement();
  await seedAgentRegister();
  await seedPayments();
}

/**
 * The levy for one approved return, worked out the way the levy screen works it out: the answers
 * to the levy-basis questions, at the rate whose window covers the period's due date.
 *
 * Mirrored rather than approximated. The demo pays some levies in full, and a payment that was
 * "in full" by a slightly different sum would show on the Payments screen as part paid or overpaid,
 * which is exactly the kind of small wrongness a client notices in a demonstration.
 */
async function levyDueFor(entityId: string, periodId: string): Promise<number | null> {
  const period = await prisma.reportingPeriod.findUnique({
    where: { id: periodId },
    select: { dueDate: true },
  });
  if (!period) return null;
  const rate = await prisma.levyRate.findFirst({
    where: {
      deletedAt: null,
      effectiveFrom: { lte: period.dueDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.dueDate } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { ratePercent: true },
  });
  if (!rate) return null;
  const submission = await prisma.submission.findFirst({
    where: {
      entityId,
      periodId,
      status: SubmissionStatus.APPROVED,
      deletedAt: null,
      supersededBy: null,
    },
    select: { values: { where: { field: { isLevyBasis: true } }, select: { valueText: true } } },
  });
  if (!submission) return null;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const revenue = round2(submission.values.reduce((sum, v) => sum + (Number(v.valueText) || 0), 0));
  return round2((revenue * Number(rate.ratePercent)) / 100);
}

/**
 * A few months of payments, so the Payments screen has a story to tell.
 *
 * The demo operator has paid one quarter's levy in full and part of the next, and nothing of its
 * payable penalty; one payment was keyed twice and the second keying was reversed by a different
 * officer. Another operator is paid up, so the table by operator has a contrast in it.
 *
 * Seeds a levy rate first if there is none, because without one no levy is assessed and there is
 * nothing to pay. Payments can never be deleted, so this skips itself on a database that already
 * has demo payments rather than piling up a second set.
 */
async function seedPayments() {
  const demo = await prisma.entity.findFirst({
    where: { licenceNumber: 'NCA/MNO/2026/001', deletedAt: null },
    select: { id: true },
  });
  if (!demo) {
    console.log('Demo operator not seeded yet, skipping payments.');
    return;
  }
  if ((await prisma.payment.count({ where: { entityId: demo.id } })) > 0) {
    console.log('Demo payments already exist, leaving them as they are.');
    return;
  }

  if ((await prisma.levyRate.count({ where: { deletedAt: null } })) === 0) {
    await prisma.levyRate.create({
      data: {
        ratePercent: 1.5,
        effectiveFrom: new Date('2025-01-01'),
        label: 'Demonstration rate, 1.5% of revenue',
      },
    });
    console.log('Seeded a demonstration levy rate of 1.5%.');
  }

  const admin = await prisma.user.findFirst({ where: { role: Role.ADMIN, deletedAt: null } });
  const supervisor = await prisma.user.findFirst({
    where: { role: Role.SUPERVISOR, deletedAt: null },
  });
  if (!admin || !supervisor) {
    console.log('No administrator and supervisor pair, so the demo payments were skipped.');
    return;
  }

  // The demo operator's approved quarters, oldest first.
  const quarters = await prisma.submission.findMany({
    where: {
      entityId: demo.id,
      status: SubmissionStatus.APPROVED,
      deletedAt: null,
      supersededBy: null,
    },
    select: { periodId: true, period: { select: { dueDate: true } } },
    orderBy: { period: { dueDate: 'asc' } },
  });

  const year = new Date().getFullYear();
  let seq = await prisma.payment.count({
    where: { receiptNumber: { startsWith: `NCA/RCT/${year}/` } },
  });
  const receipt = () => {
    seq += 1;
    return `NCA/RCT/${year}/${String(seq).padStart(6, '0')}`;
  };
  const daysAfter = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
  const asDate = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);

  let made = 0;
  const [first, second] = quarters;

  if (first) {
    const due = await levyDueFor(demo.id, first.periodId);
    if (due) {
      // Paid in full, a fortnight after the deadline.
      await prisma.payment.create({
        data: {
          receiptNumber: receipt(),
          entityId: demo.id,
          kind: PaymentKind.LEVY,
          periodId: first.periodId,
          amount: due,
          paidOn: asDate(daysAfter(first.period.dueDate, 14)),
          method: PaymentMethod.BANK_TRANSFER,
          bankReference: 'FT25DEMO0001',
          recordedById: admin.id,
        },
      });
      made += 1;
    }
  }

  if (second) {
    const due = await levyDueFor(demo.id, second.periodId);
    if (due) {
      const paidOn = asDate(daysAfter(second.period.dueDate, 20));
      const part = Math.round(due * 0.6 * 100) / 100;
      // Sixty per cent, with a note that the rest was promised.
      await prisma.payment.create({
        data: {
          receiptNumber: receipt(),
          entityId: demo.id,
          kind: PaymentKind.LEVY,
          periodId: second.periodId,
          amount: part,
          paidOn,
          method: PaymentMethod.BANK_TRANSFER,
          bankReference: 'FT26DEMO0002',
          note: 'The operator wrote to say the balance follows at the end of the month.',
          recordedById: supervisor.id,
        },
      });
      // The same line of the statement keyed a second time, and reversed by somebody else.
      await prisma.payment.create({
        data: {
          receiptNumber: receipt(),
          entityId: demo.id,
          kind: PaymentKind.LEVY,
          periodId: second.periodId,
          amount: part,
          paidOn,
          method: PaymentMethod.BANK_TRANSFER,
          bankReference: 'FT26DEMO0002-X',
          recordedById: admin.id,
          reversedAt: daysAfter(paidOn, 1),
          reversedById: supervisor.id,
          reversalReason: 'Keyed twice from the same line of the bank statement.',
        },
      });
      made += 2;
    }
  }

  // Another operator, paid up, so the table by operator has something to compare with.
  const other = await prisma.submission.findFirst({
    where: {
      entityId: { not: demo.id },
      status: SubmissionStatus.APPROVED,
      deletedAt: null,
      supersededBy: null,
      entity: { deletedAt: null, type: EntityType.MNO },
    },
    select: { entityId: true, periodId: true, period: { select: { dueDate: true } } },
    orderBy: { period: { dueDate: 'asc' } },
  });
  if (other) {
    const due = await levyDueFor(other.entityId, other.periodId);
    if (due) {
      await prisma.payment.create({
        data: {
          receiptNumber: receipt(),
          entityId: other.entityId,
          kind: PaymentKind.LEVY,
          periodId: other.periodId,
          amount: due,
          paidOn: asDate(daysAfter(other.period.dueDate, -3)),
          method: PaymentMethod.MOBILE_MONEY,
          bankReference: 'MM25DEMO0101',
          recordedById: supervisor.id,
        },
      });
      made += 1;
    }
  }

  console.log(`Seeded ${made} demo payments.`);
}

main()
  .catch((e) => {
    // The message, not the stack. Every failure this can produce is something a person has to
    // read and act on, and a refusal buried under twelve lines of Node internals reads as a crash.
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
