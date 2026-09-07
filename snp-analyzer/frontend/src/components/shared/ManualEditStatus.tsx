import { useI18n } from '@/hooks/use-i18n';
import type { UndoError } from '@/stores/undo-store';

export function ManualEditStatus({ pending, error }: { pending: boolean; error: UndoError }) {
  const { t } = useI18n();
  const errors = { conflict: t.undoConflict, unavailable: t.undoUnavailable, failed: t.undoFailed };
  const message = pending ? t.undoPending : error && errors[error];
  return <div role="status" aria-live="polite" aria-atomic="true"
    className="w-full px-6 text-sm text-text-muted bg-surface empty:hidden py-2 border-b border-border">{message}</div>;
}
