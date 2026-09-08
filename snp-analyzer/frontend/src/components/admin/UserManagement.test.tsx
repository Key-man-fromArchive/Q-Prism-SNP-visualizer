import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserManagement } from './UserManagement';
import { getUsers, getAdminDashboard } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
vi.mock('@/lib/api', () => ({ getUsers: vi.fn(), getAdminDashboard: vi.fn(), createUser: vi.fn(), updateUser: vi.fn(), deleteUser: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks(); useLanguageStore.setState({ language: 'en' });
  useAuthStore.setState({ user: { id: 'admin', username: 'admin', role: 'admin', display_name: 'Admin' } });
  vi.mocked(getUsers).mockResolvedValue({ users: [] });
  vi.mocked(getAdminDashboard).mockResolvedValue({ users: [] });
});
it.each(['users', 'dashboard'] as const)('rejects malformed %s 200 safely', async kind => {
  if (kind === 'users') vi.mocked(getUsers).mockResolvedValueOnce({ users: [null] } as unknown as Awaited<ReturnType<typeof getUsers>>);
  else vi.mocked(getAdminDashboard).mockResolvedValueOnce({ users: [null] } as unknown as Awaited<ReturnType<typeof getAdminDashboard>>);
  render(<UserManagement />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load data');
});
it('does not request private admin lists for a non-admin', () => {
  useAuthStore.setState({ user: null }); render(<UserManagement />);
  expect(screen.getByRole('alert')).toHaveTextContent('permission');
  expect(getUsers).not.toHaveBeenCalled(); expect(getAdminDashboard).not.toHaveBeenCalled();
});
it('shows safe retry on failed list, without exposing the response', async () => {
  vi.mocked(getUsers).mockRejectedValueOnce(new Error('private server detail'));
  render(<UserManagement />);
  expect(await screen.findByRole('alert')).not.toHaveTextContent('private server');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('tab', { name: 'User Management' })).toBeInTheDocument();
});
it('discards a held owner response', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getUsers>>) => void;
  vi.mocked(getUsers).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<UserManagement />);
  await act(async () => { useAuthStore.getState().clearAuth(); resolve({ users: [] }); });
  expect(screen.getByRole('alert')).toHaveTextContent('permission');
});
it('keeps long session identifiers discoverable in the member detail table', async () => {
  const sessionId = 'session-identifier-with-more-than-eight-visible-characters';
  vi.mocked(getAdminDashboard).mockResolvedValueOnce({ users: [{
    id: 'member', username: 'long.member', display_name: 'Long Member', role: 'user', is_active: true,
    created_at: '2026-01-01', session_count: 1, project_count: 0, total_data_points: 4,
    sessions: [{ session_id: sessionId, instrument: 'Synthetic', raw_filename: 'long-file.csv', created_at: '2026-01-01', num_wells: 1, num_cycles: 1 }],
    projects: [],
  }] });
  render(<UserManagement />);
  fireEvent.click(await screen.findByRole('button', { name: /Long Member/ }));
  const id = await screen.findByText(sessionId);
  expect(id).toHaveAttribute('aria-label', sessionId);
  expect(id).toHaveAttribute('title', sessionId);
});
