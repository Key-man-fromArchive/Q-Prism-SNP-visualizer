import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { UploadZone } from './UploadZone';
import { getSessions, getSessionInfo, loadExample, uploadFile, previewImportFile } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useUploadJobStore } from '@/stores/upload-job-store';
import type { UploadResponse } from '@/types/api';
const info: UploadResponse = { session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'VIC', num_wells: 1,
  num_cycles: 40, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null };
vi.mock('@/lib/api', () => ({ getSessions: vi.fn(), getSessionInfo: vi.fn(), loadExample: vi.fn(), uploadFile: vi.fn(), previewImportFile: vi.fn() }));
vi.mock('./ImportMappingWizard', () => ({ ImportMappingWizard: ({ onImported }: { onImported: (result: UploadResponse) => void }) =>
  <button onClick={() => onImported(info)}>Complete synthetic import</button> }));
beforeEach(() => {
  vi.resetAllMocks();
  useSessionStore.getState().reset();
  useUploadJobStore.getState().reset();
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
