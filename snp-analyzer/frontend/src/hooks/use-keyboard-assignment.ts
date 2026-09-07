import { useEffect, useRef, useState } from 'react';
import { setWellTypes } from '@/lib/api';
import { keyboardAnalysisReady } from '@/lib/keyboard-authority';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useI18n } from './use-i18n';
import type { WellType } from '@/types/api';

function identity() {
  const session = useSessionStore.getState();
  return `${useAuthStore.getState().user?.id}:${session.sessionId}:${session.entryGeneration}`;
}
// Shared across popup and global hook instances; not an undo/history mechanism.
const inFlight = new Set<string>();
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function useKeyboardAssignment() {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const assign = async (type: WellType, requestedWells?: string[]) => {
    if (running.current || !keyboardAnalysisReady()) return;
    const sessionId = useSessionStore.getState().sessionId;
    if (!sessionId) return;
    const owner = identity();
    if (inFlight.has(owner)) return;
    const wells = [...(requestedWells ?? useSelectionStore.getState().selectedWells)];
    if (!wells.length) return;
    const current = () => mounted.current && identity() === owner;
    running.current = true;
    inFlight.add(owner);
    setMessage('');
    try {
      await setWellTypes(sessionId, { wells, well_type: type });
      if (!current()) return;
      setMessage(t.keyboardTypeSaved(wells.length));
      window.dispatchEvent(new CustomEvent('welltypes-changed'));
      return true;
    } catch (error) {
      if (current()) setMessage(t.keyboardTypeFailed(errorMessage(error)));
    } finally { running.current = false; inFlight.delete(owner); }
  };
  return { assign, message };
}
