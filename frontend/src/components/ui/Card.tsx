import type { ReactNode } from 'react';

/**
 * The standard content surface (FRONTEND_STANDARDS §3.2): `rounded-xl`, one-step elevation, and
 * consistent padding everywhere.
 *
 * `id` is accepted because a card is often the target of in-page navigation — a section of a long
 * questionnaire that the section nav scrolls to (§3.12).
 */
export function Card({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`rounded-xl border border-gray-200 bg-white p-6 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}
