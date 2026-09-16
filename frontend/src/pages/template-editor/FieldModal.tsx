import { Controller, type UseFormReturn } from 'react-hook-form';
import { strings } from '../../lib/strings';
import type { UseMutationResult } from '@tanstack/react-query';
import { Alert, Button, Checkbox, FormField, Input, Modal, Select } from '../../components/ui';
import type { TemplateField } from '../../lib/types';
import type { FieldForm } from './field-form';
import {
  FIELD_TYPE_OPTIONS,
  FLOW_OR_STOCK_OPTIONS,
  FREQUENCY_OVERRIDE_OPTIONS,
  REFERENCE_CATEGORY_OPTIONS,
} from './field-form';

/**
 * Adding and editing one question.
 *
 * The widest form on the screen, because a question carries far more than a label: its data type
 * decides which of the rest apply, which is why `watchedDataType` is a prop rather than something
 * this component works out for itself. The page owns the form; this owns how it looks.
 */
export interface FieldModalProps {
  open: boolean;
  editingField: TemplateField | null;
  onClose: () => void;
  fieldForm: UseFormReturn<FieldForm>;
  /** The selected data type, since half the fields below only apply to some of them. */
  watchedDataType: FieldForm['dataType'];
  formError: string;
  saveFieldMutation: UseMutationResult<unknown, unknown, FieldForm, unknown>;
}

export function FieldModal({
  open,
  editingField,
  onClose,
  fieldForm,
  watchedDataType,
  formError,
  saveFieldMutation,
}: FieldModalProps) {
  const fErrors = fieldForm.formState.errors;

  return (
    <Modal open={open} title={editingField ? 'Edit field' : 'Add field'} onClose={onClose}>
      <form
        onSubmit={fieldForm.handleSubmit((v) => saveFieldMutation.mutate(v))}
        className="space-y-4"
      >
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            htmlFor="fld-key"
            label="Key"
            info="A stable identifier used in reports and rules. It can't be changed once the field is created."
            error={fErrors.key?.message}
            required
          >
            {(field) => (
              <Input
                {...field}
                placeholder="e.g. active_subscribers"
                disabled={!!editingField}
                {...fieldForm.register('key')}
              />
            )}
          </FormField>
          <FormField
            htmlFor="fld-label"
            label={strings.field.label}
            error={fErrors.label?.message}
            required
          >
            {(field) => (
              <Input
                {...field}
                placeholder="e.g. Active subscribers"
                {...fieldForm.register('label')}
              />
            )}
          </FormField>
        </div>
        <FormField
          htmlFor="fld-description"
          label={strings.field.descriptionOptional}
          error={fErrors.description?.message}
        >
          {(field) => (
            <Input
              {...field}
              placeholder="Guidance shown to operators"
              {...fieldForm.register('description')}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            htmlFor="fld-dataType"
            label="Data type"
            error={fErrors.dataType?.message}
            required
          >
            {(field) => (
              <Controller
                control={fieldForm.control}
                name="dataType"
                render={({ field: { value, onChange } }) => (
                  <Select
                    id={field.id}
                    value={value ?? ''}
                    onChange={onChange}
                    options={FIELD_TYPE_OPTIONS}
                    invalid={!!fErrors.dataType}
                  />
                )}
              />
            )}
          </FormField>
          <FormField htmlFor="fld-unit" label="Unit (optional)" error={fErrors.unit?.message}>
            {(field) => (
              <Input
                {...field}
                placeholder="e.g. subscribers, GB, %"
                {...fieldForm.register('unit')}
              />
            )}
          </FormField>
        </div>
        {watchedDataType === 'REFERENCE' && (
          <FormField
            htmlFor="fld-refcat"
            label="Reference list"
            error={fErrors.referenceCategory?.message}
            required
          >
            {(field) => (
              <Controller
                control={fieldForm.control}
                name="referenceCategory"
                render={({ field: { value, onChange } }) => (
                  <Select
                    id={field.id}
                    value={value ?? ''}
                    onChange={onChange}
                    options={REFERENCE_CATEGORY_OPTIONS}
                    placeholder="Select a list"
                    invalid={!!fErrors.referenceCategory}
                  />
                )}
              />
            )}
          </FormField>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField htmlFor="fld-order" label="Order (optional)" error={fErrors.order?.message}>
            {(field) => (
              <Input
                {...field}
                type="number"
                min={0}
                placeholder="e.g. 10"
                {...fieldForm.register('order')}
              />
            )}
          </FormField>
          <FormField
            htmlFor="fld-decimals"
            label="Decimals (optional)"
            error={fErrors.decimals?.message}
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                min={0}
                max={6}
                placeholder="0 to 6"
                {...fieldForm.register('decimals')}
              />
            )}
          </FormField>
          <FormField
            htmlFor="fld-frequencyOverride"
            label="Frequency override"
            error={fErrors.frequencyOverride?.message}
          >
            {(field) => (
              <Controller
                control={fieldForm.control}
                name="frequencyOverride"
                render={({ field: { value, onChange } }) => (
                  <Select
                    id={field.id}
                    value={value ?? ''}
                    onChange={onChange}
                    options={FREQUENCY_OVERRIDE_OPTIONS}
                  />
                )}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            htmlFor="fld-min"
            label="Minimum value (optional)"
            error={fErrors.minValue?.message}
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                step="any"
                placeholder="e.g. 0"
                {...fieldForm.register('minValue')}
              />
            )}
          </FormField>
          <FormField
            htmlFor="fld-max"
            label="Maximum value (optional)"
            error={fErrors.maxValue?.message}
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                step="any"
                placeholder="e.g. 100"
                {...fieldForm.register('maxValue')}
              />
            )}
          </FormField>
          <FormField
            htmlFor="fld-flowOrStock"
            label="Rollup treatment"
            error={fErrors.flowOrStock?.message}
            required
          >
            {(field) => (
              <Controller
                control={fieldForm.control}
                name="flowOrStock"
                render={({ field: { value, onChange } }) => (
                  <Select
                    id={field.id}
                    value={value ?? ''}
                    onChange={onChange}
                    options={FLOW_OR_STOCK_OPTIONS}
                    invalid={!!fErrors.flowOrStock}
                  />
                )}
              />
            )}
          </FormField>
        </div>
        <div className="flex flex-col gap-2">
          <Controller
            control={fieldForm.control}
            name="isMandatory"
            render={({ field: { value, onChange } }) => (
              <Checkbox
                checked={!!value}
                onChange={onChange}
                label="Required. Operators must fill this in"
              />
            )}
          />
          <Controller
            control={fieldForm.control}
            name="allowsOther"
            render={({ field: { value, onChange } }) => (
              <Checkbox
                checked={!!value}
                onChange={onChange}
                label={`Allow an "Other" free-text response`}
              />
            )}
          />
          {/* The levy is assessed on reported revenue, so only a monetary field can be its
              basis (VALIDATION_SPEC §4.1). */}
          {fieldForm.watch('dataType') === 'MONETARY' && (
            <Controller
              control={fieldForm.control}
              name="isLevyBasis"
              render={({ field: { value, onChange } }) => (
                <Checkbox
                  checked={!!value}
                  onChange={onChange}
                  label="Use this figure to assess the regulatory levy"
                />
              )}
            />
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {strings.action.cancel}
          </Button>
          <Button type="submit" isLoading={saveFieldMutation.isPending}>
            {editingField ? 'Save changes' : 'Add field'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
