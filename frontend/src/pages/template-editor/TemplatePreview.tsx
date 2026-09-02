import { useState } from 'react';
import { joinMeta } from '../../lib/format';
import {
  Card,
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
  type SelectOption,
} from '../../components/ui';
import {
  ENTITY_TYPE_LABELS,
  ENTITY_TYPES,
  FLOW_OR_STOCK_LABELS,
  type EntityType,
  type ReportingTemplate,
  type TemplateField,
} from '../../lib/types';

const ENTITY_TYPE_OPTIONS: SelectOption[] = ENTITY_TYPES.map((t) => ({
  value: t,
  label: ENTITY_TYPE_LABELS[t],
}));

const BOOLEAN_OPTIONS: SelectOption[] = [
  { value: '', label: '—' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

function hint(field: TemplateField): string | undefined {
  const parts: string[] = [];
  if (field.description) parts.push(field.description);
  if (field.unit) parts.push(`Unit: ${field.unit}`);
  if (field.dataType === 'PERCENTAGE') parts.push('Enter a value from 0 to 100');
  if (field.flowOrStock !== 'NONE') parts.push(FLOW_OR_STOCK_LABELS[field.flowOrStock]);
  return parts.length > 0 ? joinMeta(...parts) : undefined;
}

/** The control an operator would meet, rendered inert. */
function PreviewControl({ field }: { field: TemplateField }) {
  const common = { id: `preview-${field.id}`, disabled: true };
  switch (field.dataType) {
    case 'BOOLEAN':
      return <Select {...common} value="" options={BOOLEAN_OPTIONS} onChange={() => {}} />;
    case 'REFERENCE':
      return (
        <Select
          {...common}
          value=""
          placeholder={field.referenceCategory ?? 'Reference list'}
          options={[]}
          onChange={() => {}}
        />
      );
    case 'TEXTAREA':
      return <Textarea {...common} rows={3} value="" onChange={() => {}} />;
    case 'INTEGER':
    case 'DECIMAL':
    case 'MONETARY':
    case 'PERCENTAGE':
      return <Input {...common} type="number" value="" onChange={() => {}} />;
    default:
      return <Input {...common} value="" onChange={() => {}} />;
  }
}

/**
 * The questionnaire as the operator will meet it (FRONTEND_STANDARDS §3.12).
 *
 * A template author is building an experience for someone else and, until this existed, had no
 * way to see it before publishing — and publishing locks the version. The entity-type switch
 * matters as much as the preview itself: sections are gated on entity type, so "what an MNO sees"
 * and "what a mobile-money provider sees" are different questionnaires out of the same template,
 * and that difference is invisible in the editor's own list.
 *
 * The controls are deliberately disabled. This is a preview of a form, not a second place to fill
 * one in.
 */
export function TemplatePreview({
  template,
  open,
  onClose,
}: {
  template: ReportingTemplate;
  open: boolean;
  onClose: () => void;
}) {
  const [entityType, setEntityType] = useState<EntityType>('MNO');

  const visible = template.sections.filter((s) => s.applicableEntityTypes.includes(entityType));
  const fieldCount = visible.reduce((sum, s) => sum + s.fields.length, 0);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Preview as an operator"
      description={joinMeta(
        `${visible.length} of ${template.sections.length} sections apply`,
        `${fieldCount} questions`,
      )}
    >
      <div className="space-y-5">
        <Field
          label="Show what this entity type sees"
          htmlFor="preview-entity-type"
          hint="Sections are gated on entity type, so each one gets a different questionnaire."
        >
          <Select
            id="preview-entity-type"
            value={entityType}
            options={ENTITY_TYPE_OPTIONS}
            onChange={(v) => setEntityType(v as EntityType)}
          />
        </Field>

        {visible.length === 0 ? (
          <Card>
            <p className="text-sm text-gray-500">
              No section applies to {ENTITY_TYPE_LABELS[entityType]}. An operator of this type would
              open the return and find nothing to fill in.
            </p>
          </Card>
        ) : (
          visible.map((section) => (
            <Card key={section.id}>
              <h3 className="text-base font-semibold text-gray-900">{section.title}</h3>
              {section.description && (
                <p className="mt-1 text-sm text-gray-500">{section.description}</p>
              )}
              {section.fields.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">This section has no questions yet.</p>
              ) : (
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  {section.fields.map((field) => (
                    <div
                      key={field.id}
                      className={field.dataType === 'TEXTAREA' ? 'sm:col-span-2' : undefined}
                    >
                      <Field
                        label={field.label}
                        htmlFor={`preview-${field.id}`}
                        hint={hint(field)}
                        required={field.isMandatory}
                      >
                        <PreviewControl field={field} />
                      </Field>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </Drawer>
  );
}
