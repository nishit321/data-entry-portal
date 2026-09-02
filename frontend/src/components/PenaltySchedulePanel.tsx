import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  useToast,
} from './ui';
import { penaltyApi, penaltyKeys } from '../lib/penalty.api';
import { enforcementKeys } from '../lib/enforcement.api';
import { getErrorMessage } from '../lib/api';
import { formatDate, formatSsp, joinMeta } from '../lib/format';
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, type EntityType, type PenaltyRule } from '../lib/types';

const TYPE_OPTIONS = [
  { value: '', label: 'Every operator type' },
  ...ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_TYPE_LABELS[t] })),
];

const BLANK = {
  entityType: '',
  fixedAmount: '',
  dailyAmount: '',
  maxAmount: '',
  label: '',
  effectiveFrom: '',
  effectiveTo: '',
};

/** How a line reads in one phrase: what it charges on day one, and what it adds per day. */
function terms(rule: PenaltyRule): string {
  const fixed = Number(rule.fixedAmount);
  const daily = Number(rule.dailyAmount);
  const max = rule.maxAmount === null ? null : Number(rule.maxAmount);
  return joinMeta(
    fixed > 0 && `${formatSsp(fixed)} on the day it is recorded`,
    daily > 0 && `${formatSsp(daily)} a day after that`,
    max !== null && `capped at ${formatSsp(max)}`,
  );
}

/**
 * NCA Legal & Licensing's penalty schedule (Q3).
 *
 * The figures are configuration an administrator enters, not values coded into the portal. Everyone
 * who can see a compliance case can read the schedule those cases are priced under; only an
 * administrator can change it.
 */
export function PenaltySchedulePanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PenaltyRule | null>(null);
  const [form, setForm] = useState(BLANK);

  const rulesQuery = useQuery({ queryKey: penaltyKeys.all, queryFn: () => penaltyApi.list() });
  const rules = rulesQuery.data ?? [];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: penaltyKeys.all });
    void qc.invalidateQueries({ queryKey: enforcementKeys.all });
  };

  const create = useMutation({
    mutationFn: () =>
      penaltyApi.create({
        entityType: form.entityType ? (form.entityType as EntityType) : undefined,
        fixedAmount: form.fixedAmount ? Number(form.fixedAmount) : undefined,
        dailyAmount: form.dailyAmount ? Number(form.dailyAmount) : undefined,
        maxAmount: form.maxAmount ? Number(form.maxAmount) : undefined,
        label: form.label.trim() || undefined,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || undefined,
      }),
    onSuccess: () => {
      refresh();
      setOpen(false);
      setForm(BLANK);
      toast.success('Schedule line added.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't save the schedule line.")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => penaltyApi.remove(id),
    onSuccess: () => {
      refresh();
      setPendingDelete(null);
      toast.success('Schedule line removed.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove the schedule line.")),
  });

  const accrue = useMutation({
    mutationFn: () => penaltyApi.accrue(),
    onSuccess: (r) => {
      refresh();
      toast.success(
        `Reviewed ${r.cases} open ${r.cases === 1 ? 'case' : 'cases'}. Updated ${r.accrued}, closed ${r.closed}.`,
      );
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't update the open cases.")),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Penalty schedule</h3>
          <p className="mt-1 text-sm text-gray-500">
            A case is priced under the line in force on the day the default began. Changing the
            schedule does not re-price cases that are already closed.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={RefreshCw}
              isLoading={accrue.isPending}
              onClick={() => accrue.mutate()}
            >
              Update open cases
            </Button>
            <Button icon={Plus} onClick={() => setOpen(true)}>
              Add a line
            </Button>
          </div>
        )}
      </div>

      {rulesQuery.isLoading ? (
        <Skeleton className="mt-4 h-24 w-full" />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={Gavel}
          message="No penalty schedule has been entered yet. Cases are still opened and worked; they simply carry no amount."
        />
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-4 py-3">
              <Badge tone={rule.entityType ? 'info' : 'gray'}>
                {rule.entityType ? ENTITY_TYPE_LABELS[rule.entityType] : 'All types'}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">
                  {rule.label ?? 'Penalty schedule line'}
                </p>
                <p className="truncate text-xs text-gray-500">{terms(rule)}</p>
                <p className="truncate text-xs text-gray-500">
                  {joinMeta(
                    `from ${formatDate(rule.effectiveFrom)}`,
                    rule.effectiveTo ? `to ${formatDate(rule.effectiveTo)}` : 'open-ended',
                  )}
                </p>
              </div>
              {canManage && (
                <IconButton
                  icon={Trash2}
                  label={`Remove the ${rule.label ?? 'penalty schedule'} line`}
                  variant="danger"
                  onClick={() => setPendingDelete(rule)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} title="Add a schedule line" onClose={() => setOpen(false)} size="sm">
        <div className="space-y-4">
          <Field
            label="Applies to"
            htmlFor="pen-type"
            hint="Pick a type to override the general line for that class of operator."
          >
            <Select
              aria-label="Operator type this line applies to"
              options={TYPE_OPTIONS}
              value={form.entityType}
              onChange={(entityType) => setForm({ ...form, entityType })}
            />
          </Field>
          <Field
            label="Charged once (SSP)"
            htmlFor="pen-fixed"
            hint="Applied on the day the contravention is recorded."
          >
            <Input
              id="pen-fixed"
              type="number"
              step="0.01"
              min="0"
              value={form.fixedAmount}
              onChange={(e) => setForm({ ...form, fixedAmount: e.target.value })}
            />
          </Field>
          <Field
            label="Charged per day (SSP)"
            htmlFor="pen-daily"
            hint="Applied for each further day the return is still missing."
          >
            <Input
              id="pen-daily"
              type="number"
              step="0.01"
              min="0"
              value={form.dailyAmount}
              onChange={(e) => setForm({ ...form, dailyAmount: e.target.value })}
            />
          </Field>
          <Field label="Maximum (SSP)" htmlFor="pen-max" hint="Leave blank for no ceiling.">
            <Input
              id="pen-max"
              type="number"
              step="0.01"
              min="0"
              value={form.maxAmount}
              onChange={(e) => setForm({ ...form, maxAmount: e.target.value })}
            />
          </Field>
          <Field label="In force from" htmlFor="pen-from">
            <Input
              id="pen-from"
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
            />
          </Field>
          <Field
            label="In force until"
            htmlFor="pen-to"
            hint="Leave blank if the line has no end date."
          >
            <Input
              id="pen-to"
              type="date"
              value={form.effectiveTo}
              onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
            />
          </Field>
          <Field
            label="Label"
            htmlFor="pen-label"
            hint="Optional, e.g. the regulation it comes from."
          >
            <Input
              id="pen-label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={create.isPending}
              disabled={!form.effectiveFrom || (!form.fixedAmount && !form.dailyAmount)}
              onClick={() => create.mutate()}
            >
              Add line
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this schedule line?"
        confirmLabel="Remove"
        tone="danger"
        isLoading={remove.isPending}
        message="Cases already priced under this line keep their amount. New contraventions will fall to the next line that covers them, or carry no amount if there is none."
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </Card>
  );
}
