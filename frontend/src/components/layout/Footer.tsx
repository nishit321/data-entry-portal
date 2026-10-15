import { strings } from '../../lib/strings';
import { APP_VERSION } from '../../lib/app-version';

/** Shared app footer. Lives in components/layout/, used by the authenticated shell. */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-gray-200 px-4 py-4 text-xs text-gray-500 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span>
          © {year} {strings.brand.authorityFull}
        </span>
        <span>
          {strings.brand.portal}, {APP_VERSION}
        </span>
      </div>
    </footer>
  );
}
