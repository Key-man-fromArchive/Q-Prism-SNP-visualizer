import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LayoutsLibraryPanel } from './LayoutsLibraryPanel';
import { ApiError, applyLayout, listLayouts, copyLayout, deleteLayout } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), listLayouts: vi.fn(), applyLayout: vi.fn(), saveLayout: vi.fn(), deleteLayout: vi.fn(), copyLayout: vi.fn() }));
const layout = { id: 'layout', owner_user_id: 'u', name: 'Synthetic', created_at: '', updated_at: '', snapshot: { schema_version: 1, plate: { rows: 8, cols: 12 }, markers: [] } };
const conflict = () => new ApiError('private backend detail', 409, { detail: { message: 'private', conflicting_marker_ids: ['m'] } });
beforeEach(() => { vi.clearAllMocks(); useLanguageStore.setState({ language: 'en' }); useSessionStore.setState({ sessionId: 's' }); vi.mocked(listLayouts).mockResolvedValue({ layouts: [layout] }); });
it('uses a focused modal; Escape cancels without a force request and returns focus', async () => {
  vi.mocked(applyLayout).mockRejectedValue(conflict());
  render(<LayoutsLibraryPanel />);
  const load = await screen.findByTestId('layout-load-button'); load.focus(); fireEvent.click(load);
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(load).toHaveFocus(); expect(applyLayout).toHaveBeenCalledTimes(1);
});
it('ignores a late 409 after owner replacement', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(applyLayout).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  render(<LayoutsLibraryPanel />);
  fireEvent.click(await screen.findByTestId('layout-load-button'));
  await act(async () => { useAuthStore.getState().clearAuth(); reject(conflict()); });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});
it('sends exactly one force request despite duplicate confirmation while pending', async () => {
  vi.mocked(applyLayout).mockRejectedValueOnce(conflict()).mockReturnValue(new Promise(() => {}));
  render(<LayoutsLibraryPanel />);
  fireEvent.click(await screen.findByTestId('layout-load-button'));
  const confirm = await screen.findByTestId('layout-load-conflict-confirm');
  fireEvent.click(confirm); fireEvent.click(confirm);
  await waitFor(() => expect(applyLayout).toHaveBeenCalledTimes(2));
  expect(applyLayout).toHaveBeenLastCalledWith('layout', { sid: 's', force: true });
});
it.each(['owner', 'sid', 'entry'])('dismisses an existing conflict on %s replacement without force', async boundary => {
  vi.mocked(applyLayout).mockRejectedValue(conflict());
  render(<LayoutsLibraryPanel />);
  fireEvent.click(await screen.findByTestId('layout-load-button'));
  await screen.findByRole('alertdialog');
  act(() => {
    if (boundary === 'owner') useAuthStore.getState().clearAuth();
    else if (boundary === 'sid') useSessionStore.setState({ sessionId: 'other' });
    else useSessionStore.setState({ entryGeneration: useSessionStore.getState().entryGeneration + 1 });
  });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(applyLayout).toHaveBeenCalledTimes(1);
});
it('does not publish events after a synchronous session change before completion', async () => {
  let resolve!: () => void;
  vi.mocked(applyLayout).mockReturnValue(new Promise(done => { resolve = () => done({ input_revision: 2, sid: 's', markers: [], well_types_applied: {} }); }));
  const events = vi.fn(); window.addEventListener('markers-changed', events);
  render(<LayoutsLibraryPanel />);
  fireEvent.click(await screen.findByTestId('layout-load-button'));
  await act(async () => { useSessionStore.setState({ sessionId: 'other' }); resolve(); });
  expect(events).not.toHaveBeenCalled();
  window.removeEventListener('markers-changed', events);
});
it('distinguishes a successful copy followed by failed refresh from mutation failure', async () => {
  vi.mocked(copyLayout).mockResolvedValue(layout);
  render(<LayoutsLibraryPanel />);
  await screen.findByTestId('layout-copy-button');
  vi.mocked(listLayouts).mockRejectedValueOnce(new Error('private backend detail'));
  fireEvent.click(screen.getByTestId('layout-copy-button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('The change succeeded');
  expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
  expect(screen.getByTestId('layout-row')).toHaveTextContent('Synthetic');
});
it('sanitizes mutation failure without falsely reporting success', async () => {
  vi.mocked(copyLayout).mockRejectedValueOnce(new Error('private backend detail'));
  render(<LayoutsLibraryPanel />);
  fireEvent.click(await screen.findByTestId('layout-copy-button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('The change could not be completed');
  expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
});
it('retains the last known-good list when a successful response has malformed nested markers', async () => {
  const malformed = {
    ...layout,
    snapshot: { ...layout.snapshot, markers: [{ id: 'bad', name: 'Bad marker', wells: [42], ploidy: 2 }] },
  };
  vi.mocked(listLayouts).mockResolvedValueOnce({ layouts: [layout] }).mockResolvedValueOnce({ layouts: [malformed as never] });
  render(<LayoutsLibraryPanel />);
  await screen.findByTestId('layout-copy-button');
  fireEvent.click(screen.getByTestId('layout-copy-button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('updated list could not be loaded');
  expect(screen.getByTestId('layout-row')).toHaveTextContent('Synthetic');
  expect(screen.queryByText('Bad marker')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});
it.each([
  ['well-types value', { snapshot: { well_types: { A1: 17 } } }],
  ['sample id value', { snapshot: { sample_ids: { A1: 17 } } }],
  ['threshold field', { snapshot: { markers: [{ id: 'm', name: 'M', wells: ['A1'], ploidy: 2, threshold_config: { ntc_threshold: 'bad' } }] } }],
  ['layout identifier', { id: '' }],
])('retains the last known-good list when a successful response has malformed nested %s', async (_label, patch) => {
  const malformed = { ...layout, ...patch, snapshot: { ...layout.snapshot, ...(patch as { snapshot?: object }).snapshot } };
  vi.mocked(listLayouts).mockResolvedValueOnce({ layouts: [layout] }).mockResolvedValueOnce({ layouts: [malformed as never] });
  render(<LayoutsLibraryPanel />);
  await screen.findByTestId('layout-copy-button');
  fireEvent.click(screen.getByTestId('layout-copy-button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('updated list could not be loaded');
  expect(screen.getByTestId('layout-row')).toHaveTextContent('Synthetic');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});
it('cancels delete with Escape and returns focus without a request', async () => {
  render(<LayoutsLibraryPanel />);
  const trigger = await screen.findByTestId('layout-delete-button'); trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(deleteLayout).not.toHaveBeenCalled(); expect(trigger).toHaveFocus();
});
it('confirms delete once despite duplicate approval', async () => {
  vi.mocked(deleteLayout).mockResolvedValue({ status: 'ok' });
  render(<LayoutsLibraryPanel />);
  fireEvent.click(await screen.findByTestId('layout-delete-button'));
  const dialog = await screen.findByRole('alertdialog');
  const approve = dialog.querySelectorAll('button');
  const action = Array.from(approve).find(button => button.textContent === 'Delete')!;
  fireEvent.click(action); fireEvent.click(action);
  await waitFor(() => expect(deleteLayout).toHaveBeenCalledTimes(1));
});
it.each(['owner', 'sid', 'entry'])('dismisses delete on %s replacement without deleting', async boundary => {
  render(<LayoutsLibraryPanel />);
  fireEvent.click(await screen.findByTestId('layout-delete-button'));
  const dialog = await screen.findByRole('alertdialog');
  const staleApprove = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Delete')!;
  act(() => {
    if (boundary === 'owner') useAuthStore.getState().clearAuth();
    else if (boundary === 'sid') useSessionStore.setState({ sessionId: 'other' });
    else useSessionStore.setState({ entryGeneration: useSessionStore.getState().entryGeneration + 1 });
  });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  fireEvent.click(staleApprove);
  expect(deleteLayout).not.toHaveBeenCalled();
});
