import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { Alert, Button, Card, useToast } from './ui';
import { submissionsApi, submissionKeys } from '../lib/submissions.api';
import { getErrorMessage } from '../lib/api';
import { humaniseKey } from '../lib/format';
import type { WorkbookUploadReport } from '../lib/types';

/**
 * Filling a return offline (Q11).
 *
 * A questionnaire can run to eighty-odd questions and operators file over a slow link around a
 * deadline, so this offers the alternative to typing it all in one session: download the sheet,
 * fill it at leisure, upload it once. Re-uploading a corrected file is safe, which is why the copy
 * says so rather than warning people off.
 */
export function WorkbookPanel({ submissionId }: { submissionId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<WorkbookUploadReport | null>(null);

  const downloadMutation = useMutation({
    mutationFn: () => submissionsApi.downloadWorkbook(submissionId),
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't build that workbook.")),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => submissionsApi.uploadWorkbook(submissionId, file),
    onSuccess: (result) => {
      setReport(result);
      void qc.invalidateQueries({ queryKey: submissionKeys.detail(submissionId) });
      toast.success(
        `${result.applied} ${result.applied === 1 ? 'answer' : 'answers'} loaded from your workbook.`,
      );
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't read that workbook.")),
    onSettled: () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  return (
    <Card>
      <h3 className="text-base font-semibold text-gray-900">Fill this in offline</h3>
      <p className="mt-1 text-sm text-gray-500">
        Download the questions as a spreadsheet, fill in the Value column, then upload it here. You
        can upload a corrected file as many times as you need.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={Download}
          isLoading={downloadMutation.isPending}
          onClick={() => downloadMutation.mutate()}
        >
          Download the workbook
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".xlsx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadMutation.mutate(file);
          }}
        />
        <Button
          variant="secondary"
          icon={Upload}
          isLoading={uploadMutation.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload a filled workbook
        </Button>
      </div>

      {report && (
        <div className="mt-4 space-y-3">
          <Alert tone={report.rejected.length > 0 ? 'warning' : 'success'}>
            <div className="flex gap-2">
              <FileSpreadsheet size={18} aria-hidden className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">
                  {report.applied} {report.applied === 1 ? 'answer' : 'answers'} loaded
                  {report.rejected.length > 0
                    ? `, ${report.rejected.length} ${
                        report.rejected.length === 1 ? 'row' : 'rows'
                      } skipped`
                    : ''}
                  .
                </p>
                {report.rejected.length > 0 && (
                  <p className="mt-1 text-sm">
                    The rows below were left out. Everything else went in, so you can fix just these
                    and upload again.
                  </p>
                )}
              </div>
            </div>
          </Alert>

          {report.rejected.length > 0 && (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {report.rejected.map((row) => (
                <li key={`${row.rowNumber}-${row.key}`} className="px-3 py-2 text-sm">
                  <span className="font-medium text-gray-900">Row {row.rowNumber}</span>
                  {/* The stored key is the sheet's join column, not something to show a person. */}
                  {row.key && (
                    <span className="ml-2 text-xs text-gray-500">{humaniseKey(row.key)}</span>
                  )}
                  <p className="mt-0.5 text-gray-600">{row.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
