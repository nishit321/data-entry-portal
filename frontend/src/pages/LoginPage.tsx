import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthLayout } from '../components/auth/AuthLayout';
import { Alert, Button, FormField, Input, PasswordInput } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../lib/auth.api';
import { getErrorMessage } from '../lib/api';
import { isMfaChallenge, type MfaChallenge } from '../lib/types';

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

// How long to wait before the user can request another code.
const RESEND_COOLDOWN_SEC = 30;

export function LoginPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/';

  const [error, setError] = useState('');
  // When set, the password step passed and we're awaiting the OTP.
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  // The address the code was emailed to, shown on the verification step.
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  // Seconds left before Resend is allowed again.
  const [resendIn, setResendIn] = useState(0);

  // (Re)start the cooldown whenever a fresh challenge is issued (login or resend).
  useEffect(() => {
    if (challenge) setResendIn(RESEND_COOLDOWN_SEC);
  }, [challenge]);

  // Tick the cooldown down to zero, one second at a time.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError('');
    try {
      const result = await authApi.login(email, password);
      if (isMfaChallenge(result)) {
        setChallenge(result);
        setSentTo(email);
        setCode('');
        return;
      }
      setSession(result);
      navigate(from, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "We couldn't sign you in. Try again."));
    }
  });

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setError('');
    setVerifying(true);
    try {
      const auth = await authApi.verifyOtp(challenge.challengeId, code.trim());
      setSession(auth);
      navigate(from, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, 'That code is wrong or has expired.'));
    } finally {
      setVerifying(false);
    }
  };

  const onResend = async () => {
    if (!challenge) return;
    setError('');
    try {
      const fresh = await authApi.resendOtp(challenge.challengeId);
      setChallenge(fresh);
      setCode('');
    } catch (err) {
      setError(getErrorMessage(err, "We couldn't send a new code. Try again."));
    }
  };

  if (challenge) {
    return (
      <AuthLayout
        title="Verify it's you"
        subtitle={
          sentTo
            ? `We've emailed a one-time code to ${sentTo}. Enter it below to finish signing in.`
            : 'Enter the one-time code we emailed you to finish signing in.'
        }
        footer={
          <button
            type="button"
            onClick={() => {
              setChallenge(null);
              setError('');
            }}
            className="font-medium text-brand hover:underline"
          >
            Back to sign in
          </button>
        }
      >
        <form onSubmit={onVerify} className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          {challenge.devOtp && (
            <Alert tone="info">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={15} /> Demo mode. Your code is{' '}
                <span className="font-mono font-semibold">{challenge.devOtp}</span>
              </span>
            </Alert>
          )}
          <FormField htmlFor="otp" label="One-time code" required>
            {(field) => (
              <Input
                {...field}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </FormField>
          <Button type="submit" className="w-full" isLoading={verifying} disabled={code.length < 4}>
            Verify <ArrowRight size={16} className="ml-1.5" />
          </Button>
          <div className="text-center text-sm text-gray-500">
            Didn&apos;t get a code?{' '}
            <button
              type="button"
              onClick={onResend}
              disabled={resendIn > 0}
              className="font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:text-gray-500 disabled:no-underline"
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend'}
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Sign in to continue."
      footer={
        <>
          <div>
            Don&apos;t have an account?{' '}
            <Link to="/signup" className="font-medium text-brand hover:underline">
              Create one
            </Link>
          </div>
          {/* The complaint desk needs no account, so it has to be reachable from the front door. */}
          <div className="mt-2">
            Reporting a problem with a service?{' '}
            <Link to="/complaints/file" className="font-medium text-brand hover:underline">
              Tell the Authority
            </Link>
          </div>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField htmlFor="email" label="Email" error={errors.email?.message} required>
          {(field) => (
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...field}
              {...register('email')}
            />
          )}
        </FormField>
        <div>
          <FormField htmlFor="password" label="Password" error={errors.password?.message} required>
            {(field) => (
              <PasswordInput
                autoComplete="current-password"
                placeholder="••••••••"
                {...field}
                {...register('password')}
              />
            )}
          </FormField>
          <div className="mt-2 text-right">
            <Link to="/forgot-password" className="text-sm font-medium text-brand hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Sign in <ArrowRight size={16} className="ml-1.5" />
        </Button>
      </form>
    </AuthLayout>
  );
}
