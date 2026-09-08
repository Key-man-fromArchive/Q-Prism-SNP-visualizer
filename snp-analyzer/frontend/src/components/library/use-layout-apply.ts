import { useRef, useState } from 'react';
import { useOwnedOperation } from '@/hooks/use-owned-operation';
import { useSessionStore } from '@/stores/session-store';
import { ApiError, applyLayout } from '@/lib/api';
import { extractLayoutConflict } from '@/lib/layout-conflict';
import type { SavedLayout } from '@/types/api';

type ApplyTicket = ReturnType<ReturnType<typeof useOwnedOperation>['begin']>;
type Conflict = { layout: SavedLayout; ids: string[]; sid: string; ticket: ApplyTicket };

function conflictIds(error: unknown): string[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const ids = extractLayoutConflict(error)?.conflicting_marker_ids;
  return Array.isArray(ids) && ids.every(id => typeof id === 'string') ? ids : null;
}

/** A confirmation authorizes only the entry which produced its conflict. */
export function useLayoutApply(sessionId: string | null, onFailure: () => void) {
  const owner = useOwnedOperation();
  const running = useRef(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const current = (ticket: ApplyTicket, sid: string) => owner.current(ticket) && useSessionStore.getState().sessionId === sid;

  async function apply(layout: SavedLayout, sid: string, force: boolean) {
    if (running.current) return;
    running.current = true;
    const ticket = owner.begin();
    setApplyingId(layout.id);
    try {
      await applyLayout(layout.id, { sid, force });
      if (!current(ticket, sid)) return;
      setConflict(null);
      window.dispatchEvent(new CustomEvent('markers-changed'));
      window.dispatchEvent(new CustomEvent('welltypes-changed'));
    } catch (error) {
      if (!current(ticket, sid)) return;
      const ids = conflictIds(error);
      if (ids) setConflict({ layout, ids, sid, ticket });
      else onFailure();
    } finally {
      running.current = false;
      if (current(ticket, sid)) setApplyingId(null);
    }
  }
  function load(layout: SavedLayout) {
    if (!sessionId || sessionId !== useSessionStore.getState().sessionId) return;
    void apply(layout, sessionId, false);
  }
  function confirm() {
    if (!conflict || !current(conflict.ticket, conflict.sid)) return;
    void apply(conflict.layout, conflict.sid, true);
  }
  return { applyingId, conflict, load, confirm, cancel: () => setConflict(null) };
}
