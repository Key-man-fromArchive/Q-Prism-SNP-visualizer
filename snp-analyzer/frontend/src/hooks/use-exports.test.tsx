import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useExports } from './use-exports';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useAuthStore } from '@/stores/auth-store';
import { clearActiveChart, setActiveChart } from '@/lib/chart-export-registry';
import { exportCsv } from '@/lib/api';
import Plotly from 'plotly.js-dist-min';

vi.mock('plotly.js-dist-min', () => ({ default: { toImage: vi.fn() } }));
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    code: string | null;
    constructor(message: string, _status: number, payload: { detail?: { code?: string } }) {
      super(message); this.code = payload.detail?.code ?? null;
    }
  }
  return { ApiError, exportCsv: vi.fn(), exportPdf: vi.fn(), exportXlsx: vi.fn() };
});

const result = (revision = 'rev-a') => ({ algorithm: 'auto', cycle: 40, assignments: {},
  analysis_context: { result_revision: revision, cycle: 40, use_rox: false, background: 'none', input_revision: 2 },
} as never);

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 7 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useNavigationStore.setState({ session: 'run-a', cycle: 20, exportRestoring: false });
  useSettingsStore.setState({ useRox: false, backgroundMode: 'none' });
  useAnalysisStore.setState({ result: result(), pending: false, currentInputRevision: 2, inputRevisionRefreshing: false });
  clearActiveChart(document.createElement('div'));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mockPngCaption(): void {
  vi.mocked(Plotly.toImage).mockResolvedValue('data:image/png;base64,source');
  class ImmediateImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 16; height = 16;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', ImmediateImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '', font: '', fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(),
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,captioned');
}

function storedChart(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  setActiveChart({ element, sessionId: 'run-a', resultRevision: 'rev-a', cycle: 40, useRox: false,
    backgroundMode: 'none', entry: 7, ownerId: 'u', caption: 'stored cycle 40', identity: 'stored-40' });
  return element;
}

it('RED/GREEN: rejects old-cycle pixels as a structured mismatch before PNG encoding', async () => {
  const element = document.createElement('div'); document.body.append(element);
  setActiveChart({ element, sessionId: 'run-a', resultRevision: 'rev-a', cycle: 40, useRox: false,
    backgroundMode: 'none', entry: 7, ownerId: 'u', caption: 'cycle 40', identity: 'old-40' });
  const { result: hook } = renderHook(() => useExports());
  await expect(hook.current.exportPNG()).rejects.toMatchObject({ code: 'EXPORT_CONDITION_MISMATCH' });
  element.remove();
});

it('RED/GREEN: blocks stored export while the input revision is unknown or refreshing', async () => {
  const { result: hook } = renderHook(() => useExports());
  useAnalysisStore.setState({ currentInputRevision: null, inputRevisionRefreshing: true });
  await expect(hook.current.exportStored('csv')).rejects.toThrow('stale or unverified');
  expect(exportCsv).not.toHaveBeenCalled();
});

it.each(['stale', 'legacy'] as const)('RED/GREEN: blocks stored export for a %s result', async (state) => {
  const { result: hook } = renderHook(() => useExports());
  if (state === 'stale') useAnalysisStore.setState({ currentInputRevision: 3, inputRevisionRefreshing: false });
  else useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 40, assignments: {}, analysis_context: null } as never });
  await expect(hook.current.exportStored('xlsx')).rejects.toThrow(/stale|legacy/i);
  expect(exportCsv).not.toHaveBeenCalled();
});

it('RED/GREEN: cancellation during a deferred stored blob prevents the download click', async () => {
  let resolve!: (value: Blob) => void;
  vi.mocked(exportCsv).mockReturnValue(new Promise<Blob>(done => { resolve = done; }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  const controller = new AbortController();
  const { result: hook } = renderHook(() => useExports());
  const exporting = hook.current.exportStored('csv', controller.signal);
  await vi.waitFor(() => expect(exportCsv).toHaveBeenCalled());
  controller.abort();
  resolve(new Blob(['whole-run']));
  await exporting;
  expect(click).not.toHaveBeenCalled();
});

it('RED/GREEN: stored PNG keeps chart rendering live and always clears restore suppression on success and render failure', async () => {
  const element = storedChart();
  mockPngCaption();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0); return 1;
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  const { result: hook } = renderHook(() => useExports());
  await hook.current.exportStored('png');
  expect(Plotly.toImage).toHaveBeenCalledWith(element, expect.any(Object));
  expect(click).toHaveBeenCalledTimes(1);
  expect(useNavigationStore.getState().exportRestoring).toBe(false);
  element.remove();

  clearActiveChart(element);
  await expect(hook.current.exportStored('png')).rejects.toThrow('did not finish rendering');
  expect(useNavigationStore.getState().exportRestoring).toBe(false);
});

it('RED/GREEN: cancellation and session replacement clear stored-PNG restore suppression without a late download', async () => {
  let frame!: FrameRequestCallback;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback; return 1;
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  const controller = new AbortController();
  const { result: hook } = renderHook(() => useExports());
  const exporting = hook.current.exportStored('png', controller.signal);
  await waitFor(() => expect(useNavigationStore.getState().exportRestoring).toBe(true));
  useNavigationStore.getState().beginRestore('replacement');
  controller.abort();
  frame(0);
  await exporting;
  expect(useNavigationStore.getState().exportRestoring).toBe(false);
  expect(click).not.toHaveBeenCalled();
});

it('downloads and revokes a current whole-run CSV only while the export owner is current', async () => {
  vi.mocked(exportCsv).mockResolvedValue(new Blob(['whole-run']));
  const create = vi.fn(() => 'blob:result');
  const revoke = vi.fn();
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  const { result: hook } = renderHook(() => useExports());
  await hook.current.downloadCSV();
  expect(exportCsv).toHaveBeenCalledWith('run-a', 20, false, 'none', 'rev-a');
  expect(click).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledWith('blob:result');
});

it('RED/GREEN: suppresses a PNG download when ownership changes while the caption image decodes', async () => {
  useNavigationStore.setState({ cycle: 40 });
  const element = document.createElement('div'); document.body.append(element);
  setActiveChart({ element, sessionId: 'run-a', resultRevision: 'rev-a', cycle: 40, useRox: false,
    backgroundMode: 'none', entry: 7, ownerId: 'u', caption: 'cycle 40', identity: 'ready-40' });
  vi.mocked(Plotly.toImage).mockResolvedValue('data:image/png;base64,source');
  let load!: () => void;
  class DelayedImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 16; height = 16;
    set src(_value: string) { load = () => this.onload?.(); }
  }
  vi.stubGlobal('Image', DelayedImage);
  const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', font: '', fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn() }),
    toDataURL: () => 'data:image/png;base64,captioned' } as unknown as HTMLCanvasElement;
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((name: string) => name === 'canvas' ? canvas : create(name));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  const { result: hook } = renderHook(() => useExports());
  const exporting = hook.current.exportPNG();
  await vi.waitFor(() => expect(Plotly.toImage).toHaveBeenCalled());
  useAuthStore.setState({ user: { id: 'other', username: 'other', display_name: 'Other', role: 'user' } });
  load();
  await expect(exporting).rejects.toThrow('captioning');
  expect(click).not.toHaveBeenCalled();
  element.remove();
});

it('RED/GREEN: rejects a held PNG when a filter render replaces its registry generation', async () => {
  useNavigationStore.setState({ cycle: 40 });
  const element = document.createElement('div'); document.body.append(element);
  const chart = { element, sessionId: 'run-a', resultRevision: 'rev-a', cycle: 40, useRox: false,
    backgroundMode: 'none' as const, entry: 7, ownerId: 'u', caption: 'visible wells A1,A2', identity: 'render:1:A1,A2' };
  setActiveChart(chart);
  let resolve!: (url: string) => void;
  vi.mocked(Plotly.toImage).mockReturnValue(new Promise(done => { resolve = done; }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  const { result: hook } = renderHook(() => useExports());
  const exporting = hook.current.exportPNG();
  await waitFor(() => expect(Plotly.toImage).toHaveBeenCalledWith(element, expect.any(Object)));
  // Same session/revision/conditions, but selected-only filtering produced a
  // distinct rendered chart. The old encoding must never be downloadable.
  setActiveChart({ ...chart, caption: 'visible wells A1', identity: 'render:2:A1' });
  resolve('data:image/png;base64,old-pixels');
  await expect(exporting).rejects.toThrow('active chart changed during PNG rendering');
  expect(click).not.toHaveBeenCalled();
  element.remove();
});
