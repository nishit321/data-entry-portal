import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Per-route error boundary (FRONTEND_STANDARDS §5). The shell mounts one of these inside the
 * content region and keys it on the pathname, so a crash swaps out the *page* and leaves the
 * navigation, top bar, and the user's session intact — their next click still works. The
 * root-level `ErrorBoundary` remains as the last resort for a crash in the shell itself.
 *
 * "Try again" re-mounts the subtree, which recovers from a transient render failure without a
 * full reload (and without the user losing their place in the app).
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error in route:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-50 text-danger-600">
          <AlertTriangle size={24} aria-hidden />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">This page ran into a problem</h1>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            Try loading it again, or move on and come back. If it keeps happening, let the portal
            team know.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload the app
          </Button>
        </div>
      </div>
    );
  }
}
