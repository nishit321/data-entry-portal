import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { submissionsApi } from '../../lib/submissions.api';
import { workflowApi } from '../../lib/workflow.api';
import { isOperatorRole, REVIEW_STAGES } from '../../lib/types';
import type { NavCountKey } from './nav';

// How much work is waiting, shown on the nav item itself (FRONTEND_STANDARDS §3.11). A reviewer
// shouldn't have to open the queue to find out whether there's anything in it.
//
// Both counts come from the `meta.total` of an existing list endpoint asked for a single row —
// no new API surface, and the response is small enough to poll.
const REFRESH_MS = 60_000;

export type NavCounts = Partial<Record<NavCountKey, number>>;

export function useNavCounts(): NavCounts {
  const { user } = useAuth();
  const isReviewer = user !== null && (REVIEW_STAGES as readonly string[]).includes(user.role);
  const isOperator = user !== null && isOperatorRole(user.role);

  const queueQuery = useQuery({
    queryKey: ['workflow', 'queue-count'],
    queryFn: () => workflowApi.queue({ page: 1, pageSize: 1 }),
    enabled: isReviewer,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });

  const draftsQuery = useQuery({
    queryKey: ['submissions', 'draft-count'],
    queryFn: () => submissionsApi.list({ page: 1, pageSize: 1, status: 'DRAFT' }),
    enabled: isOperator,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });

  return {
    reviewQueue: queueQuery.data?.meta.total,
    openDrafts: draftsQuery.data?.meta.total,
  };
}
