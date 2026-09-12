import { useNavigationStore, isWorkspaceTab } from '@/stores/navigation-store';
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
  // P3-S1-T1: the single "Analysis" tab split into top-level "Plate Setup" /
  // "Results" tabs -- shortcuts stay live on either (isWorkspaceTab also
  // covers the transient legacy 'analysis' value quality-navigation.ts still writes).
  return Boolean(session) && nav.session === session && analysis.sessionId === session
    && isWorkspaceTab(nav.tab) && nav.status === 'ready' && !nav.exportRestoring
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
