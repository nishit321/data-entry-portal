import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { PageLoading } from './components/ui/PageLoading';
import type { Role } from './lib/types';

// Route-level code-splitting keeps the initial bundle small for low-bandwidth users (§5/§7).
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() =>
  import('./pages/SignupPage').then((m) => ({ default: m.SignupPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const EntitiesPage = lazy(() =>
  import('./pages/EntitiesPage').then((m) => ({ default: m.EntitiesPage })),
);
const AgentsPage = lazy(() =>
  import('./pages/AgentsPage').then((m) => ({ default: m.AgentsPage })),
);
const OperatorUsersPage = lazy(() =>
  import('./pages/OperatorUsersPage').then((m) => ({ default: m.OperatorUsersPage })),
);
const ReferenceDataPage = lazy(() =>
  import('./pages/ReferenceDataPage').then((m) => ({ default: m.ReferenceDataPage })),
);
const TemplatesPage = lazy(() =>
  import('./pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage })),
);
const TemplateEditorPage = lazy(() =>
  import('./pages/TemplateEditorPage').then((m) => ({ default: m.TemplateEditorPage })),
);
const ReportingPeriodsPage = lazy(() =>
  import('./pages/ReportingPeriodsPage').then((m) => ({ default: m.ReportingPeriodsPage })),
);
const SubmissionsPage = lazy(() =>
  import('./pages/SubmissionsPage').then((m) => ({ default: m.SubmissionsPage })),
);
const SubmissionEditorPage = lazy(() =>
  import('./pages/SubmissionEditorPage').then((m) => ({ default: m.SubmissionEditorPage })),
);
const ReviewQueuePage = lazy(() =>
  import('./pages/ReviewQueuePage').then((m) => ({ default: m.ReviewQueuePage })),
);
const AuditLogPage = lazy(() =>
  import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const EnforcementPage = lazy(() =>
  import('./pages/EnforcementPage').then((m) => ({ default: m.EnforcementPage })),
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
);
const BenchmarkingPage = lazy(() =>
  import('./pages/BenchmarkingPage').then((m) => ({ default: m.BenchmarkingPage })),
);
const LevyPage = lazy(() => import('./pages/LevyPage').then((m) => ({ default: m.LevyPage })));
const DocumentsPage = lazy(() =>
  import('./pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
);
const PublicComplaintPage = lazy(() =>
  import('./pages/PublicComplaintPage').then((m) => ({ default: m.PublicComplaintPage })),
);
const OpenDataPage = lazy(() =>
  import('./pages/OpenDataPage').then((m) => ({ default: m.OpenDataPage })),
);
const OpenDataAdminPage = lazy(() =>
  import('./pages/OpenDataAdminPage').then((m) => ({ default: m.OpenDataAdminPage })),
);
const ScheduledReportsPage = lazy(() =>
  import('./pages/ScheduledReportsPage').then((m) => ({ default: m.ScheduledReportsPage })),
);
const NetworkMapPage = lazy(() =>
  import('./pages/NetworkMapPage').then((m) => ({ default: m.NetworkMapPage })),
);
const NetworkFeedsPage = lazy(() =>
  import('./pages/NetworkFeedsPage').then((m) => ({ default: m.NetworkFeedsPage })),
);
const SigningCertificatesPage = lazy(() =>
  import('./pages/SigningCertificatesPage').then((m) => ({
    default: m.SigningCertificatesPage,
  })),
);
const ApiCredentialsPage = lazy(() =>
  import('./pages/ApiCredentialsPage').then((m) => ({ default: m.ApiCredentialsPage })),
);
const ComplaintsPage = lazy(() =>
  import('./pages/ComplaintsPage').then((m) => ({ default: m.ComplaintsPage })),
);
const SystemPage = lazy(() =>
  import('./pages/SystemPage').then((m) => ({ default: m.SystemPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

const AUTHORITY_INTERNAL: Role[] = [
  'ADMIN',
  'SUPERVISOR',
  'ANALYST',
  'CHECKER',
  'VERIFIER',
  'APPROVER',
];
const OPERATORS: Role[] = ['OPERATOR_ADMIN', 'OPERATOR_SUBMITTER'];
const REVIEWERS: Role[] = ['CHECKER', 'VERIFIER', 'APPROVER'];

/** A group of screens behind one role gate, all inside the authenticated shell. */
function gated(roles: Role[] | undefined, children: RouteObject[]): RouteObject {
  return {
    element: <ProtectedRoute roles={roles} />,
    children: [{ element: <Layout />, children }],
  };
}

const router = createBrowserRouter([
  // Public routes
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  // The public complaint desk: no account needed (Q4).
  { path: '/complaints/file', element: <PublicComplaintPage /> },
  // Open data: sector figures NCA has chosen to publish. No account needed (Q4).
  { path: '/open-data', element: <OpenDataPage /> },

  gated(undefined, [{ path: '/', element: <DashboardPage /> }]),

  // Notifications — every authenticated user has their own feed
  gated(undefined, [{ path: '/notifications', element: <NotificationsPage /> }]),
  gated(undefined, [{ path: '/profile', element: <ProfilePage /> }]),

  // Agents — operators (own) and Authority (all)
  gated(
    [...OPERATORS, 'ADMIN', 'SUPERVISOR', 'ANALYST'],
    [{ path: '/agents', element: <AgentsPage /> }],
  ),

  // Submissions — operators fill and submit their own; Authority reads
  gated(
    [...OPERATORS, ...AUTHORITY_INTERNAL],
    [
      { path: '/submissions', element: <SubmissionsPage /> },
      { path: '/submissions/:id', element: <SubmissionEditorPage /> },
    ],
  ),

  // The reviewer's work list (Checker → Verifier → Approver)
  gated(REVIEWERS, [{ path: '/review-queue', element: <ReviewQueuePage /> }]),

  // Compliance / enforcement — operators see their own cases; Authority sees all and acts
  gated(
    [...OPERATORS, ...AUTHORITY_INTERNAL],
    [{ path: '/enforcement', element: <EnforcementPage /> }],
  ),

  // Analytics — operators see their own figures; Authority sees the sector
  gated(
    [...OPERATORS, ...AUTHORITY_INTERNAL],
    [{ path: '/analytics', element: <AnalyticsPage /> }],
  ),

  // Benchmarking — operators see their own standing; Authority sees named comparisons
  gated(
    [...OPERATORS, ...AUTHORITY_INTERNAL],
    [{ path: '/benchmarking', element: <BenchmarkingPage /> }],
  ),

  // Revenue and levy — operators see their own assessment; Authority sees all and sets the rates
  gated([...OPERATORS, ...AUTHORITY_INTERNAL], [{ path: '/levy', element: <LevyPage /> }]),

  // Licence repository — operators see their own documents; Authority sees every operator's
  gated(
    [...OPERATORS, ...AUTHORITY_INTERNAL],
    [{ path: '/documents', element: <DocumentsPage /> }],
  ),

  // Open data — what the Authority publishes; the public page itself needs no account
  gated(
    ['ADMIN', 'SUPERVISOR', 'ANALYST'],
    [{ path: '/open-data-admin', element: <OpenDataAdminPage /> }],
  ),

  // API credentials — an operator admin manages their own; the Authority sees every operator's
  gated(
    ['OPERATOR_ADMIN', ...AUTHORITY_INTERNAL],
    [{ path: '/api-credentials', element: <ApiCredentialsPage /> }],
  ),

  // Automated feeds — operators see what is collected from them; the Authority sets them up
  gated(
    [...OPERATORS, ...AUTHORITY_INTERNAL],
    [{ path: '/network-feeds', element: <NetworkFeedsPage /> }],
  ),

  // Signing certificates — anyone who files or reviews a return may hold one (Q6)
  gated(undefined, [{ path: '/signing-certificates', element: <SigningCertificatesPage /> }]),

  // Network map — operators see their own network; Authority sees the sector
  gated(
    [...OPERATORS, ...AUTHORITY_INTERNAL],
    [{ path: '/network-map', element: <NetworkMapPage /> }],
  ),

  // Scheduled reports — Authority only; a report carries sector figures
  gated(
    ['ADMIN', 'SUPERVISOR', 'ANALYST'],
    [{ path: '/scheduled-reports', element: <ScheduledReportsPage /> }],
  ),

  // Citizen complaints — the Authority case book (the public files at /complaints/file)
  gated(['ADMIN', 'SUPERVISOR', 'ANALYST'], [{ path: '/complaints', element: <ComplaintsPage /> }]),

  // Operator self-service team management
  gated(['OPERATOR_ADMIN'], [{ path: '/my-team', element: <OperatorUsersPage /> }]),

  // System health — the Authority's own operational view
  gated(['ADMIN', 'SUPERVISOR'], [{ path: '/system', element: <SystemPage /> }]),

  // Audit log — Authority-internal roles only (append-only trail across all operators)
  gated(AUTHORITY_INTERNAL, [{ path: '/audit', element: <AuditLogPage /> }]),

  // Admin-only
  gated(
    ['ADMIN'],
    [
      { path: '/entities', element: <EntitiesPage /> },
      { path: '/reference-data', element: <ReferenceDataPage /> },
      { path: '/templates', element: <TemplatesPage /> },
      { path: '/templates/:id', element: <TemplateEditorPage /> },
      { path: '/reporting-periods', element: <ReportingPeriodsPage /> },
      { path: '/users', element: <UsersPage /> },
    ],
  ),

  // Unknown routes get a real 404, not a silent redirect (§5)
  { path: '/404', element: <NotFoundPage /> },
  { path: '*', element: <NotFoundPage /> },
]);

/**
 * The app root.
 *
 * This uses the **data router** (`createBrowserRouter`) rather than `<BrowserRouter>`. That's not
 * a preference: `useBlocker` — the only reliable way to stop an in-app navigation from discarding
 * a half-finished questionnaire (§3.12) — is only available on a data router.
 */
export default function App(): ReactNode {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Suspense fallback={<PageLoading />}>
          <RouterProvider router={router} />
        </Suspense>
      </ErrorBoundary>
    </AuthProvider>
  );
}
