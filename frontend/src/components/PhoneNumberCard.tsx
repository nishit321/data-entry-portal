import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, ShieldCheck } from 'lucide-react';
import { authApi } from '../lib/auth.api';
import { getErrorMessage } from '../lib/api';
import { formatPhone } from '../lib/phone';
import { Alert, Button, Card, ConfirmDialog, Field, Input, useToast } from './ui';
import type { User } from '../lib/types';

/**
 * The signed-in user's phone number, and proving it is theirs.
 *
 * Two steps rather than one, and the second is the point. A mistyped email address bounces and
 * somebody notices; a mistyped phone number is a working number belonging to a stranger, and the
 * Authority's deadline reminders go there instead — quietly, for as long as the record stands. So
 * the number is not saved until a code sent to it comes back.
 */
export function PhoneNumberCard({ user, onChanged }: { user: User; onChanged: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const availability = useQuery({
    queryKey: ['phone-availability'],
    queryFn: authApi.phoneAvailability,
    staleTime: 5 * 60_000,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    onChanged();
  };

  const startMutation = useMutation({
    mutationFn: () => authApi.startPhoneVerification(phone),
    onSuccess: (result) => {
      setError(null);
      setSentTo(result.maskedPhone);
      setCode('');
    },
    onError: (err) => setError(getErrorMessage(err, "We couldn't send a code to that number.")),
  });

  const confirmMutation = useMutation({
    mutationFn: () => authApi.confirmPhone(code),
    onSuccess: () => {
      setError(null);
      setSentTo(null);
      setPhone('');
      toast.success('Your phone number is confirmed.');
      refresh();
    },
    onError: (err) => setError(getErrorMessage(err, 'That code is wrong or has expired.')),
  });

  const removeMutation = useMutation({
    mutationFn: authApi.removePhone,
    onSuccess: () => {
      setConfirmRemove(false);
      toast.success('Your phone number has been removed.');
      refresh();
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove that number.")),
  });

  const gatewayOff = availability.data && !availability.data.available;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Phone size={16} className="text-gray-500" aria-hidden />
        <h3 className="text-base font-semibold text-gray-900">Mobile number</h3>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Used for the few messages that cannot wait: a return sent back for changes, a compliance
        case opened, a licence about to expire. Everything else stays in the portal and your email.
      </p>

      <div className="mt-4 space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {gatewayOff && (
          <Alert tone="info">
            Text messages are not set up on this system yet, so a number cannot be confirmed.
          </Alert>
        )}

        {user.phone && !sentTo ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="flex items-center gap-2 text-sm text-gray-800">
              <ShieldCheck size={15} className="text-success-600" aria-hidden />
              <span className="font-medium">{formatPhone(user.phone)}</span>
              <span className="text-gray-500">confirmed</span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmRemove(true)}
              isLoading={removeMutation.isPending}
            >
              Remove
            </Button>
          </div>
        ) : null}

        {sentTo ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              confirmMutation.mutate();
            }}
          >
            <Field
              label="Confirmation code"
              htmlFor="phone-code"
              hint={`We sent a six-digit code to the number ending ${sentTo.replace(/\D/g, '')}. It expires in ten minutes.`}
            >
              <Input
                id="phone-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                type="submit"
                isLoading={confirmMutation.isPending}
                disabled={code.length < 4}
              >
                Confirm
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setSentTo(null);
                  setError(null);
                }}
              >
                Use a different number
              </Button>
            </div>
          </form>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              startMutation.mutate();
            }}
          >
            <Field
              label={user.phone ? 'Change your number' : 'Add a number'}
              htmlFor="phone-number"
              hint="Start with 0 for a South Sudanese number, or include the country code."
            >
              <Input
                id="phone-number"
                type="tel"
                autoComplete="tel"
                placeholder="0920 000 000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={gatewayOff}
              />
            </Field>
            <Button
              type="submit"
              isLoading={startMutation.isPending}
              disabled={phone.trim().length < 6 || gatewayOff}
            >
              Send me a code
            </Button>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove your mobile number?"
        message="You will stop receiving text messages about returns sent back, compliance cases, and expiring licences. They will still reach you in the portal and by email."
        confirmLabel="Remove"
        isLoading={removeMutation.isPending}
        onConfirm={() => removeMutation.mutate()}
        onClose={() => setConfirmRemove(false)}
      />
    </Card>
  );
}
