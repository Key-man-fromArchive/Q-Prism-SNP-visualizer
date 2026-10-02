import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_QC_SETTINGS, type AmplificationQcSettings } from '@/lib/amplification-qc';
import { useSessionStore } from '@/stores/session-store';

/** Amplification QC choices and editor-open state of one session. */
interface SessionQc {
  settings: AmplificationQcSettings;
  open: boolean;
}

interface QcUiState {
  bySession: Record<string, SessionQc>;
  patchSettings: (sessionId: string, patch: Partial<AmplificationQcSettings>) => void;
  setOpen: (sessionId: string, open: boolean) => void;
}

const DEFAULT_SESSION_QC: SessionQc = { settings: DEFAULT_QC_SETTINGS, open: false };
const NO_SESSION = '';

/** Per-session, localStorage-persisted, so a reload or session restore keeps the operator's choices. */
export const useQcUiStore = create<QcUiState>()(
  persist(
    (set, get) => ({
      bySession: {},
      patchSettings: (id, patch) => {
        const cur = get().bySession[id] ?? DEFAULT_SESSION_QC;
        set({ bySession: { ...get().bySession, [id]: { ...cur, settings: { ...cur.settings, ...patch } } } });
      },
      setOpen: (id, open) => {
        const cur = get().bySession[id] ?? DEFAULT_SESSION_QC;
        set({ bySession: { ...get().bySession, [id]: { ...cur, open } } });
      },
    }),
    { name: 'snp-analyzer-qc-by-session', storage: createJSONStorage(() => window.localStorage) },
  ),
);

/** QC settings / editor state of the active session (defaults when none or untouched). */
export function useSessionQc() {
  const id = useSessionStore((s) => s.sessionId) ?? NO_SESSION;
  const entry = useQcUiStore((s) => s.bySession[id]) ?? DEFAULT_SESSION_QC;
  const patchSettings = useQcUiStore((s) => s.patchSettings);
  const setOpen = useQcUiStore((s) => s.setOpen);
  return {
    settings: entry.settings,
    open: entry.open,
    setSettings: (patch: Partial<AmplificationQcSettings>) => patchSettings(id, patch),
    setOpen: (open: boolean) => setOpen(id, open),
  };
}
