import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthLayout } from '../components/auth/AuthLayout';
import { Alert, Button, FormField, PasswordInput } from '../components/ui';
import { authApi } from '../lib/auth.api';
import { getErrorMessage } from '../lib/api';

const schema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm: z.string().min(1, 'Confirm your password.'),
  })
  .refine((data) => data.password === data.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError('');
    try {
      const res = await authApi.resetPassword(token, password);
      setMessage(res.message);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  });

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose a strong password you haven't used before."
      footer={
        <Link
          to="/login"
          className="inline-flex items-center font-medium text-brand hover:underline"
        >
          <ArrowLeft size={15} className="mr-1" /> Back to sign in
        </Link>
      }
    >
      {!token ? (
        <Alert tone="danger">This reset link is incomplete. Request a new one.</Alert>
      ) : message ? (
        <Alert tone="success">{message}</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField
            htmlFor="password"
            label="New password"
            error={errors.password?.message}
            required
          >
            {(field) => (
              <PasswordInput
                autoComplete="new-password"
                placeholder="At least 8 characters"
                {...field}
                {...register('password')}
              />
            )}
          </FormField>
          <FormField
            htmlFor="confirm"
            label="Confirm new password"
            error={errors.confirm?.message}
            required
          >
            {(field) => (
              <PasswordInput
                autoComplete="new-password"
                placeholder="Re-enter your password"
                {...field}
                {...register('confirm')}
              />
            )}
          </FormField>
          <Button type="submit" className="w-full" isLoading={isSubmitting}>
            Reset password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
