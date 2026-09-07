import { beforeEach, expect, it } from 'vitest';
import { useAuthStore } from './auth-store';
import { useAnalysisStore } from './analysis-store';
import { useNavigationStore } from './navigation-store';

beforeEach(() => {
  useAuthStore.getState().clearAuth();
  useAnalysisStore.getState().setSession('s', 'u');
  useNavigationStore.getState().beginRestore('s');
});
it('invalidates analysis tickets synchronously when authentication is cleared', () => {
  const ticket = useAnalysisStore.getState().beginRequest('analysis');
  useAuthStore.getState().clearAuth();
  expect(useAnalysisStore.getState().accept(ticket, { algorithm: 'auto', cycle: 20, assignments: {} })).toBe(false);
  expect(useAnalysisStore.getState().sessionId).toBeNull();
  expect(useNavigationStore.getState().session).toBeNull();
});
it('replacing the owner invalidates in-flight requests, while refreshing the same user does not', () => {
  const user = { id: 'u', username: 'u', display_name: null, role: 'user' as const };
  useAuthStore.getState().setUser(user);
  useAnalysisStore.getState().setSession('s', 'u');
  const ticket = useAnalysisStore.getState().beginRequest('analysis');
  useAuthStore.getState().setUser({ ...user, display_name: 'updated' });
  expect(useAnalysisStore.getState().isCurrent(ticket)).toBe(true);
  useAuthStore.getState().setUser({ ...user, id: 'other' });
  expect(useAnalysisStore.getState().isCurrent(ticket)).toBe(false);
});
