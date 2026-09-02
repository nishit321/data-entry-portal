import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  Page,
  PageHeader,
  Pagination,
  RelativeTime,
  Skeleton,
  useToast,
} from '../components/ui';
import { notificationsApi, notificationKeys } from '../lib/notifications.api';
import { getErrorMessage } from '../lib/api';
import type { Notification } from '../lib/types';

const PAGE_SIZE = 20;

export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [page, setPage] = useState(1);

  const feedQuery = useQuery({
    queryKey: notificationKeys.list({ page, pageSize: PAGE_SIZE }),
    queryFn: () => notificationsApi.list({ page, pageSize: PAGE_SIZE }),
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: notificationKeys.all });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      refresh();
      toast.success('All notifications marked as read.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't update your notifications.")),
  });

  const open = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.linkPath) navigate(n.linkPath);
  };

  const feed = feedQuery.data;
  const items = feed?.data ?? [];

  return (
    <Page width="default">
      <PageHeader
        title="Notifications"
        description="Updates about your returns and reviews."
        actions={
          feed && feed.unread > 0 ? (
            <Button
              variant="secondary"
              icon={CheckCheck}
              isLoading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <Card>
        {feedQuery.isLoading ? (
          <div className="space-y-4 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            message="No notifications yet. When a return of yours is reviewed, or one needs your attention, it will show up here."
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={`flex w-full gap-3 py-4 text-left focus:outline-none focus-visible:bg-gray-50 ${
                    n.readAt ? '' : 'bg-brand-50/40'
                  } -mx-4 px-4 hover:bg-gray-50 sm:-mx-6 sm:px-6`}
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${
                      n.readAt ? 'bg-transparent' : 'bg-brand-600'
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900">{n.title}</span>
                    <span className="mt-0.5 block text-sm text-gray-600">{n.body}</span>
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
      </Card>

      {feed && (
        <div className="mt-4">
          <Pagination meta={feed.meta} onPageChange={setPage} />
        </div>
      )}
    </Page>
  );
}
