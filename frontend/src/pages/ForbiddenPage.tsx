import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '../components/ui';

/**
 * Explicit access-denied screen shown when a signed-in user hits a route their role can't
 * see — not a silent bounce to `/`, which reads as a bug (FRONTEND_STANDARDS §5).
 */
export function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-gray-50 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-50 text-warning-600">
        <Lock size={26} aria-hidden />
      </div>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-warning-600">403</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">You don&apos;t have access</h1>
        <p className="mt-1.5 max-w-sm text-sm text-gray-500">
          This page is only open to certain roles. If you think you should have access, ask your
          administrator to review your permissions.
        </p>
      </div>
      <Button onClick={() => navigate('/')}>Back to dashboard</Button>
    </div>
  );
}
