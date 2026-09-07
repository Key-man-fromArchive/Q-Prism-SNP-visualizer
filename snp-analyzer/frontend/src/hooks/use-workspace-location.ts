import { useEffect, useMemo } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { createLocationRestore } from '@/lib/workspace-location';
import { connectWorkspaceHistory } from '@/lib/workspace-history';

/** URL admission owns only session identity; the existing workspace owns the single result load. */
export function useWorkspaceLocation() {
  const owner = useAuthStore(state => state.user?.id);
  const loading = useAuthStore(state => state.isLoading);
  const entry = useSessionStore(state => state.entryGeneration);
  const controller = useMemo(() => owner ? createLocationRestore(owner) : null, [owner]);
  useEffect(() => {
    if (!controller || loading) return;
    const query = new URLSearchParams(location.search);
    if (query.has('session') || query.has('tab')) void controller.run();
    const retry = () => { void controller.run(); };
    window.addEventListener('workspace-restore-retry', retry);
    return () => { controller.cancel(); window.removeEventListener('workspace-restore-retry', retry); };
  }, [controller, loading]);
  useEffect(() => {
    if (!controller || !owner || loading) return;
    return connectWorkspaceHistory(owner, () => { void controller.run(); });
  }, [controller, owner, loading, entry]);
}
