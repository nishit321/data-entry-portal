import { useState } from 'react';
import { strings } from '../lib/strings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Mail, Plus, Send, Trash2, X } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Combobox,
  ConfirmDialog,
  DatePicker,
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
  REPORT_COVERAGE_HINTS,
  REPORT_COVERAGE_LABELS,
  REPORT_COVERAGES,
  REPORT_FREQUENCIES,
  REPORT_FREQUENCY_LABELS,
  SCHEDULED_REPORT_KINDS,
  SCHEDULED_REPORT_KIND_LABELS,
  WEEKDAY_LABELS,
  type ReportCoverage,
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
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, '0')}:00`,
}));
const COVERAGE_OPTIONS = REPORT_COVERAGES.map((c) => ({
  value: c,
  label: REPORT_COVERAGE_LABELS[c],
}));

/**
 * The last day of the month a monthly schedule may key off.
 *
 * February is why. A report set for the 30th would have no date at all in most Februaries, and a
 * schedule that silently skips a month is worse than one that goes out three days early.
 */
const LAST_SAFE_DAY = 28;

/** The ordinal a reader would say out loud: 1st, 2nd, 3rd, 21st. */
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
}

/** Monday is 1, matching the way the day is stored; JavaScript puts Sunday at 0. */
function isoDayOfWeek(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/**
 * The recurring day a picked date stands for.
 *
 * The calendar is how the day is chosen, not what is stored. A schedule repeats, so what it keeps
 * is "the 15th of each month" or "every Tuesday" — picking a date is simply a more concrete way of
 * saying which. Returns null when the date is one a monthly schedule could not repeat on.
 */
function dayFromDate(iso: string, frequency: ReportFrequency): number | null {
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (frequency === 'WEEKLY') return isoDayOfWeek(date);
  return date.getDate() > LAST_SAFE_DAY ? null : date.getDate();
}

/** What the picked date means, said back to the person who picked it. */
function recurrence(iso: string, frequency: ReportFrequency): string | null {
  const day = dayFromDate(iso, frequency);
  if (day === null) return null;
  if (frequency === 'WEEKLY') return `Goes out every ${WEEKDAY_LABELS[day - 1]}.`;
  if (frequency === 'QUARTERLY') {
    return `Goes out on the ${ordinal(day)} of January, April, July and October.`;
  }
  return `Goes out on the ${ordinal(day)} of every month.`;
}

const BLANK = {
  name: '',
  kind: 'COMPLIANCE_WORKBOOK' as ScheduledReportKind,
  frequency: 'MONTHLY' as ReportFrequency,
  coverage: 'LAST_CLOSED_PERIOD' as ReportCoverage,
  runDate: '',
  hour: '7',
};

/** When a schedule next goes out, in the words an administrator used to set it up. */
function timetable(schedule: ReportSchedule): string {
  const time = `${String(schedule.hour).padStart(2, '0')}:00`;
  if (schedule.frequency === 'WEEKLY') {
    return `Every ${WEEKDAY_LABELS[schedule.dayOfPeriod - 1] ?? 'Monday'} at ${time}`;
  }
  const day = `the ${ordinal(schedule.dayOfPeriod)}`;
  return schedule.frequency === 'QUARTERLY'
    ? `Quarterly, on ${day} of January, April, July and October at ${time}`
    : `Monthly, on ${day} at ${time}`;
}

/**
 * What each run of a schedule covers.
 *
 * On the row rather than only in the form, because it is the difference between two reports that
 * are otherwise described identically. Somebody looking at a list of schedules cannot tell a levy
 * statement for last quarter from one that restates itself every month without it.
 */
function coverageLine(schedule: ReportSchedule): string {
  return REPORT_COVERAGE_LABELS[schedule.coverage];
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
        coverage: form.coverage,
        // Non-null by the time this runs: the submit button is disabled until the picked date is
        // one the schedule can actually repeat on.
        dayOfPeriod: dayFromDate(form.runDate, form.frequency) ?? 1,
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

  const runsOn = recurrence(form.runDate, form.frequency);
  // A date has been picked but a monthly schedule could not repeat on it. Said where the date was
  // chosen, rather than as a failure after pressing the button.
  const dayProblem =
    form.runDate && runsOn === null
      ? `A report set for the ${ordinal(new Date(`${form.runDate}T00:00:00`).getDate())} would have no date in February. Pick a day up to the ${LAST_SAFE_DAY}th.`
      : null;

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
                        coverageLine(schedule),
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
          <Field
            label={strings.field.name}
            htmlFor="rep-name"
            hint="What the email is titled when it arrives."
          >
            <Input
              id="rep-name"
              placeholder="e.g. Monthly compliance summary"
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
          <Field
            label="What each report covers"
            htmlFor="rep-coverage"
            hint={REPORT_COVERAGE_HINTS[form.coverage]}
          >
            <Select
              aria-label="What each report covers"
              options={COVERAGE_OPTIONS}
              value={form.coverage}
              onChange={(coverage) => setForm({ ...form, coverage: coverage as ReportCoverage })}
            />
          </Field>
          <Field label="How often" htmlFor="rep-freq">
            <Select
              aria-label="How often it goes out"
              options={FREQUENCY_OPTIONS}
              value={form.frequency}
              onChange={(frequency) =>
                setForm({ ...form, frequency: frequency as ReportFrequency })
              }
            />
          </Field>
          <div className="flex gap-4">
            <Field
              label="Day it goes out"
              htmlFor="rep-day"
              /*
               * A calendar, not a list of numbers from 1 to 28.
               *
               * The schedule repeats, so what it keeps is the day rather than the date: pick the
               * 15th of any month and it goes out on the 15th of every month. Picking it off a
               * calendar is the more concrete way of saying which day, and the line underneath
               * states the rule it produced so nobody has to infer it.
               */
              hint={runsOn ?? undefined}
              error={dayProblem ?? undefined}
            >
              {/*
                No `min`. A schedule repeats, so a date earlier this month is a perfectly good way
                of saying "the 12th" — the first run is simply next month. Blocking the past here
                would grey out half the calendar for no reason a reader could work out.
              */}
              <DatePicker
                id="rep-day"
                aria-label="Day it goes out"
                value={form.runDate}
                invalid={Boolean(dayProblem)}
                onChange={(runDate) => setForm({ ...form, runDate })}
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
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 ps-2.5 pe-1 text-xs text-gray-700"
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
              {strings.action.cancel}
            </Button>
            <Button
              icon={Mail}
              isLoading={create.isPending}
              disabled={form.name.trim().length < 2 || recipients.length === 0 || runsOn === null}
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
