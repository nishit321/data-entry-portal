import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Mail, Plus, Send, Trash2, X } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Combobox,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Page,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from '../components/ui';
import { reportsApi, reportsKeys, type ReportScheduleInput } from '../lib/reports.api';
import { userPicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { formatDateTime, joinMeta } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import {
  REPORT_FREQUENCIES,
  REPORT_FREQUENCY_LABELS,
  SCHEDULED_REPORT_KINDS,
  SCHEDULED_REPORT_KIND_LABELS,
  WEEKDAY_LABELS,
  type ReportFrequency,
  type ReportSchedule,
  type ScheduledReportKind,
} from '../lib/types';

const KIND_OPTIONS = SCHEDULED_REPORT_KINDS.map((k) => ({
  value: k,
  label: SCHEDULED_REPORT_KIND_LABELS[k],
}));
const FREQUENCY_OPTIONS = REPORT_FREQUENCIES.map((f) => ({
  value: f,
  label: REPORT_FREQUENCY_LABELS[f],
}));
const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, i) => ({ value: String(i + 1), label }));
const MONTH_DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: `Day ${i + 1}`,
}));
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, '0')}:00`,
}));

const BLANK = {
  name: '',
  kind: 'COMPLIANCE_WORKBOOK' as ScheduledReportKind,
  frequency: 'MONTHLY' as ReportFrequency,
  dayOfPeriod: '1',
  hour: '7',
};

/** When a schedule next goes out, in the words an administrator used to set it up. */
function timetable(schedule: ReportSchedule): string {
  const time = `${String(schedule.hour).padStart(2, '0')}:00`;
  if (schedule.frequency === 'WEEKLY') {
    return `Every ${WEEKDAY_LABELS[schedule.dayOfPeriod - 1] ?? 'Monday'} at ${time}`;
  }
  const day = `day ${schedule.dayOfPeriod}`;
  return schedule.frequency === 'QUARTERLY'
    ? `Quarterly, on ${day} of January, April, July and October at ${time}`
    : `Monthly, on ${day} at ${time}`;
}

/**
 * Reports the portal builds and emails on a timetable (Phase 2).
 *
 * Recipients are picked from Authority staff, never typed as addresses. A report carries sector
 * figures, and a free-text address box is one typo away from sending them outside the building.
 */
export function ScheduledReportsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [recipients, setRecipients] = useState<{ id: string; label: string }[]>([]);
  const [picking, setPicking] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ReportSchedule | null>(null);

  const listQuery = useQuery({ queryKey: reportsKeys.all, queryFn: () => reportsApi.list() });
  const schedules = listQuery.data ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: reportsKeys.all });

  const reset = () => {
    setForm(BLANK);
    setRecipients([]);
    setPicking('');
  };

  const create = useMutation({
    mutationFn: () => {
      const input: ReportScheduleInput = {
        name: form.name.trim(),
        kind: form.kind,
        frequency: form.frequency,
        dayOfPeriod: Number(form.dayOfPeriod),
        hour: Number(form.hour),
        recipientIds: recipients.map((r) => r.id),
      };
      return reportsApi.create(input);
    },
    onSuccess: () => {
      refresh();
      setOpen(false);
      reset();
      toast.success('Report scheduled.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't schedule that report.")),
  });

  const toggleEnabled = useMutation({
    mutationFn: (schedule: ReportSchedule) =>
      reportsApi.update(schedule.id, { isEnabled: !schedule.isEnabled }),
    onSuccess: (updated) => {
      refresh();
      toast.success(updated.isEnabled ? 'Back on the timetable.' : 'Paused.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't change that.")),
  });

  const sendNow = useMutation({
    mutationFn: (id: string) => reportsApi.send(id),
    onSuccess: (r) => {
      refresh();
      toast.success(`Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't send that report.")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => reportsApi.remove(id),
    onSuccess: () => {
      refresh();
      setPendingDelete(null);
      toast.success('Schedule removed.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove that schedule.")),
  });

  const dayOptions = form.frequency === 'WEEKLY' ? WEEKDAY_OPTIONS : MONTH_DAY_OPTIONS;

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Scheduled reports"
          description="Reports the portal builds and emails on a timetable, so nobody has to remember to fetch them. They go to Authority staff only."
          actions={
            canManage && (
              <Button icon={Plus} onClick={() => setOpen(true)}>
                Schedule a report
              </Button>
            )
          }
        />

        {listQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : schedules.length === 0 ? (
          <Card>
            <EmptyState
              icon={CalendarClock}
              message="No reports are scheduled. The same reports can still be downloaded from Analytics and Revenue at any time."
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {schedules.map((schedule) => (
              <Card key={schedule.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-gray-900">{schedule.name}</h3>
                      <Badge tone={schedule.isEnabled ? 'success' : 'gray'}>
                        {schedule.isEnabled ? 'Scheduled' : 'Paused'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{timetable(schedule)}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {joinMeta(
                        SCHEDULED_REPORT_KIND_LABELS[schedule.kind],
                        `${schedule.recipients.length} ${
                          schedule.recipients.length === 1 ? 'recipient' : 'recipients'
                        }`,
                        schedule.lastRunAt
                          ? `last sent ${formatDateTime(schedule.lastRunAt)}`
                          : 'not sent yet',
                      )}
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Send}
                        isLoading={sendNow.isPending && sendNow.variables === schedule.id}
                        disabled={schedule.recipients.length === 0}
                        onClick={() => sendNow.mutate(schedule.id)}
                      >
                        Send now
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleEnabled.mutate(schedule)}
                      >
                        {schedule.isEnabled ? 'Pause' : 'Resume'}
                      </Button>
                      <IconButton
                        icon={Trash2}
                        label={`Remove ${schedule.name}`}
                        variant="danger"
                        onClick={() => setPendingDelete(schedule)}
                      />
                    </div>
                  )}
                </div>

                {schedule.recipients.length === 0 ? (
                  <p className="mt-3 text-sm text-warning-700">
                    Nobody is on the list yet, so this report will not go out.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {schedule.recipients.map((r) => (
                      <Badge key={r.user.id} tone="gray">
                        {r.user.firstName} {r.user.lastName}
                      </Badge>
                    ))}
                  </div>
                )}

                {schedule.lastError && (
                  <div className="mt-3">
                    <Alert tone="warning">
                      The last attempt did not go out: {schedule.lastError}
                    </Alert>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={open} title="Schedule a report" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Field label="Name" htmlFor="rep-name" hint="What the email is titled when it arrives.">
            <Input
              id="rep-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Report" htmlFor="rep-kind">
            <Select
              aria-label="Which report to send"
              options={KIND_OPTIONS}
              value={form.kind}
              onChange={(kind) => setForm({ ...form, kind: kind as ScheduledReportKind })}
            />
          </Field>
          <Field label="How often" htmlFor="rep-freq">
            <Select
              aria-label="How often it goes out"
              options={FREQUENCY_OPTIONS}
              value={form.frequency}
              onChange={(frequency) =>
                setForm({
                  ...form,
                  frequency: frequency as ReportFrequency,
                  // The day means a different thing for a weekly schedule, so start it over.
                  dayOfPeriod: '1',
                })
              }
            />
          </Field>
          <div className="flex gap-4">
            <Field
              label={form.frequency === 'WEEKLY' ? 'Day of the week' : 'Day of the month'}
              htmlFor="rep-day"
              hint={
                form.frequency === 'WEEKLY'
                  ? undefined
                  : 'Up to the 28th, so it has a date in February too.'
              }
            >
              <Select
                aria-label="Day it goes out"
                options={dayOptions}
                value={form.dayOfPeriod}
                onChange={(dayOfPeriod) => setForm({ ...form, dayOfPeriod })}
              />
            </Field>
            <Field label="Time" htmlFor="rep-hour">
              <Select
                aria-label="Time it goes out"
                options={HOUR_OPTIONS}
                value={form.hour}
                onChange={(hour) => setForm({ ...form, hour })}
              />
            </Field>
          </div>

          <Field
            label="Send it to"
            htmlFor="rep-to"
            hint="Authority staff only. A report carries sector figures, so it cannot be sent to an address outside the Authority."
          >
            <Combobox
              aria-label="Add a recipient"
              emptyLabel="Choose someone"
              placeholder="Search staff…"
              source={userPicker}
              value={picking}
              onChange={(id, option) => {
                setPicking('');
                if (!id || recipients.some((r) => r.id === id)) return;
                setRecipients([...recipients, { id, label: option?.label ?? 'Selected person' }]);
              }}
            />
          </Field>
          {recipients.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {recipients.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-2.5 pr-1 text-xs text-gray-700"
                >
                  {r.label}
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-gray-200"
                    aria-label={`Remove ${r.label}`}
                    onClick={() => setRecipients(recipients.filter((x) => x.id !== r.id))}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              icon={Mail}
              isLoading={create.isPending}
              disabled={form.name.trim().length < 2 || recipients.length === 0}
              onClick={() => create.mutate()}
            >
              Schedule it
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this schedule?"
        confirmLabel="Remove"
        tone="danger"
        isLoading={remove.isPending}
        message={
          pendingDelete
            ? `"${pendingDelete.name}" will stop going out. The report itself can still be downloaded at any time.`
            : ''
        }
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </Page>
  );
}
