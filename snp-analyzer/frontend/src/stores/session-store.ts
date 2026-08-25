import { create } from 'zustand';
import { useSettingsStore } from '@/stores/settings-store';
import type { UploadResponse } from '@/types/api';

interface SessionState {
  sessionId: string | null;
  sessionInfo: UploadResponse | null;
  wellGroups: Record<string, string[]> | null;
  uploadState: 'idle' | 'uploading' | 'packaging' | 'success' | 'error';
  uploadProgress: number; // 0-100
  uploadError: string | null;
  // Actions
  setSession: (id: string, info: UploadResponse) => void;
  setWellGroups: (groups: Record<string, string[]> | null) => void;
  setUploadState: (state: SessionState['uploadState']) => void;
  setUploadProgress: (progress: number) => void;
  setUploadError: (error: string | null) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  sessionInfo: null,
  wellGroups: null,
  uploadState: 'idle',
  uploadProgress: 0,
  uploadError: null,

  setSession: (id, info) => {
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
    set({ sessionId: id, sessionInfo: info, wellGroups: info.well_groups });
  },
  setWellGroups: (groups) => set({ wellGroups: groups }),
  setUploadState: (state) => set({ uploadState: state }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  setUploadError: (error) => set({ uploadError: error }),
  reset: () =>
    set({
      sessionId: null,
      sessionInfo: null,
      wellGroups: null,
      uploadState: 'idle',
      uploadProgress: 0,
      uploadError: null,
    }),
}));
