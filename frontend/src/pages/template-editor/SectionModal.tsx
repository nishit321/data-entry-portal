import { Controller, type UseFormReturn } from 'react-hook-form';
import { strings } from '../../lib/strings';
import type { UseMutationResult } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  FormField,
  Input,
  Modal,
  Select,
} from '../../components/ui';
import { ENTITY_TYPE_LABELS, ENTITY_TYPES, type TemplateSection } from '../../lib/types';
import type { SectionForm } from './section-form';
import { FREQUENCY_OPTIONS } from './field-form';

/**
 * Adding and editing a section.
 *
 * The smallest of the three dialogs, and the one carrying the decision with the widest reach:
 * which kinds of operator a section applies to, and — through `requiredServiceCode` — whether it
 * is asked at all of an operator that does not offer the service.
 */
export interface SectionModalProps {
  open: boolean;
  editingSection: TemplateSection | null;
  onClose: () => void;
  sectionForm: UseFormReturn<SectionForm>;
  formError: string;
  saveSectionMutation: UseMutationResult<unknown, unknown, SectionForm, unknown>;
}

export function SectionModal({
  open,
  editingSection,
  onClose,
  sectionForm,
  formError,
  saveSectionMutation,
}: SectionModalProps) {
  const sErrors = sectionForm.formState.errors;

  return (
    <Modal open={open} title={editingSection ? 'Edit section' : 'Add section'} onClose={onClose}>
      <form
        onSubmit={sectionForm.handleSubmit((v) => saveSectionMutation.mutate(v))}
        className="space-y-4"
      >
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            htmlFor="sec-key"
            label="Key"
            info="A stable identifier used in reports and rules. It can't be changed once the section is created."
            error={sErrors.key?.message}
            required
          >
            {(field) => (
              <Input
                {...field}
                placeholder="e.g. subscribers"
                disabled={!!editingSection}
                {...sectionForm.register('key')}
              />
            )}
          </FormField>
          <FormField htmlFor="sec-title" label="Title" error={sErrors.title?.message} required>
            {(field) => (
              <Input {...field} placeholder="e.g. Subscribers" {...sectionForm.register('title')} />
            )}
          </FormField>
        </div>
        <FormField
          htmlFor="sec-description"
          label={strings.field.descriptionOptional}
          error={sErrors.description?.message}
        >
          {(field) => (
            <Input
              {...field}
              placeholder="Guidance shown to operators"
              {...sectionForm.register('description')}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            htmlFor="sec-frequency"
            label="Reporting frequency"
            error={sErrors.frequency?.message}
            required
          >
            {(field) => (
              <Controller
                control={sectionForm.control}
                name="frequency"
                render={({ field: { value, onChange } }) => (
                  <Select
                    id={field.id}
                    value={value ?? ''}
                    onChange={onChange}
                    options={FREQUENCY_OPTIONS}
                    invalid={!!sErrors.frequency}
                  />
                )}
              />
            )}
          </FormField>
          <FormField htmlFor="sec-order" label="Order (optional)" error={sErrors.order?.message}>
            {(field) => (
              <Input
                {...field}
                type="number"
                min={0}
                placeholder="e.g. 10"
                {...sectionForm.register('order')}
              />
            )}
          </FormField>
        </div>
        <FormField
          htmlFor="sec-service"
          label="Required service code (optional)"
          hint="Only entities offering this service see the section."
          error={sErrors.requiredServiceCode?.message}
        >
          {(field) => (
            <Input
              {...field}
              placeholder="e.g. MOBILE_MONEY"
              {...sectionForm.register('requiredServiceCode')}
            />
          )}
        </FormField>
        <Field
          label="Applicable entity types"
          htmlFor="sec-entity-types"
          error={sErrors.applicableEntityTypes?.message}
          required
        >
          <Controller
            control={sectionForm.control}
            name="applicableEntityTypes"
            render={({ field: { value, onChange } }) => {
              const selected = value ?? [];
              return (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {ENTITY_TYPES.map((t) => (
                    <Checkbox
                      key={t}
                      label={ENTITY_TYPE_LABELS[t]}
                      checked={selected.includes(t)}
                      onChange={(checked) =>
                        onChange(checked ? [...selected, t] : selected.filter((x) => x !== t))
                      }
                    />
                  ))}
                </div>
              );
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {strings.action.cancel}
          </Button>
          <Button type="submit" isLoading={saveSectionMutation.isPending}>
            {editingSection ? 'Save changes' : 'Add section'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
