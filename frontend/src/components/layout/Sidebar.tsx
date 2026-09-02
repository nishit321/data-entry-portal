import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { BELOW_LG, useMediaQuery } from '../../hooks/useMediaQuery';
import { useScrollLock } from '../../hooks/useScrollLock';
import { Tooltip } from '../ui/Tooltip';
import { NAV_ITEMS, NAV_SECTIONS, type NavItem } from './nav';
import { useNavCounts } from './useNavCounts';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'v0.1 (demo)';

/**
 * Left navigation (FRONTEND_STANDARDS §3.10).
 *
 * Full viewport height and pinned — only the nav list scrolls, and it contains its own scroll so
 * reaching the end doesn't push the page behind it. On desktop it can collapse to an icon rail;
 * on small screens it slides in as a focus-trapped drawer that is not tab-focusable when closed
 * (§6).
 */
export function Sidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
}: {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { user } = useAuth();
  const counts = useNavCounts();
  const asideRef = useRef<HTMLElement>(null);
  const isDrawer = useMediaQuery(BELOW_LG);

  // An open drawer freezes the page behind it, like any other overlay (§3.10).
  useScrollLock(isDrawer && open);

  // The mobile drawer behaves like a dialog: ESC closes it, and focus moves inside so the next
  // Tab lands on a nav item rather than somewhere behind the overlay (§6).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    asideRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const visible = (item: NavItem) =>
    !item.roles || (user !== null && item.roles.includes(user.role));

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: NAV_ITEMS.filter((item) => item.section === section.id && visible(item)),
  })).filter((section) => section.items.length > 0);

  const width = collapsed ? 'lg:w-[4.5rem]' : 'lg:w-64';

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />
      )}

      <aside
        ref={asideRef}
        aria-label="Main navigation"
        // `inert` keeps the closed *drawer* out of the tab order entirely; `hidden` alone would
        // fight the slide transition, and leaving it focusable strands keyboard users off-screen
        // (§6). It must be scoped to the drawer breakpoint — on desktop this same element is
        // permanent chrome, and marking it inert there would make the whole navigation dead.
        {...(isDrawer && !open ? { inert: '' } : {})}
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-brand-900 text-slate-100 transition-[transform,visibility,width] duration-200 lg:static lg:visible lg:translate-x-0 ${width} ${
          open ? 'visible translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        {/* Brand */}
        <div
          className={`flex h-16 shrink-0 items-center gap-2 border-b border-white/10 ${
            collapsed ? 'lg:justify-center lg:px-0' : 'justify-between'
          } px-5`}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600">
              <ShieldCheck size={20} />
            </div>
            <div className={`leading-tight ${collapsed ? 'lg:hidden' : ''}`}>
              <div className="text-sm font-semibold">NCA Portal</div>
              <div className="text-[11px] text-slate-400">Data Collection</div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation — the only part that scrolls, and it keeps its scroll to itself (§3.10). */}
        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          {sections.map((section, index) => (
            <div key={section.id} className={index > 0 ? 'mt-5' : ''}>
              <div
                className={`px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 ${
                  collapsed ? 'lg:sr-only' : ''
                }`}
              >
                {section.label}
              </div>
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavItemLink
                      item={item}
                      collapsed={collapsed}
                      count={item.countKey ? counts[item.countKey] : undefined}
                      onNavigate={onClose}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-white/10 px-3 py-3">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
            className="hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 lg:flex"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            <span className={collapsed ? 'lg:hidden' : ''}>Collapse</span>
          </button>
          <p className={`px-3 pt-2 text-[11px] text-slate-400 ${collapsed ? 'lg:hidden' : ''}`}>
            NCA Data Collection Portal
            <br />
            {APP_VERSION}
          </p>
        </div>
      </aside>
    </>
  );
}

function NavItemLink({
  item,
  collapsed,
  count,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  count: number | undefined;
  onNavigate: () => void;
}) {
  const Icon = item.icon;

  const link = (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          collapsed ? 'lg:justify-center lg:px-0' : ''
        } ${isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`
      }
    >
      <Icon size={18} className="shrink-0" aria-hidden />
      <span className={`flex-1 ${collapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={`min-w-[1.25rem] rounded-full bg-warning-500 px-1.5 text-center text-[11px] font-semibold leading-5 text-white ${
            collapsed ? 'lg:hidden' : ''
          }`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </NavLink>
  );

  // Collapsed to an icon rail, the label has to come back on hover and on keyboard focus —
  // an unlabelled icon is not a navigation item (§6).
  return collapsed ? (
    <Tooltip
      content={count ? `${item.label} (${count})` : item.label}
      side="right"
      className="hidden w-full lg:inline-flex [&>a]:w-full"
    >
      {link}
    </Tooltip>
  ) : (
    link
  );
}
