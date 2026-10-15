import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CircleDollarSign, Download, Percent, Plus, Scale, Undo2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Combobox,
  DatePicker,
  EmptyState,
  Field,
  FilterField,
  IconButton,
  Input,
  Modal,
  Page,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  StatCard,
  Textarea,
  useToast,
} from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { strings } from '../lib/strings';
import { getErrorMessage } from '../lib/api';
import { entityPicker, periodPicker } from '../lib/pickers';
import { formatDate, formatSsp } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { isOperatorRole, type Tone } from '../lib/types';
import {
  CHARGE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  chargeLabel,
  paymentKeys,
  paymentsApi,
  type Charge,
  type ChargeStatus,
  type Payment,
  type PaymentFilters,
  type PaymentMethod,
} from '../lib/payments.api';

const STATUS_TONE: Record<ChargeStatus, Tone> = {
  UNPAID: 'warning',
  PART_PAID: 'info',
  PAID: 'success',
  // Money is owed back, or carried. Worth a look, not an alarm.
  OVERPAID: 'info',
};

const METHOD_OPTIONS = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => ({
  value: m,
  label: PAYMENT_METHOD_LABELS[m],
}));

const PAGE_SIZE = 20;

function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/** Today in the browser's own calendar, for the latest date a payment can have arrived. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

/**
 * Money received against levies and penalties (NCA, October 2026: "amounts paid, outstanding
 * balances, and payment rates").
 *
 * Three readings of the same record, top to bottom: how much is owed and how much has arrived,
 * what each operator and each charge stands at, and the payments themselves with their receipts.
 *
 * An operator sees the same screen held to its own record, and cannot enter anything: a payment
 * is recorded by the Authority against the bank statement, because an operator saying it has paid
 * is not evidence that it has.
 */
export function PaymentsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const isOperator = !!user && isOperatorRole(user.role);
  const canHandle = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';

  const [entityId, setEntityId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [page, setPage] = useState(1);
  const filters: PaymentFilters = {
    entityId: isOperator ? undefined : entityId || undefined,
    periodId: periodId || undefined,
  };

  const balancesQuery = useQuery({
    queryKey: paymentKeys.balances(filters),
    queryFn: () => paymentsApi.balances(filters),
  });
  const listQuery = useQuery({
    queryKey: paymentKeys.list({ ...filters, page, pageSize: PAGE_SIZE }),
    queryFn: () => paymentsApi.list({ ...filters, page, pageSize: PAGE_SIZE }),
  });

  // `null` is closed; `'pick'` opens the dialog with a choice of charge; a charge opens it preset.
  const [recording, setRecording] = useState<Charge | 'pick' | null>(null);
  const [reversing, setReversing] = useState<Payment | null>(null);

  const download = useMutation({
    mutationFn: paymentsApi.downloadReceipt,
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't download that receipt.")),
  });

  const b = balancesQuery.data;
  const t = b?.totals;

  const chargeColumns: Column<Charge>[] = [
    ...(isOperator
      ? []
      : [
          {
            header: 'Operator',
            cell: (c: Charge) => <span className="font-medium text-gray-900">{c.entity.name}</span>,
          },
        ]),
    {
      header: 'For',
      width: '11rem',
      cell: (c) => chargeLabel(c.kind, c.period.label),
    },
    { header: 'Due', width: '9rem', align: 'right', cell: (c) => formatSsp(c.due) },
    { header: 'Received', width: '9rem', align: 'right', cell: (c) => formatSsp(c.paid) },
    {
      header: 'Outstanding',
      width: '9rem',
      align: 'right',
      cell: (c) => (
        <span className={c.outstanding > 0 ? 'font-medium text-gray-900' : 'text-gray-500'}>
          {formatSsp(c.outstanding)}
        </span>
      ),
    },
    {
      header: 'Status',
      width: '9rem',
      cell: (c) => (
        <Badge tone={STATUS_TONE[c.status]}>
          {CHARGE_STATUS_LABELS[c.status]}
          {c.status === 'OVERPAID' ? ` by ${formatSsp(c.overpaid)}` : ''}
        </Badge>
      ),
    },
    ...(canHandle
      ? [
          {
            header: 'Actions',
            align: 'right' as const,
            width: '6rem',
            cell: (c: Charge) => (
              <div className="flex justify-end">
                <IconButton
                  icon={Plus}
                  label={`Record a payment for ${c.entity.name}, ${chargeLabel(c.kind, c.period.label)}`}
                  onClick={() => setRecording(c)}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  const paymentColumns: Column<Payment>[] = [
    {
      header: 'Receipt',
      width: '12rem',
      cell: (p) => (
        <span className={p.reversedAt ? 'text-gray-500 line-through' : 'font-medium text-gray-900'}>
          {p.receiptNumber}
        </span>
      ),
    },
    ...(isOperator ? [] : [{ header: 'Operator', cell: (p: Payment) => p.entity.name }]),
    {
      header: 'For',
      width: '11rem',
      cell: (p) => chargeLabel(p.kind, p.period?.label ?? p.enforcementCase?.period.label),
    },
    { header: 'Amount', width: '9rem', align: 'right', cell: (p) => formatSsp(p.amount) },
    { header: 'Received', width: '8rem', cell: (p) => formatDate(p.paidOn) },
    {
      header: 'Method',
      width: '8rem',
      hideOnMobile: true,
      cell: (p) => PAYMENT_METHOD_LABELS[p.method],
    },
    { header: 'Bank reference', width: '10rem', hideOnMobile: true, cell: (p) => p.bankReference },
    {
      header: 'Status',
      width: '7rem',
      cell: (p) =>
        p.reversedAt ? <Badge tone="gray">Reversed</Badge> : <Badge tone="success">Received</Badge>,
    },
    {
      header: 'Actions',
      align: 'right',
      width: '6rem',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <IconButton
            icon={Download}
            label={`Download receipt ${p.receiptNumber}`}
            onClick={() => download.mutate(p)}
          />
          {canHandle && !p.reversedAt && (
            <IconButton
              icon={Undo2}
              label={`Reverse receipt ${p.receiptNumber}`}
              variant="danger"
              disabled={p.recordedBy.id === user?.id}
              disabledReason="You recorded this payment, so somebody else has to reverse it."
              onClick={() => setReversing(p)}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Payments"
          description={
            isOperator
              ? 'What your operator owes in levy and penalties, what the Authority has received, and your receipts.'
              : 'Levy and penalty payments received, recorded against the bank statement, and what each operator still owes.'
          }
          actions={
            canHandle ? (
              <Button
                icon={Plus}
                onClick={() => setRecording('pick')}
                disabled={!b || b.charges.length === 0}
              >
                Record a payment
              </Button>
            ) : undefined
          }
        />

        <div className="flex flex-wrap gap-4">
          {!isOperator && (
            <FilterField label={strings.field.operator} width="lg">
              <Combobox
                aria-label={strings.filter.byOperator}
                emptyLabel="All operators"
                placeholder={strings.search.operators}
                source={entityPicker}
                value={entityId}
                onChange={(v) => {
                  setEntityId(v);
                  setPage(1);
                }}
              />
            </FilterField>
          )}
          <FilterField label={strings.field.reportingPeriod} width="lg">
            <Combobox
              aria-label="Choose a reporting period"
              emptyLabel="Every period"
              placeholder={strings.search.periods}
              source={periodPicker}
              value={periodId}
              onChange={(v) => {
                setPeriodId(v);
                setPage(1);
              }}
            />
          </FilterField>
        </div>

        {balancesQuery.isLoading || !t ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Due" value={formatSsp(t.due)} icon={Scale} tone="brand" />
            <StatCard
              label="Received"
              value={formatSsp(t.paid)}
              hint={t.overpaid > 0 ? `${formatSsp(t.overpaid)} more than was due` : undefined}
              icon={Banknote}
              tone="success"
            />
            <StatCard
              label="Outstanding"
              value={formatSsp(t.outstanding)}
              icon={CircleDollarSign}
              tone={t.outstanding > 0 ? 'warning' : 'gray'}
            />
            <StatCard
              label="Payment rate"
              value={percent(t.paymentRate)}
              hint={`${t.chargesSettled} of ${t.charges} charges settled`}
              icon={Percent}
              tone="info"
            />
          </div>
        )}

        {!isOperator && !entityId && b && b.operators.length > 0 && (
          <Card>
            <h3 className="text-base font-semibold text-gray-900">By operator</h3>
            <p className="mt-1 text-sm text-gray-500">
              Most outstanding first. Choose an operator to see only theirs.
            </p>
            <div className="mt-4">
              <DataTable
                label="Balances by operator"
                columns={[
                  {
                    header: 'Operator',
                    cell: (o) => <span className="font-medium text-gray-900">{o.entity.name}</span>,
                  },
                  { header: 'Due', width: '9rem', align: 'right', cell: (o) => formatSsp(o.due) },
                  {
                    header: 'Received',
                    width: '9rem',
                    align: 'right',
                    cell: (o) => formatSsp(o.paid),
                  },
                  {
                    header: 'Outstanding',
                    width: '9rem',
                    align: 'right',
                    cell: (o) => formatSsp(o.outstanding),
                  },
                  {
                    header: 'Payment rate',
                    width: '8rem',
                    align: 'right',
                    cell: (o) => percent(o.paymentRate),
                  },
                ]}
                rows={b.operators}
                rowKey={(o) => o.entity.id}
                onRowClick={(o) => {
                  setEntityId(o.entity.id);
                  setPage(1);
                }}
              />
            </div>
          </Card>
        )}

        <Card>
          <h3 className="text-base font-semibold text-gray-900">What is owed</h3>
          <p className="mt-1 text-sm text-gray-500">
            Each period&apos;s levy from approved returns, and each penalty once it is payable.
          </p>
          <div className="mt-4">
            <DataTable
              label="Charges"
              columns={chargeColumns}
              rows={b?.charges ?? []}
              rowKey={(c) => c.key}
              loading={balancesQuery.isLoading}
              error={balancesQuery.isError}
              onRetry={() => void balancesQuery.refetch()}
              emptyMessage="Nothing is owed. A levy appears once a return is approved, and a penalty once its remedy notice has run out."
            />
          </div>
        </Card>

        <Card>
          <h3 className="text-base font-semibold text-gray-900">Payments received</h3>
          <p className="mt-1 text-sm text-gray-500">
            Every payment stays on this list. One recorded in error is reversed, not removed.
          </p>
          <div className="mt-4">
            {listQuery.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !listQuery.data || listQuery.data.data.length === 0 ? (
              <EmptyState icon={Banknote} message="No payment has been recorded yet." />
            ) : (
              <>
                <DataTable
                  label="Payments"
                  columns={paymentColumns}
                  rows={listQuery.data.data}
                  rowKey={(p) => p.id}
                  error={listQuery.isError}
                  onRetry={() => void listQuery.refetch()}
                />
                <div className="mt-4">
                  <Pagination meta={listQuery.data.meta} onPageChange={setPage} />
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {recording && b && (
        <RecordPaymentDialog
          charges={b.charges}
          preset={recording === 'pick' ? null : recording}
          onClose={() => setRecording(null)}
          onRecorded={(payment) => {
            setRecording(null);
            void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
            toast.success(`Receipt ${payment.receiptNumber} issued.`);
          }}
        />
      )}

      {reversing && (
        <ReversePaymentDialog
          payment={reversing}
          onClose={() => setReversing(null)}
          onReversed={(payment) => {
            setReversing(null);
            void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
            toast.success(`Receipt ${payment.receiptNumber} reversed.`);
          }}
        />
      )}
    </Page>
  );
}

function RecordPaymentDialog({
  charges,
  preset,
  onClose,
  onRecorded,
}: {
  charges: Charge[];
  preset: Charge | null;
  onClose: () => void;
  onRecorded: (payment: Payment) => void;
}) {
  const [chargeKey, setChargeKey] = useState(preset?.key ?? '');
  const charge = charges.find((c) => c.key === chargeKey) ?? null;

  // Starts at what is outstanding, because that is what an operator usually sends.
  const [amount, setAmount] = useState(
    preset && preset.outstanding > 0 ? String(preset.outstanding) : '',
  );
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [bankReference, setBankReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const chargeOptions = useMemo(
    () =>
      charges.map((c) => ({
        value: c.key,
        label: `${c.entity.name}: ${chargeLabel(c.kind, c.period.label)} (${formatSsp(c.outstanding)} outstanding)`,
      })),
    [charges],
  );

  const parsed = Number(amount);
  const ready =
    !!charge &&
    amount.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    paidOn !== '' &&
    bankReference.trim().length >= 3;

  const record = useMutation({
    mutationFn: () =>
      paymentsApi.record({
        kind: charge!.kind,
        entityId: charge!.entity.id,
        periodId: charge!.kind === 'LEVY' ? charge!.period.id : undefined,
        enforcementCaseId: charge!.kind === 'PENALTY' ? (charge!.caseId ?? undefined) : undefined,
        amount: Math.round(parsed * 100) / 100,
        paidOn,
        method,
        bankReference: bankReference.trim(),
        note: note.trim() || undefined,
      }),
    onSuccess: onRecorded,
    onError: (err) => setError(getErrorMessage(err, "We couldn't record that payment.")),
  });

  return (
    <Modal
      open
      title="Record a payment"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {strings.action.cancel}
          </Button>
          <Button isLoading={record.isPending} disabled={!ready} onClick={() => record.mutate()}>
            Record and issue a receipt
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Record money that has arrived, as the bank statement shows it. A receipt is issued
          straight away, and a payment cannot be edited afterwards, only reversed.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}

        {preset ? (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
            <div className="font-medium text-gray-900">{preset.entity.name}</div>
            <div className="text-gray-600">
              {chargeLabel(preset.kind, preset.period.label)}: {formatSsp(preset.outstanding)}{' '}
              outstanding of {formatSsp(preset.due)}
            </div>
          </div>
        ) : (
          <Field label="What is being paid" htmlFor="payment-charge">
            <Select
              id="payment-charge"
              aria-label="What is being paid"
              placeholder="Choose the levy or penalty"
              searchable
              options={chargeOptions}
              value={chargeKey}
              onChange={(key) => {
                setChargeKey(key);
                const c = charges.find((x) => x.key === key);
                if (c && c.outstanding > 0) setAmount(String(c.outstanding));
              }}
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount received (SSP)" htmlFor="payment-amount">
            <Input
              id="payment-amount"
              type="number"
              inputMode="decimal"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field
            label="Date received"
            htmlFor="payment-date"
            hint="As the bank statement shows it."
          >
            <DatePicker
              id="payment-date"
              aria-label="Date the money was received"
              value={paidOn}
              max={today()}
              onChange={setPaidOn}
            />
          </Field>
          <Field label="How it was paid" htmlFor="payment-method">
            <Select
              id="payment-method"
              aria-label="How it was paid"
              options={METHOD_OPTIONS}
              value={method}
              onChange={(v) => setMethod(v as PaymentMethod)}
            />
          </Field>
          <Field
            label="Bank reference"
            htmlFor="payment-reference"
            hint="The reference on the bank statement."
          >
            <Input
              id="payment-reference"
              placeholder="e.g. FT26288XKQ91"
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Note" htmlFor="payment-note" hint="Optional.">
          <Textarea
            id="payment-note"
            rows={2}
            autoGrow
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {charge && parsed > charge.outstanding && charge.outstanding > 0 && (
          <Alert tone="info">
            This is {formatSsp(parsed - charge.outstanding)} more than is outstanding. It will be
            recorded as received and shown as overpaid.
          </Alert>
        )}
      </div>
    </Modal>
  );
}

function ReversePaymentDialog({
  payment,
  onClose,
  onReversed,
}: {
  payment: Payment;
  onClose: () => void;
  onReversed: (payment: Payment) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const ready = reason.trim().length >= 10;

  const reverse = useMutation({
    mutationFn: () => paymentsApi.reverse(payment.id, reason.trim()),
    onSuccess: onReversed,
    onError: (err) => setError(getErrorMessage(err, "We couldn't reverse that payment.")),
  });

  return (
    <Modal
      open
      size="sm"
      title={`Reverse receipt ${payment.receiptNumber}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {strings.action.cancel}
          </Button>
          <Button
            variant="danger"
            isLoading={reverse.isPending}
            disabled={!ready}
            onClick={() => reverse.mutate()}
          >
            Reverse this payment
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          {formatSsp(payment.amount)} from {payment.entity.name}, received{' '}
          {formatDate(payment.paidOn)}. Reversing takes it off the operator&apos;s balance. The
          payment and its receipt stay on record, marked as reversed, and this cannot be undone.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field
          label="Why it is being reversed"
          htmlFor="reverse-reason"
          hint="In a sentence. This is what an auditor will read."
        >
          <Textarea
            id="reverse-reason"
            rows={3}
            autoGrow
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
