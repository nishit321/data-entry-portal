import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { FloatingPanel } from '../ui/_popover';
import { RelativeTime } from '../ui/RelativeTime';
import { notificationsApi, notificationKeys } from '../../lib/notifications.api';
import type { Notification } from '../../lib/types';

// The unread badge polls on the same cadence as the nav counts, so a reviewer sees new work land
// without a refresh. The dropdown itself fetches the latest few only when it's opened.
const REFRESH_MS = 60_000;
const PANEL_SIZE = 8;

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const unreadQuery = useQuery({
    queryKey: notificationKeys.unread,
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
    // Always land showing the true count: refetch when the bell mounts (e.g. straight after a
    // login lands the user here) and when they return to the tab after acting as another role.
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const unread = unreadQuery.data?.unread ?? 0;

  const feedQuery = useQuery({
    queryKey: notificationKeys.list({ page: 1, pageSize: PANEL_SIZE }),
    queryFn: () => notificationsApi.list({ page: 1, pageSize: PANEL_SIZE }),
    enabled: open,
    // Each time the panel opens, pull the latest rather than showing a cached list.
    refetchOnMount: 'always',
    staleTime: 0,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: notificationKeys.all });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: refresh,
  });

  const openItem = (n: Notification) => {
    setOpen(false);
    if (!n.readAt) markRead.mutate(n.id);
    if (n.linkPath) navigate(n.linkPath);
  };

  const items = feedQuery.data?.data ?? [];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Bell size={20} aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <FloatingPanel
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <span className="text-sm font-semibold text-gray-900">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 disabled:opacity-50"
            >
              <CheckCheck size={14} aria-hidden />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto overscroll-contain">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">
              {feedQuery.isLoading ? 'Loading…' : 'You have no notifications yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 ${
                      n.readAt ? '' : 'bg-brand-50/40'
                    }`}
                  >
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        n.readAt ? 'bg-transparent' : 'bg-brand-600'
                      }`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900">{n.title}</span>
                      <span className="mt-0.5 block text-xs text-gray-600">{n.body}</span>
                      <RelativeTime
                        value={n.createdAt}
                        className="mt-1 block text-xs text-gray-500"
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-100 px-4 py-2 text-center">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/notifications');
            }}
            className="text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            View all notifications
          </button>
        </div>
      </FloatingPanel>
    </>
  );
}
