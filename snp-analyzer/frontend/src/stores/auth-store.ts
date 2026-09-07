import { create } from 'zustand';
import type { AuthMode, LinkedASGContext, User } from '@/types/auth';
import { useAnalysisStore } from './analysis-store';
import { useNavigationStore } from './navigation-store';
import { useSessionStore } from './session-store';
import { useDataStore } from './data-store';

function clearOwnedSession() {
  useAnalysisStore.getState().clear();
  useNavigationStore.getState().clear();
  useSessionStore.getState().reset();
  useDataStore.getState().clearData();
}

interface AuthState {
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
  user: null,
  authMode: 'local',
  linkedContext: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) => {
    if (get().user?.id !== user.id) clearOwnedSession();
    set({ user, isAuthenticated: true, isLoading: false });
  },
  setAuthMode: (mode) => set({ authMode: mode }),
  setLinkedContext: (context) => set({ linkedContext: context }),
  clearAuth: () => {
    clearOwnedSession();
    set({ user: null, linkedContext: null, isAuthenticated: false, isLoading: false });
  },
  setLoading: (loading) => set({ isLoading: loading }),
}));
