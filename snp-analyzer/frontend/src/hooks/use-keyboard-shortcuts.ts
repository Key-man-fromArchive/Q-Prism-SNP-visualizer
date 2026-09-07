import { useEffect, useEffectEvent, useState } from 'react';
import { ownsKeyboardEvent } from '@/lib/keyboard-routing';
import type { WellType } from '@/types/api';

export type ShortcutAction = 'togglePlay' | 'prevCycle' | 'nextCycle' | 'exportCSV'
  | 'toggleDarkMode' | 'assignWellType' | 'undo' | 'redo' | 'help';
export type KeyboardShortcutsCallbacks = Partial<Record<Exclude<ShortcutAction, 'assignWellType' | 'help'>, () => void>> & {
  assignWellType?: (type: WellType) => void;
  canExecute?: (action: ShortcutAction) => boolean;
};
const types: Record<string, WellType> = {
  '1': 'NTC', '2': 'Unknown', '3': 'Positive Control', '4': 'Allele 1 Homo',
  '5': 'Allele 2 Homo', '6': 'Heterozygous', '7': 'Undetermined',
};
function command(event: KeyboardEvent): ShortcutAction | null {
  const mac = navigator.platform.toUpperCase().includes('MAC');
  const primaryOnly = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  // Shared undo/CAS is P3-S2: do not consume native undo with local history.
  if (!primaryOnly || event.shiftKey) return null;
  return event.key.toLowerCase() === 'e' ? 'exportCSV' : null;
}
function actionFor(event: KeyboardEvent): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey) return command(event);
  if (event.key === '?') return 'help';
  if (event.shiftKey) return null;
  if (types[event.key]) return 'assignWellType';
  const plain: Record<string, ShortcutAction> = {
    ' ': 'togglePlay', ArrowLeft: 'prevCycle', ArrowRight: 'nextCycle', d: 'toggleDarkMode', D: 'toggleDarkMode',
  };
  return plain[event.key] ?? null;
}
function invoke(callbacks: KeyboardShortcutsCallbacks, action: Exclude<ShortcutAction, 'help'>, key: string): boolean {
  if (action === 'assignWellType') {
    if (!callbacks.assignWellType) return false;
    callbacks.assignWellType(types[key]); return true;
  }
  const callback = callbacks[action];
  if (!callback) return false;
  callback(); return true;
}
export function useKeyboardShortcuts(callbacks: KeyboardShortcutsCallbacks) {
  const [showHelp, setShowHelp] = useState(false);
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (ownsKeyboardEvent(event)) return;
    const action = actionFor(event);
    if (!action || callbacks.canExecute?.(action) === false) return;
    if (action === 'help') { event.preventDefault(); setShowHelp(true); return; }
    if (invoke(callbacks, action, event.key)) event.preventDefault();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handle(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  return { showHelp, setShowHelp };
}
