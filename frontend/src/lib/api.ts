import axios, { AxiosError } from 'axios';
import { reportNetworkFailure, reportNetworkSuccess } from './connection';

const TOKEN_KEY = 'nca_access_token';

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Attach the bearer token to every request when present.
api.interceptors.request.use((config) => {
  const token = tokenStorage.get();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    reportNetworkSuccess();
    return response;
  },
  (error: AxiosError) => {
    // No response at all means the request never reached the server — that's a connection
    // problem, not an application error, and the shell banner reports it (§5).
    if (error.response) reportNetworkSuccess();
    else reportNetworkFailure();

    if (error.response?.status === 401) {
      tokenStorage.clear();
      if (!window.location.pathname.startsWith('/login')) {
        // Carry the destination and the reason across, so sign-in can explain what happened and
        // land the user back where they were instead of dropping them on an empty dashboard (§5).
        const next = `${window.location.pathname}${window.location.search}`;
        const params = new URLSearchParams({ next, reason: 'expired' });
        window.location.assign(`/login?${params.toString()}`);
      }
    }
    return Promise.reject(error);
  },
);

/** Normalise an Axios error into a display message. */
export function getErrorMessage(
  error: unknown,
  fallback = "We couldn't complete that. Try again.",
): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    const data = error.response?.data as
      { message?: string | string[]; requestId?: string } | undefined;
    const message = data?.message;
    let text = fallback;
    if (Array.isArray(message)) text = message.join(', ');
    else if (typeof message === 'string') text = message;
    // Surface the correlation id on server faults so users can quote it in support.
    if (status >= 500 && data?.requestId) {
      return `${text} (ref: ${data.requestId})`;
    }
    return text;
  }
  return fallback;
}
