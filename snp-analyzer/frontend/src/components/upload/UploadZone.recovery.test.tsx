import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UploadZone } from './UploadZone';
import { ApiError, getSessions, loadExample, previewImportFile, uploadFile } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useUploadJobStore } from '@/stores/upload-job-store';
import { useLanguageStore } from '@/stores/language-store';
import en from '@/locales/en';
import userEvent from '@testing-library/user-event';
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), getSessions: vi.fn(), uploadFile: vi.fn(), loadExample: vi.fn(), previewImportFile: vi.fn() }));
const info = { session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'VIC', num_wells: 96,
  num_cycles: 40, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null };
afterEach(() => vi.useRealTimers());
it('keeps template help open after a real pointer focus and click sequence', async () => {
  const user = userEvent.setup();
  render(<UploadZone />);
  await user.click(screen.getByRole('button', { name: en.importTemplatesHelpLabel }));
  expect(screen.getByRole('tooltip')).toBeVisible();
});
it('provides help button expansion and dismissible keyboard template descriptions', async () => {
  render(<UploadZone />);
  const help = screen.getByRole('button', { name: en.importTemplatesHelpLabel });
  fireEvent.focus(help);
  expect(help).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('tooltip')).toHaveTextContent(en.importTemplatesHelp);
  fireEvent.keyDown(help, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.click(help);
  expect(help).toHaveAttribute('aria-expanded', 'true');
  fireEvent.blur(help);
  const template = screen.getByRole('link', { name: en.templateRdes });
  fireEvent.focus(template);
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  fireEvent.keyDown(template, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(template.getAttribute('href')).toContain('/templates/');
  await act(async () => {});
});
it('labels example selection and exposes upload progress without replacing retained jobs', async () => {
  useSessionStore.setState({ uploadState: 'uploading', uploadProgress: 35 });
  render(<UploadZone />);
  expect(screen.getByRole('combobox', { name: /Load example/ })).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '35');
  await act(async () => {});
});
it('ignores a preview failure after logout without restoring upload state or leaking details', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(previewImportFile).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files: [new File([], 'one.csv')] } });
  act(() => useAuthStore.getState().clearAuth());
  await act(async () => { reject(new Error('private-secret')); });
  expect(useSessionStore.getState().uploadState).toBe('idle');
  expect(screen.queryByText(/private-secret/)).not.toBeInTheDocument();
});
beforeEach(() => {
  vi.resetAllMocks(); useSessionStore.getState().reset(); useUploadJobStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  useLanguageStore.getState().setLanguage('en'); vi.mocked(getSessions).mockResolvedValue([]);
});
it('retains per-file partial/unknown results across remount and navigates only on explicit request', async () => {
  vi.mocked(uploadFile).mockResolvedValueOnce(info).mockRejectedValueOnce(new ApiError('private', 500, {})).mockRejectedValueOnce(new TypeError('secret'));
  const navigate = vi.fn(); const view = render(<UploadZone onGoToProject={navigate} />);
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files: ['success.eds', 'failed.eds', 'lost.eds'].map(name => new File([], name)) } });
  await waitFor(() => expect(useUploadJobStore.getState().pending).toBe(false));
  await screen.findByText('lost.eds');
  expect(navigate).not.toHaveBeenCalled(); expect(uploadFile).toHaveBeenCalledTimes(3);
  view.unmount(); render(<UploadZone onGoToProject={navigate} />);
  expect(screen.getByText('failed.eds')).toBeVisible();
  expect(screen.getByText(/Upload outcome is unknown/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Check sessions in Project' }));
  expect(navigate).toHaveBeenCalledOnce(); expect(uploadFile).toHaveBeenCalledTimes(3);
});
it('does not revive an old owner when a single upload returns after logout', async () => {
  vi.useFakeTimers();
  let resolve!: (result: typeof info) => void;
  vi.mocked(uploadFile).mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files: [new File([], 'one.eds')] } });
  act(() => useAuthStore.getState().clearAuth());
  await act(async () => { resolve(info); await vi.advanceTimersByTimeAsync(1000); });
  expect(useUploadJobStore.getState().jobs).toEqual([]);
  expect(useSessionStore.getState().sessionId).toBeNull();
});
it('does not upload old XML files under a new owner after held packaging', async () => {
  let resolve!: (value: ArrayBuffer) => void;
  const file = new File(['synthetic'], 'old.xml');
  Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(done => { resolve = done; }) });
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files: [file] } });
  act(() => useAuthStore.getState().setUser({ id: 'other', username: 'other', role: 'admin', display_name: null }));
  await act(async () => { resolve(new ArrayBuffer(0)); await new Promise(done => setTimeout(done, 40)); });
  expect(uploadFile).not.toHaveBeenCalled();
});
it('retains a failed XML packaging outcome across remount without uploading or leaking details', async () => {
  const file = new File([], 'broken.xml');
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.reject(new Error('private packaging detail')) });
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files: [file] } });
  await act(async () => {});
  expect(useUploadJobStore.getState().jobs).toEqual([expect.objectContaining({ filename: 'broken.xml', stage: 'failed' })]);
  view.unmount(); render(<UploadZone />);
  expect(screen.getByText('broken.xml')).toBeVisible();
  expect(screen.queryByText(/private packaging detail/)).not.toBeInTheDocument();
  expect(uploadFile).not.toHaveBeenCalled();
});
it('uploads two XML sources once and retains only their original filenames with the shared session', async () => {
  vi.mocked(uploadFile).mockResolvedValue(info);
  const files = ['first.xml', 'second.xml'].map(name => {
    const file = new File([], name);
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new ArrayBuffer(0)) });
    return file;
  });
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files } });
  await waitFor(() => expect(uploadFile).toHaveBeenCalledOnce());
  await waitFor(() => expect(useUploadJobStore.getState().pending).toBe(false));
  expect(useUploadJobStore.getState().jobs.map(job => [job.filename, job.stage, job.sessionId]))
    .toEqual([['first.xml', 'success', 'synthetic'], ['second.xml', 'success', 'synthetic']]);
  expect(vi.mocked(uploadFile).mock.calls[0][0].name).toBe('cfx_xml_export.zip');
  for (const job of useUploadJobStore.getState().jobs) expect(Object.keys(job).sort())
    .toEqual(['batch', 'filename', 'id', 'reason', 'sessionId', 'stage']);
});
it('reports a directory read failure without uploading or exposing the native error', async () => {
  const entry = { isDirectory: true, isFile: false, createReader: () => ({ readEntries: (_ok: unknown, fail: (error: Error) => void) => fail(new Error('private path')) }) };
  const view = render(<UploadZone />);
  fireEvent.drop(view.container.querySelector('#drop-area')!, { dataTransfer: { items: [{ webkitGetAsEntry: () => entry }], files: [] } });
  await act(async () => {});
  expect(useSessionStore.getState().uploadState).toBe('error');
  expect(screen.queryByText(/private path/)).not.toBeInTheDocument();
  expect(uploadFile).not.toHaveBeenCalled();
});
it('rejects a delayed example result after logout, including the old navigation timer', async () => {
  vi.useFakeTimers();
  let resolve!: (result: typeof info) => void;
  vi.mocked(loadExample).mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#example-select')!, { target: { value: '2' } });
  act(() => useAuthStore.getState().clearAuth());
  await act(async () => { resolve(info); await vi.advanceTimersByTimeAsync(1000); });
  expect(useSessionStore.getState().sessionId).toBeNull();
});
it.each([400, 401, 403, 500])('only offers spreadsheet preview for a verified format error, status %i', async status => {
  vi.mocked(uploadFile).mockRejectedValue(new ApiError('private', status, { detail: 'Failed to parse file: invalid sheet' }));
  vi.mocked(previewImportFile).mockReturnValue(new Promise(() => {}));
  const view = render(<UploadZone />);
  fireEvent.change(view.container.querySelector('#file-input')!, { target: { files: [new File([], 'one.xlsx')] } });
  await act(async () => {});
  expect(previewImportFile).toHaveBeenCalledTimes(status === 400 ? 1 : 0);
});
