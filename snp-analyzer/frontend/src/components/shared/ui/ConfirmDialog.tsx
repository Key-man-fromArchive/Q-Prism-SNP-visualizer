import { Modal } from "./Modal";
import { Button } from "./Button";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** Body message; can include an irreversible-action warning. */
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** danger styles the confirm button + uses role=alertdialog. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Shared confirmation dialog (PRD FR-CN-1) replacing window.confirm. Destructive
 * actions pass danger to get the alertdialog role and a danger confirm button.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      role={danger ? "alertdialog" : "dialog"}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
