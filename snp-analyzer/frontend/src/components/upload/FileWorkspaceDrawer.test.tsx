import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FileWorkspaceDrawer } from './FileWorkspaceDrawer';
import { useSessionStore } from '@/stores/session-store';
import { useLanguageStore } from '@/stores/language-store';
import type { UploadResponse } from '@/types/api';

const api = vi.hoisted(() => ({
  getSessions: vi.fn(),
  getSessionInfo: vi.fn(),
  previewImportFile: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('@/lib/api', () => api);

function info(id: string, filename: string): UploadResponse {
  return {
    session_id: id,
    raw_filename: filename,
    instrument: 'CFX Opus',
    allele2_dye: 'HEX',
    num_wells: 96,
    num_cycles: 40,
    has_rox: false,
    data_windows: null,
    suggested_cycle: 40,
    background_modes: ['none'],
    well_groups: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('FileWorkspaceDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLanguageStore.setState({ language: 'en' });
    sessionStorage.clear();
    useSessionStore.setState({
      sessionId: null,
      sessionInfo: null,
      wellGroups: null,
      openSessionIds: [],
      uploadState: 'idle',
      uploadProgress: 0,
      uploadError: null,
    });
    api.getSessions.mockResolvedValue([]);
  });

  it('uploads multiple files without replacing the active analysis', async () => {
    useSessionStore.getState().setSession('active', info('active', 'active.pcrd'));
    const activeSummary = {
        session_id: 'active',
        raw_filename: 'active.pcrd',
        instrument: 'CFX Opus',
        num_wells: 96,
        num_cycles: 40,
        uploaded_at: '',
      };
    api.getSessions
      .mockResolvedValueOnce([activeSummary])
      .mockResolvedValue([
        activeSummary,
        { ...activeSummary, session_id: 'new-a', raw_filename: 'new-a.pcrd' },
        { ...activeSummary, session_id: 'new-b', raw_filename: 'new-b.eds' },
      ]);
    api.uploadFile
      .mockResolvedValueOnce(info('new-a', 'new-a.pcrd'))
      .mockResolvedValueOnce(info('new-b', 'new-b.eds'));
    render(<FileWorkspaceDrawer />);

    fireEvent.click(screen.getByRole('button', { name: /files/i }));
    const dropTarget = screen.getByText(/drop pcr files here/i).closest('div');
    expect(dropTarget).not.toBeNull();
    fireEvent.drop(dropTarget!, {
      dataTransfer: {
        files: [
          new File(['a'], 'new-a.pcrd', { type: 'application/octet-stream' }),
          new File(['b'], 'new-b.eds', { type: 'application/octet-stream' }),
        ],
      },
    });

    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText(/success ·/i)).toHaveLength(2));
    expect(useSessionStore.getState().sessionId).toBe('active');
    expect(useSessionStore.getState().openSessionIds).toEqual(['active', 'new-a', 'new-b']);
  });

  it('adds a recent file to the workspace and opens it on demand', async () => {
    api.getSessions.mockResolvedValue([
      {
        session_id: 'recent',
        raw_filename: 'recent.pcrd',
        instrument: 'QuantStudio',
        num_wells: 384,
        num_cycles: 40,
        uploaded_at: '2026-09-11T00:00:00Z',
      },
    ]);
    api.getSessionInfo.mockResolvedValue(info('recent', 'recent.pcrd'));
    const onOpenSession = vi.fn();
    render(<FileWorkspaceDrawer onOpenSession={onOpenSession} />);

    fireEvent.click(screen.getByRole('button', { name: /files/i }));
    await screen.findByText('recent.pcrd');
    fireEvent.click(screen.getByRole('button', { name: /^open$/i }));

    await waitFor(() => expect(useSessionStore.getState().sessionId).toBe('recent'));
    expect(onOpenSession).toHaveBeenCalledOnce();
    expect(useSessionStore.getState().openSessionIds).toContain('recent');
  });

  it('processes raw uploads sequentially', async () => {
    const first = deferred<UploadResponse>();
    api.uploadFile
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(info('second', 'second.pcrd'));
    render(<FileWorkspaceDrawer />);

    fireEvent.click(screen.getByRole('button', { name: /files/i }));
    const dropTarget = screen.getByText(/drop pcr files here/i).closest('div');
    fireEvent.drop(dropTarget!, {
      dataTransfer: {
        files: [
          new File(['a'], 'first.pcrd'),
          new File(['b'], 'second.pcrd'),
        ],
      },
    });

    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledTimes(1));
    first.resolve(info('first', 'first.pcrd'));
    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledTimes(2));
  });

  it('does not let an older session-list response remove a newly uploaded file', async () => {
    const initialList = deferred<unknown[]>();
    const uploaded = {
      session_id: 'new-session',
      raw_filename: 'new-session.pcrd',
      instrument: 'CFX Opus',
      num_wells: 96,
      num_cycles: 40,
      uploaded_at: '2026-09-11T00:00:00Z',
    };
    api.getSessions
      .mockReturnValueOnce(initialList.promise)
      .mockResolvedValueOnce([uploaded]);
    api.uploadFile.mockResolvedValue(info('new-session', 'new-session.pcrd'));
    render(<FileWorkspaceDrawer />);

    fireEvent.click(screen.getByRole('button', { name: /files/i }));
    const dropTarget = screen.getByText(/drop pcr files here/i).closest('div');
    fireEvent.drop(dropTarget!, {
      dataTransfer: { files: [new File(['a'], 'new-session.pcrd')] },
    });

    await waitFor(() => expect(api.getSessions).toHaveBeenCalledTimes(2));
    initialList.resolve([]);
    await waitFor(() => expect(useSessionStore.getState().openSessionIds).toContain('new-session'));
  });
});
