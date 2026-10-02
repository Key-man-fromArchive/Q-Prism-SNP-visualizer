import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { EXPORT_TEST_IDS } from '@/lib/export-testids';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { ApiError, saveAsgResult } from '@/lib/api';
import ko from '@/locales/ko';

const exportFns = vi.hoisted(() => ({ csv: vi.fn(), png: vi.fn(), pdf: vi.fn(), xlsx: vi.fn(), stored: vi.fn(), pptx: vi.fn(), zip: vi.fn() }));
const markerApi = vi.hoisted(() => ({ get: vi.fn() }));
const actions = vi.hoisted(() => ({ analyze: vi.fn(), refresh: vi.fn() }));

vi.mock('@/lib/api', () => {
  class ApiError extends Error { code: string | null; constructor(message: string, _status: number, payload: { detail?: { code?: string } }) { super(message); this.code = payload.detail?.code ?? null; } }
  return { ApiError, logout: vi.fn(), saveAsgResult: vi.fn(), getMarkers: markerApi.get };
});
vi.mock('@/hooks/use-dark-mode', () => ({ useDarkMode: () => ({ isDark: false, toggle: vi.fn() }) }));
vi.mock('@/hooks/use-exports', () => ({ useExports: () => ({ downloadCSV: exportFns.csv, exportPNG: exportFns.png,
  exportPDF: exportFns.pdf, exportXLSX: exportFns.xlsx, exportPPTX: exportFns.pptx, exportScatterZip: exportFns.zip,
  exportStored: exportFns.stored, printReport: vi.fn() }) }));
vi.mock('@/hooks/use-undo-redo', () => ({ useUndoRedo: () => ({ canUndo: false, canRedo: false }) }));
vi.mock('@/lib/analysis-actions', () => ({ analyzeCurrent: actions.analyze }));
vi.mock('@/lib/analysis-session', () => ({ loadAnalysisSession: actions.refresh }));
vi.mock('@/components/shared/QcBadges', () => ({ QcBadges: () => null }));
vi.mock('@/components/analysis/AddToProjectButton', () => ({ AddToProjectButton: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  markerApi.get.mockResolvedValue({ markers: [] });
  useSessionStore.setState({ sessionId: 'run-a', sessionInfo: null });
  useSelectionStore.setState({ currentCycle: 20 });
  useSettingsStore.setState({ useRox: false });
  useAuthStore.setState({ user: null, authMode: 'asg_launch', linkedContext: {
    target_type: 'marker', target_id: 'synthetic', context: {}, scope: ['snp:save_result'], expires_at: null,
  } });
});

it('keeps full linked identities in a keyboard disclosure and exposes the complete user name', () => {
  const alias = 'LongUnbrokenAlias'.repeat(20);
  const name = 'Long operator name '.repeat(10);
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: name, role: 'admin' },
    linkedContext: { target_type: 'marker', target_id: 'Synthetic target', context: { tag_alias: alias, marker_id: 'Synthetic marker' }, scope: [], expires_at: null } });
  render(<Header />);
  expect(document.querySelector('.header-username')).toHaveAttribute('title', name);
  expect(document.querySelector('.header-username')).toHaveTextContent(name.trim());
  expect(screen.getAllByText(alias)).toHaveLength(2); // CSS selects one presentation; no duplicated actions.
  const disclosure = document.querySelector('.header-linked-context details');
  expect(disclosure?.querySelector('summary')).toHaveAttribute('aria-label');
  expect(screen.getByRole('button', { name: /^(ASG)$/ })).toBeDisabled();
});

it('folds name, role and logout into one user menu so the header keeps a single row', () => {
  useAuthStore.setState({ user: { id: 'u', username: 'admin', display_name: 'Administrator', role: 'admin' } });
  render(<Header />);
  const trigger = screen.getByRole('button', { name: 'Administrator' });
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveTextContent('admin');
  expect(screen.queryByRole('button', { name: ko.logout })).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByRole('menuitem', { name: ko.logout })).toBeInTheDocument();
});

it('opens a decision dialog for a structured export mismatch and cancel prevents the stored action', async () => {
  exportFns.csv.mockRejectedValue(new ApiError('mismatch', 409, { detail: { code: 'EXPORT_CONDITION_MISMATCH' } }));
  render(<Header />);
  fireEvent.click(screen.getByRole('button', { name: /Export|내보내기/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^(Cancel|취소)$/ }));
  expect(exportFns.stored).not.toHaveBeenCalled();
});

const threeMarkers = ['m1', 'm2', 'm3'].map(id => ({ id, name: id.toUpperCase(), wells: ['A1'], ploidy: 2 }));
async function renderWithMarkers() {
  markerApi.get.mockResolvedValue({ markers: threeMarkers });
  render(<Header />);
  fireEvent.click(screen.getByRole('button', { name: /Export|내보내기/ }));
  await screen.findByRole('menuitem', { name: ko.exportReportSelectMarkers });
}
const menuItem = (name: string) => screen.getByRole('menuitem', { name });
const reopenMenu = () => fireEvent.click(screen.getByRole('button', { name: /Export|내보내기/ }));

it('lists PPTX, report images and a distinct current-screen image once markers exist', async () => {
  await renderWithMarkers();
  expect(menuItem(ko.exportReportPPTX)).toBeInTheDocument();
  expect(menuItem(ko.exportReportScatterZip)).toBeInTheDocument();
  expect(menuItem(ko.exportReportCurrentScreen)).toBeInTheDocument();
});

it('hides marker selection (and sends no ids) for a session without markers', async () => {
  render(<Header />);
  fireEvent.click(screen.getByRole('button', { name: /Export|내보내기/ }));
  expect(screen.queryByRole('menuitem', { name: ko.exportReportSelectMarkers })).toBeNull();
  fireEvent.click(menuItem(ko.exportReportPPTX));
  await vi.waitFor(() => expect(exportFns.pptx).toHaveBeenCalledWith(undefined, undefined));
});

async function deselectSecondMarker() {
  fireEvent.click(menuItem(ko.exportReportSelectMarkers));
  const options = await screen.findAllByTestId(EXPORT_TEST_IDS.markerOption);
  expect(options).toHaveLength(3);
  fireEvent.click(within(options[1]).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: ko.close }));
}

it('applies the marker selection to PPTX, report images and PDF', async () => {
  await renderWithMarkers();
  await deselectSecondMarker();
  reopenMenu();
  fireEvent.click(menuItem(ko.exportReportPPTX));
  await vi.waitFor(() => expect(exportFns.pptx).toHaveBeenCalledWith(['m1', 'm3'], undefined));
  reopenMenu();
  fireEvent.click(menuItem(ko.exportReportScatterZip));
  await vi.waitFor(() => expect(exportFns.zip).toHaveBeenCalledWith(['m1', 'm3']));
  reopenMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: /PDF/ }));
  await vi.waitFor(() => expect(exportFns.pdf).toHaveBeenCalledWith(['m1', 'm3']));
});

it('exports the chosen format from the dialog and disables export with no marker selected', async () => {
  await renderWithMarkers();
  fireEvent.click(menuItem(ko.exportReportSelectMarkers));
  const dialog = await screen.findByTestId(EXPORT_TEST_IDS.dialog);
  fireEvent.click(within(dialog).getByTestId(EXPORT_TEST_IDS.formatPngZip));
  fireEvent.click(within(dialog).getByTestId(EXPORT_TEST_IDS.submit));
  await vi.waitFor(() => expect(exportFns.zip).toHaveBeenCalledWith(undefined));
  fireEvent.click(within(dialog).getByTestId(EXPORT_TEST_IDS.markerSelectAll));
  expect(within(dialog).getByTestId(EXPORT_TEST_IDS.submit)).toBeDisabled();
  expect(within(dialog).getByTestId(EXPORT_TEST_IDS.status)).toHaveTextContent('0/3');
});

it('turns the PPTX results table off from the dialog and keeps that on the stored retry', async () => {
  exportFns.pptx.mockRejectedValueOnce(new ApiError('mismatch', 409, { detail: { code: 'EXPORT_CONDITION_MISMATCH' } }));
  await renderWithMarkers();
  fireEvent.click(menuItem(ko.exportReportSelectMarkers));
  const dialog = await screen.findByTestId(EXPORT_TEST_IDS.dialog);
  fireEvent.click(within(dialog).getByTestId(EXPORT_TEST_IDS.formatPptx));
  const toggle = within(dialog).getByLabelText(ko.exportReportIncludeTable);
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  fireEvent.click(within(dialog).getByTestId(EXPORT_TEST_IDS.submit));
  await vi.waitFor(() => expect(exportFns.pptx).toHaveBeenCalledWith(undefined, false));
  await screen.findByRole('alertdialog');
  fireEvent.click(screen.getByRole('button', { name: ko.exportStoredResult }));
  await vi.waitFor(() => expect(exportFns.stored).toHaveBeenCalledWith('pptx', expect.anything(), undefined, false));
});

it('keeps the marker selection when a condition mismatch is resolved with the stored result', async () => {
  exportFns.pptx.mockRejectedValue(new ApiError('mismatch', 409, { detail: { code: 'EXPORT_CONDITION_MISMATCH' } }));
  await renderWithMarkers();
  await deselectSecondMarker();
  reopenMenu();
  fireEvent.click(menuItem(ko.exportReportPPTX));
  await screen.findByRole('alertdialog');
  fireEvent.click(screen.getByRole('button', { name: ko.exportStoredResult }));
  await vi.waitFor(() => expect(exportFns.stored).toHaveBeenCalledWith('pptx', expect.anything(), ['m1', 'm3'], undefined));
});

it('keeps the marker selection when a condition mismatch is resolved by reanalysis', async () => {
  actions.analyze.mockResolvedValue(true);
  exportFns.zip.mockRejectedValueOnce(new ApiError('mismatch', 409, { detail: { code: 'EXPORT_CONDITION_MISMATCH' } }));
  useAnalysisStore.getState().setSession('run-a', 'u');
  useAnalysisStore.getState().setCurrentRequest({ algorithm: 'auto', cycle: 20, n_clusters: 4 });
  await renderWithMarkers();
  await deselectSecondMarker();
  reopenMenu();
  fireEvent.click(menuItem(ko.exportReportScatterZip));
  await screen.findByRole('alertdialog');
  fireEvent.click(screen.getByRole('button', { name: ko.exportReanalyzeCurrent }));
  await vi.waitFor(() => expect(exportFns.zip).toHaveBeenLastCalledWith(['m1', 'm3']));
});

function openCsvMismatch() {
  fireEvent.click(screen.getByRole('button', { name: /Export|내보내기/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));
  return screen.findByRole('alertdialog');
}

it('cancels a deferred reanalysis before it can retry an export, and suppresses duplicate action clicks', async () => {
  let resolve!: (value: boolean) => void;
  actions.analyze.mockReturnValue(new Promise<boolean>(done => { resolve = done; }));
  exportFns.csv.mockRejectedValueOnce(new ApiError('mismatch', 409, { detail: { code: 'EXPORT_CONDITION_MISMATCH' } }));
  useAnalysisStore.getState().setSession('run-a', 'u');
  useAnalysisStore.getState().setCurrentRequest({ algorithm: 'auto', cycle: 20, n_clusters: 4 });
  render(<Header />);
  const dialog = await openCsvMismatch();
  const reanalyze = screen.getByRole('button', { name: /Reanalyze|재분석/ });
  fireEvent.click(reanalyze); fireEvent.click(reanalyze);
  expect(actions.analyze).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await act(async () => resolve(true));
  expect(exportFns.csv).toHaveBeenCalledTimes(1);
});

it('catches and presents a retry failure after reanalysis', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  actions.analyze.mockResolvedValue(true);
  exportFns.csv.mockRejectedValueOnce(new ApiError('mismatch', 409, { detail: { code: 'EXPORT_CONDITION_MISMATCH' } }))
    .mockRejectedValueOnce(new Error('retry failed'));
  useAnalysisStore.getState().setSession('run-a', 'u');
  useAnalysisStore.getState().setCurrentRequest({ algorithm: 'auto', cycle: 20, n_clusters: 4 });
  render(<Header />);
  await openCsvMismatch();
  fireEvent.click(screen.getByRole('button', { name: /Reanalyze|재분석/ }));
  await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('retry failed')));
});

it('refreshes on revision conflict and requires a separate confirmation without automatic replacement export', async () => {
  exportFns.csv.mockRejectedValue(new ApiError('replaced', 409, { detail: { code: 'RESULT_REVISION_CONFLICT' } }));
  actions.refresh.mockResolvedValue({ markers: [], ploidy: 2, hasCompletedResult: true, info: {} });
  render(<Header />);
  await openCsvMismatch();
  await vi.waitFor(() => expect(actions.refresh).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(exportFns.csv).toHaveBeenCalledTimes(1);
});

it.each(['session', 'cycle', 'rox', 'mutation'])('discards pending ASG save after %s changes', async (change) => {
  let reject!: (error: Error) => void;
  vi.mocked(saveAsgResult).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  render(<Header />);
  fireEvent.click(screen.getByRole('button', { name: 'ASG' }));
  expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled();
  act(() => {
    if (change === 'session') useSessionStore.setState({ sessionId: 'run-b' });
    else if (change === 'cycle') useSelectionStore.setState({ currentCycle: 21 });
    else if (change === 'rox') useSettingsStore.setState({ useRox: true });
    else window.dispatchEvent(new Event('asg-result-dirty'));
  });
  await act(async () => reject(new Error('old request error')));
  expect(screen.getByRole('button', { name: 'ASG' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'ASG' })).not.toHaveAttribute('title', 'old request error');
});

describe('ASG linked context label', () => {
  // The raw target_type/target_id are ASG's internal linkage identifiers
  // (e.g. "ad_hoc" / "1") and must never surface to the operator, in either
  // the always-visible desktop row or the collapsed <xl summary.
  function assertRawValueHiddenEverywhere(raw: string) {
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
    const scope = document.querySelector('.header-linked-context');
    expect(scope).not.toBeNull();
    expect(scope!.innerHTML).not.toContain(raw);
    // Tooltips / accessible names must not leak the raw value either.
    scope!.querySelectorAll('[title], [aria-label]').forEach((el) => {
      expect(el.getAttribute('title')).not.toBe(raw);
      expect(el.getAttribute('aria-label')).not.toBe(raw);
    });
  }

  it('shows the human-readable marker_id for an ad_hoc link and hides the raw type/id', () => {
    useAuthStore.setState({ linkedContext: {
      target_type: 'ad_hoc', target_id: 'RAWID1', context: { tag_alias: '', marker_id: 'Ad hoc SNP Analyze' }, scope: [], expires_at: null,
    } });
    render(<Header />);
    expect(screen.getAllByText('Ad hoc SNP Analyze')).toHaveLength(2);
    assertRawValueHiddenEverywhere('ad_hoc');
    assertRawValueHiddenEverywhere('RAWID1');
  });

  it('prefers tag_alias over marker_id when both are present', () => {
    useAuthStore.setState({ linkedContext: {
      target_type: 'marker_version', target_id: 'RAWID2', context: { tag_alias: 'Custom Tag', marker_id: 'Should not show' }, scope: [], expires_at: null,
    } });
    render(<Header />);
    expect(screen.getAllByText('Custom Tag')).toHaveLength(2);
    expect(screen.queryByText('Should not show')).not.toBeInTheDocument();
    assertRawValueHiddenEverywhere('marker_version');
    assertRawValueHiddenEverywhere('RAWID2');
  });

  it('falls back to a neutral i18n label for an unknown target_type without crashing', () => {
    useAuthStore.setState({ linkedContext: {
      target_type: 'MYSTERY_TYPE', target_id: 'RAWID3', context: {}, scope: [], expires_at: null,
    } });
    expect(() => render(<Header />)).not.toThrow();
    assertRawValueHiddenEverywhere('MYSTERY_TYPE');
    assertRawValueHiddenEverywhere('RAWID3');
    // Some neutral, non-raw label must still render (block is not suppressed).
    expect(document.querySelector('.header-linked-context')?.textContent?.trim()).not.toBe('');
  });

  it('maps a bare marker target_type to a real label instead of the neutral fallback', () => {
    useAuthStore.setState({ linkedContext: {
      target_type: 'marker', target_id: 'RAWID4', context: {}, scope: [], expires_at: null,
    } });
    render(<Header />);
    // The store defaults to Korean; assert against the actual translation rather
    // than hardcoding an English string, so this doesn't silently drift.
    const mappedLabel = ko.asgTargetLabel('marker');
    expect(mappedLabel).not.toBe(ko.asgTargetLabel('unmapped-type-for-test'));
    expect(screen.getAllByText(mappedLabel)).toHaveLength(2);
    assertRawValueHiddenEverywhere('RAWID4');
  });

  it('renders no linked-context block at all when there is no ASG context', () => {
    useAuthStore.setState({ linkedContext: null });
    render(<Header />);
    expect(document.querySelector('.header-linked-context')).not.toBeInTheDocument();
  });
});

// P5-S1-T1: the header's file workspace trigger is hidden while UploadZone
// (and its own inline trigger) is on screen -- App.tsx passes this through
// `showFileWorkspaceTrigger`, tied to the same `visibility.upload` boolean.
// The prop defaults to visible so every render site above, which never
// passes it, keeps its pre-existing header exactly as before.
describe('file workspace trigger placement', () => {
  it('shows the header trigger by default, for callers that do not pass the prop', () => {
    render(<Header />);
    expect(screen.getByTestId('file-workspace-trigger-header')).toBeInTheDocument();
  });

  it('shows the header trigger when a session is active', () => {
    render(<Header showFileWorkspaceTrigger />);
    expect(screen.getByTestId('file-workspace-trigger-header')).toBeInTheDocument();
  });

  it('hides the header trigger while the central upload screen owns the inline one', () => {
    render(<Header showFileWorkspaceTrigger={false} />);
    expect(screen.queryByTestId('file-workspace-trigger-header')).not.toBeInTheDocument();
  });
});

// P6-S3-T1 (FB 2026-09-11): "Powered by Invirustech" stays in the header
// while a session is open, but moves to the upload screen's own footer
// (UploadZone) once there is no session -- it must not show in both places.
describe('"Powered by Invirustech" placement', () => {
  it('keeps it in the header while a session is active', () => {
    render(<Header />); // beforeEach sets sessionId: 'run-a'
    expect(screen.getByRole('link', { name: /Powered by Invirustech/ })).toBeInTheDocument();
  });

  it('hides it from the header when there is no session (UploadZone owns the footer copy)', () => {
    useSessionStore.setState({ sessionId: null, sessionInfo: null });
    render(<Header />);
    expect(screen.queryByRole('link', { name: /Powered by Invirustech/ })).not.toBeInTheDocument();
  });
});
