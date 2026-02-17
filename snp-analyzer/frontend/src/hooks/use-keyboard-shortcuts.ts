import { useEffect, useState, useCallback } from 'react';

export interface KeyboardShortcutsCallbacks {
  togglePlay?: () => void;
  prevCycle?: () => void;
  nextCycle?: () => void;
  exportCSV?: () => void;
  toggleDarkMode?: () => void;
  assignWellType?: (type: string) => void;
  undo?: () => void;
  redo?: () => void;
}

/**
 * Hook for registering global keyboard shortcuts
 * @returns showHelp state and setShowHelp setter for help overlay
 */
export function useKeyboardShortcuts(callbacks: KeyboardShortcutsCallbacks): {
  showHelp: boolean;
  setShowHelp: (v: boolean) => void;
} {
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Skip if user is typing in an input field
      const target = e.target as HTMLElement;
      const isInputField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (isInputField) return;

      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      // Handle keyboard shortcuts
      switch (e.key) {
        case ' ':
          e.preventDefault();
          callbacks.togglePlay?.();
          break;

        case 'ArrowLeft':
          e.preventDefault();
          callbacks.prevCycle?.();
          break;

        case 'ArrowRight':
          e.preventDefault();
          callbacks.nextCycle?.();
          break;

        case 'e':
        case 'E':
          if (ctrlOrCmd) {
            e.preventDefault();
            callbacks.exportCSV?.();
          }
          break;

        case 'd':
        case 'D':
          if (!ctrlOrCmd) {
            e.preventDefault();
            callbacks.toggleDarkMode?.();
          }
          break;

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
          if (!ctrlOrCmd) {
            e.preventDefault();
            const typeMap: Record<string, string> = {
              '1': 'NTC',
              '2': 'Unknown',
              '3': 'Positive Control',
              '4': 'Allele 1 Homo',
              '5': 'Allele 2 Homo',
              '6': 'Heterozygous',
              '7': 'Undetermined',
            };
            callbacks.assignWellType?.(typeMap[e.key]);
          }
          break;

        case '?':
          e.preventDefault();
          setShowHelp((prev) => !prev);
          break;

        case 'Escape':
          if (showHelp) {
            e.preventDefault();
            setShowHelp(false);
          }
          break;

        case 'z':
        case 'Z':
          if (ctrlOrCmd) {
            e.preventDefault();
            if (e.shiftKey) {
              callbacks.redo?.();
            } else {
              callbacks.undo?.();
            }
          }
          break;

        case 'y':
        case 'Y':
          if (ctrlOrCmd) {
            e.preventDefault();
            callbacks.redo?.();
          }
          break;

        default:
          break;
      }
    },
    [callbacks, showHelp]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { showHelp, setShowHelp };
}
