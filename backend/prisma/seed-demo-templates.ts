import { FieldType, Prisma, PrismaClient, TemplateStatus } from '@prisma/client';
import { validateRuleConfig } from '../src/templates/rule-config';
import type { TemplateDef } from './demo-templates/types';
import { telecomTemplates } from './demo-templates/telecom';
import { connectivityTemplates } from './demo-templates/connectivity';
import { financialTemplates } from './demo-templates/financial';
import { governanceTemplates } from './demo-templates/governance';

const prisma = new PrismaClient();

const NUMERIC: FieldType[] = [
  FieldType.INTEGER,
  FieldType.DECIMAL,
  FieldType.MONETARY,
  FieldType.PERCENTAGE,
];

const ALL: TemplateDef[] = [
  ...telecomTemplates,
  ...connectivityTemplates,
  ...financialTemplates,
  ...governanceTemplates,
];

/** Fail fast on an internally inconsistent template so we never seed a silently-broken rule. */
function assertConsistent(t: TemplateDef): Set<string> {
  const sectionKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  const numericKeys = new Set<string>();

  for (const s of t.sections) {
    if (sectionKeys.has(s.key)) throw new Error(`"${t.name}": duplicate section key "${s.key}"`);
    sectionKeys.add(s.key);
    for (const f of s.fields) {
      if (fieldKeys.has(f.key)) throw new Error(`"${t.name}": duplicate field key "${f.key}"`);
      fieldKeys.add(f.key);
      if (NUMERIC.includes(f.dataType)) numericKeys.add(f.key);
    }
  }

  for (const r of t.rules ?? []) {
    const problem = validateRuleConfig(r.type, r.config, numericKeys);
    if (problem) throw new Error(`"${t.name}" rule "${r.label}": ${problem}`);
  }
  return fieldKeys;
}

async function run() {
  // Validate the whole library up front — one bad template aborts before anything is written.
  for (const t of ALL) assertConsistent(t);

  let created = 0;
  let skipped = 0;

  for (const t of ALL) {
    const exists = await prisma.reportingTemplate.findFirst({ where: { name: t.name } });
    if (exists) {
      skipped += 1;
      console.log(`skip (exists): ${t.name}`);
      continue;
    }

    await prisma.reportingTemplate.create({
      data: {
        name: t.name,
        description: t.description,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
        sections: {
          create: t.sections.map((s, si) => ({
            key: s.key,
            title: s.title,
            description: s.description,
            order: si,
            applicableEntityTypes: s.applicableEntityTypes,
            frequency: s.frequency,
            requiredServiceCode: s.requiredServiceCode,
            fields: {
              create: s.fields.map((f, fi) => ({
                key: f.key,
                label: f.label,
                description: f.description,
                order: fi,
                dataType: f.dataType,
                unit: f.unit,
                decimals: f.decimals,
                isMandatory: f.isMandatory ?? false,
                flowOrStock: f.flowOrStock ?? 'NONE',
                minValue: f.minValue,
                maxValue: f.maxValue,
                referenceCategory: f.referenceCategory,
                allowsOther: f.allowsOther ?? false,
                frequencyOverride: f.frequencyOverride,
              })),
            },
          })),
        },
        rules: {
          create: (t.rules ?? []).map((r, ri) => ({
            type: r.type,
            severity: r.severity,
            label: r.label,
            config: r.config as Prisma.InputJsonValue,
            order: ri,
          })),
        },
      },
    });
    created += 1;
    const fieldCount = t.sections.reduce((n, s) => n + s.fields.length, 0);
    console.log(
      `created: ${t.name} — ${t.sections.length} sections, ${fieldCount} fields, ${(t.rules ?? []).length} rules`,
    );
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped, ${ALL.length} total.`);
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
