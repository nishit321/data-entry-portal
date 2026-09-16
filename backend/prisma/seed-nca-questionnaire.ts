/* eslint-disable no-console -- a command-line tool reports by printing */
/**
 * Seed NCA's real questionnaire.
 *
 *   npm run seed:questionnaire
 *
 * Separate from `prisma/seed.ts` on purpose, and the reason matters for what gets run where. The
 * main seed creates a demonstration: an invented operator, a twelve-field sketch of a return,
 * approved figures so the charts have something to draw. This creates the instrument the Authority
 * actually collects with, and it belongs on a live server where none of that demonstration does.
 *
 * Idempotent by name. Running it twice creates one questionnaire, so it is safe on a server that
 * has already had it.
 *
 * Pass `--replace` while the transcription is being worked on and an existing **draft** is rebuilt
 * from this file. It refuses to touch a published one, and refuses if any return has been opened
 * against it — by then the questions are part of a record somebody filed against, and rewriting
 * them would change what an operator is on record as having been asked.
 *
 * ## Publishing, and why this stops short of it
 *
 * The questionnaire is created as a **draft**. Publishing is what makes a template collectable, and
 * it is a decision with consequences: a published template can have reporting periods opened
 * against it, and once an operator has filed, its questions are part of a record that has to stay
 * readable. Somebody at the Authority should look at the two hundred questions this creates and
 * press publish themselves, from the screen built for it.
 */
import { FieldType, Prisma, PrismaClient, TemplateStatus } from '@prisma/client';
import { validateRuleConfig } from '../src/templates/rule-config';
import { ncaQuestionnaire } from './nca-questionnaire';
import type { TemplateDef } from './demo-templates/types';

const prisma = new PrismaClient();

const NUMERIC: FieldType[] = [
  FieldType.INTEGER,
  FieldType.DECIMAL,
  FieldType.MONETARY,
  FieldType.PERCENTAGE,
];

/**
 * Refuse to seed a questionnaire that contradicts itself.
 *
 * The same check the demo library runs, for a better reason. A rule naming a field that does not
 * exist, or two sections sharing a key, does not fail at seed time — it fails months later when an
 * operator's return is silently not checked by a rule everyone assumed was running. Two hundred
 * hand-transcribed fields is exactly the size at which a typo hides.
 */
function assertConsistent(t: TemplateDef): void {
  const sectionKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  const numericKeys = new Set<string>();

  for (const s of t.sections) {
    if (sectionKeys.has(s.key)) throw new Error(`duplicate section key "${s.key}"`);
    sectionKeys.add(s.key);
    for (const f of s.fields) {
      if (fieldKeys.has(f.key)) throw new Error(`duplicate field key "${f.key}"`);
      fieldKeys.add(f.key);
      if (NUMERIC.includes(f.dataType)) numericKeys.add(f.key);
    }
  }

  for (const r of t.rules ?? []) {
    const problem = validateRuleConfig(r.type, r.config, numericKeys);
    if (problem) throw new Error(`rule "${r.label}": ${problem}`);
  }
}

/**
 * Every service a section is gated on must be a code an operator can actually tick.
 *
 * Not covered by the rule validator, and the failure mode is the quiet kind: a section keyed to a
 * service code that is not in the reference list is a section no operator ever sees, and nothing
 * anywhere says so. The return simply never asks for mobile money.
 */
async function assertServiceCodesExist(t: TemplateDef): Promise<void> {
  const required = [
    ...new Set(t.sections.map((s) => s.requiredServiceCode).filter((c): c is string => !!c)),
  ];
  if (required.length === 0) return;

  const known = await prisma.referenceItem.findMany({
    where: { category: 'SERVICE_TYPE', code: { in: required }, deletedAt: null },
    select: { code: true },
  });
  const missing = required.filter((code) => !known.some((k) => k.code === code));
  if (missing.length > 0) {
    throw new Error(
      `These sections are gated on service codes that are not in the reference data, so no ` +
        `operator would ever be shown them: ${missing.join(', ')}. ` +
        `Run \`npm run prisma:seed\` first: it seeds the SERVICE_TYPE list.`,
    );
  }
}

async function run() {
  const t = ncaQuestionnaire;
  assertConsistent(t);
  await assertServiceCodesExist(t);

  const replace = process.argv.includes('--replace');
  const exists = await prisma.reportingTemplate.findFirst({
    where: { name: t.name },
    select: { id: true, status: true, _count: { select: { periods: true } } },
  });

  if (exists && !replace) {
    console.log(`Already seeded: ${t.name} (${exists.status.toLowerCase()}).`);
    console.log('Pass --replace to rebuild it from source while it is still a draft.');
    return;
  }

  if (exists) {
    /*
     * Two refusals, and neither is a formality.
     *
     * A published template is what reporting periods are opened against, and a period carries
     * returns. Rewriting its questions would change what an operator is on record as having been
     * asked, months after they answered. The period count catches the same thing one step earlier:
     * a draft with a period against it is a draft somebody has already started collecting with.
     */
    if (exists.status !== TemplateStatus.DRAFT) {
      throw new Error(
        `"${t.name}" is ${exists.status.toLowerCase()}, not a draft. A published questionnaire is ` +
          'what returns were filed against; edit it on the template screen instead.',
      );
    }
    if (exists._count.periods > 0) {
      throw new Error(
        `"${t.name}" already has ${exists._count.periods} reporting period(s) against it, so it ` +
          'is in use. Edit it on the template screen instead.',
      );
    }
    await prisma.reportingTemplate.delete({ where: { id: exists.id } });
    console.log(`Replaced the existing draft of ${t.name}.`);
  }

  const created = await prisma.reportingTemplate.create({
    data: {
      name: t.name,
      description: t.description,
      version: 1,
      // A draft, deliberately. See the note at the top of this file.
      status: TemplateStatus.DRAFT,
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
              isLevyBasis: f.isLevyBasis ?? false,
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
    select: { id: true },
  });

  const fields = t.sections.reduce((n, s) => n + s.fields.length, 0);
  const hard = (t.rules ?? []).filter((r) => r.severity === 'HARD').length;
  const soft = (t.rules ?? []).length - hard;

  console.log(`Seeded: ${t.name}`);
  console.log(`  ${t.sections.length} sections, ${fields} fields`);
  console.log(`  ${hard} blocking rules, ${soft} warnings`);
  console.log(`  id: ${created.id}`);
  console.log('');
  console.log('It is a DRAFT. Open it under Templates, read it through, and publish it there.');
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
