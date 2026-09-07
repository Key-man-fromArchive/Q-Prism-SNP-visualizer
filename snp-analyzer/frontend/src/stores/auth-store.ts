import { create } from 'zustand';
import type { AuthMode, LinkedASGContext, User } from '@/types/auth';
import { useAnalysisStore } from './analysis-store';
import { useNavigationStore } from './navigation-store';
import { useSessionStore } from './session-store';
import { useDataStore } from './data-store';
import { clearOwnerViewCache } from '@/lib/session-view-cache';
import { useUploadJobStore } from './upload-job-store';

function clearOwnedSession() {
  useUploadJobStore.getState().reset();
  useAnalysisStore.getState().clear();
  useNavigationStore.getState().clear();
  useSessionStore.getState().reset();
  useDataStore.getState().clearData();
}

interface AuthState {
  generation: number;
  user: User | null;
  authMode: AuthMode;
  linkedContext: LinkedASGContext | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  // Actions
  setUser: (user: User) => void;
  setAuthMode: (mode: AuthMode) => void;
  setLinkedContext: (context: LinkedASGContext | null) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  generation: 0,
  user: null,
  authMode: 'local',
  linkedContext: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) => {
    if (get().user?.id !== user.id) {
      const previous = get().user?.id;
      if (previous) clearOwnerViewCache(previous);
      clearOwnedSession();
    }
    set({ user, generation: get().generation + 1, isAuthenticated: true, isLoading: false });
  },
  setAuthMode: (mode) => set({ authMode: mode }),
  setLinkedContext: (context) => set({ linkedContext: context }),
  clearAuth: () => {
    const owner = get().user?.id;
    if (owner) clearOwnerViewCache(owner);
    clearOwnedSession();
    set({ user: null, generation: get().generation + 1, linkedContext: null, isAuthenticated: false, isLoading: false });
  },
  setLoading: (loading) => set({ isLoading: loading }),
}));
