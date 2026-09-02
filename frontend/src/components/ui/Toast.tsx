import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, Undo2, X, XCircle } from 'lucide-react';
import type { Tone } from '../../lib/types';

type ToastTone = Exclude<Tone, 'gray'>;

export interface ToastOptions {
  tone?: ToastTone;
  /** Offers a single reversal on the toast itself — "Draft deleted. Undo". */
  action?: { label: string; onClick: () => void };
}

interface Toast {
  id: number;
  tone: ToastTone;
  message: ReactNode;
  action?: ToastOptions['action'];
}

interface ToastApi {
  show: (message: ReactNode, options?: ToastOptions) => void;
  success: (message: ReactNode, options?: Omit<ToastOptions, 'tone'>) => void;
  error: (message: ReactNode, options?: Omit<ToastOptions, 'tone'>) => void;
  info: (message: ReactNode, options?: Omit<ToastOptions, 'tone'>) => void;
  warning: (message: ReactNode, options?: Omit<ToastOptions, 'tone'>) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

// A tinted left accent + a soft colour ring give each toast an at-a-glance meaning:
// green for success, red for error, amber/blue for warning/info.
const toneStyles: Record<ToastTone, { accent: string; icon: typeof Info; iconColor: string }> = {
  success: {
    accent: 'border-l-success-500 ring-success-200',
    icon: CheckCircle2,
    iconColor: 'text-success-600',
  },
  warning: {
    accent: 'border-l-warning-500 ring-warning-200',
    icon: AlertTriangle,
    iconColor: 'text-warning-600',
  },
  danger: {
    accent: 'border-l-danger-500 ring-danger-200',
    icon: XCircle,
    iconColor: 'text-danger-600',
  },
  info: { accent: 'border-l-info-500 ring-info-200', icon: Info, iconColor: 'text-info-600' },
};

/**
 * How long each tone lives (FRONTEND_STANDARDS §3.7). A failure does **not** expire: a message
 * that leaves before it's read hasn't been delivered, and "we couldn't save your return" is
 * exactly the message a user must not miss. A toast carrying an Undo also stays put — the offer
 * is worthless if it vanishes while the user is still registering what happened.
 */
const TTL_MS: Record<ToastTone, number | null> = {
  success: 4000,
  info: 5000,
  warning: 8000,
  danger: null,
};

/** Cap the stack so a burst of failed requests can't bury the screen. */
const MAX_VISIBLE = 4;

/**
 * One toast provider for the whole app (FRONTEND_STANDARDS §3.7). Toasts carry transient action
 * outcomes ("Entity created"), stack, and never block layout. Persistent conditions use an inline
 * `Alert` instead.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: ReactNode, options: ToastOptions = {}) => {
    const tone = options.tone ?? 'info';
    const id = ++seq.current;
    setToasts((list) =>
      [...list, { id, tone, message, action: options.action }].slice(-MAX_VISIBLE),
    );
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (m, o) => show(m, { ...o, tone: 'success' }),
      error: (m, o) => show(m, { ...o, tone: 'danger' }),
      info: (m, o) => show(m, { ...o, tone: 'info' }),
      warning: (m, o) => show(m, { ...o, tone: 'warning' }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { accent, icon: Icon, iconColor } = toneStyles[toast.tone];
  const [paused, setPaused] = useState(false);
  const ttl = toast.action ? null : TTL_MS[toast.tone];

  useEffect(() => {
    if (ttl === null || paused) return;
    const timer = setTimeout(onDismiss, ttl);
    return () => clearTimeout(timer);
    // Re-arming on `paused` restarts the countdown when the pointer leaves, which is the
    // forgiving behaviour: someone reading a message shouldn't lose it mid-sentence.
  }, [ttl, paused, onDismiss]);

  return (
    // The handlers pause the countdown rather than doing anything. `focus` and `blur` are there
    // so a keyboard user reading the message keeps it on screen too, which is the point of
    // WCAG 2.2.1.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border border-gray-200 border-l-4 bg-white px-4 py-3 text-sm shadow-lg ring-1 ${accent}`}
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${iconColor}`} aria-hidden />
      <div className="flex-1">
        <div className="text-gray-800">{toast.message}</div>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              onDismiss();
            }}
            className="mt-1.5 inline-flex items-center gap-1 rounded text-sm font-medium text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <Undo2 size={13} aria-hidden />
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 text-gray-500 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
