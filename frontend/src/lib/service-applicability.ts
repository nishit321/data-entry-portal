import type { EntityType, ReferenceCategory, TemplateSection } from './types';

/**
 * Which sections of a questionnaire apply to this operator on this return (VALIDATION_SPEC §3).
 *
 * A mirror of the server's rule, and deliberately a thin one. The server decides — it raises the
 * hard error and it refuses the submission — but the operator has to be able to see the answer
 * while they are typing, not after they press submit. Asking the server on every keystroke to find
 * out whether a section should still be on screen would be a poor trade.
 *
 * Because it is a mirror, it is kept small enough to read side by side with
 * `backend/src/submissions/service-applicability.ts`. If the rule changes, both change.
 */

const SERVICE_CATEGORY: ReferenceCategory = 'SERVICE_TYPE';

/** Normalise a code so "Mobile Money" and "mobile_money" are not two different services. */
export function normaliseServiceCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export interface DeclarationValue {
  valueText: string;
  isUnavailable: boolean;
}

/**
 * The services this return declares, read from the answers on the form right now.
 *
 * Every SERVICE_TYPE answer counts, and one answer may carry several codes separated by commas —
 * the same tolerance the server has, so the screen and the validator never disagree about what was
 * ticked. A value marked unavailable declares nothing.
 */
export function declaredServices(
  sections: readonly TemplateSection[],
  values: Readonly<Record<string, DeclarationValue>>,
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

/** Whether a section applies: written for this operator type, and its service ticked if it names one. */
export function sectionApplies(
  section: TemplateSection,
  entityType: EntityType,
  declared: ReadonlySet<string>,
): boolean {
  if (!section.applicableEntityTypes.includes(entityType)) return false;
  const required = section.requiredServiceCode?.trim();
  if (!required) return true;
  return declared.has(normaliseServiceCode(required));
}

/** Whether a value is an answer, as opposed to a blank the form left behind. */
export function hasAnswer(value: DeclarationValue | undefined): boolean {
  if (!value) return false;
  if (value.isUnavailable) return true;
  return (value.valueText ?? '').trim() !== '';
}

/**
 * A section that no longer applies but still holds answers.
 *
 * This is the case that would otherwise trap an operator. Untick a service after filling its
 * section in, and the server rightly refuses the return — but if the screen simply hid the section,
 * the operator would be told to clear figures they can no longer see. So a section in this state
 * stays on screen, with a warning and a way to empty it.
 */
export function isStrandedSection(
  section: TemplateSection,
  entityType: EntityType,
  declared: ReadonlySet<string>,
  values: Readonly<Record<string, DeclarationValue>>,
): boolean {
  if (sectionApplies(section, entityType, declared)) return false;
  if (!section.applicableEntityTypes.includes(entityType)) return false;
  if (!section.requiredServiceCode?.trim()) return false;
  return section.fields.some((f) => hasAnswer(values[f.id]));
}

/** A service code as a person reads it: MOBILE_MONEY becomes "mobile money". */
export function humaniseService(code: string | null | undefined): string {
  const words = (code ?? '').trim().replace(/[_-]+/g, ' ').toLowerCase();
  return words || 'that service';
}
