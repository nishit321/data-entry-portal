import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageLoading } from './ui/PageLoading';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import type { Role } from '../lib/types';

/**
 * Gates child routes behind authentication and, optionally, specific roles.
 * Unauthenticated users go to /login; a signed-in user with the wrong role sees an
 * explicit access-denied screen (never a silent bounce — FRONTEND_STANDARDS §5).
 */
export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) return <PageLoading />;

  if (!isAuthenticated) {
    // Carry the destination so signing in returns the user to where they were headed, rather
    // than dropping them on the dashboard with no explanation (§5).
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <ForbiddenPage />;
  }

  return <Outlet />;
}
