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
  type SelectOption,
} from '../../components/ui';
import type { TemplateRule } from '../../lib/types';
import type { RuleForm } from './rule-form';
import { RULE_SEVERITY_OPTIONS, RULE_TYPE_OPTIONS } from './rule-form';

/**
 * Adding and editing a validation rule.
 *
 * Lifted out of `TemplateEditorPage`, which §7 of the standards had outgrown at 1,800 lines. The
 * dependency worth naming is `fieldRefSelect`: a rule is the only thing on this screen that
 * reaches across questions, so this component has to be handed a way to list them. Building that
 * list here instead would mean two places deciding which fields a rule may point at.
 */
export interface RuleModalProps {
  open: boolean;
  editingRule: TemplateRule | null;
  onClose: () => void;
  ruleForm: UseFormReturn<RuleForm>;
  /** Which rule type is selected, so the operand fields can follow it. */
  watchedRuleType: RuleForm['type'];
  /** The numeric questions a rule may reference, and a picker bound to one operand. */
  fieldRefOptions: SelectOption[];
  hasFieldRefs: boolean;
  fieldRefSelect: (
    name: 'total' | 'left' | 'right' | 'balance' | 'backing' | 'field' | 'when' | 'require',
    controlId: string,
  ) => React.ReactNode;
  formError: string;
  saveRuleMutation: UseMutationResult<unknown, unknown, RuleForm, unknown>;
}

export function RuleModal({
  open,
  editingRule,
  onClose,
  ruleForm,
  watchedRuleType,
  fieldRefOptions,
  hasFieldRefs,
  fieldRefSelect,
  formError,
  saveRuleMutation,
}: RuleModalProps) {
  const rErrors = ruleForm.formState.errors;

  return (
    <Modal
      open={open}
      title={editingRule ? 'Edit validation rule' : 'Add validation rule'}
      onClose={onClose}
    >
      <form
        onSubmit={ruleForm.handleSubmit((v) => saveRuleMutation.mutate(v))}
        className="space-y-4"
      >
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="rule-type" label="Rule type" error={rErrors.type?.message} required>
            {(field) => (
              <Controller
                control={ruleForm.control}
                name="type"
                render={({ field: { value, onChange } }) => (
                  <Select
                    id={field.id}
                    value={value ?? ''}
                    onChange={onChange}
                    options={RULE_TYPE_OPTIONS}
                    invalid={!!rErrors.type}
                  />
                )}
              />
            )}
          </FormField>
          <FormField
            htmlFor="rule-severity"
            label="Severity"
            error={rErrors.severity?.message}
            required
          >
            {(field) => (
              <Controller
                control={ruleForm.control}
                name="severity"
                render={({ field: { value, onChange } }) => (
                  <Select
                    id={field.id}
                    value={value ?? ''}
                    onChange={onChange}
                    options={RULE_SEVERITY_OPTIONS}
                    invalid={!!rErrors.severity}
                  />
                )}
              />
            )}
          </FormField>
        </div>
        <FormField
          htmlFor="rule-label"
          label={strings.field.label}
          error={rErrors.label?.message}
          required
        >
          {(field) => (
            <Input
              {...field}
              placeholder="e.g. Subscriber breakdown must sum to the total"
              {...ruleForm.register('label')}
            />
          )}
        </FormField>

        {!hasFieldRefs && (
          <Alert tone="warning">
            This template has no numeric fields yet. Add a number, percentage, or monetary field
            before you can build a cross-field rule.
          </Alert>
        )}

        {hasFieldRefs && watchedRuleType === 'SUM_EQUALS_TOTAL' && (
          <>
            <Field
              label="Fields that must add up"
              htmlFor="rule-operands"
              error={rErrors.operands?.message}
              required
            >
              <Controller
                control={ruleForm.control}
                name="operands"
                render={({ field: { value, onChange } }) => {
                  const selected = value ?? [];
                  return (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {fieldRefOptions.map((o) => (
                        <Checkbox
                          key={o.value}
                          label={o.label}
                          checked={selected.includes(o.value)}
                          onChange={(checked) =>
                            onChange(
                              checked
                                ? [...selected, o.value]
                                : selected.filter((x) => x !== o.value),
                            )
                          }
                        />
                      ))}
                    </div>
                  );
                }}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Total field"
                htmlFor="rule-total"
                error={rErrors.total?.message}
                required
              >
                {fieldRefSelect('total', 'rule-total')}
              </Field>
              <FormField
                htmlFor="rule-tolerance"
                label="Tolerance % (optional)"
                error={rErrors.tolerancePercent?.message}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    step="any"
                    min={0}
                    placeholder="e.g. 0.5"
                    {...ruleForm.register('tolerancePercent')}
                  />
                )}
              </FormField>
            </div>
          </>
        )}

        {hasFieldRefs && watchedRuleType === 'LESS_OR_EQUAL' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="This field (must not exceed)"
              htmlFor="rule-left"
              error={rErrors.left?.message}
              required
            >
              {fieldRefSelect('left', 'rule-left')}
            </Field>
            <Field
              label="Must stay within this field"
              htmlFor="rule-right"
              error={rErrors.right?.message}
              required
            >
              {fieldRefSelect('right', 'rule-right')}
            </Field>
          </div>
        )}

        {hasFieldRefs && watchedRuleType === 'FLOAT_RECONCILE' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Balance held"
                htmlFor="rule-balance"
                error={rErrors.balance?.message}
                required
              >
                {fieldRefSelect('balance', 'rule-balance')}
              </Field>
              <Field
                label="Amount it must back"
                htmlFor="rule-backing"
                error={rErrors.backing?.message}
                required
              >
                {fieldRefSelect('backing', 'rule-backing')}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                htmlFor="rule-shortfall"
                label="Shortfall % (optional)"
                error={rErrors.shortfallPercent?.message}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    step="any"
                    min={0}
                    placeholder="e.g. 1"
                    {...ruleForm.register('shortfallPercent')}
                  />
                )}
              </FormField>
              <FormField
                htmlFor="rule-surplus"
                label="Surplus % (optional)"
                error={rErrors.surplusPercent?.message}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    step="any"
                    min={0}
                    placeholder="e.g. 5"
                    {...ruleForm.register('surplusPercent')}
                  />
                )}
              </FormField>
            </div>
          </>
        )}

        {hasFieldRefs && watchedRuleType === 'PERIOD_ON_PERIOD' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Field to watch"
              htmlFor="rule-field"
              error={rErrors.field?.message}
              required
            >
              {fieldRefSelect('field', 'rule-field')}
            </Field>
            <FormField
              htmlFor="rule-threshold"
              label="Change threshold % (optional)"
              error={rErrors.thresholdPercent?.message}
            >
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  step="any"
                  min={0}
                  placeholder="e.g. 25"
                  {...ruleForm.register('thresholdPercent')}
                />
              )}
            </FormField>
          </div>
        )}

        {hasFieldRefs && watchedRuleType === 'NONZERO_REQUIRES' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="When this field is above zero"
              htmlFor="rule-when"
              error={rErrors.when?.message}
              required
            >
              {fieldRefSelect('when', 'rule-when')}
            </Field>
            <Field
              label="This field must also be filled"
              htmlFor="rule-require"
              error={rErrors.require?.message}
              required
            >
              {fieldRefSelect('require', 'rule-require')}
            </Field>
          </div>
        )}

        <FormField htmlFor="rule-order" label="Order (optional)" error={rErrors.order?.message}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min={0}
              placeholder="e.g. 10"
              {...ruleForm.register('order')}
            />
          )}
        </FormField>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {strings.action.cancel}
          </Button>
          <Button type="submit" isLoading={saveRuleMutation.isPending} disabled={!hasFieldRefs}>
            {editingRule ? 'Save changes' : 'Add rule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
