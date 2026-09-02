import { api } from './api';
import type { UserListParams } from './auth.api';
import type { CreateUserResponse, Paginated, User } from './types';

/** Operator self-service: an OPERATOR_ADMIN manages users within its own entity. */
export type OperatorRole = 'OPERATOR_ADMIN' | 'OPERATOR_SUBMITTER';

export interface OperatorCreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: OperatorRole;
  password?: string;
}

export const operatorUsersApi = {
  list: (params: UserListParams = {}) =>
    api.get<Paginated<User>>('/operator/users', { params }).then((r) => r.data),

  create: (body: OperatorCreateUserInput) =>
    api.post<CreateUserResponse>('/operator/users', body).then((r) => r.data),

  update: (
    id: string,
    body: Partial<{
      firstName: string;
      lastName: string;
      role: OperatorRole;
      isActive: boolean;
    }>,
  ) => api.patch<User>(`/operator/users/${id}`, body).then((r) => r.data),

  remove: (id: string) =>
    api.delete<{ message: string }>(`/operator/users/${id}`).then((r) => r.data),
};

export const operatorUserKeys = {
  all: ['operator-users'] as const,
  list: () => ['operator-users', 'list'] as const,
};
