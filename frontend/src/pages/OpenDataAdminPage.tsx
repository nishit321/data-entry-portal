import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Eye, EyeOff, Globe, Plus, Trash2 } from 'lucide-react';
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
  Page,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '../components/ui';
import {
  publicIndicatorsApi,
  publicPortalKeys,
  type PublicIndicatorInput,
} from '../lib/public-portal.api';
import { getErrorMessage } from '../lib/api';
import { joinMeta } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import {
  PUBLIC_AGGREGATIONS,
  PUBLIC_AGGREGATION_LABELS,
  type PublicAggregation,
  type PublicIndicator,
} from '../lib/types';

const AGGREGATION_OPTIONS = PUBLIC_AGGREGATIONS.map((a) => ({
  value: a,
  label: PUBLIC_AGGREGATION_LABELS[a],
}));

const BLANK = {
  fieldKey: '',
  aggregation: 'SUM' as PublicAggregation,
  label: '',
  unit: '',
  description: '',
};

/**
 * Deciding what the public sees (Q4).
 *
 * Adding a figure and publishing it are two actions on purpose. Someone can prepare the wording,
 * check how it reads, and only then turn it on — rather than a question going live the instant it
 * is typed.
 */
export function OpenDataAdminPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PublicIndicator | null>(null);
  const [form, setForm] = useState(BLANK);

  const listQuery = useQuery({
    queryKey: publicPortalKeys.admin,
    queryFn: () => publicIndicatorsApi.list(),
  });
  const availableQuery = useQuery({
    queryKey: publicPortalKeys.available,
    queryFn: () => publicIndicatorsApi.available(),
    enabled: isAdmin,
  });

  const indicators = listQuery.data ?? [];
  const available = availableQuery.data ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: ['public-indicators'] });

  const create = useMutation({
    mutationFn: () => {
      const input: PublicIndicatorInput = {
        fieldKey: form.fieldKey,
        aggregation: form.aggregation,
        label: form.label.trim(),
        unit: form.unit.trim() || undefined,
        description: form.description.trim() || undefined,
        order: indicators.length,
      };
      return publicIndicatorsApi.create(input);
    },
    onSuccess: () => {
      refresh();
      setOpen(false);
      setForm(BLANK);
      toast.success('Added. It is not public until you publish it.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't add that figure.")),
  });

  const togglePublished = useMutation({
    mutationFn: (indicator: PublicIndicator) =>
      publicIndicatorsApi.update(indicator.id, { isPublished: !indicator.isPublished }),
    onSuccess: (updated) => {
      refresh();
      toast.success(updated.isPublished ? 'Now on the public page.' : 'Taken off the public page.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't change that.")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => publicIndicatorsApi.remove(id),
    onSuccess: () => {
      refresh();
      setPendingDelete(null);
      toast.success('Removed from the public page.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove that figure.")),
  });

  // A question already on the list cannot be added twice with the same calculation.
  const taken = new Set(indicators.map((i) => `${i.fieldKey}::${i.aggregation}`));
  const fieldOptions = available.map((f) => ({
    value: f.fieldKey,
    label: f.unit ? `${f.label} (${f.unit})` : f.label,
    disabled: taken.has(`${f.fieldKey}::${form.aggregation}`),
  }));

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Open data"
          description="The figures published on the public page. Everything here is combined across operators before it is shown; no operator's own figures are ever published."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={ExternalLink}
                onClick={() => window.open('/open-data', '_blank', 'noopener')}
              >
                View public page
              </Button>
              {isAdmin && (
                <Button icon={Plus} onClick={() => setOpen(true)}>
                  Add a figure
                </Button>
              )}
            </div>
          }
        />

        <Card>
          {listQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : indicators.length === 0 ? (
            <EmptyState
              icon={Globe}
              message="Nothing is published yet. The public page shows the sector overview and citizen reports until a figure is added here."
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {indicators.map((indicator) => (
                <li key={indicator.id} className="flex items-center gap-4 py-3">
                  <Badge tone={indicator.isPublished ? 'success' : 'gray'}>
                    {indicator.isPublished ? 'Public' : 'Draft'}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{indicator.label}</p>
                    <p className="truncate text-xs text-gray-500">
                      {joinMeta(
                        PUBLIC_AGGREGATION_LABELS[indicator.aggregation],
                        indicator.unit,
                        indicator.fieldKey,
                      )}
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={indicator.isPublished ? EyeOff : Eye}
                        isLoading={
                          togglePublished.isPending &&
                          togglePublished.variables?.id === indicator.id
                        }
                        onClick={() => togglePublished.mutate(indicator)}
                      >
                        {indicator.isPublished ? 'Unpublish' : 'Publish'}
                      </Button>
                      <IconButton
                        icon={Trash2}
                        label={`Remove ${indicator.label}`}
                        variant="danger"
                        onClick={() => setPendingDelete(indicator)}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-xs text-gray-500">
          A figure is shown for a period only when enough operators reported it. Where too few did,
          the public page shows a dash rather than a number, because a figure resting on one or two
          operators would point at a named company.
        </p>
      </div>

      <Modal open={open} title="Add a figure to the public page" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Field
            label="How it is combined"
            htmlFor="pub-agg"
            hint="Operators' individual answers are never shown; only the combined figure."
          >
            <Select
              aria-label="How the figure is combined"
              options={AGGREGATION_OPTIONS}
              value={form.aggregation}
              onChange={(aggregation) =>
                setForm({ ...form, aggregation: aggregation as PublicAggregation })
              }
            />
          </Field>
          <Field
            label="Question"
            htmlFor="pub-field"
            hint="Only numeric questions on a published questionnaire. Revenue used to assess the levy cannot be published."
          >
            <Select
              aria-label="Question to publish"
              options={fieldOptions}
              value={form.fieldKey}
              onChange={(fieldKey) => {
                const picked = available.find((f) => f.fieldKey === fieldKey);
                setForm({
                  ...form,
                  fieldKey,
                  label: form.label || (picked?.label ?? ''),
                  unit: form.unit || (picked?.unit ?? ''),
                });
              }}
              placeholder={
                availableQuery.isLoading ? 'Loading questions…' : 'Choose a question to publish'
              }
            />
          </Field>
          <Field
            label="Public wording"
            htmlFor="pub-label"
            hint="What a member of the public reads. Plainer than the questionnaire's own wording."
          >
            <Input
              id="pub-label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </Field>
          <Field label="Unit" htmlFor="pub-unit" hint="Optional, e.g. subscribers or minutes.">
            <Input
              id="pub-unit"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            />
          </Field>
          <Field
            label="Context"
            htmlFor="pub-desc"
            hint="Optional. A sentence explaining what the figure means to someone outside the sector."
          >
            <Textarea
              id="pub-desc"
              rows={2}
              autoGrow
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={create.isPending}
              disabled={!form.fieldKey || form.label.trim().length < 2}
              onClick={() => create.mutate()}
            >
              Add figure
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this figure?"
        confirmLabel="Remove"
        tone="danger"
        isLoading={remove.isPending}
        message={
          pendingDelete
            ? `"${pendingDelete.label}" will no longer appear on the public page, including its history.`
            : ''
        }
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </Page>
  );
}
