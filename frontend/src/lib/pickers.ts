import type { ComboboxSource } from '../components/ui/Combobox';
import { entitiesApi } from './entities.api';
import { periodsApi } from './reporting-periods.api';
import { templatesApi } from './templates.api';
import { usersApi } from './auth.api';
import { formatDate, joinMeta } from './format';
import { ROLE_LABELS } from './types';

// The `Combobox` sources for every growable collection a screen might need to pick from
// (FRONTEND_STANDARDS §2).
//
// These live here rather than in each screen for the reason CODING_STANDARDS §1 gives: the entity
// picker appears on submissions, the review queue, users, and agents, and four copies of it would
// be four chances for one of them to drift back to a fixed `pageSize` and start truncating again.
//
// Each source pairs a paged `fetch` with a `resolve`, because the two answer different questions.
// `fetch` finds candidates for what the user is typing; `resolve` names the record that is
// *already* selected, which may sit on page 40 of the list and would otherwise render as a raw id
// after a page reload.

/** One page of options at a time — the same size for every picker, so scrolling feels alike. */
const PAGE_SIZE = 20;

export const entityPicker: ComboboxSource = {
  queryKey: 'entities',
  fetch: async ({ search, page }) => {
    const result = await entitiesApi.list({
      search,
      page,
      pageSize: PAGE_SIZE,
      sort: 'name',
      order: 'asc',
    });
    return {
      options: result.data.map((e) => ({ value: e.id, label: e.name, detail: e.licenceNumber })),
      hasNext: result.meta.hasNext,
    };
  },
  resolve: async (id) => {
    const entity = await entitiesApi.get(id);
    return { value: entity.id, label: entity.name, detail: entity.licenceNumber };
  },
};

export const templatePicker: ComboboxSource = {
  queryKey: 'templates',
  fetch: async ({ search, page }) => {
    const result = await templatesApi.list({
      search,
      page,
      pageSize: PAGE_SIZE,
      sort: 'name',
      order: 'asc',
    });
    return {
      options: result.data.map((t) => ({
        value: t.id,
        label: t.name,
        detail: `Version ${t.version}`,
      })),
      hasNext: result.meta.hasNext,
    };
  },
  resolve: async (id) => {
    const template = await templatesApi.get(id);
    return { value: template.id, label: template.name, detail: `Version ${template.version}` };
  },
};

/** Published templates only — the set a reporting period can actually be built on. */
export const publishedTemplatePicker: ComboboxSource = {
  ...templatePicker,
  queryKey: 'templates-published',
  fetch: async ({ search, page }) => {
    const result = await templatesApi.list({
      search,
      page,
      pageSize: PAGE_SIZE,
      status: 'PUBLISHED',
      sort: 'name',
      order: 'asc',
    });
    return {
      options: result.data.map((t) => ({
        value: t.id,
        label: t.name,
        detail: `Version ${t.version}`,
      })),
      hasNext: result.meta.hasNext,
    };
  },
};

export const periodPicker: ComboboxSource = {
  queryKey: 'reporting-periods',
  fetch: async ({ search, page }) => {
    const result = await periodsApi.list({
      search,
      page,
      pageSize: PAGE_SIZE,
      sort: 'dueDate',
      order: 'desc',
    });
    return {
      options: result.data.map((p) => ({
        value: p.id,
        label: p.label,
        detail: joinMeta(p.template.name, `due ${formatDate(p.dueDate)}`),
      })),
      hasNext: result.meta.hasNext,
    };
  },
  resolve: async (id) => {
    const period = await periodsApi.get(id);
    return {
      value: period.id,
      label: period.label,
      detail: joinMeta(period.template.name, `due ${formatDate(period.dueDate)}`),
    };
  },
};

export const userPicker: ComboboxSource = {
  queryKey: 'users',
  fetch: async ({ search, page }) => {
    const result = await usersApi.list({
      search,
      page,
      pageSize: PAGE_SIZE,
      sort: 'firstName',
      order: 'asc',
    });
    return {
      options: result.data.map((u) => ({
        value: u.id,
        label: `${u.firstName} ${u.lastName}`,
        detail: joinMeta(u.email, ROLE_LABELS[u.role]),
      })),
      hasNext: result.meta.hasNext,
    };
  },
  resolve: async (id) => {
    // There's no single-user endpoint, so find the record through the list. It's one request and
    // only runs when a filter arrives already pointing at someone.
    const result = await usersApi.list({ page: 1, pageSize: PAGE_SIZE });
    const match = result.data.find((u) => u.id === id);
    return match
      ? {
          value: match.id,
          label: `${match.firstName} ${match.lastName}`,
          detail: joinMeta(match.email, ROLE_LABELS[match.role]),
        }
      : null;
  },
};
