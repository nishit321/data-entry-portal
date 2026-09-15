import { useState } from 'react';
import { strings } from '../lib/strings';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CopyPlus,
  Eye,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FormField,
  IconButton,
  Input,
  Modal,
  ReorderList,
  Page,
  PageHeader,
  Select,
  Spinner,
  useToast,
  type SelectOption,
} from '../components/ui';
import { templatesApi, templateKeys } from '../lib/templates.api';
import { TemplatePreview } from './template-editor/TemplatePreview';
import { FieldModal } from './template-editor/FieldModal';
import { SectionModal } from './template-editor/SectionModal';
import { sectionSchema, toSectionInput, type SectionForm } from './template-editor/section-form';
import { RuleModal } from './template-editor/RuleModal';
import { fieldSchema, toFieldInput, type FieldForm } from './template-editor/field-form';
import { ruleSchema, toRuleInput, ruleFormula, type RuleForm } from './template-editor/rule-form';
import { getErrorMessage } from '../lib/api';
import { TEMPLATE_STATUS_TONE } from '../lib/status';
import {
  ENTITY_TYPE_LABELS,
  FIELD_TYPE_LABELS,
  FLOW_OR_STOCK_LABELS,
  REPORTING_FREQUENCY_LABELS,
  RULE_TYPE_LABELS,
  type RuleSeverity,
  type TemplateField,
  type TemplateRule,
  type TemplateSection,
  type TemplateStatus,
} from '../lib/types';

// No status→label map ships in lib/types, so the editor owns its own display labels.
const STATUS_LABELS: Record<TemplateStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

// HARD blocks the submission, SOFT only warns — the canonical tone mapping (FRONTEND_STANDARDS §3.3).
const RULE_SEVERITY_TONE: Record<RuleSeverity, 'danger' | 'warning'> = {
  HARD: 'danger',
  SOFT: 'warning',
};
// The shipped severity labels are sentence-length for the picker; the list badge just wants a word.
const RULE_SEVERITY_BADGE: Record<RuleSeverity, string> = { HARD: 'Hard', SOFT: 'Soft' };

const detailsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(1000).optional(),
});
type DetailsForm = z.infer<typeof detailsSchema>;

// One flat form backs every rule type; `type` decides which config inputs render and which are
// required (superRefine below), and `toRuleInput` packs only the relevant keys into `config`.

export function TemplateEditorPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [draggingField, setDraggingField] = useState<{ sectionId: string; fieldId: string } | null>(
    null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const detailQuery = useQuery({
    queryKey: templateKeys.detail(id),
    queryFn: () => templatesApi.get(id),
    enabled: id !== '',
  });

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<TemplateSection | null>(null);
  const [sectionDelete, setSectionDelete] = useState<TemplateSection | null>(null);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldSectionId, setFieldSectionId] = useState('');
  const [editingField, setEditingField] = useState<TemplateField | null>(null);
  const [fieldDelete, setFieldDelete] = useState<{
    section: TemplateSection;
    field: TemplateField;
  } | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TemplateRule | null>(null);
  const [ruleDelete, setRuleDelete] = useState<TemplateRule | null>(null);
  const [formError, setFormError] = useState('');

  const detailsForm = useForm<DetailsForm>({ resolver: zodResolver(detailsSchema) });
  const sectionForm = useForm<SectionForm>({ resolver: zodResolver(sectionSchema) });
  const fieldForm = useForm<FieldForm>({ resolver: zodResolver(fieldSchema) });
  const ruleForm = useForm<RuleForm>({ resolver: zodResolver(ruleSchema) });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: templateKeys.detail(id) });
    qc.invalidateQueries({ queryKey: templateKeys.all });
  };

  const saveDetailsMutation = useMutation({
    mutationFn: (v: DetailsForm) =>
      templatesApi.update(id, { name: v.name, description: v.description || undefined }),
    onSuccess: () => {
      invalidate();
      setDetailsOpen(false);
      setFormError('');
      toast.success('Template details updated.');
    },
    onError: (err) => setFormError(getErrorMessage(err, "We couldn't update the template")),
  });

  const publishMutation = useMutation({
    mutationFn: () => templatesApi.publish(id),
    onSuccess: () => {
      invalidate();
      setPublishOpen(false);
      toast.success('Template published.');
    },
    onError: (err) => {
      setPublishOpen(false);
      toast.error(getErrorMessage(err, "We couldn't publish the template"));
    },
  });

  const newVersionMutation = useMutation({
    mutationFn: () => templatesApi.newVersion(id),
    onSuccess: (tpl) => {
      qc.invalidateQueries({ queryKey: templateKeys.all });
      toast.success(`Draft v${tpl.version} created.`);
      navigate(`/templates/${tpl.id}`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't create a new version")),
  });

  const saveSectionMutation = useMutation({
    mutationFn: (v: SectionForm) =>
      editingSection
        ? templatesApi.updateSection(id, editingSection.id, toSectionInput(v, true))
        : templatesApi.addSection(id, toSectionInput(v, false)),
    onSuccess: () => {
      invalidate();
      setSectionOpen(false);
      setFormError('');
      toast.success(editingSection ? 'Section updated.' : 'Section added.');
    },
    onError: (err) => setFormError(getErrorMessage(err, "We couldn't save the section")),
  });

  // Reordering (FRONTEND_STANDARDS §3.12). There's no dedicated reorder endpoint, so a move
  // rewrites the `order` of every item in the group — one PATCH each, sent together. Writing all
  // of them rather than only the moved one keeps the sequence dense and predictable, which
  // matters because `order` is what the operator's questionnaire is sorted by.
  const reorderSectionsMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((sectionId, index) =>
          templatesApi.updateSection(id, sectionId, { order: index * 10 }),
        ),
      );
    },
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't save the new order")),
  });

  const reorderFieldsMutation = useMutation({
    mutationFn: async ({ sectionId, orderedIds }: { sectionId: string; orderedIds: string[] }) => {
      await Promise.all(
        orderedIds.map((fieldId, index) =>
          templatesApi.updateField(id, sectionId, fieldId, { order: index * 10 }),
        ),
      );
    },
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't save the new order")),
  });

  const deleteSectionMutation = useMutation({
    mutationFn: (sectionId: string) => templatesApi.removeSection(id, sectionId),
    onSuccess: () => {
      invalidate();
      setSectionDelete(null);
      toast.success('Section deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the section")),
  });

  const saveFieldMutation = useMutation({
    mutationFn: (v: FieldForm) =>
      editingField
        ? templatesApi.updateField(id, fieldSectionId, editingField.id, toFieldInput(v, true))
        : templatesApi.addField(id, fieldSectionId, toFieldInput(v, false)),
    onSuccess: () => {
      invalidate();
      setFieldOpen(false);
      setFormError('');
      toast.success(editingField ? 'Field updated.' : 'Field added.');
    },
    onError: (err) => setFormError(getErrorMessage(err, "We couldn't save the field")),
  });

  const deleteFieldMutation = useMutation({
    mutationFn: (vars: { sectionId: string; fieldId: string }) =>
      templatesApi.removeField(id, vars.sectionId, vars.fieldId),
    onSuccess: () => {
      invalidate();
      setFieldDelete(null);
      toast.success('Field deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the field")),
  });

  const saveRuleMutation = useMutation({
    mutationFn: (v: RuleForm) =>
      editingRule
        ? templatesApi.updateRule(id, editingRule.id, toRuleInput(v, true))
        : templatesApi.addRule(id, toRuleInput(v)),
    onSuccess: () => {
      invalidate();
      setRuleOpen(false);
      setFormError('');
      toast.success(editingRule ? 'Rule updated.' : 'Rule added.');
    },
    onError: (err) => setFormError(getErrorMessage(err, "We couldn't save the rule")),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (ruleId: string) => templatesApi.removeRule(id, ruleId),
    onSuccess: () => {
      invalidate();
      setRuleDelete(null);
      toast.success('Rule deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the rule")),
  });

  if (detailQuery.isLoading) return <Spinner label="Loading template…" />;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="space-y-4">
        <Alert tone="danger">
          {getErrorMessage(detailQuery.error, 'This template could not be found.')}
        </Alert>
        <Link
          to="/templates"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          <ChevronLeft size={16} aria-hidden /> Back to templates
        </Link>
      </div>
    );
  }

  const template = detailQuery.data;
  const isDraft = template.status === 'DRAFT';

  /** Shift one field within its section by a step, and persist the whole section's new order. */
  const moveField = (section: (typeof template.sections)[number], index: number, step: number) => {
    const target = index + step;
    if (target < 0 || target >= section.fields.length) return;
    const ordered = section.fields.map((f) => f.id);
    const [moved] = ordered.splice(index, 1);
    if (moved) ordered.splice(target, 0, moved);
    reorderFieldsMutation.mutate({ sectionId: section.id, orderedIds: ordered });
  };

  /** Drop the dragged field onto another row in the same section. */
  const moveFieldTo = (sectionId: string, targetFieldId: string) => {
    if (!draggingField || draggingField.sectionId !== sectionId) return;
    const section = template.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const from = section.fields.findIndex((f) => f.id === draggingField.fieldId);
    const to = section.fields.findIndex((f) => f.id === targetFieldId);
    setDraggingField(null);
    if (from < 0 || to < 0 || from === to) return;
    moveField(section, from, to - from);
  };
  const dErrors = detailsForm.formState.errors;
  const rErrors = ruleForm.formState.errors;
  const watchedDataType = fieldForm.watch('dataType');
  const watchedRuleType = ruleForm.watch('type');
  // Cross-field rules operate on numbers, so a rule may only reference the template's numeric
  // fields. The admin picks from these — they can't type a key that doesn't exist.
  const NUMERIC_FIELD_TYPES = ['INTEGER', 'DECIMAL', 'MONETARY', 'PERCENTAGE'];
  const fieldRefOptions: SelectOption[] = template.sections
    .flatMap((s) => s.fields)
    .filter((f) => NUMERIC_FIELD_TYPES.includes(f.dataType))
    .map((f) => ({ value: f.key, label: `${f.label} (${f.key})` }));
  const hasFieldRefs = fieldRefOptions.length > 0;

  // Resolve a field key to its human label so rule formulas read in plain terms, not snake_case.
  const labelByKey: Record<string, string> = {};
  for (const s of template.sections) for (const f of s.fields) labelByKey[f.key] = f.label;
  const fieldLabel = (key: string) => labelByKey[key] ?? key;

  // A field-key dropdown bound to one rule-form field — reused for every single-field operand.
  const fieldRefSelect = (
    name: 'total' | 'left' | 'right' | 'balance' | 'backing' | 'field' | 'when' | 'require',
    controlId: string,
  ) => (
    <Controller
      control={ruleForm.control}
      name={name}
      render={({ field: { value, onChange } }) => (
        <Select
          id={controlId}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          options={fieldRefOptions}
          invalid={!!rErrors[name]}
          placeholder="Select a field…"
        />
      )}
    />
  );

  const openDetails = () => {
    detailsForm.reset({ name: template.name, description: template.description ?? '' });
    setFormError('');
    setDetailsOpen(true);
  };

  const openAddSection = () => {
    setEditingSection(null);
    sectionForm.reset({
      key: '',
      title: '',
      description: '',
      order: undefined,
      applicableEntityTypes: [],
      frequency: 'QUARTERLY',
      requiredServiceCode: '',
    });
    setFormError('');
    setSectionOpen(true);
  };

  const openEditSection = (s: TemplateSection) => {
    setEditingSection(s);
    sectionForm.reset({
      key: s.key,
      title: s.title,
      description: s.description ?? '',
      order: s.order,
      applicableEntityTypes: s.applicableEntityTypes,
      frequency: s.frequency,
      requiredServiceCode: s.requiredServiceCode ?? '',
    });
    setFormError('');
    setSectionOpen(true);
  };

  const openAddField = (sectionId: string) => {
    setEditingField(null);
    setFieldSectionId(sectionId);
    fieldForm.reset({
      key: '',
      label: '',
      description: '',
      order: undefined,
      dataType: 'INTEGER',
      unit: '',
      decimals: undefined,
      isMandatory: false,
      flowOrStock: 'NONE',
      minValue: undefined,
      maxValue: undefined,
      referenceCategory: '',
      allowsOther: false,
      frequencyOverride: '',
      isLevyBasis: false,
    });
    setFormError('');
    setFieldOpen(true);
  };

  const openEditField = (sectionId: string, f: TemplateField) => {
    setEditingField(f);
    setFieldSectionId(sectionId);
    fieldForm.reset({
      key: f.key,
      label: f.label,
      description: f.description ?? '',
      order: f.order,
      dataType: f.dataType,
      unit: f.unit ?? '',
      decimals: f.decimals ?? undefined,
      isMandatory: f.isMandatory,
      flowOrStock: f.flowOrStock,
      minValue: f.minValue != null ? Number(f.minValue) : undefined,
      maxValue: f.maxValue != null ? Number(f.maxValue) : undefined,
      referenceCategory: f.referenceCategory ?? '',
      allowsOther: f.allowsOther,
      frequencyOverride: f.frequencyOverride ?? '',
      isLevyBasis: f.isLevyBasis ?? false,
    });
    setFormError('');
    setFieldOpen(true);
  };

  // Blank config for a fresh rule — every possible key present so the form is fully controlled.
  const emptyRuleConfig = {
    operands: [] as string[],
    total: '',
    tolerancePercent: undefined,
    left: '',
    right: '',
    balance: '',
    backing: '',
    shortfallPercent: undefined,
    surplusPercent: undefined,
    field: '',
    thresholdPercent: undefined,
    when: '',
    require: '',
  };

  const openAddRule = () => {
    setEditingRule(null);
    ruleForm.reset({
      type: 'SUM_EQUALS_TOTAL',
      severity: 'HARD',
      label: '',
      order: undefined,
      ...emptyRuleConfig,
    });
    setFormError('');
    setRuleOpen(true);
  };

  const openEditRule = (rule: TemplateRule) => {
    setEditingRule(rule);
    const c = rule.config;
    // Read a config value back into its flat form field, coercing to the input's shape.
    const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : '');
    const num = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : undefined);
    ruleForm.reset({
      type: rule.type,
      severity: rule.severity,
      label: rule.label,
      order: rule.order,
      ...emptyRuleConfig,
      operands: Array.isArray(c.operands) ? (c.operands as string[]) : [],
      total: str('total'),
      tolerancePercent: num('tolerancePercent'),
      left: str('left'),
      right: str('right'),
      balance: str('balance'),
      backing: str('backing'),
      shortfallPercent: num('shortfallPercent'),
      surplusPercent: num('surplusPercent'),
      field: str('field'),
      thresholdPercent: num('thresholdPercent'),
      when: str('when'),
      require: str('require'),
    });
    setFormError('');
    setRuleOpen(true);
  };

  return (
    <Page width="wide">
      <div>
        <PageHeader
          title={template.name}
          description={template.description ?? undefined}
          // Version and status describe the record, so they sit with the title, not in the
          // button row (§3.6).
          meta={
            <>
              <span className="text-sm font-medium text-gray-500">Version {template.version}</span>
              <Badge tone={TEMPLATE_STATUS_TONE[template.status]}>
                {STATUS_LABELS[template.status]}
              </Badge>
            </>
          }
          actions={
            <>
              {/* Preview is available in every state — reading a published questionnaire the way
                  an operator sees it is as useful as checking one before publishing (§3.12). */}
              <Button variant="secondary" onClick={() => setPreviewOpen(true)} icon={Eye}>
                Preview
              </Button>
              {isDraft ? (
                <>
                  <Button variant="secondary" onClick={openDetails} icon={Pencil}>
                    Edit details
                  </Button>
                  <Button onClick={() => setPublishOpen(true)}>Publish</Button>
                </>
              ) : (
                <Button
                  icon={CopyPlus}
                  onClick={() => newVersionMutation.mutate()}
                  isLoading={newVersionMutation.isPending}
                >
                  New version
                </Button>
              )}
            </>
          }
        />

        <div className="space-y-6">
          {!isDraft && (
            <Alert tone="info">
              {template.status === 'ARCHIVED'
                ? 'This template is archived and read-only.'
                : 'This template is published, so it is read-only. Create a new version to change it.'}
            </Alert>
          )}

          {template.sections.length === 0 ? (
            <Card className="p-0">
              <EmptyState
                message="No sections yet. Add the first section to start building the questionnaire."
                action={
                  isDraft ? (
                    <Button variant="secondary" onClick={openAddSection} icon={Plus}>
                      Add section
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <>
              <ReorderList
                aria-label="Questionnaire sections"
                disabled={!isDraft}
                items={template.sections.map((s) => ({ id: s.id, label: s.title }))}
                onReorder={(orderedIds) => reorderSectionsMutation.mutate(orderedIds)}
                renderItem={(item) => {
                  const section = template.sections.find((s) => s.id === item.id);
                  if (!section) return null;
                  return (
                    <Card key={section.id}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-gray-900">
                              {section.title}
                            </h3>
                            <span className="font-mono text-xs text-gray-500">{section.key}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                            <span>{REPORTING_FREQUENCY_LABELS[section.frequency]}</span>
                            {section.requiredServiceCode && (
                              <span>Requires service {section.requiredServiceCode}</span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {section.applicableEntityTypes.map((t) => (
                              <Badge key={t} tone="gray">
                                {ENTITY_TYPE_LABELS[t]}
                              </Badge>
                            ))}
                          </div>
                          {section.description && (
                            <p className="text-sm text-gray-500">{section.description}</p>
                          )}
                        </div>
                        {isDraft && (
                          <div className="flex shrink-0 items-center gap-1">
                            <IconButton
                              icon={Pencil}
                              label="Edit this section"
                              onClick={() => openEditSection(section)}
                            />
                            <IconButton
                              icon={Trash2}
                              label="Delete this section"
                              variant="danger"
                              onClick={() => setSectionDelete(section)}
                            />
                          </div>
                        )}
                      </div>

                      <div className="mt-4 border-t border-gray-100 pt-4">
                        {section.fields.length === 0 ? (
                          <p className="text-sm text-gray-500">No fields in this section yet.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                              <thead className="text-start text-xs uppercase tracking-wide text-gray-500">
                                <tr>
                                  <th className="pb-2 pe-4 font-medium">Field</th>
                                  <th className="pb-2 pe-4 font-medium">Key</th>
                                  <th className="pb-2 pe-4 font-medium">{strings.field.type}</th>
                                  <th className="pb-2 pe-4 font-medium">Unit</th>
                                  <th className="pb-2 pe-4 font-medium">Rollup</th>
                                  {isDraft && (
                                    <th className="pb-2 text-end font-medium">Actions</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {section.fields.map((f, fieldIndex) => (
                                  <tr
                                    key={f.id}
                                    draggable={isDraft}
                                    onDragStart={() =>
                                      setDraggingField({ sectionId: section.id, fieldId: f.id })
                                    }
                                    onDragEnd={() => setDraggingField(null)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => moveFieldTo(section.id, f.id)}
                                    className={
                                      draggingField?.fieldId === f.id ? 'opacity-40' : undefined
                                    }
                                  >
                                    <td className="py-2 pe-4">
                                      <div className="flex flex-wrap items-center gap-2">
                                        {isDraft && (
                                          // Drag to reorder, with move buttons alongside — a
                                          // drag-only interaction is unusable from the keyboard (§6).
                                          <span className="flex items-center">
                                            <GripVertical
                                              size={14}
                                              aria-hidden
                                              className="cursor-grab text-gray-300"
                                            />
                                            <button
                                              type="button"
                                              disabled={fieldIndex === 0}
                                              aria-label={`Move ${f.label} up`}
                                              onClick={() => moveField(section, fieldIndex, -1)}
                                              className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                            >
                                              <ChevronUp size={13} />
                                            </button>
                                            <button
                                              type="button"
                                              disabled={fieldIndex === section.fields.length - 1}
                                              aria-label={`Move ${f.label} down`}
                                              onClick={() => moveField(section, fieldIndex, 1)}
                                              className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                            >
                                              <ChevronDown size={13} />
                                            </button>
                                          </span>
                                        )}
                                        <span className="font-medium text-gray-900">{f.label}</span>
                                        {f.isMandatory && <Badge tone="info">Required</Badge>}
                                      </div>
                                    </td>
                                    <td className="py-2 pe-4 font-mono text-xs text-gray-500">
                                      {f.key}
                                    </td>
                                    <td className="py-2 pe-4 text-gray-600">
                                      {FIELD_TYPE_LABELS[f.dataType]}
                                    </td>
                                    <td className="py-2 pe-4 text-gray-600">{f.unit ?? '—'}</td>
                                    <td className="py-2 pe-4 text-gray-600">
                                      {f.flowOrStock === 'NONE'
                                        ? '—'
                                        : FLOW_OR_STOCK_LABELS[f.flowOrStock]}
                                    </td>
                                    {isDraft && (
                                      <td className="py-2 text-end">
                                        <div className="flex justify-end gap-1">
                                          <IconButton
                                            icon={Pencil}
                                            label="Edit this field"
                                            onClick={() => openEditField(section.id, f)}
                                          />
                                          <IconButton
                                            icon={Trash2}
                                            label="Delete this field"
                                            variant="danger"
                                            onClick={() => setFieldDelete({ section, field: f })}
                                          />
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {isDraft && (
                          <div className="mt-4">
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={Plus}
                              onClick={() => openAddField(section.id)}
                            >
                              Add field
                            </Button>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                }}
              />

              {isDraft && (
                <Button variant="secondary" onClick={openAddSection} icon={Plus}>
                  Add section
                </Button>
              )}
            </>
          )}

          {/* Validation rules — cross-field checks run against a submission (VALIDATION_SPEC §6). */}
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Validation rules</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Cross-field checks run when an operator submits this questionnaire.
                </p>
              </div>
              {isDraft && (
                <Button variant="secondary" size="sm" onClick={openAddRule} icon={Plus}>
                  Add rule
                </Button>
              )}
            </div>

            <div className="mt-4 border-t border-gray-100 pt-4">
              {template.rules.length === 0 ? (
                <EmptyState message="No validation rules yet. Add a rule to cross-check operators' answers." />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {template.rules.map((rule) => {
                    const formula = ruleFormula(rule, fieldLabel);
                    return (
                      <li
                        key={rule.id}
                        className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-gray-900">{rule.label}</span>
                            <Badge tone="gray">{RULE_TYPE_LABELS[rule.type]}</Badge>
                            <Badge tone={RULE_SEVERITY_TONE[rule.severity]}>
                              {RULE_SEVERITY_BADGE[rule.severity]}
                            </Badge>
                          </div>
                          {formula && <p className="text-sm text-gray-500">{formula}</p>}
                        </div>
                        {isDraft && (
                          <div className="flex shrink-0 items-center gap-1">
                            <IconButton
                              icon={Pencil}
                              label="Edit this rule"
                              onClick={() => openEditRule(rule)}
                            />
                            <IconButton
                              icon={Trash2}
                              label="Delete this rule"
                              variant="danger"
                              onClick={() => setRuleDelete(rule)}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </div>

        {/* Edit-details modal */}
        <Modal
          open={detailsOpen}
          title="Edit template details"
          onClose={() => setDetailsOpen(false)}
        >
          <form
            onSubmit={detailsForm.handleSubmit((v) => saveDetailsMutation.mutate(v))}
            className="space-y-4"
          >
            {formError && <Alert tone="danger">{formError}</Alert>}
            <FormField
              htmlFor="tpl-name"
              label={strings.field.name}
              error={dErrors.name?.message}
              required
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="e.g. Mobile operator quarterly return"
                  {...detailsForm.register('name')}
                />
              )}
            </FormField>
            <FormField
              htmlFor="tpl-description"
              label={strings.field.descriptionOptional}
              error={dErrors.description?.message}
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="What this questionnaire collects"
                  {...detailsForm.register('description')}
                />
              )}
            </FormField>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDetailsOpen(false)}>
                {strings.action.cancel}
              </Button>
              <Button type="submit" isLoading={saveDetailsMutation.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        </Modal>

        {/* Section modal */}
        <SectionModal
          open={sectionOpen}
          editingSection={editingSection}
          onClose={() => setSectionOpen(false)}
          sectionForm={sectionForm}
          formError={formError}
          saveSectionMutation={saveSectionMutation}
        />

        {/* Field modal */}
        <FieldModal
          open={fieldOpen}
          editingField={editingField}
          onClose={() => setFieldOpen(false)}
          fieldForm={fieldForm}
          watchedDataType={watchedDataType}
          formError={formError}
          saveFieldMutation={saveFieldMutation}
        />

        {/* Rule modal */}
        <RuleModal
          open={ruleOpen}
          editingRule={editingRule}
          onClose={() => setRuleOpen(false)}
          ruleForm={ruleForm}
          watchedRuleType={watchedRuleType}
          fieldRefOptions={fieldRefOptions}
          hasFieldRefs={hasFieldRefs}
          fieldRefSelect={fieldRefSelect}
          formError={formError}
          saveRuleMutation={saveRuleMutation}
        />

        {/* Confirmations */}
        <ConfirmDialog
          open={publishOpen}
          title="Publish template"
          message="Publishing locks this version and makes it available for reporting. To change it afterwards you will need to create a new version."
          confirmLabel="Publish"
          tone="primary"
          isLoading={publishMutation.isPending}
          onConfirm={() => publishMutation.mutate()}
          onClose={() => setPublishOpen(false)}
        />

        <ConfirmDialog
          open={!!sectionDelete}
          title="Delete section"
          message={
            sectionDelete
              ? `Delete section "${sectionDelete.title}" and its ${sectionDelete.fields.length === 1 ? '1 field' : `${sectionDelete.fields.length} fields`}? This cannot be undone.`
              : ''
          }
          tone="danger"
          isLoading={deleteSectionMutation.isPending}
          onConfirm={() => sectionDelete && deleteSectionMutation.mutate(sectionDelete.id)}
          onClose={() => setSectionDelete(null)}
        />

        <ConfirmDialog
          open={!!fieldDelete}
          title="Delete field"
          message={
            fieldDelete ? `Delete field "${fieldDelete.field.label}"? This cannot be undone.` : ''
          }
          tone="danger"
          isLoading={deleteFieldMutation.isPending}
          onConfirm={() =>
            fieldDelete &&
            deleteFieldMutation.mutate({
              sectionId: fieldDelete.section.id,
              fieldId: fieldDelete.field.id,
            })
          }
          onClose={() => setFieldDelete(null)}
        />

        <ConfirmDialog
          open={!!ruleDelete}
          title="Delete rule"
          message={ruleDelete ? `Delete rule "${ruleDelete.label}"? This cannot be undone.` : ''}
          tone="danger"
          isLoading={deleteRuleMutation.isPending}
          onConfirm={() => ruleDelete && deleteRuleMutation.mutate(ruleDelete.id)}
          onClose={() => setRuleDelete(null)}
        />

        <TemplatePreview
          template={template}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
        />
      </div>
    </Page>
  );
}
