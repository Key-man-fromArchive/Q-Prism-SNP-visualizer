import { useEffect, useEffectEvent } from 'react';
import { getWellTypes } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';
import type { WellTypesResponse } from '@/types/api';

function owns(owner: string, sid: string, entry: number): boolean {
  const session = useSessionStore.getState();
  return useAuthStore.getState().user?.id === owner && session.sessionId === sid && session.entryGeneration === entry;
}
function obsolete(response: WellTypesResponse): boolean {
  const revision = useAnalysisStore.getState().knownInputRevision;
  return revision !== null && response.input_revision < revision;
}
/** Guards both shared assignments and consumer-specific imported-type metadata. */
export function useWellTypeAssignments(onSnapshot?: (response: WellTypesResponse) => void) {
  const owner = useAuthStore(state => state.user?.id);
  const sid = useSessionStore(state => state.sessionId);
  const entry = useSessionStore(state => state.entryGeneration);
  const accept = useEffectEvent((response: WellTypesResponse) => {
    useDataStore.getState().setWellTypeAssignments({ ...response.assignments });
    onSnapshot?.(response);
  });
  useEffect(() => {
    if (!owner || !sid) return;
    let sequence = 0, active = true;
    const load = async () => {
      const request = ++sequence;
      try {
        const response = await getWellTypes(sid);
        if (!active || request !== sequence || !owns(owner, sid, entry) || obsolete(response)) return;
        accept(response);
      } catch { /* Keep the last accepted display; command failures are announced separately. */ }
    };
    void load();
    window.addEventListener('welltypes-changed', load);
    return () => { active = false; sequence++; window.removeEventListener('welltypes-changed', load); };
  }, [owner, sid, entry]);
}
