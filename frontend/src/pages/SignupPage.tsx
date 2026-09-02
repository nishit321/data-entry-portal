import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthLayout } from '../components/auth/AuthLayout';
import { Alert, Button, FormField, Input, PasswordInput } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../lib/auth.api';
import { getErrorMessage } from '../lib/api';

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type FormValues = z.infer<typeof schema>;

export function SignupPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();

  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError('');
    try {
      const auth = await authApi.signup(values);
      setSession(auth);
      navigate('/', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "We couldn't create your account. Try again."));
    }
  });

  return (
    <AuthLayout
      title="Create account"
      subtitle="Register to submit and track your data."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <FormField
            htmlFor="firstName"
            label="First name"
            error={errors.firstName?.message}
            required
          >
            {(field) => (
              <Input
                autoComplete="given-name"
                placeholder="e.g. Grace"
                {...field}
                {...register('firstName')}
              />
            )}
          </FormField>
          <FormField htmlFor="lastName" label="Last name" error={errors.lastName?.message} required>
            {(field) => (
              <Input
                autoComplete="family-name"
                placeholder="e.g. Deng"
                {...field}
                {...register('lastName')}
              />
            )}
          </FormField>
        </div>
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
        <FormField htmlFor="password" label="Password" error={errors.password?.message} required>
          {(field) => (
            <PasswordInput
              autoComplete="new-password"
              placeholder="At least 8 characters"
              {...field}
              {...register('password')}
            />
          )}
        </FormField>
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Create account <ArrowRight size={16} className="ml-1.5" />
        </Button>
      </form>
    </AuthLayout>
  );
}
