import { create } from 'zustand';
import { useSettingsStore } from '@/stores/settings-store';
import type { UploadResponse } from '@/types/api';
import { useAnalysisStore } from './analysis-store';
import { useNavigationStore } from './navigation-store';
import { useSelectionStore } from './selection-store';

function invalidateSession() {
  useAnalysisStore.getState().clear();
  useNavigationStore.getState().clear();
  useSelectionStore.getState().setPlaying(false);
  useSelectionStore.getState().clearSelection();
}

interface SessionState {
  entryReason: 'fresh' | 'reopen';
  entryGeneration: number;
  initialAnalysisAvailable: boolean;
  sessionId: string | null;
  sessionInfo: UploadResponse | null;
  wellGroups: Record<string, string[]> | null;
  uploadState: 'idle' | 'uploading' | 'packaging' | 'success' | 'error';
  uploadProgress: number; // 0-100
  uploadError: string | null;
  // Actions
  setSession: (id: string, info: UploadResponse, reason?: 'fresh' | 'reopen') => void;
  consumeInitialAnalysis: () => boolean;
  setWellGroups: (groups: Record<string, string[]> | null) => void;
  setUploadState: (state: SessionState['uploadState']) => void;
  setUploadProgress: (progress: number) => void;
  setUploadError: (error: string | null) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  entryReason: 'reopen', entryGeneration: 0, initialAnalysisAvailable: false,
  sessionId: null,
  sessionInfo: null,
  wellGroups: null,
  uploadState: 'idle',
  uploadProgress: 0,
  uploadError: null,

  setSession: (id, info, reason = 'reopen') => {
    invalidateSession();
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
    set({ sessionId: id, sessionInfo: info, wellGroups: info.well_groups, entryReason: reason,
      entryGeneration: get().entryGeneration + 1, initialAnalysisAvailable: reason === 'fresh' });
  },
  consumeInitialAnalysis: () => {
    const available = get().initialAnalysisAvailable;
    set({ initialAnalysisAvailable: false });
    return available;
  },
  setWellGroups: (groups) => set({ wellGroups: groups }),
  setUploadState: (state) => set({ uploadState: state }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  setUploadError: (error) => set({ uploadError: error }),
  reset: () => {
    invalidateSession();
    set({
      entryReason: 'reopen', initialAnalysisAvailable: false, entryGeneration: get().entryGeneration + 1,
      sessionId: null,
      sessionInfo: null,
      wellGroups: null,
      uploadState: 'idle',
      uploadProgress: 0,
      uploadError: null,
    });
  },
}));
