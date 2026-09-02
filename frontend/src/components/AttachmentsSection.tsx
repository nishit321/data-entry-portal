import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  IconButton,
  Select,
  useToast,
  type SelectOption,
} from './ui';
import { attachmentsApi, attachmentKeys } from '../lib/attachments.api';
import { submissionKeys } from '../lib/submissions.api';
import { getErrorMessage } from '../lib/api';
import { formatDate, formatFileSize, joinMeta } from '../lib/format';
import {
  ATTACHMENT_KIND_FORMATS,
  ATTACHMENT_KIND_LABELS,
  ATTACHMENT_KINDS,
  type AttachmentKind,
  type SubmissionAttachment,
} from '../lib/types';

const KIND_OPTIONS: SelectOption[] = ATTACHMENT_KINDS.map((k) => ({
  value: k,
  label: ATTACHMENT_KIND_LABELS[k],
}));

interface AttachmentsSectionProps {
  submissionId: string;
  /** True only for the owning operator while the return is an editable draft. */
  editable: boolean;
  initial: SubmissionAttachment[];
}

export function AttachmentsSection({ submissionId, editable, initial }: AttachmentsSectionProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AttachmentKind>('COVERAGE_MAP');
  const [selectedName, setSelectedName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SubmissionAttachment | null>(null);

  const listQuery = useQuery({
    queryKey: attachmentKeys.list(submissionId),
    queryFn: () => attachmentsApi.list(submissionId),
    initialData: initial,
  });
  const attachments = listQuery.data ?? [];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: attachmentKeys.list(submissionId) });
    void qc.invalidateQueries({ queryKey: submissionKeys.detail(submissionId) });
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => attachmentsApi.upload(submissionId, kind, file),
    onSuccess: (att) => {
      toast.success(`${att.fileName} uploaded.`);
      resetPicker();
      refresh();
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't upload that file.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(submissionId, id),
    onSuccess: () => {
      toast.success('File removed.');
      setPendingDelete(null);
      refresh();
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove that file.")),
  });

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  async function handleDownload(att: SubmissionAttachment) {
    setDownloadingId(att.id);
    try {
      await attachmentsApi.download(submissionId, att);
    } catch (err) {
      toast.error(getErrorMessage(err, "We couldn't download that file."));
    } finally {
      setDownloadingId(null);
    }
  }

  function resetPicker() {
    setSelectedName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedName(file.name);
      uploadMutation.mutate(file);
    }
  }

  return (
    <Card>
      <h3 className="text-base font-semibold text-gray-900">Supporting files</h3>
      <p className="mt-1 text-sm text-gray-500">
        Coverage and fibre maps, agent registers, and any other documents that go with this return.
      </p>

      {editable && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[16rem_auto] sm:items-end">
          <Field label="File type" htmlFor="attachment-kind" hint={ATTACHMENT_KIND_FORMATS[kind]}>
            <Select
              id="attachment-kind"
              value={kind}
              options={KIND_OPTIONS}
              onChange={(v) => setKind(v as AttachmentKind)}
            />
          </Field>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={ATTACHMENT_KIND_FORMATS[kind]}
              onChange={onFileChosen}
            />
            <Button
              type="button"
              variant="secondary"
              icon={Paperclip}
              isLoading={uploadMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              Add a file
            </Button>
            {selectedName && uploadMutation.isPending && (
              <span className="ml-2 text-sm text-gray-500">{selectedName}</span>
            )}
          </div>
        </div>
      )}

      <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
        {attachments.length === 0 && (
          <li className="py-4 text-sm text-gray-500">No files have been added yet.</li>
        )}
        {attachments.map((att) => (
          <li key={att.id} className="flex items-center gap-3 py-3">
            <FileText className="size-5 shrink-0 text-gray-500" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{att.fileName}</p>
              <p className="text-xs text-gray-500">
                {joinMeta(
                  ATTACHMENT_KIND_LABELS[att.kind],
                  formatFileSize(att.sizeBytes),
                  `added ${formatDate(att.createdAt)}`,
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Download}
              isLoading={downloadingId === att.id}
              onClick={() => void handleDownload(att)}
            >
              Download
            </Button>
            {editable && (
              <IconButton
                icon={Trash2}
                label={`Remove ${att.fileName}`}
                variant="danger"
                onClick={() => setPendingDelete(att)}
              />
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this file?"
        confirmLabel="Remove"
        tone="danger"
        isLoading={deleteMutation.isPending}
        message={pendingDelete ? `${pendingDelete.fileName} will be removed from this return.` : ''}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </Card>
  );
}
