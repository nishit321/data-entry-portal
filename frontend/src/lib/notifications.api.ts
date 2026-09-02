import { api } from './api';
import type { Notification, Paginated } from './types';

export interface NotificationListParams {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}

/** The list response carries the total unread count alongside the page of rows. */
export interface NotificationFeed extends Paginated<Notification> {
  unread: number;
}

export const notificationsApi = {
  list: (params: NotificationListParams = {}) =>
    api
      .get<NotificationFeed>('/notifications', {
        params: {
          page: params.page,
          pageSize: params.pageSize,
          unreadOnly: params.unreadOnly ? 'true' : undefined,
        },
      })
      .then((r) => r.data),

  unreadCount: () => api.get<{ unread: number }>('/notifications/unread-count').then((r) => r.data),

  markRead: (id: string) =>
    api.patch<{ message: string }>(`/notifications/${id}/read`).then((r) => r.data),

  markAllRead: () => api.post<{ updated: number }>('/notifications/read-all').then((r) => r.data),
};

export const notificationKeys = {
  all: ['notifications'] as const,
  unread: ['notifications', 'unread-count'] as const,
  list: (params: NotificationListParams) => ['notifications', 'list', params] as const,
};
