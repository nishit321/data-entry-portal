import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Menu, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS } from '../../lib/types';
import { Dropdown } from '../ui/Dropdown';
import { Breadcrumb } from '../ui/Breadcrumb';
import { NotificationBell } from './NotificationBell';
import { pageTitle } from './nav';

function initials(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

/**
 * The top bar. Fixed with the shell (FRONTEND_STANDARDS §3.10) and never scrolls away.
 *
 * The account menu is the shared `Dropdown` — it used to be hand-rolled here, which meant it
 * couldn't be closed with ESC and announced nothing to a screen reader. §3.4 is explicit that a
 * screen never hand-rolls a primitive that exists; the top bar is not exempt.
 */
export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!user) return null;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="z-20 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:hidden"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <div className="min-w-0">
          <Breadcrumb />
          <h1 className="truncate text-lg font-semibold leading-tight text-gray-900">
            {pageTitle(location.pathname)}
          </h1>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <NotificationBell />

        <Dropdown
          label="Account menu"
          align="right"
          triggerClassName="flex shrink-0 items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          trigger={
            <>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                {initials(user.firstName, user.lastName)}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-medium text-gray-900">
                  {user.firstName} {user.lastName}
                </span>
                <span className="block text-xs text-gray-500">{ROLE_LABELS[user.role]}</span>
              </span>
              <ChevronDown size={16} className="text-gray-500" aria-hidden />
            </>
          }
          header={
            <>
              <div className="text-sm font-medium text-gray-900">
                {user.firstName} {user.lastName}
              </div>
              <div className="truncate text-xs text-gray-500">{user.email}</div>
            </>
          }
          items={[
            { label: 'Your details', icon: UserRound, onClick: () => navigate('/profile') },
            {
              label: 'Sign out',
              icon: LogOut,
              danger: true,
              separatorBefore: true,
              onClick: handleLogout,
            },
          ]}
        />
      </div>
    </header>
  );
}
