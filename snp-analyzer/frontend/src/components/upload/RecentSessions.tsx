import { useRecentSessions } from '@/hooks/use-recent-sessions';
import { useI18n } from '@/hooks/use-i18n';
import { RecoveryNotice } from '@/components/shared/RecoveryNotice';

export function RecentSessions() {
  const state = useRecentSessions();
  const { t } = useI18n();
  return <section aria-label={t.recentSessions} className="mt-4">
    <h3 className="text-xs font-medium text-text-muted mb-1.5">{t.recentSessions}</h3>
    <p role="status" aria-live="polite">{state.status === 'loading' ? t.recentLoading : state.status === 'ready' && !state.sessions.length ? t.recentEmpty : ''}</p>
    <p role="status" aria-live="polite">{state.opening ? t.recentOpening : ''}</p>
    <RecoveryNotice reason={state.listError} onRetry={() => void state.reload()} />
    <RecoveryNotice reason={state.openError} onRetry={() => void state.reload()} />
    <div className="flex flex-wrap gap-2">{state.sessions.map(session => <button key={session.session_id} type="button"
      onClick={() => void state.open(session.session_id)} title={session.raw_filename || session.session_id}
      className="max-w-[220px] truncate rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text hover:border-primary">
      {session.raw_filename || session.instrument} · {session.num_wells}{t.wells}
    </button>)}</div>
  </section>;
}
