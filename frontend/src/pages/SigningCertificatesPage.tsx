import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Page,
  PageHeader,
  Skeleton,
  Textarea,
  useToast,
} from '../components/ui';
import { signaturesApi, signaturesKeys } from '../lib/signatures.api';
import { getErrorMessage } from '../lib/api';
import { formatDate, joinMeta } from '../lib/format';
import type { SigningCertificate } from '../lib/types';

const BLANK = { label: '', certificatePem: '' };

/**
 * Signing certificates (Q6, Phase 3).
 *
 * The upgrade path Q6 asked for: a return has always carried the signer's typed name and a
 * timestamp, and a certificate adds a signature anyone can check again years later. Registering one
 * is optional — a return signed by name alone is still a signed return.
 *
 * Only the public half is ever sent here. The private key stays with the signer, which is the only
 * arrangement under which a signature means anything.
 */
export function SigningCertificatesPage() {
  const qc = useQueryClient();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [pendingRevoke, setPendingRevoke] = useState<SigningCertificate | null>(null);

  const listQuery = useQuery({
    queryKey: signaturesKeys.certificates,
    queryFn: () => signaturesApi.listCertificates(),
  });
  const certificates = listQuery.data ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: signaturesKeys.certificates });

  const register = useMutation({
    mutationFn: () =>
      signaturesApi.register({
        label: form.label.trim(),
        certificatePem: form.certificatePem.trim(),
      }),
    onSuccess: () => {
      refresh();
      setOpen(false);
      setForm(BLANK);
      toast.success('Certificate registered.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't register that certificate.")),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => signaturesApi.revoke(id),
    onSuccess: () => {
      refresh();
      setPendingRevoke(null);
      toast.success('Certificate revoked.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't revoke that certificate.")),
  });

  const expired = (cert: SigningCertificate) => new Date(cert.notAfter).getTime() < Date.now();

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Signing certificates"
          description="Register a certificate to sign your returns with, so anyone can check later that a return has not been altered since you filed it."
          actions={
            <Button icon={Plus} onClick={() => setOpen(true)}>
              Register a certificate
            </Button>
          }
        />

        <Alert tone="info">
          <p className="font-medium">Only the public half goes here.</p>
          <p className="mt-1 text-sm">
            Your private key stays with you and is never sent to the portal. That is what makes a
            signature yours: nobody else, including the Authority, can produce one.
          </p>
        </Alert>

        <Card>
          {listQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : certificates.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              message="No certificates registered. Returns you file are still signed with your name and the time you filed them."
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {certificates.map((cert) => (
                <li key={cert.id} className="flex items-start gap-4 py-3">
                  <Badge
                    tone={
                      cert.status === 'REVOKED' ? 'gray' : expired(cert) ? 'warning' : 'success'
                    }
                  >
                    {cert.status === 'REVOKED' ? 'Revoked' : expired(cert) ? 'Expired' : 'In use'}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{cert.label}</p>
                    <p className="truncate text-xs text-gray-500">{cert.subject}</p>
                    <p className="truncate text-xs text-gray-500">
                      {joinMeta(
                        cert.algorithm,
                        `valid to ${formatDate(cert.notAfter)}`,
                        cert.selfSigned && 'self-signed',
                      )}
                    </p>
                    <p className="mt-1 truncate font-mono text-xs text-gray-500">
                      {cert.fingerprint}
                    </p>
                  </div>
                  {cert.status !== 'REVOKED' && (
                    <IconButton
                      icon={Trash2}
                      label={`Revoke ${cert.label}`}
                      variant="danger"
                      onClick={() => setPendingRevoke(cert)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="flex items-start gap-2 text-xs text-gray-500">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          Revoking a certificate stops it signing anything new. Returns already signed with it keep
          their signature, and still verify. Revocation is about what happens next, not about
          disowning what was signed while the certificate was good.
        </p>
      </div>

      <Modal open={open} title="Register a signing certificate" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Field
            label="Name it"
            htmlFor="cert-label"
            hint="For your own reference, e.g. which device or person holds the key."
          >
            <Input
              id="cert-label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </Field>
          <Field
            label="Certificate"
            htmlFor="cert-pem"
            hint="Paste the PEM text, beginning BEGIN CERTIFICATE. Never paste a private key."
          >
            <Textarea
              id="cert-pem"
              rows={8}
              className="font-mono text-xs"
              placeholder="-----BEGIN CERTIFICATE-----"
              value={form.certificatePem}
              onChange={(e) => setForm({ ...form, certificatePem: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={register.isPending}
              disabled={form.label.trim().length < 2 || form.certificatePem.trim().length < 64}
              onClick={() => register.mutate()}
            >
              Register
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="Revoke this certificate?"
        confirmLabel="Revoke"
        tone="danger"
        isLoading={revoke.isPending}
        message="It cannot sign anything new after this, and it cannot be brought back. Returns already signed with it are unaffected."
        onConfirm={() => pendingRevoke && revoke.mutate(pendingRevoke.id)}
        onClose={() => setPendingRevoke(null)}
      />
    </Page>
  );
}
