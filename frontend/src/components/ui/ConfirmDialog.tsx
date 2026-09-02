import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

/**
 * Standardized destructive-action confirmation (FRONTEND_STANDARDS §3.9) — replaces every
 * `window.confirm`. Spells out the consequence and routes the destructive action through a
 * `danger` primary button. Drive `open` from state and run the action in `onConfirm`.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  tone = 'danger',
  isLoading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  isLoading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose} size="sm">
      <div className="space-y-5">
        <p className="text-sm text-gray-600">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} isLoading={isLoading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
