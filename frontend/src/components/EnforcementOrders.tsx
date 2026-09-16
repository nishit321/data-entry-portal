import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Gavel, Undo2 } from 'lucide-react';
import { strings } from '../lib/strings';
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
  type SelectOption,
} from './ui';
import {
  enforcementApi,
  enforcementKeys,
  type ApproveOrderInput,
  type DraftOrderInput,
} from '../lib/enforcement.api';
import { getErrorMessage } from '../lib/api';
import { formatDate, joinMeta } from '../lib/format';
import {
  ENFORCEMENT_ORDER_STATUS_LABELS,
  ENFORCEMENT_ORDER_TYPE_HINTS,
  ENFORCEMENT_ORDER_TYPE_LABELS,
  ENFORCEMENT_ORDER_TYPES,
  type EnforcementCase,
  type EnforcementOrder,
  type EnforcementOrderStatus,
  type EnforcementOrderType,
} from '../lib/types';

const TYPE_OPTIONS: SelectOption[] = ENFORCEMENT_ORDER_TYPES.map((t) => ({
  value: t,
  label: ENFORCEMENT_ORDER_TYPE_LABELS[t],
}));

const STATUS_TONE: Record<EnforcementOrderStatus, 'gray' | 'danger' | 'warning'> = {
  // A draft is grey because it does nothing. An order in force is the sharpest thing on the screen.
  DRAFT: 'gray',
  APPROVED: 'danger',
  REVOKED: 'warning',
};

const BLANK = {
  type: 'SUSPENSION_FULL' as EnforcementOrderType,
  reason: '',
  legalBasis: '',
  effectiveFrom: '',
  durationDays: '',
};

/**
 * Formal enforcement orders on a compliance case: Tier 3's non-financial sanctions.
 *
 * A penalty is money; an order stops an operator trading. The screen has to carry three things the
 * service already enforces, because an interface that hides them turns a refusal into a mystery:
 *
 *  1. **A draft does nothing.** It carries no effect until somebody approves it, and the most
 *     dangerous possible reading of this screen is that writing an order is making one. So a draft
 *     is drawn grey and says so in words.
 *  2. **The drafter cannot approve.** That is the whole point of escalating sign-off, so the
 *     button is absent rather than present and failing.
 *  3. **A cancellation needs the Board.** The Board meets and minutes decisions; it does not hold
 *     a login. So approving a cancellation asks for the minute reference and the date it was
 *     taken, and a suspension does not.
 */
export function EnforcementOrders({
  case: complianceCase,
  currentUserId,
  canManage,
}: {
  case: EnforcementCase;
  currentUserId: string | undefined;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [drafting, setDrafting] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [approving, setApproving] = useState<EnforcementOrder | null>(null);
  const [board, setBoard] = useState({ ref: '', decidedAt: '' });
  const [revoking, setRevoking] = useState<EnforcementOrder | null>(null);
  const [revokeNote, setRevokeNote] = useState('');

  const ordersQuery = useQuery({
    queryKey: enforcementKeys.orders(complianceCase.id),
    queryFn: () => enforcementApi.orders(complianceCase.id),
  });
  const orders = ordersQuery.data ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: enforcementKeys.all });

  const draft = useMutation({
    mutationFn: () => {
      const input: DraftOrderInput = {
        type: form.type,
        reason: form.reason.trim(),
        legalBasis: form.legalBasis.trim(),
        effectiveFrom: form.effectiveFrom,
        // A cancellation does not run for a period. The service refuses a duration on one rather
        // than ignoring it, so the screen must not send one.
        durationDays:
          form.type === 'CANCELLATION' || !form.durationDays
            ? undefined
            : Number(form.durationDays),
      };
      return enforcementApi.draftOrder(complianceCase.id, input);
    },
    onSuccess: () => {
      refresh();
      setDrafting(false);
      setForm(BLANK);
      toast.success('Order drafted. It has no effect until somebody else approves it.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't draft that order.")),
  });

  const approve = useMutation({
    mutationFn: () => {
      const input: ApproveOrderInput =
        approving?.type === 'CANCELLATION'
          ? { boardMinuteRef: board.ref.trim(), boardDecidedAt: board.decidedAt }
          : {};
      return enforcementApi.approveOrder(approving!.id, input);
    },
    onSuccess: () => {
      refresh();
      setApproving(null);
      setBoard({ ref: '', decidedAt: '' });
      toast.success('Order approved. It is now in force.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't approve that order.")),
  });

  const revoke = useMutation({
    mutationFn: () => enforcementApi.revokeOrder(revoking!.id, revokeNote.trim()),
    onSuccess: () => {
      refresh();
      setRevoking(null);
      setRevokeNote('');
      toast.success('Order withdrawn.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't withdraw that order.")),
  });

  const name = (person: EnforcementOrder['draftedBy']) =>
    person ? `${person.firstName} ${person.lastName}` : 'an account since removed';

  const readyToDraft =
    form.reason.trim().length > 0 &&
    form.legalBasis.trim().length > 0 &&
    form.effectiveFrom.length > 0;

  const readyToApprove =
    approving?.type !== 'CANCELLATION' ||
    (board.ref.trim().length > 0 && board.decidedAt.length > 0);

  if (ordersQuery.isLoading) return null;
  if (orders.length === 0 && !canManage) return null;

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
            <Gavel size={14} aria-hidden />
            Enforcement orders
          </h4>
          <p className="mt-1 text-xs text-gray-500">
            Suspending or cancelling a licence. Separate from any penalty on this case.
          </p>
        </div>
        {canManage && (
          <Button variant="secondary" size="sm" icon={Gavel} onClick={() => setDrafting(true)}>
            Draft an order
          </Button>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No orders have been made on this case.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {orders.map((order) => (
            <li key={order.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {ENFORCEMENT_ORDER_TYPE_LABELS[order.type]}
                </span>
                <Badge tone={STATUS_TONE[order.status]}>
                  {ENFORCEMENT_ORDER_STATUS_LABELS[order.status]}
                </Badge>
              </div>

              {/*
                The sentence that stops this screen being misread.
                An officer who drafts an order and closes the page could otherwise believe they have
                suspended somebody. They have written a proposal.
              */}
              {order.status === 'DRAFT' && (
                <p className="mt-1 text-xs text-warning-700">
                  Not in force. It takes effect only when somebody else approves it.
                </p>
              )}

              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{order.reason}</p>
              <p className="mt-2 text-xs text-gray-500">
                {joinMeta(
                  order.legalBasis,
                  `takes effect ${formatDate(order.effectiveFrom)}`,
                  order.durationDays ? `for ${order.durationDays} days` : null,
                )}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {joinMeta(
                  `drafted by ${name(order.draftedBy)}`,
                  order.approvedAt ? `approved by ${name(order.approvedBy)}` : null,
                  order.boardMinuteRef
                    ? `Board minute ${order.boardMinuteRef} of ${formatDate(order.boardDecidedAt!)}`
                    : null,
                )}
              </p>

              {order.status === 'REVOKED' && (
                <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-600">
                  {joinMeta(
                    `Withdrawn by ${name(order.revokedBy)}`,
                    order.revokedAt ? formatDate(order.revokedAt) : null,
                  )}
                  {order.revokedNote ? `: ${order.revokedNote}` : ''}
                </p>
              )}

              {canManage && order.status !== 'REVOKED' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {/*
                    Absent, not disabled, when the reader drafted it. The rule is that sign-off
                    escalates to a second person; a greyed-out button invites somebody to go
                    looking for a way round it.
                  */}
                  {order.status === 'DRAFT' && order.draftedBy?.id !== currentUserId && (
                    <Button size="sm" icon={Check} onClick={() => setApproving(order)}>
                      Approve
                    </Button>
                  )}
                  {order.status === 'DRAFT' && order.draftedBy?.id === currentUserId && (
                    <p className="text-xs text-gray-500">
                      You drafted this, so somebody else has to approve it.
                    </p>
                  )}
                  {order.status === 'APPROVED' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Undo2}
                      onClick={() => setRevoking(order)}
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* --- Drafting ------------------------------------------------------ */}
      <Modal open={drafting} title="Draft an enforcement order" onClose={() => setDrafting(false)}>
        <div className="space-y-4">
          <Alert tone="info">
            Drafting does not suspend anything. The order takes effect only once a second person
            approves it.
          </Alert>

          <Field
            label="What kind of order"
            htmlFor="order-type"
            hint={ENFORCEMENT_ORDER_TYPE_HINTS[form.type]}
          >
            <Select
              aria-label="Kind of order"
              options={TYPE_OPTIONS}
              value={form.type}
              onChange={(type) => setForm({ ...form, type: type as EnforcementOrderType })}
            />
          </Field>

          <Field
            label="Why"
            htmlFor="order-reason"
            hint="An operator has to be able to answer this, so say what they did."
          >
            <Textarea
              id="order-reason"
              rows={3}
              autoGrow
              placeholder="What the operator did, and what the order requires of them"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </Field>

          <Field
            label="Legal basis"
            htmlFor="order-basis"
            hint="The section of the Act this rests on."
          >
            <Input
              id="order-basis"
              placeholder="e.g. Section 42(3) of the Communications Act"
              value={form.legalBasis}
              onChange={(e) => setForm({ ...form, legalBasis: e.target.value })}
            />
          </Field>

          <div className="flex gap-4">
            <Field label="Takes effect" htmlFor="order-from">
              <DatePicker
                id="order-from"
                aria-label="Date the order takes effect"
                value={form.effectiveFrom}
                onChange={(effectiveFrom) => setForm({ ...form, effectiveFrom })}
              />
            </Field>
            {/*
              A cancellation ends a licence; it does not run for a stretch of days. The field is
              hidden rather than ignored, because "cancelled for 90 days" is not a thing the Act
              provides for and a form that accepts it invites a file that says something untrue.
            */}
            {form.type !== 'CANCELLATION' && (
              <Field label="For how long" htmlFor="order-days" hint="In days.">
                <Input
                  id="order-days"
                  type="number"
                  min={1}
                  placeholder="e.g. 90"
                  value={form.durationDays}
                  onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
                />
              </Field>
            )}
          </div>

          {form.type === 'CANCELLATION' && (
            <Alert tone="warning">
              A cancellation ends the licence and does not run for a period. It has to be approved
              against a Board minute, not by the Director General.
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDrafting(false)}>
              {strings.action.cancel}
            </Button>
            <Button
              isLoading={draft.isPending}
              disabled={!readyToDraft}
              onClick={() => draft.mutate()}
            >
              Save the draft
            </Button>
          </div>
        </div>
      </Modal>

      {/* --- Approving ----------------------------------------------------- */}
      <Modal
        open={approving !== null}
        title="Approve this order?"
        onClose={() => setApproving(null)}
        size="sm"
      >
        <div className="space-y-4">
          <Alert tone="danger">
            <p>
              This puts the order in force from{' '}
              {approving ? formatDate(approving.effectiveFrom) : ''}.
              {approving?.type === 'CANCELLATION'
                ? ' The licence ends.'
                : ' The operator stops trading as the order describes.'}
            </p>
          </Alert>

          {approving?.type === 'CANCELLATION' && (
            <>
              {/*
                The Board is a body that meets and minutes its decisions, not an account that signs
                in. What is recorded here is the minute that authorised the cancellation; the
                officer entering it is recorded separately, and the two are different facts.
              */}
              <Field
                label="Board minute reference"
                htmlFor="order-minute"
                hint="The minute in which the Board authorised this."
              >
                <Input
                  id="order-minute"
                  placeholder="e.g. NCA/BM/2026/14"
                  value={board.ref}
                  onChange={(e) => setBoard({ ...board, ref: e.target.value })}
                />
              </Field>
              <Field label="Date the Board decided" htmlFor="order-minute-date">
                <DatePicker
                  id="order-minute-date"
                  aria-label="Date the Board decided"
                  value={board.decidedAt}
                  onChange={(decidedAt) => setBoard({ ...board, decidedAt })}
                />
              </Field>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setApproving(null)}>
              {strings.action.cancel}
            </Button>
            <Button
              icon={Check}
              isLoading={approve.isPending}
              disabled={!readyToApprove}
              onClick={() => approve.mutate()}
            >
              Approve the order
            </Button>
          </div>
        </div>
      </Modal>

      {/* --- Withdrawing --------------------------------------------------- */}
      <Modal
        open={revoking !== null}
        title="Withdraw this order?"
        onClose={() => setRevoking(null)}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            The order stays on the case. It had legal effect while it stood, so it is marked
            withdrawn rather than removed.
          </p>
          <Field label="Why it is being withdrawn" htmlFor="order-revoke-note">
            <Textarea
              id="order-revoke-note"
              rows={3}
              autoGrow
              placeholder="What changed"
              value={revokeNote}
              onChange={(e) => setRevokeNote(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRevoking(null)}>
              {strings.action.cancel}
            </Button>
            <Button
              icon={Ban}
              isLoading={revoke.isPending}
              disabled={revokeNote.trim().length === 0}
              onClick={() => revoke.mutate()}
            >
              Withdraw it
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
