import { api } from './api';

/** One switch as the administrator's screen sees it. */
export interface SettingView {
  key: string;
  label: string;
  description: string;
  type: 'boolean' | 'number';
  value: boolean | number;
  /** False while the setting is still as the portal shipped. */
  isCustomised: boolean;
  min?: number;
  max?: number;
  unit?: string;
}

/**
 * The handful of values the sign-in screen has to obey before anybody has signed in.
 *
 * Values only. The server deliberately does not describe the rest of the configuration to a
 * reader with no account.
 */
export type PublicSettings = Record<string, boolean | number>;

export const settingsApi = {
  publicValues: () => api.get<PublicSettings>('/settings/public').then((r) => r.data),
  all: () => api.get<SettingView[]>('/settings').then((r) => r.data),
  set: (key: string, value: boolean | number) =>
    api.patch<SettingView[]>(`/settings/${key}`, { value }).then((r) => r.data),
};

export const settingsKeys = {
  all: ['settings'] as const,
  public: ['settings', 'public'] as const,
};
