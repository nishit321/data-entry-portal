import { api } from './api';
import type {
  AuthResponse,
  CreateUserResponse,
  LoginResult,
  MfaChallenge,
  Paginated,
  Role,
  User,
} from './types';

export interface UserListParams {
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'email' | 'firstName' | 'lastName' | 'role' | 'isActive';
  order?: 'asc' | 'desc';
  role?: Role;
  isActive?: boolean;
  search?: string;
}

// --- Auth endpoints ---

export const authApi = {
  // Returns a token, OR an MFA challenge when MFA is on (then call verifyOtp).
  login: (email: string, password: string) =>
    api.post<LoginResult>('/auth/login', { email, password }).then((r) => r.data),

  verifyOtp: (challengeId: string, code: string) =>
    api.post<AuthResponse>('/auth/verify-otp', { challengeId, code }).then((r) => r.data),

  resendOtp: (challengeId: string) =>
    api.post<MfaChallenge>('/auth/resend-otp', { challengeId }).then((r) => r.data),

  signup: (payload: { email: string; password: string; firstName: string; lastName: string }) =>
    api.post<AuthResponse>('/auth/signup', payload).then((r) => r.data),

  forgotPassword: (email: string) =>
    api.post<{ message: string }>('/auth/forgot-password', { email }).then((r) => r.data),

  resetPassword: (token: string, password: string) =>
    api.post<{ message: string }>('/auth/reset-password', { token, password }).then((r) => r.data),

  me: () => api.get<User>('/auth/me').then((r) => r.data),

  // --- The caller's own phone number ---

  /** Whether a number can be confirmed at all, so the screen can say so before asking for one. */
  phoneAvailability: () => api.get<{ available: boolean }>('/auth/phone').then((r) => r.data),

  /** Sends a code to the number. The number is not stored until the code comes back. */
  startPhoneVerification: (phone: string) =>
    api
      .post<{ maskedPhone: string; expiresInSec: number }>('/auth/phone', { phone })
      .then((r) => r.data),

  confirmPhone: (code: string) =>
    api.post<{ phone: string }>('/auth/phone/verify', { code }).then((r) => r.data),

  removePhone: () => api.delete<void>('/auth/phone').then((r) => r.data),
};

// --- User administration endpoints (ADMIN only) ---

export const usersApi = {
  list: (params: UserListParams = {}) =>
    api.get<Paginated<User>>('/users', { params }).then((r) => r.data),

  roles: () => api.get<Role[]>('/users/roles').then((r) => r.data),

  create: (payload: {
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    entityId?: string;
    password?: string;
  }) => api.post<CreateUserResponse>('/users', payload).then((r) => r.data),

  setRole: (id: string, role: Role) =>
    api.patch<User>(`/users/${id}/role`, { role }).then((r) => r.data),

  update: (
    id: string,
    payload: {
      firstName?: string;
      lastName?: string;
      role?: Role;
      isActive?: boolean;
      // null clears the entity link (used when moving to a non-operator role).
      entityId?: string | null;
    },
  ) => api.patch<User>(`/users/${id}`, payload).then((r) => r.data),

  remove: (id: string) => api.delete<{ message: string }>(`/users/${id}`).then((r) => r.data),
};
