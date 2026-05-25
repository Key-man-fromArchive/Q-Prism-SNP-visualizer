import { create } from 'zustand';
import type { AuthMode, LinkedASGContext, User } from '@/types/auth';

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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  authMode: 'local',
  linkedContext: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) => set({ user, isAuthenticated: true, isLoading: false }),
  setAuthMode: (mode) => set({ authMode: mode }),
  setLinkedContext: (context) => set({ linkedContext: context }),
  clearAuth: () => set({ user: null, linkedContext: null, isAuthenticated: false, isLoading: false }),
  setLoading: (loading) => set({ isLoading: loading }),
}));
