import { RecoveryNotice } from '@/components/shared/RecoveryNotice';
import { useI18n } from '@/hooks/use-i18n';
import type { useRecentSessions } from '@/hooks/use-recent-sessions';

export function SessionRecoveryFeedback({ state }: { state: ReturnType<typeof useRecentSessions> }) {
  const { t } = useI18n();
  return <div>
    <p role="status" aria-live="polite">{state.status === 'loading' ? t.recentLoading : ''}</p>
    <RecoveryNotice reason={state.listError} onRetry={() => void state.reload()} />
    <RecoveryNotice reason={state.openError} onRetry={() => void state.reload()} />
  </div>;
}
export function SessionEmptyState({ status }: { status: 'loading' | 'ready' | 'error' }) {
  const { t } = useI18n();
  return <p role="status" className="text-text-muted text-sm text-center py-6">{status === 'ready' ? t.noSessions : ''}</p>;
}
