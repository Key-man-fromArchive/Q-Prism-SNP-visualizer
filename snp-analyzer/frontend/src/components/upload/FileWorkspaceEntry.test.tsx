import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FileWorkspaceDrawer } from './FileWorkspaceDrawer';
import { FileWorkspaceTrigger } from './FileWorkspaceTrigger';
import { useFileWorkspaceStore } from '@/stores/file-workspace-store';
import { useSessionStore } from '@/stores/session-store';
import { useLanguageStore } from '@/stores/language-store';
import type { UploadResponse } from '@/types/api';

// FB-02 / P5-S1-T1: the entry point is two mutually-exclusive triggers
// (header once a session exists, inline next to UploadZone before one
// does) sharing one always-mounted panel. This mirrors exactly how
// App.tsx wires Header + FileWorkspaceDrawer + UploadZone, without pulling
// in all of App's auth/navigation machinery.
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
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Renders exactly the same shape App.tsx does: one trigger visible at a
 *  time, driven by whether a session is active, plus the always-mounted
 *  panel. `hasSession` is a plain prop so the test controls the flip
 *  directly instead of driving it through a real upload. */
function TestHost({ hasSession }: { hasSession: boolean }) {
  return (
    <>
      {hasSession
        ? <FileWorkspaceTrigger placement="header" />
        : <FileWorkspaceTrigger placement="inline" />}
      <FileWorkspaceDrawer />
    </>
  );
}

function ToggleableHost() {
  const [hasSession, setHasSession] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setHasSession(true)}>simulate session created</button>
      <TestHost hasSession={hasSession} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useLanguageStore.setState({ language: 'en' });
  useFileWorkspaceStore.setState({ open: false, triggers: {} });
  useSessionStore.setState({
    sessionId: null, sessionInfo: null, wellGroups: null, openSessionIds: [],
    uploadState: 'idle', uploadProgress: 0, uploadError: null,
  });
  api.getSessions.mockResolvedValue([]);
});

it('shows only the inline trigger next to the drop zone while there is no session', () => {
  render(<TestHost hasSession={false} />);
  expect(screen.getByTestId('file-workspace-trigger-inline')).toBeInTheDocument();
  expect(screen.queryByTestId('file-workspace-trigger-header')).not.toBeInTheDocument();
});

it('shows only the header trigger, with its count badge, once a session is active', () => {
  useSessionStore.setState({ openSessionIds: ['s1'] });
  render(<TestHost hasSession />);
  expect(screen.getByTestId('file-workspace-trigger-header')).toBeInTheDocument();
  expect(screen.queryByTestId('file-workspace-trigger-inline')).not.toBeInTheDocument();
  expect(screen.getByText('1')).toBeInTheDocument();
});

it('shows the same queue from either trigger', async () => {
  const uploading = deferred<UploadResponse>();
  api.uploadFile.mockReturnValue(uploading.promise);
  const { rerender } = render(<TestHost hasSession={false} />);

  fireEvent.click(screen.getByTestId('file-workspace-trigger-inline'));
  const dropTarget = screen.getByText(/drop pcr files here/i).closest('div');
  fireEvent.drop(dropTarget!, { dataTransfer: { files: [new File(['a'], 'queued.pcrd')] } });
  await screen.findByText('queued.pcrd');

  // Close, then reopen from the *other* trigger: same queue must reappear.
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /close/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  rerender(<TestHost hasSession />);
  fireEvent.click(screen.getByTestId('file-workspace-trigger-header'));
  expect(await screen.findByText('queued.pcrd')).toBeInTheDocument();

  uploading.resolve(info('queued', 'queued.pcrd'));
});

it(
  'keeps the upload queue and the panel open when a session appears mid-upload and swaps the visible trigger',
  async () => {
    const uploading = deferred<UploadResponse>();
    api.uploadFile.mockReturnValue(uploading.promise);
    render(<ToggleableHost />);

    fireEvent.click(screen.getByTestId('file-workspace-trigger-inline'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const dropTarget = screen.getByText(/drop pcr files here/i).closest('div');
    fireEvent.drop(dropTarget!, { dataTransfer: { files: [new File(['a'], 'mid-flight.pcrd')] } });
    await screen.findByText('mid-flight.pcrd');
    expect(await screen.findByText(/uploading/i)).toBeInTheDocument();

    // A session becomes active *while the upload is still in flight* --
    // this is exactly the "success flips visibility.upload to false" race
    // FB-02 called out as the failure mode a conditionally-mounted drawer
    // would hit. The inline trigger disappears and the header trigger
    // appears, but the panel itself must neither close nor lose its queue.
    fireEvent.click(screen.getByRole('button', { name: 'simulate session created' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('mid-flight.pcrd')).toBeInTheDocument();
    expect(screen.queryByTestId('file-workspace-trigger-inline')).not.toBeInTheDocument();
    expect(screen.getByTestId('file-workspace-trigger-header')).toBeInTheDocument();

    uploading.resolve(info('mid-flight', 'mid-flight.pcrd'));
    await waitFor(() => expect(screen.getByText(/success ·/i)).toBeInTheDocument());
  },
);

it('returns focus to whichever trigger is visible when the panel closes', async () => {
  render(<TestHost hasSession={false} />);
  const inlineTrigger = screen.getByTestId('file-workspace-trigger-inline');
  fireEvent.click(inlineTrigger);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(document.activeElement).toBe(inlineTrigger);
});

it('returns focus to the header trigger (not a vanished inline one) after a mid-upload session swap', async () => {
  const uploading = deferred<UploadResponse>();
  api.uploadFile.mockReturnValue(uploading.promise);
  render(<ToggleableHost />);

  fireEvent.click(screen.getByTestId('file-workspace-trigger-inline'));
  const dropTarget = screen.getByText(/drop pcr files here/i).closest('div');
  fireEvent.drop(dropTarget!, { dataTransfer: { files: [new File(['a'], 'swap.pcrd')] } });
  await screen.findByText('swap.pcrd');

  fireEvent.click(screen.getByRole('button', { name: 'simulate session created' }));
  const headerTrigger = screen.getByTestId('file-workspace-trigger-header');

  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /close/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(document.activeElement).toBe(headerTrigger);

  uploading.resolve(info('swap', 'swap.pcrd'));
});
