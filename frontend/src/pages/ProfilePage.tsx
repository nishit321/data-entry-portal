import { Page, PageHeader } from '../components/ui';
import { PhoneNumberCard } from '../components/PhoneNumberCard';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/types';

/**
 * The signed-in person's own details.
 *
 * Small on purpose. The portal had nowhere at all for a user to see or change anything about
 * themselves, and a mobile number is the first thing that needs one. Anything else self-service
 * belongs here rather than in a second screen.
 */
export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  if (!user) return null;

  return (
    <Page>
      <PageHeader
        title="Your details"
        description="How the Authority reaches you about your returns."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Name</dt>
              <dd className="mt-0.5 text-gray-900">
                {user.firstName} {user.lastName}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Email</dt>
              <dd className="mt-0.5 text-gray-900">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Role</dt>
              <dd className="mt-0.5 text-gray-900">{ROLE_LABELS[user.role]}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-gray-500">
            Your name, email and role are set by whoever administers your account. Ask them if any
            of it is wrong.
          </p>
        </div>

        <PhoneNumberCard user={user} onChanged={() => void refreshUser()} />
      </div>
    </Page>
  );
}
