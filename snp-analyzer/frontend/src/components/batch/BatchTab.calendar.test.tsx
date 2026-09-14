// @TASK P29-CALENDAR - toggle to the calendar view and open sessions from it
// @SPEC 사용자 요청 "이전작업내역을 달력형태로 볼 수 있으면 좋겠습니다" (feedback-2026-09-11)
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BatchTab } from './BatchTab';
import { ApiError, getSessionInfo, getSessions } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import { useSessionStore } from '@/stores/session-store';

vi.mock('@/lib/api', async original => ({
  ...await original<typeof import('@/lib/api')>(),
  getSessions: vi.fn(), getSessionInfo: vi.fn(),
  getProjects: vi.fn().mockResolvedValue({ projects: [] }),
}));

const row = { session_id: 'synthetic', instrument: 'Synthetic', num_wells: 96, num_cycles: 40,
  uploaded_at: '2026-09-14 04:55:29', raw_filename: 'run.eds' };

beforeEach(() => {
  vi.clearAllMocks(); useSessionStore.getState().reset(); useLanguageStore.setState({ language: 'en' });
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  vi.mocked(getSessions).mockResolvedValue([row]);
});

it('switches to the calendar view and loads a session picked from a day, reusing the existing open path', async () => {
  const info = { ...row, allele2_dye: 'VIC', has_rox: false, suggested_cycle: 40, data_windows: null, well_groups: null,
    cycles: [40], input_revision: 0, analysis_status: 'idle' as const, analysis_pending: false };
  vi.mocked(getSessionInfo).mockResolvedValueOnce(info);
  const navigate = vi.fn();
  render(<BatchTab onLoadSession={navigate} />);
  await screen.findByText('[run.eds]');
  fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
  fireEvent.click(screen.getByRole('gridcell', { name: /September 14, 2026/ }));
  fireEvent.click(screen.getByRole('button', { name: /run\.eds/ }));
  await act(async () => {});
  expect(getSessionInfo).toHaveBeenCalledWith('synthetic');
  expect(useSessionStore.getState().sessionId).toBe('synthetic');
  expect(navigate).toHaveBeenCalled();
});

it('surfaces a failed open from the calendar the same way the table does', async () => {
  vi.mocked(getSessionInfo).mockRejectedValueOnce(new ApiError('secret', 404, {}));
  render(<BatchTab />);
  await screen.findByText('[run.eds]');
  fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
  fireEvent.click(screen.getByRole('gridcell', { name: /September 14, 2026/ }));
  fireEvent.click(screen.getByRole('button', { name: /run\.eds/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This item no longer exists. Refresh the list.');
  expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  expect(useSessionStore.getState().sessionId).toBeNull();
});

it('keeps the table view as the default and preserves the existing table when switching back', async () => {
  render(<BatchTab />);
  await screen.findByText('[run.eds]');
  expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('columnheader', { name: 'Instrument' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
  expect(screen.queryByRole('columnheader', { name: 'Instrument' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  expect(screen.getByRole('columnheader', { name: 'Instrument' })).toBeInTheDocument();
});
