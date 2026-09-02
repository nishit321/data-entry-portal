import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { isChildRoute, navItemFor } from '../layout/nav';

/**
 * The trail on nested routes (FRONTEND_STANDARDS §3.6) — "Templates › Template".
 *
 * It derives itself from the nav config, so a new child route gets a breadcrumb by declaring a
 * `childTitle` rather than by each editor screen hand-placing its own "← Back" link. On a
 * top-level route it renders nothing; the page title alone is the whole story there.
 */
export function Breadcrumb() {
  const location = useLocation();
  if (!isChildRoute(location.pathname)) return null;

  const parent = navItemFor(location.pathname);
  if (!parent) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-0.5">
      <ol className="flex items-center gap-1 text-xs text-gray-500">
        <li>
          <Link
            to={parent.to}
            className="rounded hover:text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            {parent.label}
          </Link>
        </li>
        <li aria-hidden className="text-gray-300">
          <ChevronRight size={12} />
        </li>
        <li aria-current="page" className="text-gray-500">
          {parent.childTitle ?? 'Detail'}
        </li>
      </ol>
    </nav>
  );
}
