import { useMutation } from '@tanstack/react-query';
import { collectForExport, downloadCsv, exportFilename, toCsv, type CsvColumn } from '../lib/csv';
import { getErrorMessage } from '../lib/api';
import { useToast } from '../components/ui';

/**
 * Export a filtered list to CSV, exactly as the screen has it filtered.
 *
 * A hook rather than forty lines repeated per screen, and the reason is the wording rather than
 * the plumbing. An export can come back **truncated**, and what the reader is told at that moment
 * is the whole safety of the feature: a spreadsheet that is quietly missing its last four thousand
 * rows is worse than no spreadsheet, because it looks complete. That sentence has to be identical
 * on every screen, and three hand-written copies is three chances for one of them to say nothing.
 *
 * What it does *not* do is fetch everything at once. `collectForExport` pages through the same
 * endpoint the table uses, stopping at `EXPORT_ROW_LIMIT`, so an export of a filter that matches a
 * million rows degrades into a capped file and a warning rather than a request nobody can serve.
 */
export function useCsvExport<T>({
  subject,
  fetchPage,
  columns,
  noun = 'records',
}: {
  /** Names the file: `submissions-2026-09-16.csv`. */
  subject: string;
  /** The same list call the table makes, with the screen's filters already applied. */
  fetchPage: (page: number, pageSize: number) => Promise<{ data: T[]; meta: { hasNext: boolean } }>;
  columns: CsvColumn<T>[];
  /** What is being exported, plural, for the message. */
  noun?: string;
}) {
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const { rows, truncated } = await collectForExport<T>(fetchPage);
      downloadCsv(exportFilename(subject), toCsv(rows, columns));
      return { count: rows.length, truncated };
    },
    onSuccess: ({ count, truncated }) => {
      if (count === 0) {
        // Not a success and not a failure. A file of headers and nothing else would have the
        // reader hunting for what went wrong with a download that worked perfectly.
        toast.warning(`Nothing to export: no ${noun} match the current filters.`);
        return;
      }
      if (truncated) {
        toast.warning(
          `Exported the first ${count.toLocaleString()} ${noun}. Narrow the filters to get the rest.`,
        );
        return;
      }
      toast.success(`Exported ${count.toLocaleString()} ${noun}.`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't build the export")),
  });

  return { run: () => mutation.mutate(), isPending: mutation.isPending };
}
