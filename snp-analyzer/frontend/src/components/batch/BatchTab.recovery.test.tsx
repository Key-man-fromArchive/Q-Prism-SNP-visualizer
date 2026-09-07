import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BatchTab } from './BatchTab';
import { ApiError, getSessionInfo, getSessions } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import { useSessionStore } from '@/stores/session-store';
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), getSessions: vi.fn(), getSessionInfo: vi.fn(), getProjects: vi.fn().mockResolvedValue({ projects: [] }) }));
const row = { session_id: 'synthetic', instrument: 'Synthetic', num_wells: 96, num_cycles: 40, uploaded_at: '2026-09-07', raw_filename: 'Synthetic recent' };
beforeEach(() => {
  vi.clearAllMocks(); useSessionStore.getState().reset(); useLanguageStore.setState({ language: 'en' });
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
});
it('shows a fixed failed-list notice instead of empty and retries without leaking raw details', async () => {
  vi.mocked(getSessions).mockRejectedValueOnce(new ApiError('private-secret', 500, {})).mockResolvedValue([]);
  render(<BatchTab />);
  await screen.findByText('The server could not complete this request.');
  expect(screen.queryByText(/private-secret/)).not.toBeInTheDocument();
  expect(screen.queryByText('No sessions. Upload a file first.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry list refresh' }));
  await act(async () => {});
  expect(getSessions).toHaveBeenCalledTimes(2);
});
it('does not publish a held open after logout or call the parent navigation callback', async () => {
  vi.mocked(getSessions).mockResolvedValue([row]);
  let resolve!: (value: Awaited<ReturnType<typeof getSessionInfo>>) => void;
  vi.mocked(getSessionInfo).mockReturnValue(new Promise(done => { resolve = done; }));
  const navigate = vi.fn(); render(<BatchTab onLoadSession={navigate} />);
  await screen.findByText('[Synthetic recent]');
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  act(() => useAuthStore.getState().clearAuth());
  await act(async () => resolve({ ...row, allele2_dye: 'VIC', has_rox: false, suggested_cycle: 40, data_windows: null, well_groups: null,
    cycles: [40], input_revision: 0, analysis_status: 'idle', analysis_pending: false }));
  expect(useSessionStore.getState().sessionId).toBeNull(); expect(navigate).not.toHaveBeenCalled();
});
