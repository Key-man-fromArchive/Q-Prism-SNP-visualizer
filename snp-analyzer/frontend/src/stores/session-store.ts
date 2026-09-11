import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getSessionInfo } from '@/lib/api';
import { useSettingsStore } from '@/stores/settings-store';
import type { UploadResponse } from '@/types/api';
import { useAnalysisStore } from './analysis-store';
import { useNavigationStore } from './navigation-store';
import { useSelectionStore } from './selection-store';
import { useUndoStore } from './undo-store';

function invalidateSession() {
  useUndoStore.getState().reset();
  useAnalysisStore.getState().clear();
  useNavigationStore.getState().clear();
  useSelectionStore.getState().setPlaying(false);
  useSelectionStore.getState().clearSelection();
}

interface SessionState {
  restoreQuery: string | null;
  entryReason: 'fresh' | 'reopen';
  entryGeneration: number;
  initialAnalysisAvailable: boolean;
  sessionId: string | null;
  sessionInfo: UploadResponse | null;
  /** Every plate the operator currently has open, active or not. The
   *  navigation store owns WHERE you are inside the active plate; this is
   *  only which plates are on the bench. */
  openSessionIds: string[];
  wellGroups: Record<string, string[]> | null;
  uploadState: 'idle' | 'uploading' | 'packaging' | 'success' | 'error';
  uploadProgress: number; // 0-100
  uploadError: string | null;
  // Actions
  setSession: (id: string, info: UploadResponse, reason?: 'fresh' | 'reopen', query?: string | null) => void;
  loadSession: (id: string) => Promise<boolean>;
  addOpenSession: (id: string) => void;
  closeOpenSession: (id: string) => void;
  syncOpenSessions: (availableIds: string[]) => void;
  clearWorkspace: () => void;
  consumeInitialAnalysis: () => boolean;
  setWellGroups: (groups: Record<string, string[]> | null) => void;
  setUploadState: (state: SessionState['uploadState']) => void;
  setUploadProgress: (progress: number) => void;
  setUploadError: (error: string | null) => void;
  reset: () => void;
}

/** Guards a slow session load from landing after a newer one (or after the
 *  workspace was cleared) and reactivating a plate nobody asked for. */
let sessionLoadRevision = 0;

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
  restoreQuery: null,
  entryReason: 'reopen', entryGeneration: 0, initialAnalysisAvailable: false,
  sessionId: null,
  sessionInfo: null,
  openSessionIds: [],
  wellGroups: null,
  uploadState: 'idle',
  uploadProgress: 0,
  uploadError: null,

  setSession: (id, info, reason = 'reopen', query = null) => {
    sessionLoadRevision += 1;
    invalidateSession();
    useNavigationStore.getState().beginRestore(id);
    // The background mode is a persisted preference but only some runs can be
    // read with it, and the backend rejects the rest rather than distorting
    // them. Loading a run that does not allow the remembered mode would
    // otherwise 400 every data request, so reconcile here — the moment the
    // constraint becomes known — instead of at each of the eight call sites.
    const allowed = info.background_modes;
    const settings = useSettingsStore.getState();
    if (allowed && !allowed.includes(settings.backgroundMode)) {
      settings.setBackgroundMode('none');
    }
    const open = get().openSessionIds;
    set({ restoreQuery: query, sessionId: id, sessionInfo: info, wellGroups: info.well_groups, entryReason: reason,
      openSessionIds: open.includes(id) ? open : [...open, id],
      entryGeneration: get().entryGeneration + 1, initialAnalysisAvailable: reason === 'fresh' });
  },
  consumeInitialAnalysis: () => {
    const available = get().initialAnalysisAvailable;
    set({ initialAnalysisAvailable: false });
    return available;
  },
  /** Activates an already-uploaded plate by id. Returns false when a newer
   *  load (or a workspace reset) overtook this one, so the caller does not
   *  navigate to a plate that is no longer the one being opened. */
  loadSession: async (id) => {
    const revision = ++sessionLoadRevision;
    const info = await getSessionInfo(id);
    if (revision !== sessionLoadRevision) return false;
    get().setSession(id, info, 'reopen');
    return true;
  },
  addOpenSession: (id) => set(state => ({
    openSessionIds: state.openSessionIds.includes(id) ? state.openSessionIds : [...state.openSessionIds, id],
  })),
  closeOpenSession: (id) => set(state => ({
    openSessionIds: state.openSessionIds.filter(sessionId => sessionId !== id),
  })),
  /** Drops plates that no longer exist on the server (deleted elsewhere, or
   *  swept by the retention timer) instead of offering dead tabs. */
  syncOpenSessions: (availableIds) => {
    const available = new Set(availableIds);
    set(state => ({ openSessionIds: state.openSessionIds.filter(id => available.has(id)) }));
  },
  setWellGroups: (groups) => set({ wellGroups: groups }),
  setUploadState: (state) => set({ uploadState: state }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  setUploadError: (error) => set({ uploadError: error }),
  reset: () => {
    sessionLoadRevision += 1;
    invalidateSession();
    set({
      entryReason: 'reopen', initialAnalysisAvailable: false, entryGeneration: get().entryGeneration + 1,
      restoreQuery: null, sessionId: null,
      sessionInfo: null,
      wellGroups: null,
      uploadState: 'idle',
      uploadProgress: 0,
      uploadError: null,
    });
  },
  /** Everything off the bench — used when the identity behind the workspace
   *  changes (logout), where leaving another user's plates listed would be
   *  wrong even though they are only ids. */
  clearWorkspace: () => {
    sessionLoadRevision += 1;
    invalidateSession();
    set({
      entryReason: 'reopen', initialAnalysisAvailable: false, entryGeneration: get().entryGeneration + 1,
      restoreQuery: null, sessionId: null,
      sessionInfo: null,
      openSessionIds: [],
      wellGroups: null,
      uploadState: 'idle',
      uploadProgress: 0,
      uploadError: null,
    });
  },
    }),
    {
      // Only WHICH plates are open survives a reload. Where you were inside the
      // active plate is the navigation store's job, and it lives in the URL.
      name: 'qprism-file-workspace',
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
      partialize: state => ({ openSessionIds: state.openSessionIds }),
      merge: (persisted, current) => {
        const candidate = persisted && typeof persisted === 'object' ? persisted as { openSessionIds?: unknown } : {};
        const openSessionIds = Array.isArray(candidate.openSessionIds)
          ? candidate.openSessionIds.filter((id): id is string => typeof id === 'string')
          : [];
        return { ...current, openSessionIds };
      },
    },
  ),
);
