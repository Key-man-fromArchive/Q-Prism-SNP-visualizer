import { useEffect, useRef, useState } from 'react';
import { assignManualWells } from '@/lib/manual-commands';
import { keyboardAnalysisReady } from '@/lib/keyboard-authority';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useI18n } from './use-i18n';
import type { WellType } from '@/types/api';
import { useUndoStore } from '@/stores/undo-store';

function identity() {
  const session = useSessionStore.getState();
  return `${useAuthStore.getState().user?.id}:${session.sessionId}:${session.entryGeneration}`;
}
export function useKeyboardAssignment() {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const assign = async (type: WellType, requestedWells?: string[]) => {
    if (!keyboardAnalysisReady()) return;
    const sessionId = useSessionStore.getState().sessionId;
    if (!sessionId) return;
    const owner = identity();
    const wells = [...(requestedWells ?? useSelectionStore.getState().selectedWells)];
    if (!wells.length) return;
    const current = () => mounted.current && identity() === owner;
    setMessage('');
    const succeeded = await assignManualWells(wells, type);
    if (!current()) return;
    if (succeeded) {
      setMessage(t.keyboardTypeSaved(wells.length));
      return true;
    }
    if (useUndoStore.getState().error) setMessage(t.undoFailed);
    return false;
  };
  return { assign, message };
}
