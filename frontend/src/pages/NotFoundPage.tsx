import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui';

/** Real 404 for unknown routes — never a silent redirect (FRONTEND_STANDARDS §5). */
export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-gray-50 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Compass size={28} aria-hidden />
      </div>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">404</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Page not found</h1>
        <p className="mt-1.5 max-w-sm text-sm text-gray-500">
          This page doesn&apos;t exist, or you may not have access to it. Check the link and try
          again.
        </p>
      </div>
      <Button onClick={() => navigate('/')}>Back to dashboard</Button>
    </div>
  );
}
