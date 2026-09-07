import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';

type Ticket = { request: number; owner: string | undefined; auth: number; entry: number; epoch: symbol | null };
/** UI callback ownership; upload jobs themselves may safely finish after a tab unmount. */
export function useOwnedOperation() {
  const sequence = useRef(0), active = useRef(true);
  const epoch = useRef<symbol | null>(null);
  useEffect(() => {
    active.current = true;
    epoch.current = Symbol('mounted operation');
    return () => { active.current = false; };
  }, []);
  const begin = useCallback((): Ticket => {
    const auth = useAuthStore.getState();
    return { request: ++sequence.current, owner: auth.user?.id, auth: auth.generation, entry: useSessionStore.getState().entryGeneration, epoch: epoch.current };
  }, []);
  const current = useCallback((ticket: Ticket): boolean => {
    const auth = useAuthStore.getState();
    return active.current && epoch.current === ticket.epoch && sequence.current === ticket.request && auth.user?.id === ticket.owner
      && auth.generation === ticket.auth && useSessionStore.getState().entryGeneration === ticket.entry;
  }, []);
  return useMemo(() => ({ begin, current }), [begin, current]);
}
