import { useNavigationStore } from '@/stores/navigation-store';
import { useSessionStore } from '@/stores/session-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSelectionStore } from '@/stores/selection-store';
import type { ShortcutAction } from '@/hooks/use-keyboard-shortcuts';
import { canMoveManual } from '@/lib/manual-commands';
import { useUndoStore } from '@/stores/undo-store';

export function keyboardAnalysisReady(): boolean {
  const nav = useNavigationStore.getState();
  const analysis = useAnalysisStore.getState();
  const session = useSessionStore.getState().sessionId;
  return Boolean(session) && nav.session === session && analysis.sessionId === session
    && nav.tab === 'analysis' && nav.status === 'ready' && !nav.exportRestoring
    && !analysis.pending && !analysis.inputRevisionRefreshing;
}
export function keyboardCanExecute(action: ShortcutAction): boolean {
  if (action === 'help' || action === 'toggleDarkMode') return true;
  if (action === 'undo') return canMoveManual(-1);
  if (action === 'redo') return canMoveManual(1);
  if (!keyboardAnalysisReady()) return false;
  if (action === 'assignWellType') return !useUndoStore.getState().pending && useSelectionStore.getState().selectedWells.length > 0;
  if (action === 'exportCSV') return keyboardExportReady();
  return true;
}
function keyboardExportReady(): boolean {
    const state = useAnalysisStore.getState();
    return Boolean(state.result?.analysis_context) && state.currentInputRevision !== null
      && state.currentInputRevision === state.result?.analysis_context?.input_revision;
}
