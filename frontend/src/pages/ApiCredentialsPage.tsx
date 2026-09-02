import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, RefreshCw, ShieldOff, X } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Page,
  PageHeader,
  Skeleton,
  useToast,
} from '../components/ui';
import { apiClientKeys, apiClientsApi, type ApiClientInput } from '../lib/api-clients.api';
import { getErrorMessage } from '../lib/api';
import { formatDate, formatDateTime, joinMeta } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import {
  API_CLIENT_STATUS_LABELS,
  API_SCOPES,
  API_SCOPE_HINTS,
  API_SCOPE_LABELS,
  isOperatorRole,
  type ApiClient,
  type ApiClientWithSecret,
  type ApiScope,
} from '../lib/types';

const BLANK = {
  name: '',
  scopes: [] as ApiScope[],
  certFingerprint: '',
  allowedCidrs: '',
  rateLimitPerMinute: '60',
};

/**
 * Machine credentials for an operator's own systems (Q10, Phase 3).
 *
 * The screen is built around one fact: the secret is shown once. Everything about how it is
 * presented — the dialog that will not close by accident, the copy button, the warning — exists
 * because there is no second chance to read it.
 */
export function ApiCredentialsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const isOperator = !!user && isOperatorRole(user.role);
  const canManage = user?.role === 'OPERATOR_ADMIN' || user?.role === 'ADMIN';

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [issued, setIssued] = useState<ApiClientWithSecret | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiClient | null>(null);
  const [pendingRotate, setPendingRotate] = useState<ApiClient | null>(null);

  const listQuery = useQuery({ queryKey: apiClientKeys.all, queryFn: () => apiClientsApi.list() });
  const clients = listQuery.data ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: apiClientKeys.all });

  const create = useMutation({
    mutationFn: () => {
      const input: ApiClientInput = {
        name: form.name.trim(),
        scopes: form.scopes,
        certFingerprint: form.certFingerprint.trim() || undefined,
        allowedCidrs: form.allowedCidrs
          .split(/[\n,]/)
          .map((v) => v.trim())
          .filter(Boolean),
        rateLimitPerMinute: Number(form.rateLimitPerMinute) || 60,
      };
      return apiClientsApi.create(input);
    },
    onSuccess: (client) => {
      refresh();
      setOpen(false);
      setForm(BLANK);
      setIssued(client);
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't issue that credential.")),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => apiClientsApi.rotate(id),
    onSuccess: (client) => {
      refresh();
      setPendingRotate(null);
      setIssued(client);
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't rotate that secret.")),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiClientsApi.revoke(id),
    onSuccess: () => {
      refresh();
      setPendingRevoke(null);
      toast.success('Credential revoked.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't revoke that credential.")),
  });

  const toggleScope = (scope: ApiScope, on: boolean) =>
    setForm({
      ...form,
      scopes: on ? [...form.scopes, scope] : form.scopes.filter((s) => s !== scope),
    });

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copied.`);
    } catch {
      toast.error('Your browser would not let us copy that. Select it and copy by hand.');
    }
  };

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="API credentials"
          description={
            isOperator
              ? 'Credentials your own systems use to file returns without anyone typing them in.'
              : 'Machine credentials issued to operators, and what each one is allowed to do.'
          }
          actions={
            canManage && (
              <Button icon={Plus} onClick={() => setOpen(true)}>
                Issue a credential
              </Button>
            )
          }
        />

        {listQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : clients.length === 0 ? (
          <Card>
            <EmptyState
              icon={KeyRound}
              message="No credentials have been issued. Returns can still be filed on screen as usual."
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {clients.map((client) => (
              <Card key={client.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-gray-900">{client.name}</h3>
                      <Badge
                        tone={
                          client.status === 'ACTIVE'
                            ? 'success'
                            : client.status === 'SUSPENDED'
                              ? 'warning'
                              : 'gray'
                        }
                      >
                        {API_CLIENT_STATUS_LABELS[client.status]}
                      </Badge>
                      {!isOperator && <Badge tone="info">{client.entity.name}</Badge>}
                    </div>

                    <p className="mt-1 font-mono text-xs text-gray-600">{client.clientId}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {joinMeta(
                        `secret ends ${client.secretLast4}`,
                        client.expiresAt && `expires ${formatDate(client.expiresAt)}`,
                        client.lastUsedAt
                          ? `last used ${formatDateTime(client.lastUsedAt)}`
                          : 'never used',
                      )}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {client.scopes.map((scope) => (
                        <Badge key={scope} tone="gray">
                          {API_SCOPE_LABELS[scope]}
                        </Badge>
                      ))}
                    </div>

                    <p className="mt-2 text-xs text-gray-500">
                      {joinMeta(
                        client.allowedCidrs.length > 0
                          ? `Only from ${client.allowedCidrs.join(', ')}`
                          : 'Usable from any address',
                        client.certFingerprint
                          ? 'bound to a client certificate'
                          : 'no client certificate required',
                      )}
                    </p>
                  </div>

                  {canManage && client.status !== 'REVOKED' && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={RefreshCw}
                        onClick={() => setPendingRotate(client)}
                      >
                        Rotate secret
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={ShieldOff}
                        onClick={() => setPendingRevoke(client)}
                      >
                        Revoke
                      </Button>
                    </div>
                  )}
                </div>

                {client.allowedCidrs.length === 0 && client.status === 'ACTIVE' && (
                  <p className="mt-3 text-xs text-warning-700">
                    This credential can be used from anywhere. If you know the addresses your
                    systems call from, adding them here means a leaked secret is not enough on its
                    own.
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={open} title="Issue a credential" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Field
            label="What is it for"
            htmlFor="cred-name"
            hint="The name that appears against anything this credential files."
          >
            <Input
              id="cred-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-700">What it may do</legend>
            {API_SCOPES.map((scope) => (
              <Checkbox
                key={scope}
                checked={form.scopes.includes(scope)}
                onChange={(on) => toggleScope(scope, on)}
                label={API_SCOPE_LABELS[scope]}
                hint={API_SCOPE_HINTS[scope]}
              />
            ))}
          </fieldset>

          <Field
            label="Addresses it may be used from"
            htmlFor="cred-cidrs"
            hint="One per line, e.g. 203.0.113.10 or 203.0.113.0/24. Leave blank to allow any address."
          >
            <Input
              id="cred-cidrs"
              value={form.allowedCidrs}
              onChange={(e) => setForm({ ...form, allowedCidrs: e.target.value })}
            />
          </Field>

          <Field
            label="Client certificate fingerprint"
            htmlFor="cred-cert"
            hint="Optional. The SHA-256 fingerprint of the certificate your system presents. When set, no other certificate will do."
          >
            <Input
              id="cred-cert"
              value={form.certFingerprint}
              onChange={(e) => setForm({ ...form, certFingerprint: e.target.value })}
            />
          </Field>

          <Field label="Requests a minute" htmlFor="cred-rate">
            <Input
              id="cred-rate"
              type="number"
              min="1"
              value={form.rateLimitPerMinute}
              onChange={(e) => setForm({ ...form, rateLimitPerMinute: e.target.value })}
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={create.isPending}
              disabled={form.name.trim().length < 2 || form.scopes.length === 0}
              onClick={() => create.mutate()}
            >
              Issue it
            </Button>
          </div>
        </div>
      </Modal>

      {/* The one time the secret is ever visible. */}
      <Modal
        open={issued !== null}
        title="Copy the secret now"
        onClose={() => setIssued(null)}
        size="lg"
      >
        <div className="space-y-4">
          <Alert tone="warning">
            This is the only time this secret is shown. It is stored as a hash, so nobody can show
            it to you again: not an administrator, and not us. If it is lost, rotate the credential.
          </Alert>

          {(
            [
              ['Client id', issued?.clientId ?? ''],
              ['Client secret', issued?.clientSecret ?? ''],
            ] as const
          ).map(([label, value]) => (
            <Field key={label} label={label} htmlFor={`issued-${label}`}>
              <div className="flex gap-2">
                <Input id={`issued-${label}`} readOnly value={value} className="font-mono" />
                <Button variant="secondary" icon={Copy} onClick={() => void copy(value, label)}>
                  Copy
                </Button>
              </div>
            </Field>
          ))}

          <div className="flex justify-end">
            <Button icon={X} onClick={() => setIssued(null)}>
              I have copied it
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingRotate !== null}
        title="Rotate this secret?"
        confirmLabel="Rotate"
        isLoading={rotate.isPending}
        message="The current secret stops working immediately, with no overlap. Anything still using it will start failing until it is updated."
        onConfirm={() => pendingRotate && rotate.mutate(pendingRotate.id)}
        onClose={() => setPendingRotate(null)}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="Revoke this credential?"
        confirmLabel="Revoke"
        tone="danger"
        isLoading={revoke.isPending}
        message="It stops working immediately and cannot be brought back. Returns it has already filed are unaffected. To use the API again, issue a new credential."
        onConfirm={() => pendingRevoke && revoke.mutate(pendingRevoke.id)}
        onClose={() => setPendingRevoke(null)}
      />
    </Page>
  );
}
