import { useRef, useState } from 'react';
import { strings } from '../lib/strings';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, CheckCircle2, Copy, Paperclip, X } from 'lucide-react';
import { AuthLayout } from '../components/auth/AuthLayout';
import {
  Alert,
  Badge,
  Button,
  Field,
  FormField,
  IconButton,
  Input,
  Select,
  Textarea,
  useToast,
  type SelectOption,
} from '../components/ui';
import { complaintsApi, type FiledComplaint } from '../lib/complaints.api';
import { getErrorMessage } from '../lib/api';
import { COMPLAINT_STATUS_TONE } from '../lib/status';
import { formatDate, formatFileSize, joinMeta } from '../lib/format';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_FILE_FORMATS,
  COMPLAINT_STATUS_LABELS,
  MAX_COMPLAINT_FILES,
  type ComplaintCategory,
  type ComplaintTracking,
} from '../lib/types';

/**
 * The per-file size the picker will accept, in bytes.
 *
 * A courtesy check, not the check. The server decides, and it may be configured lower; refusing an
 * obviously oversized file here just saves someone uploading ten megabytes to be told no.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const CATEGORY_OPTIONS: SelectOption[] = COMPLAINT_CATEGORIES.map((c) => ({
  value: c,
  label: COMPLAINT_CATEGORY_LABELS[c],
}));

const schema = z.object({
  category: z.enum(COMPLAINT_CATEGORIES),
  subject: z.string().min(4, 'Give your message a short subject').max(160),
  description: z
    .string()
    .min(20, 'Please describe what happened in a little more detail')
    .max(4000, 'Please keep this under 4000 characters'),
  complainantName: z.string().max(120).optional(),
  complainantEmail: z.string().email('Enter a valid email address').or(z.literal('')).optional(),
  complainantPhone: z.string().max(40).optional(),
});
type FormValues = z.infer<typeof schema>;

/**
 * The public complaint desk (Q4). Reached without signing in, so it lives outside the authenticated
 * shell and asks for as little as possible: contact details are optional, and a citizen may file
 * anonymously. On success they are given a reference number and a tracking code — the code is shown
 * once and is what proves the complaint is theirs when they come back to check on it.
 */
export function PublicComplaintPage() {
  const toast = useToast();
  const [filed, setFiled] = useState<FiledComplaint | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'file' | 'track'>('file');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  /** Files the Authority did not get, named on the receipt rather than swallowed. */
  const [failedUploads, setFailedUploads] = useState<string[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { category: 'SERVICE_QUALITY' },
  });
  const { errors, isSubmitting } = form.formState;

  function addFiles(chosen: File[]) {
    const room = MAX_COMPLAINT_FILES - files.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_COMPLAINT_FILES} files.`);
      return;
    }
    const tooBig = chosen.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooBig.length > 0) {
      toast.error(`${tooBig[0].name} is too large. Each file can be up to 10 MB.`);
    }
    const room_ = chosen.filter((f) => f.size <= MAX_FILE_BYTES).slice(0, room);
    if (room_.length > 0) setFiles((current) => [...current, ...room_]);
  }

  function onFilesChosen(event: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    // Clear the input, so choosing the same file again still fires a change event.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setError('');
    try {
      const result = await complaintsApi.file({
        category: values.category as ComplaintCategory,
        subject: values.subject,
        description: values.description,
        complainantName: values.complainantName || undefined,
        complainantEmail: values.complainantEmail || undefined,
        complainantPhone: values.complainantPhone || undefined,
      });

      /*
       * The complaint is filed; the files follow.
       *
       * One at a time and never fatal. What has already been recorded is the account of what
       * happened, and losing that because a photo would not upload would be the worse outcome by
       * some distance. A file that does not make it is named on the receipt instead, so the sender
       * knows what the Authority has rather than assuming.
       */
      const failed: string[] = [];
      for (const file of files) {
        try {
          await complaintsApi.attach(result.referenceNumber, result.trackingCode, file);
        } catch {
          failed.push(file.name);
        }
      }
      setFailedUploads(failed);
      setFiled(result);
    } catch (err) {
      setError(getErrorMessage(err, "We couldn't send that just now. Please try again."));
    }
  });

  const copyCode = async () => {
    if (!filed) return;
    try {
      await navigator.clipboard.writeText(
        `Reference: ${filed.referenceNumber}\nTracking code: ${filed.trackingCode}`,
      );
      toast.success('Copied. Keep it somewhere safe.');
    } catch {
      toast.error('Your browser would not let us copy. Please write the details down.');
    }
  };

  if (filed) {
    return (
      <AuthLayout
        title="We have your complaint"
        subtitle="Keep the details below. You need both to check on progress."
        footer={
          <Link to="/login" className="font-medium text-brand-700 hover:text-brand-800">
            Go to sign in
          </Link>
        }
      >
        <div className="space-y-5">
          <Alert tone="success">
            <div className="flex gap-2">
              <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0" />
              <p>{filed.message}</p>
            </div>
          </Alert>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Reference number
            </div>
            <div className="mt-1 font-mono text-sm text-gray-900">{filed.referenceNumber}</div>
            <div className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">
              Tracking code
            </div>
            <div className="mt-1 break-all font-mono text-sm text-gray-900">
              {filed.trackingCode}
            </div>
          </div>

          {files.length > 0 && failedUploads.length === 0 && (
            <p className="text-sm text-gray-600">
              {files.length === 1
                ? 'Your file was sent with it.'
                : `Your ${files.length} files were sent with it.`}
            </p>
          )}
          {failedUploads.length > 0 && (
            <Alert tone="warning">
              <p>
                Your complaint is filed, but we could not attach {failedUploads.join(', ')}.
                Everything you wrote has been recorded. If the file matters, write to the Authority
                with your reference number.
              </p>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" icon={Copy} onClick={() => void copyCode()}>
              Copy both
            </Button>
            <Button
              onClick={() => {
                setFiled(null);
                setMode('track');
              }}
            >
              Check on it
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  if (mode === 'track') {
    return <TrackPanel onBack={() => setMode('file')} />;
  }

  return (
    <AuthLayout
      title="Tell the Authority about a problem"
      subtitle="Report a problem with a telecom or mobile money service, or send a suggestion. You do not need an account."
      footer={
        <button
          type="button"
          onClick={() => setMode('track')}
          className="font-medium text-brand-700 hover:text-brand-800"
        >
          Already filed something? Check on it
        </button>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="What is this about?" htmlFor="cmp-category">
          <Select
            id="cmp-category"
            value={form.watch('category')}
            options={CATEGORY_OPTIONS}
            onChange={(v) => form.setValue('category', v as ComplaintCategory)}
          />
        </Field>

        <FormField htmlFor="cmp-subject" label="Subject" error={errors.subject?.message}>
          <Input id="cmp-subject" placeholder="A short summary" {...form.register('subject')} />
        </FormField>

        <FormField
          htmlFor="cmp-description"
          label="What happened?"
          error={errors.description?.message}
        >
          <Textarea
            id="cmp-description"
            rows={5}
            placeholder="Include dates, places, and any reference numbers you have."
            {...form.register('description')}
          />
        </FormField>

        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-medium text-gray-900">Anything that shows the problem</p>
          <p className="mt-1 text-xs text-gray-500">
            A photo, a screenshot or a PDF, such as a bill or a message you were sent. Up to{' '}
            {MAX_COMPLAINT_FILES} files, 10 MB each. Only the Authority sees them.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept={COMPLAINT_FILE_FORMATS}
            onChange={onFilesChosen}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={Paperclip}
            className="mt-3"
            disabled={files.length >= MAX_COMPLAINT_FILES}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose files
          </Button>

          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-900">{file.name}</p>
                    <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                  </div>
                  <IconButton
                    icon={X}
                    label={`Remove ${file.name}`}
                    type="button"
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-medium text-gray-900">Your details (optional)</p>
          <p className="mt-1 text-xs text-gray-500">
            Leave these blank to file anonymously. Without them the Authority cannot come back to
            you for more information.
          </p>
          <div className="mt-3 space-y-3">
            <FormField
              htmlFor="cmp-name"
              label={strings.field.name}
              error={errors.complainantName?.message}
            >
              <Input
                id="cmp-name"
                placeholder="e.g. Mary Deng"
                {...form.register('complainantName')}
              />
            </FormField>
            <FormField
              htmlFor="cmp-email"
              label={strings.field.email}
              error={errors.complainantEmail?.message}
            >
              <Input
                id="cmp-email"
                placeholder={strings.example.email}
                type="email"
                {...form.register('complainantEmail')}
              />
            </FormField>
            <FormField htmlFor="cmp-phone" label="Phone" error={errors.complainantPhone?.message}>
              <Input
                id="cmp-phone"
                placeholder="e.g. +211 92 123 4567"
                {...form.register('complainantPhone')}
              />
            </FormField>
          </div>
        </div>

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          Send to the Authority
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Look up a filed complaint with its reference number and tracking code. */
function TrackPanel({ onBack }: { onBack: () => void }) {
  const [reference, setReference] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ComplaintTracking | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    setError('');
    setResult(null);
    setLoading(true);
    try {
      setResult(await complaintsApi.track(reference.trim(), code.trim()));
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          'We could not find a complaint with that reference number and tracking code.',
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Check on a complaint"
      subtitle="Enter the reference number and tracking code you were given."
      footer={
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800"
        >
          <ArrowLeft size={14} aria-hidden />
          File something new
        </button>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Reference number" htmlFor="track-ref">
          <Input
            id="track-ref"
            placeholder="NCA/CMP/2026/000123"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <Field label="Tracking code" htmlFor="track-code">
          <Input
            id="track-code"
            placeholder="The code from your receipt"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>

        <Button
          className="w-full"
          isLoading={loading}
          disabled={!reference.trim() || !code.trim()}
          onClick={() => void lookup()}
        >
          Check progress
        </Button>

        {result && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{result.subject}</p>
                <p className="mt-0.5 font-mono text-xs text-gray-500">{result.referenceNumber}</p>
              </div>
              <Badge tone={COMPLAINT_STATUS_TONE[result.status]}>
                {COMPLAINT_STATUS_LABELS[result.status]}
              </Badge>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              {joinMeta(
                `Filed on ${formatDate(result.createdAt)}`,
                result.resolvedAt ? `closed on ${formatDate(result.resolvedAt)}` : null,
                result.attachmentCount === 0
                  ? null
                  : result.attachmentCount === 1
                    ? '1 file attached'
                    : `${result.attachmentCount} files attached`,
              )}
            </p>
            {result.resolutionNote && (
              <p className="mt-3 border-t border-gray-200 pt-3 text-sm text-gray-700">
                {result.resolutionNote}
              </p>
            )}
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
