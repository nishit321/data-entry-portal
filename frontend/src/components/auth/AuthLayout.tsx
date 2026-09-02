import type { ReactNode } from 'react';
import { ShieldCheck, LineChart, FileCheck2, Lock } from 'lucide-react';

const HIGHLIGHTS = [
  {
    icon: ShieldCheck,
    title: 'Secure & auditable',
    text: 'Every submission, edit, and approval is logged and attributable.',
  },
  {
    icon: LineChart,
    title: 'Real-time compliance',
    text: 'Track who has reported, who is overdue, and sector performance.',
  },
  {
    icon: FileCheck2,
    title: 'Structured submissions',
    text: 'Validated, comparable data across every regulated entity.',
  },
];

/**
 * Split-screen shell for unauthenticated pages: a branded panel on the left
 * (desktop only) and the form on the right. Collapses to a single column with
 * a compact brand header on mobile.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-white">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-800 to-brand-900 p-12 text-white lg:flex">
        {/* Decorative glows */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <ShieldCheck size={24} />
          </div>
          <div className="leading-tight">
            <div className="text-base font-semibold">NCA Data Collection Portal</div>
            <div className="text-xs text-brand-200">
              National Communication Authority, South Sudan
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-2xl font-semibold leading-snug">
            Regulatory data reporting, done right.
          </h2>
          <p className="mt-2 text-sm text-brand-100">
            One secure system of record for operators and the Authority.
          </p>

          <ul className="mt-10 space-y-6">
            {HIGHLIGHTS.map((h) => {
              const Icon = h.icon;
              return (
                <li key={h.title} className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                    <Icon size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{h.title}</div>
                    <div className="text-sm text-brand-200">{h.text}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-brand-300">
          <Lock size={13} />
          All data is treated confidentially and used solely for regulatory purposes.
        </div>
      </div>

      {/* Form area */}
      <div className="flex w-full items-center justify-center px-6 py-12 sm:px-10 lg:w-1/2">
        <div className="w-full max-w-sm">
          {/* Compact brand for mobile */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
              <ShieldCheck size={22} />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-gray-900">NCA Portal</div>
              <div className="text-xs text-gray-500">Data Collection</div>
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-gray-500">{subtitle}</p>}

          <div className="mt-8">{children}</div>

          {footer && <div className="mt-8 text-center text-sm text-gray-600">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
