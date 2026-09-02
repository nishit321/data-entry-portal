import type { ReactNode } from 'react';
import { Footer } from '../layout/Footer';

/**
 * The scrolling page frame (FRONTEND_STANDARDS §3.10). The shell itself is fixed to the
 * viewport, so a document-shaped screen — a dashboard, a detail view, an editor — supplies its
 * own scroll region here. This is the *only* scrollbar on such a screen; the footer scrolls with
 * the content rather than eating a strip of every viewport.
 *
 * List screens use `ListShell` instead: they fill the height and scroll their table internally
 * so the toolbar and column headers stay put (§3.11).
 */
export function Page({
  children,
  /** Wider canvas for editors and builders that need the room. */
  width = 'default',
  /** Screens that manage their own footer placement (or shouldn't show one) can drop it. */
  footer = true,
}: {
  children: ReactNode;
  width?: 'default' | 'wide' | 'full';
  footer?: boolean;
}) {
  const maxWidth =
    width === 'full' ? 'max-w-none' : width === 'wide' ? 'max-w-[90rem]' : 'max-w-6xl';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <div className={`mx-auto w-full flex-1 p-4 sm:p-6 lg:p-8 ${maxWidth}`}>{children}</div>
      {footer && <Footer />}
    </div>
  );
}
