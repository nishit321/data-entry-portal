import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Route-level error boundary (FRONTEND_STANDARDS §5). Catches render/runtime crashes and
 * shows a friendly fallback with a reload, instead of a blank white screen. A crash in one
 * page never takes down the shell.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-50 text-danger-600">
          <AlertTriangle size={24} aria-hidden />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">We couldn&apos;t load this page</h1>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Try again. If it keeps happening, tell the portal team.
          </p>
        </div>
        <Button onClick={() => window.location.reload()}>Reload the page</Button>
      </div>
    );
  }
}
