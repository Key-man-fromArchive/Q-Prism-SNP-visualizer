import { useI18n } from '@/hooks/use-i18n';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSessionStore } from '@/stores/session-store';

export function WorkspaceRestoreNotice() {
  const { t } = useI18n();
  const status = useNavigationStore(state => state.status);
  const error = useNavigationStore(state => state.error);
  const reasons = useNavigationStore(state => state.reasons);
  if (status === 'ready') return reasons.length ? <p role="status" className="px-6 py-3 text-sm text-text-muted">{t.restoreFallback}</p> : null;
  if (status === 'restoring') return <p role="status" aria-busy="true" className="px-6 py-6 text-text-muted">{t.restoreLoading}</p>;
  const messages: Record<string, string> = { forbidden: t.restoreForbidden, 'not-found': t.restoreNotFound, 'invalid-url': t.restoreInvalidUrl };
  const retry = () => window.dispatchEvent(new Event(useSessionStore.getState().sessionId ? 'workspace-load-retry' : 'workspace-restore-retry'));
  const projects = () => {
    useSessionStore.getState().reset();
    useNavigationStore.getState().setTab('project');
    history.replaceState(null, '', `${location.pathname}?tab=project${location.hash}`);
  };
  return <section role="alert" className="px-6 py-6 text-text">
    <p>{messages[error ?? ''] ?? t.restoreNetwork}</p>
    <div className="flex gap-3 mt-3">
      {error === 'network' && <button type="button" onClick={retry} className="rounded border border-border px-3 py-2">{t.retry}</button>}
      <button type="button" onClick={projects} className="rounded border border-border px-3 py-2">{t.restoreProjects}</button>
    </div>
  </section>;
}
