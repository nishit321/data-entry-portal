import { z } from 'zod';
import {
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  FLOW_OR_STOCK,
  FLOW_OR_STOCK_LABELS,
  REFERENCE_CATEGORIES,
  REFERENCE_CATEGORY_LABELS,
  REPORTING_FREQUENCIES,
  REPORTING_FREQUENCY_LABELS,
} from '../../lib/types';
import type { FieldInput } from '../../lib/templates.api';
import type { SelectOption } from '../../components/ui';

/**
 * One question, everything except how it looks.
 *
 * A question is the most conditional thing on this screen — half its settings only apply to some
 * data types, and the rules about which are the sort that go quietly wrong when they live in two
 * places. The schema is the single statement of them, and it sits here rather than inside a
 * dialog so the page can build a payload without opening one.
 */

/** A key an operator will see in a spreadsheet column: letters, digits, underscore, hyphen. */
export const SLUG = /^[A-Za-z0-9_-]+$/;

/** Every reporting frequency, for the controls that let one be chosen outright. */
export const FREQUENCY_OPTIONS: SelectOption[] = REPORTING_FREQUENCIES.map((f) => ({
  value: f,
  label: REPORTING_FREQUENCY_LABELS[f],
}));

/** Numbers arrive from inputs as strings; an empty one means "not set", not zero. */
const numOrUndef = (v: unknown) =>
  v === '' || v === null || v === undefined ? undefined : Number(v);

export const FREQUENCY_OVERRIDE_OPTIONS: SelectOption[] = [
  { value: '', label: 'Same as section' },
  ...FREQUENCY_OPTIONS,
];

export const FIELD_TYPE_OPTIONS: SelectOption[] = FIELD_TYPES.map((t) => ({
  value: t,
  label: FIELD_TYPE_LABELS[t],
}));

export const FLOW_OR_STOCK_OPTIONS: SelectOption[] = FLOW_OR_STOCK.map((f) => ({
  value: f,
  label: FLOW_OR_STOCK_LABELS[f],
}));

export const REFERENCE_CATEGORY_OPTIONS: SelectOption[] = REFERENCE_CATEGORIES.map((c) => ({
  value: c,
  label: REFERENCE_CATEGORY_LABELS[c],
}));

export const fieldSchema = z
  .object({
    key: z.string().min(1, 'Key is required').max(100).regex(SLUG, 'Letters, digits, _ and - only'),
    label: z.string().min(1, 'Label is required').max(200),
    description: z.string().max(500).optional(),
    order: z.preprocess(numOrUndef, z.number().int().min(0).optional()),
    dataType: z.enum(FIELD_TYPES),
    unit: z.string().max(50).optional(),
    decimals: z.preprocess(numOrUndef, z.number().int().min(0).max(6).optional()),
    isMandatory: z.boolean(),
    flowOrStock: z.enum(FLOW_OR_STOCK),
    minValue: z.preprocess(numOrUndef, z.number().optional()),
    maxValue: z.preprocess(numOrUndef, z.number().optional()),
    referenceCategory: z.enum(REFERENCE_CATEGORIES).or(z.literal('')),
    allowsOther: z.boolean(),
    frequencyOverride: z.enum(REPORTING_FREQUENCIES).or(z.literal('')),
    isLevyBasis: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.dataType === 'REFERENCE' && !v.referenceCategory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceCategory'],
        message: 'Choose a reference list for reference fields',
      });
    }
  });
export type FieldForm = z.infer<typeof fieldSchema>;

/** Build a field payload, dropping blanks; `key` is create-only (read-only on edit). */
export function toFieldInput(v: FieldForm, isEdit: boolean): FieldInput {
  const body: FieldInput = {
    label: v.label,
    dataType: v.dataType,
    isMandatory: v.isMandatory,
    flowOrStock: v.flowOrStock,
    allowsOther: v.allowsOther,
    isLevyBasis: v.isLevyBasis,
  };
  if (!isEdit) body.key = v.key;
  if (v.description) body.description = v.description;
  if (v.order !== undefined) body.order = v.order;
  if (v.unit) body.unit = v.unit;
  if (v.decimals !== undefined) body.decimals = v.decimals;
  if (v.minValue !== undefined) body.minValue = v.minValue;
  if (v.maxValue !== undefined) body.maxValue = v.maxValue;
  if (v.dataType === 'REFERENCE' && v.referenceCategory)
    body.referenceCategory = v.referenceCategory;
  if (v.frequencyOverride) body.frequencyOverride = v.frequencyOverride;
  return body;
}
