import { create } from 'zustand';
import type { UploadResponse } from '@/types/api';

interface SessionState {
  sessionId: string | null;
  sessionInfo: UploadResponse | null;
  uploadState: 'idle' | 'uploading' | 'packaging' | 'success' | 'error';
  uploadProgress: number; // 0-100
  uploadError: string | null;
  // Actions
  setSession: (id: string, info: UploadResponse) => void;
  setUploadState: (state: SessionState['uploadState']) => void;
  setUploadProgress: (progress: number) => void;
  setUploadError: (error: string | null) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  sessionInfo: null,
  uploadState: 'idle',
  uploadProgress: 0,
  uploadError: null,

  setSession: (id, info) => set({ sessionId: id, sessionInfo: info }),
  setUploadState: (state) => set({ uploadState: state }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  setUploadError: (error) => set({ uploadError: error }),
  reset: () =>
    set({
      sessionId: null,
      sessionInfo: null,
      uploadState: 'idle',
      uploadProgress: 0,
      uploadError: null,
    }),
}));
