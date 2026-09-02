import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './layout/Sidebar';
import { Topbar } from './layout/Topbar';
import { ConnectionBanner } from './layout/ConnectionBanner';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { PageLoading } from './ui/PageLoading';
import { usePreference } from '../hooks/usePreference';
import { usePageMeta } from '../hooks/usePageMeta';
import { pageTitle } from './layout/nav';

/**
 * The authenticated shell (FRONTEND_STANDARDS §3.10).
 *
 * The shell is exactly viewport-height and never scrolls — `h-screen overflow-hidden`. The
 * sidebar and top bar therefore hold their position no matter how long the page is, and each
 * screen owns its own scroll region (`Page` or `ListShell`). Before this, the whole document
 * scrolled and the navigation slid off the top of a long audit log.
 */
export function Layout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = usePreference('sidebar-collapsed', false);
  const location = useLocation();

  // Title, focus, and the screen-reader announcement for every route change, in one place (§6).
  usePageMeta(pageTitle(location.pathname));

  // A route change closes the mobile drawer — otherwise tapping a nav item leaves the overlay
  // covering the page the user just asked for.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Keyboard skip link — first focusable element, visible only when focused (§6). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <Sidebar
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
      />

      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <ConnectionBanner />
        {/* The single content region. Pages render `Page` (scrolls) or `ListShell` (fills). */}
        <main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          {/* Keyed on the path so a crash in one screen is cleared by navigating away (§5). */}
          <RouteErrorBoundary key={location.pathname}>
            {/* Inside the shell, so a page chunk downloading leaves the nav usable rather than
                blanking the whole application (§5). */}
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
