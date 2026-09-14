// @TASK P32-RAWFILE - retain the original uploaded file, distinguishing
// "never had one" / "expired" / "missing (anomaly)" in the sessions table.
// @SPEC docs/planning/feedback-2026-09-11/evidence/P32-RAW-FILE.md
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BatchTab } from './BatchTab';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import { useSessionStore } from '@/stores/session-store';
import { getSessions, downloadRawFile } from '@/lib/api';
import type { SessionListItem } from '@/types/api';

vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  getSessions: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue({ projects: [] }),
  downloadRawFile: vi.fn(),
}));

function session(overrides: Partial<SessionListItem>): SessionListItem {
  return {
    session_id: 'sid-1', instrument: 'QuantStudio', num_wells: 96, num_cycles: 40,
    uploaded_at: '2026-09-01T00:00:00+00:00', raw_filename: 'plate.xls',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.getState().reset();
  useLanguageStore.setState({ language: 'en' });
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
});

it('renders nothing extra for a session with no raw file record (legacy/failed-store)', async () => {
  vi.mocked(getSessions).mockResolvedValue([
    session({ raw_file: { status: 'none', original_filename: null, size_bytes: null, sha256: null, stored_at: null, expires_at: null, deleted_at: null } }),
  ]);
  render(<BatchTab />);
  await screen.findByText(/sid-1/);
  expect(screen.queryByLabelText(/Download original file/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /expired/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /missing/i })).not.toBeInTheDocument();
});

it('offers a download for an available raw file, distinct from a legacy session', async () => {
  vi.mocked(getSessions).mockResolvedValue([
    session({
      session_id: 'sid-available',
      raw_file: {
        status: 'available', original_filename: 'plate.xls', size_bytes: 1024, sha256: 'abc',
        stored_at: '2026-09-01T00:00:00+00:00', expires_at: '2099-01-01T00:00:00+00:00', deleted_at: null,
      },
    }),
  ]);
  render(<BatchTab />);
  const button = await screen.findByRole('button', { name: /Download plate\.xls/i });
  expect(button).toBeVisible();
});

it('downloading triggers a real save-as with the original filename, not the session id', async () => {
  vi.mocked(getSessions).mockResolvedValue([
    session({
      session_id: 'sid-available',
      raw_file: {
        status: 'available', original_filename: 'plate.xls', size_bytes: 6, sha256: 'abc',
        stored_at: '2026-09-01T00:00:00+00:00', expires_at: '2099-01-01T00:00:00+00:00', deleted_at: null,
      },
    }),
  ]);
  const blob = new Blob([new Uint8Array([1, 2, 3])]);
  vi.mocked(downloadRawFile).mockResolvedValue(blob);
  let downloadedFilename = '';
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:synthetic');
    static revokeObjectURL = vi.fn();
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloadedFilename = this.download;
  });
  try {
    render(<BatchTab />);
    const button = await screen.findByRole('button', { name: /Download plate\.xls/i });
    button.click();
    await vi.waitFor(() => expect(downloadRawFile).toHaveBeenCalledWith('sid-available'));
    await vi.waitFor(() => expect(downloadedFilename).toBe('plate.xls'));
  } finally {
    click.mockRestore();
  }
});

it('flags the download control when the raw file expires within a week, ahead of deletion', async () => {
  const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  vi.mocked(getSessions).mockResolvedValue([
    session({
      session_id: 'sid-soon',
      raw_file: {
        status: 'available', original_filename: 'plate.xls', size_bytes: 10, sha256: 'abc',
        stored_at: new Date().toISOString(), expires_at: soon, deleted_at: null,
      },
    }),
  ]);
  render(<BatchTab />);
  const button = await screen.findByRole('button', { name: /Download plate\.xls/i });
  expect(button.className).toContain('text-warning');
});

it('reports an expired raw file distinctly from a missing (anomalous) one', async () => {
  vi.mocked(getSessions).mockResolvedValue([
    session({
      session_id: 'sid-expired',
      raw_file: {
        status: 'expired', original_filename: 'old-plate.xls', size_bytes: 100, sha256: 'abc',
        stored_at: '2026-01-01T00:00:00+00:00', expires_at: '2026-04-01T00:00:00+00:00', deleted_at: '2026-04-02T00:00:00+00:00',
      },
    }),
    session({
      session_id: 'sid-missing',
      raw_file: {
        status: 'missing', original_filename: 'ghost-plate.xls', size_bytes: 100, sha256: 'abc',
        stored_at: '2026-08-01T00:00:00+00:00', expires_at: '2099-01-01T00:00:00+00:00', deleted_at: null,
      },
    }),
  ]);
  render(<BatchTab />);
  const expiredIcon = await screen.findByLabelText(/expired on/i);
  const missingIcon = screen.getByLabelText(/unexpectedly missing/i);
  expect(expiredIcon).toBeVisible();
  expect(missingIcon).toBeVisible();
  // Distinct text, not the same "no file" message for both.
  expect(expiredIcon.getAttribute('aria-label')).not.toEqual(missingIcon.getAttribute('aria-label'));
  // No download control offered for either -- only 'available' gets one.
  expect(screen.queryByRole('button', { name: /Download/i })).not.toBeInTheDocument();
});
