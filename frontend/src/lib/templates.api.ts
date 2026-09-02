import { api } from './api';
import type {
  EntityType,
  FieldType,
  FlowOrStock,
  Paginated,
  ReferenceCategory,
  ReportingFrequency,
  ReportingTemplate,
  RuleSeverity,
  RuleType,
  TemplateListRow,
  TemplateStatus,
} from './types';

export interface TemplateListParams {
  page?: number;
  pageSize?: number;
  sort?: 'name' | 'version' | 'status' | 'createdAt' | 'updatedAt';
  order?: 'asc' | 'desc';
  status?: TemplateStatus;
  search?: string;
}

export interface SectionInput {
  key?: string;
  title?: string;
  description?: string;
  order?: number;
  applicableEntityTypes?: EntityType[];
  frequency?: ReportingFrequency;
  requiredServiceCode?: string;
}

export interface FieldInput {
  key?: string;
  label?: string;
  description?: string;
  order?: number;
  dataType?: FieldType;
  unit?: string;
  decimals?: number;
  isMandatory?: boolean;
  flowOrStock?: FlowOrStock;
  minValue?: number;
  maxValue?: number;
  referenceCategory?: ReferenceCategory;
  allowsOther?: boolean;
  frequencyOverride?: ReportingFrequency;
  isLevyBasis?: boolean;
}

export interface RuleInput {
  type?: RuleType;
  severity?: RuleSeverity;
  label?: string;
  config?: Record<string, unknown>;
  order?: number;
}

export const templatesApi = {
  list: (params: TemplateListParams) =>
    api.get<Paginated<TemplateListRow>>('/templates', { params }).then((r) => r.data),

  get: (id: string) => api.get<ReportingTemplate>(`/templates/${id}`).then((r) => r.data),

  create: (body: { name: string; description?: string }) =>
    api.post<ReportingTemplate>('/templates', body).then((r) => r.data),

  update: (id: string, body: { name?: string; description?: string }) =>
    api.patch<ReportingTemplate>(`/templates/${id}`, body).then((r) => r.data),

  publish: (id: string) =>
    api.post<ReportingTemplate>(`/templates/${id}/publish`, {}).then((r) => r.data),

  newVersion: (id: string) =>
    api.post<ReportingTemplate>(`/templates/${id}/new-version`, {}).then((r) => r.data),

  remove: (id: string) => api.delete<{ message: string }>(`/templates/${id}`).then((r) => r.data),

  addSection: (id: string, body: SectionInput) =>
    api.post<ReportingTemplate>(`/templates/${id}/sections`, body).then((r) => r.data),

  updateSection: (id: string, sectionId: string, body: SectionInput) =>
    api
      .patch<ReportingTemplate>(`/templates/${id}/sections/${sectionId}`, body)
      .then((r) => r.data),

  removeSection: (id: string, sectionId: string) =>
    api.delete<ReportingTemplate>(`/templates/${id}/sections/${sectionId}`).then((r) => r.data),

  addField: (id: string, sectionId: string, body: FieldInput) =>
    api
      .post<ReportingTemplate>(`/templates/${id}/sections/${sectionId}/fields`, body)
      .then((r) => r.data),

  updateField: (id: string, sectionId: string, fieldId: string, body: FieldInput) =>
    api
      .patch<ReportingTemplate>(`/templates/${id}/sections/${sectionId}/fields/${fieldId}`, body)
      .then((r) => r.data),

  removeField: (id: string, sectionId: string, fieldId: string) =>
    api
      .delete<ReportingTemplate>(`/templates/${id}/sections/${sectionId}/fields/${fieldId}`)
      .then((r) => r.data),

  addRule: (id: string, body: RuleInput) =>
    api.post<ReportingTemplate>(`/templates/${id}/rules`, body).then((r) => r.data),

  updateRule: (id: string, ruleId: string, body: RuleInput) =>
    api.patch<ReportingTemplate>(`/templates/${id}/rules/${ruleId}`, body).then((r) => r.data),

  removeRule: (id: string, ruleId: string) =>
    api.delete<ReportingTemplate>(`/templates/${id}/rules/${ruleId}`).then((r) => r.data),
};

export const templateKeys = {
  all: ['templates'] as const,
  list: (params: TemplateListParams) => ['templates', 'list', params] as const,
  detail: (id: string) => ['templates', 'detail', id] as const,
};
