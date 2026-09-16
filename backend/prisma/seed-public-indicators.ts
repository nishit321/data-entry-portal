/* eslint-disable no-console -- a command-line tool reports by printing */
/**
 * Fill the public allowlist with candidates, unpublished.
 *
 *   npm run seed:indicators
 *
 * The allowlist decides what the public portal may show. It has been live and empty since Phase 2,
 * and the reason was not neglect: an entry names one question by key, and until NCA's questionnaire
 * was transcribed there were no real keys to name.
 *
 * ## Two things this deliberately does not do
 *
 * **It does not publish anything.** Every candidate is created switched off. Adding a line to the
 * allowlist and deciding the public may see it are two separate decisions, and the second is the
 * Authority's to take on the Open Data screen. What this changes is that somebody ticks a box
 * instead of typing twenty rows and guessing at field keys.
 *
 * **It does not bypass the guard the service applies.** `PublicIndicatorsService` refuses a field
 * that is not numeric, not on a *published* questionnaire, or marked as the levy basis. Writing
 * rows straight through Prisma would sidestep all three and create entries the Open Data screen
 * cannot explain, naming questions it will not offer. So the same three checks run here, and this
 * refuses rather than creating something unreachable.
 *
 * Which means it will not run until NCA publishes the questionnaire. That is the correct order:
 * publishing the questionnaire is what makes its questions real, and an allowlist entry against a
 * draft names a question that may still change.
 */
import { FieldType, PrismaClient, TemplateStatus } from '@prisma/client';
import { INDICATOR_CANDIDATES, NOT_EXPRESSIBLE } from './nca-questionnaire/public-indicators';

const prisma = new PrismaClient();

const NUMERIC: FieldType[] = [
  FieldType.INTEGER,
  FieldType.DECIMAL,
  FieldType.MONETARY,
  FieldType.PERCENTAGE,
];

/** The three refusals `PublicIndicatorsService.assertPublishable` makes, run before anything is written. */
async function publishableProblem(fieldKey: string): Promise<string | null> {
  const field = await prisma.templateField.findFirst({
    where: {
      key: fieldKey,
      section: { template: { deletedAt: null, status: TemplateStatus.PUBLISHED } },
    },
    select: { dataType: true, isLevyBasis: true },
  });
  if (!field) return 'not on any published questionnaire';
  if (!NUMERIC.includes(field.dataType))
    return `is a ${field.dataType.toLowerCase()}, not a figure`;
  if (field.isLevyBasis) return 'is the levy basis, which is commercially sensitive';
  return null;
}

async function run() {
  const problems: string[] = [];
  for (const c of INDICATOR_CANDIDATES) {
    const problem = await publishableProblem(c.fieldKey);
    if (problem) problems.push(`  ${c.fieldKey}: ${problem}`);
  }

  if (problems.length > 0) {
    console.error('None of these could be added to the allowlist:');
    console.error(problems.join('\n'));
    console.error('');
    console.error(
      'If they are all "not on any published questionnaire", the questionnaire is still a draft. ' +
        'Publish it under Templates first: an allowlist entry against a draft names a question ' +
        'that may still change.',
    );
    process.exitCode = 1;
    return;
  }

  let added = 0;
  let already = 0;
  for (const c of INDICATOR_CANDIDATES) {
    const existing = await prisma.publicIndicator.findFirst({
      where: { fieldKey: c.fieldKey, aggregation: c.aggregation, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      already += 1;
      continue;
    }
    await prisma.publicIndicator.create({
      data: {
        fieldKey: c.fieldKey,
        aggregation: c.aggregation,
        label: c.label,
        unit: c.unit ?? null,
        description: c.description,
        order: c.order,
        // Off. Always off. See the note at the top of this file.
        isPublished: false,
      },
    });
    added += 1;
  }

  console.log(`Added ${added} candidate indicators, ${already} were already on the list.`);
  console.log('');
  console.log(
    'Every one is switched OFF. Open Data is where somebody decides what the public sees.',
  );
  console.log('');
  console.log(`${NOT_EXPRESSIBLE.length} things NCA has asked for cannot be an indicator:`);
  for (const n of NOT_EXPRESSIBLE) console.log(`  - ${n.want}`);
  console.log('');
  console.log('The reasons are in prisma/nca-questionnaire/public-indicators.ts.');
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
