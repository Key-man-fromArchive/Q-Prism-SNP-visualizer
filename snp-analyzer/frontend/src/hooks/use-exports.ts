import { useCallback } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useAuthStore } from '@/stores/auth-store';
import { ApiError, exportCsv, exportPdf, exportXlsx } from '@/lib/api';
import Plotly from 'plotly.js-dist-min';
import { getActiveChart, type ActiveChart } from '@/lib/chart-export-registry';
import type { BackgroundMode } from '@/types/api';

// The legacy fallback: exactly what shipped before per-chart sizing existed,
// used whenever the element hasn't been laid out (0-size, disconnected, or
// jsdom in tests) so a PNG export still succeeds instead of encoding garbage.
const FALLBACK_CAPTURE_SIZE = { width: 1200, height: 900 };
const CAPTURE_LONG_SIDE = 1200;

// Derives the PNG capture size from the chart element's own rendered
// aspect ratio (not from settings-store.scatterAspect directly) so the
// export always matches whatever the user is actually looking at --
// including a 70vh-clamped viewport where the CSS aspect-ratio can't hold.
function pngCaptureSize(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  const width = rect.width || element.clientWidth;
  const height = rect.height || element.clientHeight;
  if (!width || !height) return FALLBACK_CAPTURE_SIZE;
  if (width >= height) {
    return { width: CAPTURE_LONG_SIDE, height: Math.round(CAPTURE_LONG_SIDE * (height / width)) };
  }
  return { width: Math.round(CAPTURE_LONG_SIDE * (width / height)), height: CAPTURE_LONG_SIDE };
}

async function captionPng(dataUrl: string, caption: string): Promise<string> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve(); image.onerror = () => reject(new Error('PNG export image could not be decoded'));
    image.src = dataUrl;
  });
  const words = caption.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > 120 && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height + 20 + Math.max(lines.length, 1) * 22;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG caption canvas is unavailable');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  context.fillStyle = '#111827'; context.font = '16px sans-serif';
  lines.forEach((text, index) => context.fillText(text, 14, image.height + 24 + index * 22, canvas.width - 28));
  return canvas.toDataURL('image/png');
}

// @TASK P7-VALUES - client-side well x cycle values CSV (FB-06 Q-1: "웰마다
// 형광값"). Deliberately independent of the stored-result export machinery
// above (conditions()/storedConditions()): those validate against
// analysis_context/result_revision because they re-export a *committed*
// genotype result. This CSV instead mirrors whatever the live overlay/table
// is currently showing -- there is no "stale result" concept for it, so it
// does not need that validation, only the values already on screen.
function escapeCsvField(value: string | number): string {
  const s = String(value);
  return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds the CSV text for the per-well x per-cycle value table. Values
 *  passed in are ALREADY normalization/background-corrected (norm_fam /
 *  norm_allele2 from the amplification response) -- never labeled "raw"
 *  here. `normalizationApplied`/`backgroundMode` mirror the honest
 *  reported/unreported handling `OverlayProcessingStatus` uses: `undefined`
 *  means the server didn't say, which is a different fact from "not
 *  applied" and must not be guessed from `requestedRox`. */
export function buildWellCycleValuesCsv(params: {
  curves: { well: string; values: number[] }[];
  cycles: number[];
  channelLabel: string;
  sessionId: string;
  normalizationApplied: boolean | undefined;
  backgroundMode: BackgroundMode | undefined;
  requestedRox: boolean;
}): string {
  const metaRows: (string | number)[][] = [
    ['Session', params.sessionId],
    ['Channel', params.channelLabel],
    ['Requested reference normalization', params.requestedRox ? 'yes' : 'no'],
    ['Normalization applied', params.normalizationApplied === undefined ? 'unreported' : params.normalizationApplied ? 'yes' : 'no'],
    ['Background mode', params.backgroundMode ?? 'unreported'],
  ];
  const header = ['Well', ...params.cycles.map(String)];
  const dataRows = params.curves.map((c) => [c.well, ...c.values.map(String)]);
  return [...metaRows, [], header, ...dataRows]
    .map((row) => row.map(escapeCsvField).join(','))
    .join('\n');
}

/** Triggers a browser download of arbitrary text content. Standalone (not
 *  reusing `saveBlob` above) because `saveBlob` is scoped inside the
 *  `useExports()` hook closure and gated on the stored-export ownership
 *  checks that don't apply here (see `buildWellCycleValuesCsv` above). */
export function downloadTextFile(filename: string, content: string, mimeType = 'text/csv;charset=utf-8;'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    window.URL.revokeObjectURL(url);
  }
}

type ExportIdentity = { sessionId: string; entry: number; ownerId: string | undefined };
type ExportConditions = ExportIdentity & { cycle: number | undefined; useRox: boolean; backgroundMode: BackgroundMode; revision: string };
function stillOwns(identity: ExportIdentity): boolean {
  return useSessionStore.getState().sessionId === identity.sessionId
    && useSessionStore.getState().entryGeneration === identity.entry
    && useAuthStore.getState().user?.id === identity.ownerId;
}

function validatePngConditions(current: ExportConditions): void {
  const analysis = useAnalysisStore.getState();
  const context = analysis.result?.analysis_context;
  if (!context || analysis.inputRevisionRefreshing || analysis.currentInputRevision === null
    || analysis.currentInputRevision !== context.input_revision) {
    throw new Error('Reanalyze before exporting a stale or unverified result');
  }
  if (context.cycle !== current.cycle || context.use_rox !== current.useRox || context.background !== current.backgroundMode) {
    throw new ApiError('The current view differs from the completed result', 409, {
      detail: { code: 'EXPORT_CONDITION_MISMATCH', message: 'Choose current reanalysis or the stored result' },
    });
  }
}
function chartMatches(chart: ActiveChart | null, current: ExportConditions): boolean {
  return chart !== null && chart.entry === current.entry && chart.ownerId === current.ownerId
    && chart.cycle === current.cycle && chart.useRox === current.useRox && chart.backgroundMode === current.backgroundMode;
}
function requirePngChart(current: ExportConditions): ActiveChart {
  const chart = getActiveChart(current.sessionId, current.revision);
  if (!chart) throw new Error('The active chart is not ready for export');
  if (!chartMatches(chart, current)) {
    throw new ApiError('The rendered chart does not match the current analysis conditions', 409, {
      detail: { code: 'EXPORT_CONDITION_MISMATCH', message: 'Render the requested analysis conditions first' },
    });
  }
  return chart;
}
function assertPngOwnership(current: ExportConditions, chart: ActiveChart, stage: string, signal?: AbortSignal): void {
  if (signal?.aborted || !stillOwns(current) || getActiveChart(current.sessionId, current.revision)?.identity !== chart.identity) {
    throw new Error(`The active chart changed during PNG ${stage}`);
  }
}
async function waitForStoredChart(current: ExportConditions, exportPNG: (signal?: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<void> {
  for (let frame = 0; frame < 60; frame += 1) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (signal?.aborted) return;
    if (chartMatches(getActiveChart(current.sessionId, current.revision), current)) {
      await exportPNG(signal); return;
    }
  }
  throw new Error('The stored chart did not finish rendering');
}
async function renderStoredPng(current: ExportConditions, exportPNG: (signal?: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<void> {
  const nav = useNavigationStore.getState();
  const restore = { session: nav.session, entry: useSessionStore.getState().entryGeneration };
  nav.setExportRestoring(true);
  useNavigationStore.getState().setCycle(current.cycle ?? 0);
  useSettingsStore.getState().setUseRox(current.useRox);
  useSettingsStore.getState().setBackgroundMode(current.backgroundMode);
  try { await waitForStoredChart(current, exportPNG, signal); }
  finally {
    if (useNavigationStore.getState().session === restore.session && useSessionStore.getState().entryGeneration === restore.entry) {
      useNavigationStore.getState().setExportRestoring(false);
    }
  }
}

/**
 * Hook providing export functions for the current session
 */
export function useExports(): {
  downloadCSV: () => Promise<void>;
  exportPNG: (signal?: AbortSignal) => Promise<void>;
  exportPDF: () => Promise<void>;
  exportXLSX: () => Promise<void>;
  exportStored: (kind: 'csv' | 'png' | 'pdf' | 'xlsx', signal?: AbortSignal) => Promise<void>;
  printReport: () => void;
} {
  const conditions = useCallback(() => {
    const { sessionId, entryGeneration: entry } = useSessionStore.getState();
    const { useRox, backgroundMode } = useSettingsStore.getState();
    const { cycle } = useNavigationStore.getState();
    const { pending, result } = useAnalysisStore.getState();
    const { currentInputRevision, inputRevisionRefreshing } = useAnalysisStore.getState();
    const ownerId = useAuthStore.getState().user?.id;
    const revision = result?.analysis_context?.result_revision;
    if (!sessionId) throw new Error('No active session');
    if (pending) throw new Error('Wait for the active analysis before exporting');
    if (!revision) throw new Error('Reanalyze before exporting a legacy result');
    return { sessionId, cycle: cycle ?? undefined, useRox, backgroundMode, revision, entry, ownerId,
      currentInputRevision, inputRevisionRefreshing };
  }, []);

  const storedConditions = useCallback(() => {
    const current = conditions();
    const { result, currentInputRevision, inputRevisionRefreshing } = useAnalysisStore.getState();
    const context = result?.analysis_context;
    if (!context) throw new Error('Reanalyze before exporting a legacy result');
    if (inputRevisionRefreshing || currentInputRevision === null || currentInputRevision !== context.input_revision) {
      throw new Error('Reanalyze before exporting a stale or unverified result');
    }
    return { ...current, cycle: context.cycle, useRox: context.use_rox,
      backgroundMode: context.background, revision: context.result_revision };
  }, [conditions]);

  const saveBlob = useCallback((blob: Blob, current: ReturnType<typeof conditions>, filename: string, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    if (!stillOwns(current)) return;
    const url = window.URL.createObjectURL(blob);
    try {
      if (signal?.aborted || !stillOwns(current)) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      window.URL.revokeObjectURL(url);
    }
  }, []);

  const downloadCSV = useCallback(async () => {
    const current = conditions();

    try {
      const blob = await exportCsv(current.sessionId, current.cycle, current.useRox, current.backgroundMode, current.revision);
      saveBlob(blob, current, `snp-results-${current.sessionId.replace(/[^a-zA-Z0-9._-]/g, '_')}.csv`);
    } catch (error) {
      console.error('Failed to download CSV:', error);
      throw error;
    }
  }, [conditions, saveBlob]);

  const exportPNG = useCallback(async (signal?: AbortSignal) => {
    const current = conditions();
    validatePngConditions(current);
    const chart = requirePngChart(current);

    try {
      const { width, height } = pngCaptureSize(chart.element);
      const dataUrl = await Plotly.toImage(chart.element, {
        format: 'png',
        width,
        height,
        scale: 2,
      });

      assertPngOwnership(current, chart, 'rendering', signal);
      const captioned = await captionPng(dataUrl, chart.caption);
      assertPngOwnership(current, chart, 'captioning', signal);
      const a = document.createElement('a');
      a.href = captioned;
      const suffix = current.sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
      a.download = `scatter-plot-${suffix}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to export PNG:', error);
      throw error;
    }
  }, [conditions]);

  const exportPDF = useCallback(async () => {
    const current = conditions();

    try {
      const blob = await exportPdf(current.sessionId, current.useRox, current.backgroundMode, current.cycle, current.revision);
      saveBlob(blob, current, `snp-report-${current.sessionId.replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      throw error;
    }
  }, [conditions, saveBlob]);

  const exportXLSX = useCallback(async () => {
    const current = conditions();

    try {
      const blob = await exportXlsx(current.sessionId, current.useRox, current.backgroundMode, current.cycle, current.revision);
      saveBlob(blob, current, `snp-report-${current.sessionId.replace(/[^a-zA-Z0-9._-]/g, '_')}.xlsx`);
    } catch (error) {
      console.error('Failed to export XLSX:', error);
      throw error;
    }
  }, [conditions, saveBlob]);

  const exportStored = useCallback(async (kind: 'csv' | 'png' | 'pdf' | 'xlsx', signal?: AbortSignal) => {
    const current = storedConditions();
    try {
      if (signal?.aborted) return;
      if (kind === 'png') {
        await renderStoredPng(current, exportPNG, signal);
        return;
      }
      const blob = kind === 'csv'
        ? await exportCsv(current.sessionId, current.cycle, current.useRox, current.backgroundMode, current.revision)
        : kind === 'pdf'
          ? await exportPdf(current.sessionId, current.useRox, current.backgroundMode, current.cycle, current.revision)
          : await exportXlsx(current.sessionId, current.useRox, current.backgroundMode, current.cycle, current.revision);
      saveBlob(blob, current, `snp-${kind}-stored-${current.sessionId.replace(/[^a-zA-Z0-9._-]/g, '_')}.${kind}`, signal);
    } catch (error) {
      console.error(`Failed to export stored ${kind}:`, error);
      throw error;
    }
  }, [exportPNG, saveBlob, storedConditions]);

  const printReport = useCallback(() => {
    window.print();
  }, []);

  return {
    downloadCSV,
    exportPNG,
    exportPDF,
    exportXLSX,
    exportStored,
    printReport,
  };
}
