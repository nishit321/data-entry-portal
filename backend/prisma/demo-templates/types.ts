import {
  EntityType,
  FieldType,
  FlowOrStock,
  ReferenceCategory,
  ReportingFrequency,
  RuleSeverity,
  RuleType,
} from '@prisma/client';

/**
 * Authoring types for the demo template library. Each module under this folder exports an array
 * of `TemplateDef`; the runner (`prisma/seed-demo-templates.ts`) validates every rule against the
 * template's numeric fields and creates them as published templates. `order` is assigned by array
 * position, so authors just list things in the order they should appear.
 */
export interface FieldDef {
  key: string;
  label: string;
  dataType: FieldType;
  description?: string;
  unit?: string;
  decimals?: number;
  isMandatory?: boolean;
  flowOrStock?: FlowOrStock;
  minValue?: number;
  maxValue?: number;
  referenceCategory?: ReferenceCategory;
  allowsOther?: boolean;
  frequencyOverride?: ReportingFrequency;
  /**
   * The revenue figure the levy is assessed on.
   *
   * Exactly one field on a questionnaire should carry it. Four parts of the portal read it and
   * none of them can guess: the levy assessment has nothing to compute from without it, the
   * enforcement engine cannot price a percentage-of-revenue penalty, benchmarking cannot rank
   * anyone, and the public allowlist refuses it outright because it is the figure Q4 names as
   * commercially sensitive. A questionnaire with none set is one where the levy screen reports
   * that no basis is marked, for every period, forever.
   */
  isLevyBasis?: boolean;
}

export interface SectionDef {
  key: string;
  title: string;
  description?: string;
  applicableEntityTypes: EntityType[];
  frequency: ReportingFrequency;
  requiredServiceCode?: string;
  fields: FieldDef[];
}

export interface RuleDef {
  type: RuleType;
  severity: RuleSeverity;
  label: string;
  /** Field-key operands + thresholds; must reference numeric fields defined in this template. */
  config: Record<string, unknown>;
}

export interface TemplateDef {
  name: string;
  description: string;
  sections: SectionDef[];
  rules?: RuleDef[];
}
