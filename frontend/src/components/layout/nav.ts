import {
  Building2,
  CalendarClock,
  BarChart3,
  ClipboardCheck,
  Coins,
  ClipboardList,
  FileBadge,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageSquareWarning,
  ScrollText,
  ServerCog,
  ShieldAlert,
  Store,
  UserCog,
  Users,
  type LucideIcon,
  Trophy,
  Globe,
  Map,
  KeyRound,
  Antenna,
  ShieldCheck,
} from 'lucide-react';
import type { Role } from '../../lib/types';

/** Which live count, if any, a nav item shows as a badge (see `useNavCounts`). */
export type NavCountKey = 'reviewQueue' | 'openDrafts';

export type NavSectionId = 'work' | 'registry' | 'reporting' | 'administration';

export interface NavSection {
  id: NavSectionId;
  label: string;
}

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  section: NavSectionId;
  /** If set, only these roles see the item. Undefined = all authenticated users. */
  roles?: Role[];
  /** Shows a count badge so pending work is visible without opening the screen. */
  countKey?: NavCountKey;
  /** Trail shown by `Breadcrumb` on child routes, e.g. Templates → this record. */
  childTitle?: string;
}

/** Grouping for the sidebar, in display order. Empty groups are dropped per role. */
export const NAV_SECTIONS: NavSection[] = [
  { id: 'work', label: 'Your work' },
  { id: 'registry', label: 'Registry' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'administration', label: 'Administration' },
];

const OPERATOR_AND_AUTHORITY: Role[] = [
  'OPERATOR_ADMIN',
  'OPERATOR_SUBMITTER',
  'ADMIN',
  'SUPERVISOR',
  'ANALYST',
];

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, section: 'work' },
  {
    label: 'Returns',
    to: '/submissions',
    icon: ClipboardList,
    section: 'work',
    countKey: 'openDrafts',
    childTitle: 'Return',
    roles: [...OPERATOR_AND_AUTHORITY, 'CHECKER', 'VERIFIER', 'APPROVER'],
  },
  {
    label: 'Review queue',
    to: '/review-queue',
    icon: ClipboardCheck,
    section: 'work',
    countKey: 'reviewQueue',
    roles: ['CHECKER', 'VERIFIER', 'APPROVER'],
  },
  {
    label: 'Compliance',
    to: '/enforcement',
    icon: ShieldAlert,
    section: 'work',
    roles: [...OPERATOR_AND_AUTHORITY, 'CHECKER', 'VERIFIER', 'APPROVER'],
  },
  {
    label: 'Analytics',
    to: '/analytics',
    icon: BarChart3,
    section: 'reporting',
    roles: [...OPERATOR_AND_AUTHORITY, 'CHECKER', 'VERIFIER', 'APPROVER'],
  },
  {
    label: 'Benchmarking',
    to: '/benchmarking',
    icon: Trophy,
    section: 'reporting',
    roles: [...OPERATOR_AND_AUTHORITY, 'CHECKER', 'VERIFIER', 'APPROVER'],
  },
  {
    label: 'Revenue and levy',
    to: '/levy',
    icon: Coins,
    section: 'reporting',
    roles: [...OPERATOR_AND_AUTHORITY, 'CHECKER', 'VERIFIER', 'APPROVER'],
  },

  {
    label: 'Scheduled reports',
    to: '/scheduled-reports',
    icon: CalendarClock,
    section: 'reporting',
    roles: ['ADMIN', 'SUPERVISOR', 'ANALYST'],
  },
  {
    label: 'Open data',
    to: '/open-data-admin',
    icon: Globe,
    section: 'reporting',
    roles: ['ADMIN', 'SUPERVISOR', 'ANALYST'],
  },

  {
    label: 'API credentials',
    to: '/api-credentials',
    icon: KeyRound,
    section: 'registry',
    roles: ['OPERATOR_ADMIN', 'ADMIN', 'SUPERVISOR', 'ANALYST'],
  },

  {
    label: 'Automated feeds',
    to: '/network-feeds',
    icon: Antenna,
    section: 'registry',
    roles: [...OPERATOR_AND_AUTHORITY, 'CHECKER', 'VERIFIER', 'APPROVER'],
  },
  {
    label: 'Signing certificates',
    to: '/signing-certificates',
    icon: ShieldCheck,
    section: 'administration',
  },
  {
    label: 'Network map',
    to: '/network-map',
    icon: Map,
    section: 'registry',
    roles: [...OPERATOR_AND_AUTHORITY, 'CHECKER', 'VERIFIER', 'APPROVER'],
  },

  { label: 'Entities', to: '/entities', icon: Building2, section: 'registry', roles: ['ADMIN'] },
  {
    label: 'Documents',
    to: '/documents',
    icon: FileBadge,
    section: 'registry',
    roles: [...OPERATOR_AND_AUTHORITY, 'CHECKER', 'VERIFIER', 'APPROVER'],
  },
  {
    label: 'Agents',
    to: '/agents',
    icon: Store,
    section: 'registry',
    roles: OPERATOR_AND_AUTHORITY,
  },
  {
    label: 'My team',
    to: '/my-team',
    icon: UserCog,
    section: 'registry',
    roles: ['OPERATOR_ADMIN'],
  },

  {
    label: 'Templates',
    to: '/templates',
    icon: FileText,
    section: 'reporting',
    childTitle: 'Template',
    roles: ['ADMIN'],
  },
  {
    label: 'Reporting periods',
    to: '/reporting-periods',
    icon: CalendarClock,
    section: 'reporting',
    roles: ['ADMIN'],
  },
  {
    label: 'Reference data',
    to: '/reference-data',
    icon: ListChecks,
    section: 'reporting',
    roles: ['ADMIN'],
  },

  {
    label: 'Complaints',
    to: '/complaints',
    icon: MessageSquareWarning,
    section: 'work',
    roles: ['ADMIN', 'SUPERVISOR', 'ANALYST'],
  },

  { label: 'Users', to: '/users', icon: Users, section: 'administration', roles: ['ADMIN'] },
  {
    label: 'System health',
    to: '/system',
    icon: ServerCog,
    section: 'administration',
    roles: ['ADMIN', 'SUPERVISOR'],
  },
  {
    label: 'Audit log',
    to: '/audit',
    icon: ScrollText,
    section: 'administration',
    roles: ['ADMIN', 'SUPERVISOR', 'ANALYST', 'CHECKER', 'VERIFIER', 'APPROVER'],
  },
];

/** The nav item a path belongs to — the longest matching `to`, so child routes resolve. */
export function navItemFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter(
    (i) => i.to === pathname || (i.to !== '/' && pathname.startsWith(`${i.to}/`)),
  ).sort((a, b) => b.to.length - a.to.length)[0];
}

/** Titles for screens reached outside the sidebar (e.g. the notification bell). */
const EXTRA_TITLES: Record<string, string> = {
  '/notifications': 'Notifications',
  '/profile': 'Your details',
};

/** Resolve a page title from the current path for the top bar and `document.title`. */
export function pageTitle(pathname: string): string {
  return navItemFor(pathname)?.label ?? EXTRA_TITLES[pathname] ?? 'NCA Portal';
}

/** True when the path is a child of its nav item (a detail/editor screen), not the list itself. */
export function isChildRoute(pathname: string): boolean {
  const item = navItemFor(pathname);
  return item !== undefined && item.to !== pathname;
}
