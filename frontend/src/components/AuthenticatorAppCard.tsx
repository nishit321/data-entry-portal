import { useState } from 'react';
import { strings } from '../lib/strings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { authApi } from '../lib/auth.api';
import { getErrorMessage } from '../lib/api';
import { Alert, Button, Card, Field, Input, useToast } from './ui';

/**
 * The authenticator-app second factor (Q8).
 *
 * Before this, the only second factor was a code sent by email, which means signing in depended on
 * a mail provider being up: when it is not, nobody gets in at all — not an operator with a deadline,
 * not an approver. An authenticator app needs nothing but the phone already in the user's hand.
 *
 * The screen is deliberately three separate moments rather than one form. Scanning a code,
 * proving the app holds it, and writing down the recovery codes are three different things a
 * person has to do, and running them together is how somebody ends up switching on a second
 * factor they have not actually stored anywhere.
 */

type Stage = 'idle' | 'scanning' | 'codes';

export function AuthenticatorAppCard() {
  const toast = useToast();
  const qc = useQueryClient();

  const [stage, setStage] = useState<Stage>('idle');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [enrolment, setEnrolment] = useState<{ qrSvg: string; secret: string } | null>(null);

  const status = useQuery({ queryKey: ['totp-status'], queryFn: authApi.totpStatus });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['totp-status'] });

  const begin = useMutation({
    mutationFn: authApi.beginTotp,
    onSuccess: (result) => {
      setError(null);
      setEnrolment({ qrSvg: result.qrSvg, secret: result.secret });
      setCode('');
      setStage('scanning');
    },
    onError: (err) => setError(getErrorMessage(err, "We couldn't start setting that up.")),
  });

  const confirm = useMutation({
    mutationFn: () => authApi.confirmTotp(code),
    onSuccess: (result) => {
      setError(null);
      setEnrolment(null);
      setRecoveryCodes(result.recoveryCodes);
      setStage('codes');
      refresh();
    },
    onError: (err) => setError(getErrorMessage(err, 'That code is wrong. Check the app.')),
  });

  const regenerate = useMutation({
    mutationFn: () => authApi.regenerateRecoveryCodes(code),
    onSuccess: (result) => {
      setError(null);
      setCode('');
      setRecoveryCodes(result.recoveryCodes);
      setStage('codes');
      refresh();
    },
    onError: (err) => setError(getErrorMessage(err, 'That code is wrong or has been used.')),
  });

  const disable = useMutation({
    mutationFn: () => authApi.disableTotp(code),
    onSuccess: () => {
      setError(null);
      setCode('');
      setStage('idle');
      toast.success('Your authenticator app has been removed.');
      refresh();
    },
    onError: (err) => setError(getErrorMessage(err, 'That code is wrong or has been used.')),
  });

  const data = status.data;
  const unavailable = data && !data.available;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-gray-500" aria-hidden />
        <h3 className="text-base font-semibold text-gray-900">Authenticator app</h3>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        A code from an app on your phone, instead of one sent to your email. It keeps working when
        email does not.
      </p>

      <div className="mt-4 space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {unavailable && (
          <Alert tone="info">
            Authenticator apps are not set up on this system yet. Ask the Authority to configure
            them.
          </Alert>
        )}

        {/* --- Already on ------------------------------------------------------------------- */}
        {data?.enabled && stage === 'idle' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <span className="flex items-center gap-2 text-sm text-gray-800">
                <ShieldCheck size={15} className="text-success-600" aria-hidden />
                <span className="font-medium">In use</span>
                <span className="text-gray-500">
                  {data.recoveryCodesRemaining} recovery{' '}
                  {data.recoveryCodesRemaining === 1 ? 'code' : 'codes'} left
                </span>
              </span>
            </div>

            {data.recoveryCodesRemaining <= 2 && (
              <Alert tone="warning">
                You are almost out of recovery codes. Without one, losing your phone means losing
                access to this account.
              </Alert>
            )}

            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
              }}
            >
              <Field
                label="Code from your app"
                htmlFor="totp-code"
                hint="Needed to change either of these, even though you are signed in."
              >
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={strings.example.oneTimeCode}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  isLoading={regenerate.isPending}
                  disabled={code.length < 6}
                  onClick={() => regenerate.mutate()}
                >
                  New recovery codes
                </Button>
                <Button
                  variant="danger"
                  isLoading={disable.isPending}
                  disabled={code.length < 6}
                  onClick={() => disable.mutate()}
                >
                  Remove the app
                </Button>
              </div>
            </form>
          </>
        )}

        {/* --- Not set up yet --------------------------------------------------------------- */}
        {!data?.enabled && stage === 'idle' && (
          <Button isLoading={begin.isPending} disabled={unavailable} onClick={() => begin.mutate()}>
            Set up an authenticator app
          </Button>
        )}

        {/* --- Scanning --------------------------------------------------------------------- */}
        {stage === 'scanning' && enrolment && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              confirm.mutate();
            }}
          >
            <div className="flex flex-wrap items-start gap-5">
              <img
                src={enrolment.qrSvg}
                width={168}
                height={168}
                alt="Scan this with your authenticator app to add this account."
                className="rounded border border-gray-200 bg-white p-2"
              />
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <p className="text-gray-700">
                  Scan this with Google Authenticator, Microsoft Authenticator, or any app that
                  takes a six-digit code.
                </p>
                <p className="text-gray-500">
                  If it cannot scan, type this in instead:
                  <br />
                  <code className="mt-1 inline-block break-all rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-800">
                    {enrolment.secret}
                  </code>
                </p>
              </div>
            </div>

            <Field
              label="Then enter the code it shows"
              htmlFor="totp-confirm"
              hint="Six digits. It changes every thirty seconds."
            >
              <Input
                id="totp-confirm"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={strings.example.oneTimeCode}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>

            <div className="flex gap-2">
              <Button type="submit" isLoading={confirm.isPending} disabled={code.length < 6}>
                Turn it on
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setStage('idle');
                  setEnrolment(null);
                  setError(null);
                }}
              >
                {strings.action.cancel}
              </Button>
            </div>
          </form>
        )}

        {/* --- Recovery codes, shown once --------------------------------------------------- */}
        {stage === 'codes' && (
          <div className="space-y-3">
            <Alert tone="warning">
              Save these somewhere safe now. They are the only way back in if you lose your phone,
              and this is the only time they are shown.
            </Alert>
            <ul className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-sm text-gray-800 sm:grid-cols-3">
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
                  toast.success('Copied.');
                }}
              >
                Copy them
              </Button>
              <Button
                onClick={() => {
                  setRecoveryCodes([]);
                  setCode('');
                  setStage('idle');
                }}
              >
                I have saved them
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
