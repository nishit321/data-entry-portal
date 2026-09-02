import { EntityType, ReferenceCategory } from '@prisma/client';

/**
 * Which sections of a questionnaire actually apply to this operator, on this return
 * (VALIDATION_SPEC §3, §6.1).
 *
 * Two things decide it. The operator's **type** is fixed and known before the return is opened.
 * The **services it offers** are not: they are an answer on the return itself, ticked in Section 1,
 * and they can change from one period to the next. A section carrying `requiredServiceCode` exists
 * only for operators who tick that service.
 *
 * The spec is unusually specific about both halves of the consequence, and both are here:
 *
 * - *"If 'Mobile Money Services' is not ticked, Section 6 is hidden entirely (not shown, not
 *   required)."* — an operator must not be asked to fill in a section about a service it does not
 *   provide, and must not be blocked from filing because it left that section empty.
 * - *"Mobile-money data submitted while the service is not ticked in Section 1 → hard error."* —
 *   the other direction. A figure reported against a service the operator says it does not offer
 *   is a contradiction, and the return should not be accepted while it stands.
 *
 * Kept pure so the same rule can be run in three places without drifting: the validator, the
 * screen the operator fills in, and the machine API that tells an integration which questions to
 * answer. A rule enforced in one of those and not the others is the kind that produces an
 * operator insisting the portal accepted something it later rejected.
 */

/** The lookup list a "which services do you offer?" answer is chosen from. */
export const SERVICE_CATEGORY = ReferenceCategory.SERVICE_TYPE;

export interface ApplicabilityField {
  id: string;
  key: string;
  /** Set on REFERENCE fields; SERVICE_TYPE is the one that declares a service. */
  referenceCategory?: ReferenceCategory | null;
}

export interface ApplicabilitySection {
  key: string;
  applicableEntityTypes: EntityType[];
  /** A SERVICE_TYPE code. When set, this section exists only if that service is ticked. */
  requiredServiceCode?: string | null;
  fields: ApplicabilityField[];
}

export interface ApplicabilityValue {
  valueText?: string | null;
  isUnavailable?: boolean;
}

/** Normalise a service code so "Mobile Money" and "mobile_money" are not two different services. */
export function normaliseServiceCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * The services this return declares, read from its own answers.
 *
 * Every SERVICE_TYPE answer anywhere on the return counts, and a single answer may carry several
 * codes separated by commas. That tolerance is deliberate: NCA's final questionnaire content has
 * not been seeded yet, and "which services do you offer?" is equally reasonably built as one
 * multi-value question or as one question per service. Reading whichever arrives means the rule
 * works the day the real questionnaire is loaded, rather than needing to be revisited then.
 *
 * A value marked unavailable declares nothing. "I cannot tell you" is not "yes".
 */
export function declaredServices(
  sections: readonly ApplicabilitySection[],
  values: Readonly<Record<string, ApplicabilityValue>>,
): Set<string> {
  const declared = new Set<string>();

  for (const section of sections) {
    for (const field of section.fields) {
      if (field.referenceCategory !== SERVICE_CATEGORY) continue;
      const value = values[field.id];
      if (!value || value.isUnavailable) continue;

      for (const part of (value.valueText ?? '').split(',')) {
        const code = normaliseServiceCode(part);
        if (code) declared.add(code);
      }
    }
  }

  return declared;
}

/** Whether a section applies to this operator type at all. */
export function appliesToEntityType(
  section: ApplicabilitySection,
  entityType: EntityType,
): boolean {
  return section.applicableEntityTypes.includes(entityType);
}

/**
 * Whether a section applies on this return.
 *
 * A section with no `requiredServiceCode` applies to everyone of the right type — the overwhelming
 * majority. A section that names a service applies only when that service is ticked.
 */
export function sectionApplies(
  section: ApplicabilitySection,
  entityType: EntityType,
  declared: ReadonlySet<string>,
): boolean {
  if (!appliesToEntityType(section, entityType)) return false;
  const required = section.requiredServiceCode?.trim();
  if (!required) return true;
  return declared.has(normaliseServiceCode(required));
}

/** Whether a value is an answer at all, as opposed to a blank the form left behind. */
export function hasAnswer(value: ApplicabilityValue | undefined): boolean {
  if (!value) return false;
  if (value.isUnavailable) return true;
  return (value.valueText ?? '').trim() !== '';
}

/**
 * Sections that carry answers for a service the operator has not ticked.
 *
 * This is the §6.1 hard error. It is reported per field rather than per section so the operator is
 * told exactly which figures to remove — "Section 6 should be empty" sends somebody hunting.
 */
export function undeclaredAnswers(
  sections: readonly ApplicabilitySection[],
  entityType: EntityType,
  declared: ReadonlySet<string>,
  values: Readonly<Record<string, ApplicabilityValue>>,
): { section: ApplicabilitySection; field: ApplicabilityField }[] {
  const found: { section: ApplicabilitySection; field: ApplicabilityField }[] = [];

  for (const section of sections) {
    // Only sections gated on a service can produce this. A section that does not apply because of
    // the operator's *type* is a different situation, and the type is not something the operator
    // can contradict on the form.
    if (!section.requiredServiceCode?.trim()) continue;
    if (!appliesToEntityType(section, entityType)) continue;
    if (sectionApplies(section, entityType, declared)) continue;

    for (const field of section.fields) {
      if (hasAnswer(values[field.id])) found.push({ section, field });
    }
  }

  return found;
}
