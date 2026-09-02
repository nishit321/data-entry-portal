import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthLayout } from '../components/auth/AuthLayout';
import { Alert, Button, FormField, Input } from '../components/ui';
import { authApi } from '../lib/auth.api';
import { getErrorMessage } from '../lib/api';

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError('');
    setMessage('');
    try {
      const res = await authApi.forgotPassword(email);
      setMessage(res.message);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  });

  return (
    <AuthLayout
      title="Forgot password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link
          to="/login"
          className="inline-flex items-center font-medium text-brand hover:underline"
        >
          <ArrowLeft size={15} className="mr-1" /> Back to sign in
        </Link>
      }
    >
      {message ? (
        <Alert tone="success">{message}</Alert>
      ) : (
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
          <Button type="submit" className="w-full" isLoading={isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
