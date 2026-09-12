import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { UploadZone } from './UploadZone';
import { getSessions, getSessionInfo, loadExample, uploadFile } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useUploadJobStore } from '@/stores/upload-job-store';
import { useFileWorkspaceStore } from '@/stores/file-workspace-store';
import { useLanguageStore } from '@/stores/language-store';
import en from '@/locales/en';
import type { UploadResponse } from '@/types/api';

const info: UploadResponse = { session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'VIC', num_wells: 1,
  num_cycles: 40, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null };

vi.mock('@/lib/api', () => ({ getSessions: vi.fn(), getSessionInfo: vi.fn(), loadExample: vi.fn(), uploadFile: vi.fn(), previewImportFile: vi.fn() }));

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

// FB (2026-09-11): "이 화면은 SNP analysis... 미적으로 매우 뒤떨어지는 상황" --
// the upload screen needed the brand logo/art, not just a bare drop zone.

it('shows the brand hero (wide logo) on the upload screen when there is no session', () => {
  render(<UploadZone />);
  expect(screen.getByAltText(en.appTitle)).toBeInTheDocument();
  expect(screen.getByText(en.heroSubtitle)).toBeInTheDocument();
});

it('hides the hero once a session exists (a session, not a bare screen, should not carry the empty-state banner)', async () => {
  render(<UploadZone />);
  expect(screen.getByAltText(en.appTitle)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(en.exampleLoad), { target: { value: '2' } });
  await waitFor(() => expect(useSessionStore.getState().sessionId).toBe('synthetic'));
  expect(screen.queryByAltText(en.appTitle)).not.toBeInTheDocument();
});

it('moves "Powered by Invirustech" to a footer on the upload screen', () => {
  render(<UploadZone />);
  expect(screen.getByRole('link', { name: new RegExp(en.poweredBy) })).toBeInTheDocument();
});

// P5-S1-T1 put the inline multi-file workspace trigger next to the drop
// zone; the hero must not crowd it out or break its click behavior.
it('keeps the inline file workspace trigger working after the hero is added', async () => {
  render(<UploadZone />);
  expect(await screen.findByTestId('file-workspace-trigger-inline')).toBeInTheDocument();
  fireEvent.click(await screen.findByTestId('file-workspace-trigger-inline'));
  expect(useFileWorkspaceStore.getState().open).toBe(true);
});

// The drop zone's own upload behavior must not regress from the hero markup
// added around it.
it('still uploads a single dropped file into the existing drop zone', async () => {
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files: [new File(['synthetic'], 'plate.pcrd')] } });
  await waitFor(() => expect(useSessionStore.getState().sessionId).toBe('synthetic'));
  expect(uploadFile).toHaveBeenCalledOnce();
});
