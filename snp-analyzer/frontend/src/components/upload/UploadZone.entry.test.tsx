import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { UploadZone } from './UploadZone';
import { getSessions, getSessionInfo, loadExample, uploadFile, previewImportFile } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useUploadJobStore } from '@/stores/upload-job-store';
import { useFileWorkspaceStore } from '@/stores/file-workspace-store';
import { useLanguageStore } from '@/stores/language-store';
import { MAX_FILES_PER_DROP, MAX_TOTAL_MB } from '@/lib/upload-jobs';
import en from '@/locales/en';
import type { UploadResponse } from '@/types/api';
const info: UploadResponse = { session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'VIC', num_wells: 1,
  num_cycles: 40, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null };
vi.mock('@/lib/api', () => ({ getSessions: vi.fn(), getSessionInfo: vi.fn(), loadExample: vi.fn(), uploadFile: vi.fn(), previewImportFile: vi.fn() }));
vi.mock('./ImportMappingWizard', () => ({ ImportMappingWizard: ({ onImported }: { onImported: (result: UploadResponse) => void }) =>
  <button onClick={() => onImported(info)}>Complete synthetic import</button> }));
beforeEach(() => {
  vi.resetAllMocks();
  useLanguageStore.setState({ language: 'en' });
  useSessionStore.getState().reset();
  useUploadJobStore.getState().reset();
  useFileWorkspaceStore.setState({ open: false, triggers: {} });
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  vi.mocked(getSessions).mockResolvedValue([]);
  vi.mocked(loadExample).mockResolvedValue(info);
  vi.mocked(uploadFile).mockResolvedValue(info);
  vi.mocked(getSessionInfo).mockResolvedValue({ ...info, cycles: [40], input_revision: 0, analysis_status: 'idle', analysis_pending: false });
});
it('marks a new example as a fresh one-shot entry', async () => {
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#example-select')!, { target: { value: '2' } });
  await waitFor(() => expect(useSessionStore.getState().entryReason).toBe('fresh'));
  expect(useSessionStore.getState().consumeInitialAnalysis()).toBe(true);
  expect(useSessionStore.getState().consumeInitialAnalysis()).toBe(false);
});
it('marks a new raw upload as fresh', async () => {
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files: [new File(['synthetic'], 'plate.pcrd')] } });
  await waitFor(() => expect(useSessionStore.getState().entryReason).toBe('fresh'));
  expect(uploadFile).toHaveBeenCalledOnce();
});
it('marks completed mapped imports as fresh', async () => {
  vi.mocked(previewImportFile).mockResolvedValue({ preview_id: 'p', filename: 'synthetic.csv', parser_id: 'generic', candidate_tables: [],
    inferred_delimiter: ',', decimal_separator: '.', header_row: 1, first_data_row: 2, inferred_headers: [], column_candidates: {},
    sample_rows: [], channel_candidates: [], assay_mode_candidates: [], warnings: [], suggested_mapping: null, metadata: {} });
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files: [new File(['well,value'], 'synthetic.csv')] } });
  fireEvent.click(await screen.findByText('Complete synthetic import'));
  await waitFor(() => expect(useSessionStore.getState().entryReason).toBe('fresh'));
});
it('keeps a recent never-analyzed session as reopen rather than granting fresh permission', async () => {
  vi.mocked(getSessions).mockResolvedValue([{ session_id: 'synthetic', instrument: 'Synthetic', num_wells: 1, num_cycles: 40,
    uploaded_at: '2026-09-07T00:00:00Z', raw_filename: 'Synthetic recent run' }]);
  render(<UploadZone />);
  fireEvent.click(await screen.findByRole('button', { name: /Synthetic recent run/ }));
  await waitFor(() => expect(useSessionStore.getState().sessionId).toBe('synthetic'));
  expect(useSessionStore.getState().entryReason).toBe('reopen');
  expect(useSessionStore.getState().consumeInitialAnalysis()).toBe(false);
});

// P5-S1-T1: FB-02's complaint was that the multi-file workspace entry point
// was out of view in the header. This is the one that must be next to the
// drop zone while there is no session yet -- UploadZone renders it, App.tsx
// renders the header one, and `visibility.upload` never allows both at once.
it('renders the file workspace trigger next to the drop zone, not only in the header', async () => {
  render(<UploadZone />);
  expect(await screen.findByTestId('file-workspace-trigger-inline')).toBeInTheDocument();
});

it('opens the shared file workspace panel state from the inline trigger', async () => {
  render(<UploadZone />);
  fireEvent.click(await screen.findByTestId('file-workspace-trigger-inline'));
  expect(useFileWorkspaceStore.getState().open).toBe(true);
});

// P5-S2-T1: the drawer and this central drop zone are not being unified
// (D-7), but a drop that is too big must be rejected the same way through
// either one -- same numbers, same message, both read from upload-jobs.ts.
it('does not regress a central multi-file batch upload of raw files', async () => {
  vi.mocked(uploadFile)
    .mockResolvedValueOnce({ ...info, session_id: 'batch-a' })
    .mockResolvedValueOnce({ ...info, session_id: 'batch-b' });
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#file-input')!, {
    target: { files: [new File(['a'], 'a.pcrd'), new File(['b'], 'b.eds')] },
  });
  await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(useSessionStore.getState().openSessionIds).toEqual(
    expect.arrayContaining(['batch-a', 'batch-b']),
  ));
});

it('rejects a central drop of more files than the shared per-drop maximum with the drawer\'s exact message', async () => {
  const view = render(<UploadZone />);
  const files = Array.from({ length: MAX_FILES_PER_DROP + 1 }, (_, i) => new File(['x'], `f${i}.pcrd`));
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files } });
  expect(await screen.findByText(en.workspaceTooManyFiles(MAX_FILES_PER_DROP))).toBeInTheDocument();
  expect(uploadFile).not.toHaveBeenCalled();
});

it('rejects a central drop whose combined size exceeds the shared total-size maximum with the drawer\'s exact message', async () => {
  const view = render(<UploadZone />);
  const big = new File(['x'], 'big.pcrd');
  Object.defineProperty(big, 'size', { value: MAX_TOTAL_MB * 1024 * 1024 + 1 });
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files: [big, new File(['y'], 'y.eds')] } });
  expect(await screen.findByText(en.workspaceTotalTooLarge(MAX_TOTAL_MB))).toBeInTheDocument();
  expect(uploadFile).not.toHaveBeenCalled();
});
