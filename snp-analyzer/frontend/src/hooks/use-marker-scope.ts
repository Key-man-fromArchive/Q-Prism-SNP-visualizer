import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { getMarkers } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import type { MarkerRegion } from '@/types/api';

/** Latest reads only; local edits invalidate reads that began before the edit. */
export function useMarkerScope() {
  const sid = useSessionStore(state => state.sessionId);
  const entry = useSessionStore(state => state.entryGeneration);
  const owner = useAuthStore(state => state.user?.id);
  const identity = `${owner}:${sid}:${entry}`;
  const sequence = useRef(0);
  const [markers, updateMarkers] = useState<MarkerRegion[]>([]);
  const [read, setRead] = useState({ identity: '', status: 'loading', known: false });
  const setMarkers = useCallback((value: SetStateAction<MarkerRegion[]>) => {
    sequence.current++;
    updateMarkers(value);
    setRead(previous => previous.known ? { ...previous, status: 'ready' } : previous);
  }, []);
  useEffect(() => {
    if (!sid) return;
    let active = true;
    const load = async () => {
      const ticket = ++sequence.current;
      setRead(previous => ({ identity, status: 'loading', known: previous.identity === identity && previous.known }));
      try {
        const result = await getMarkers(sid);
        if (!active || ticket !== sequence.current) return;
        updateMarkers(result.markers);
        setRead({ identity, status: 'ready', known: true });
      } catch {
        if (active && ticket === sequence.current) setRead({ identity, status: 'error', known: false });
      }
    };
    void load();
    window.addEventListener('markers-changed', load);
    return () => { active = false; window.removeEventListener('markers-changed', load); };
  }, [sid, identity]);
  return { markers: read.identity === identity ? markers : [], setMarkers, markerStatus: read.identity === identity ? read.status : 'loading' };
}
