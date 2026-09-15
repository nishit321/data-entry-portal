import { z } from 'zod';
import { ENTITY_TYPES, REPORTING_FREQUENCIES } from '../../lib/types';
import type { SectionInput } from '../../lib/templates.api';
import { SLUG } from './field-form';

/**
 * A section, everything except how it looks.
 *
 * The rule that matters here is `applicableEntityTypes`: a section with none selected would apply
 * to nobody and quietly disappear from every return, so the schema insists on at least one rather
 * than letting an empty list through as "all".
 */

/** Numbers arrive from inputs as strings; an empty one means "not set", not zero. */
const numOrUndef = (v: unknown) =>
  v === '' || v === null || v === undefined ? undefined : Number(v);

export const sectionSchema = z.object({
  key: z.string().min(1, 'Key is required').max(100).regex(SLUG, 'Letters, digits, _ and - only'),
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(500).optional(),
  order: z.preprocess(numOrUndef, z.number().int().min(0).optional()),
  applicableEntityTypes: z.array(z.enum(ENTITY_TYPES)).min(1, 'Select at least one entity type'),
  frequency: z.enum(REPORTING_FREQUENCIES),
  requiredServiceCode: z.string().max(50).optional(),
});
export type SectionForm = z.infer<typeof sectionSchema>;

/** Build a section payload, dropping blanks; `key` is create-only (read-only on edit). */
export function toSectionInput(v: SectionForm, isEdit: boolean): SectionInput {
  const body: SectionInput = {
    title: v.title,
    applicableEntityTypes: v.applicableEntityTypes,
    frequency: v.frequency,
  };
  if (!isEdit) body.key = v.key;
  if (v.description) body.description = v.description;
  if (v.order !== undefined) body.order = v.order;
  if (v.requiredServiceCode) body.requiredServiceCode = v.requiredServiceCode;
  return body;
}
