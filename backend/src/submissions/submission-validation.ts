import { EntityType, FieldType, ReferenceCategory } from '@prisma/client';
import { declaredServices, sectionApplies, undeclaredAnswers } from './service-applicability';

/**
 * Field-level submission validation (VALIDATION_SPEC §2, §3, §5, §7). Pure and
 * synchronous so it is trivially testable and reusable. Produces the two-tier
 * result: `hard` issues block submission, `soft` issues warn.
 *
 * This covers the per-field rules (mandatory, data-unavailable, type, range,
 * percentage bounds, non-negativity, the "Other" controlled pair). The
 * cross-field rules (Postpaid+Prepaid=Total, float reconciliation, …) and the
 * period-on-period ±50% soft checks are the job of the dedicated validation
 * engine (next spine module), which builds on this.
 */

export interface ValidationField {
  id: string;
  key: string;
  label: string;
  dataType: FieldType;
  isMandatory: boolean;
  allowsOther: boolean;
  minValue: number | null;
  maxValue: number | null;
  /** Set on REFERENCE fields. A SERVICE_TYPE answer is what declares a service (§3). */
  referenceCategory?: ReferenceCategory | null;
}

export interface ValidationSection {
  key: string;
  applicableEntityTypes: EntityType[];
  /**
   * A SERVICE_TYPE code. When set, this section exists only for operators who tick that service
   * in Section 1 (VALIDATION_SPEC §3).
   */
  requiredServiceCode?: string | null;
  fields: ValidationField[];
}

export interface SubmittedValue {
  valueText?: string | null;
  isUnavailable?: boolean;
  unavailableReason?: string | null;
  otherText?: string | null;
}

export interface ValidationIssue {
  sectionKey: string;
  fieldKey: string;
  label: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  hard: ValidationIssue[];
  soft: ValidationIssue[];
}

const NUMERIC_TYPES: FieldType[] = [
  FieldType.INTEGER,
  FieldType.DECIMAL,
  FieldType.PERCENTAGE,
  FieldType.MONETARY,
];

const MAX_REASON = 200;
const OTHER_MIN = 3;
const OTHER_MAX = 100;

/** A service code as a person reads it: MOBILE_MONEY becomes "mobile money". */
function humaniseService(code: string): string {
  const words = code.trim().replace(/[_-]+/g, ' ').toLowerCase();
  return words || 'that service';
}

export function validateSubmission(
  sections: ValidationSection[],
  entityType: EntityType,
  values: Record<string, SubmittedValue>,
): ValidationResult {
  const hard: ValidationIssue[] = [];
  const soft: ValidationIssue[] = [];

  // Which services this return declares. Read from the return's own answers, because the services
  // an operator offers are a thing it tells us each period, not a fixed property of the operator.
  const declared = declaredServices(sections, values);

  // §6.1: a figure reported against a service the operator has not ticked is a contradiction, and
  // a hard error. Reported per field so the operator is told which figures to remove.
  for (const { section, field } of undeclaredAnswers(sections, entityType, declared, values)) {
    // `undeclaredAnswers` works on the narrower applicability shape, so the label the operator
    // actually sees is looked up from the full field here.
    const labelled = section.fields.find(
      (f): f is ValidationField => (f as ValidationField).id === field.id,
    );
    hard.push({
      sectionKey: section.key,
      fieldKey: field.key,
      label: labelled?.label ?? field.key,
      code: 'service_not_declared',
      message: `This question is only asked of operators offering ${humaniseService(
        section.requiredServiceCode ?? '',
      )}. Either tick that service in Section 1, or clear this answer.`,
    });
  }

  for (const section of sections) {
    // §3: a section applies when it is written for this operator's type *and*, if it names a
    // service, that service has been ticked. A section that does not apply is not validated at
    // all — nothing in it is mandatory, because the operator is not being asked it.
    if (!sectionApplies(section, entityType, declared)) continue;

    for (const field of section.fields) {
      const v = values[field.id] ?? {};
      const issue = (code: string, message: string): ValidationIssue => ({
        sectionKey: section.key,
        fieldKey: field.key,
        label: field.label,
        code,
        message,
      });

      // "Data unavailable" — a value of NULL is allowed only with a reason.
      if (v.isUnavailable) {
        const reason = (v.unavailableReason ?? '').trim();
        if (!reason) {
          hard.push(
            issue('reason_required', `"${field.label}" needs a reason when marked unavailable`),
          );
        } else if (reason.length > MAX_REASON) {
          hard.push(
            issue('reason_too_long', `Reason for "${field.label}" is too long (max ${MAX_REASON})`),
          );
        }
        continue; // no value expected when unavailable
      }

      const raw = (v.valueText ?? '').trim();
      const hasValue = raw !== '';

      if (!hasValue) {
        if (field.isMandatory) {
          hard.push(issue('required', `"${field.label}" is required`));
        }
      } else {
        validateTyped(field, raw, issue, hard);
      }

      // Controlled "Other (Specify)" pair.
      const other = (v.otherText ?? '').trim();
      if (other) {
        if (!field.allowsOther) {
          hard.push(
            issue('other_not_allowed', `"${field.label}" does not accept an "Other" description`),
          );
        } else if (other.length < OTHER_MIN || other.length > OTHER_MAX) {
          hard.push(
            issue(
              'other_length',
              `The "Other" description must be ${OTHER_MIN} to ${OTHER_MAX} characters`,
            ),
          );
        }
      }
    }
  }

  return { hard, soft };
}

function validateTyped(
  field: ValidationField,
  raw: string,
  issue: (code: string, message: string) => ValidationIssue,
  hard: ValidationIssue[],
): void {
  if (NUMERIC_TYPES.includes(field.dataType)) {
    const n = Number(raw);
    if (Number.isNaN(n)) {
      hard.push(issue('not_a_number', `"${field.label}" must be a number`));
      return;
    }
    if (n < 0) hard.push(issue('negative', `"${field.label}" cannot be negative`));
    if (field.dataType === FieldType.INTEGER && !Number.isInteger(n)) {
      hard.push(issue('not_integer', `"${field.label}" must be a whole number`));
    }
    if (field.dataType === FieldType.PERCENTAGE && (n < 0 || n > 100)) {
      hard.push(issue('percentage_range', `"${field.label}" must be between 0 and 100`));
    }
    if (field.minValue != null && n < field.minValue) {
      hard.push(issue('below_min', `"${field.label}" is below the minimum of ${field.minValue}`));
    }
    if (field.maxValue != null && n > field.maxValue) {
      hard.push(issue('above_max', `"${field.label}" exceeds the maximum of ${field.maxValue}`));
    }
  } else if (field.dataType === FieldType.BOOLEAN) {
    if (raw !== 'true' && raw !== 'false') {
      hard.push(issue('not_boolean', `"${field.label}" must be Yes or No`));
    }
  } else if (field.dataType === FieldType.DATE) {
    if (Number.isNaN(Date.parse(raw))) {
      hard.push(issue('invalid_date', `"${field.label}" must be a valid date`));
    }
  }
}
