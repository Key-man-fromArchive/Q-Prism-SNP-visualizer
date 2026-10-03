import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useExports } from './use-exports';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useAuthStore } from '@/stores/auth-store';
import { exportPdf, exportPptx, exportScatterZip, exportXlsx } from '@/lib/api';

vi.mock('plotly.js-dist-min', () => ({ default: { toImage: vi.fn() } }));
vi.mock('@/lib/api', () => {
  class ApiError extends Error {}
  return { ApiError, exportCsv: vi.fn(), exportPdf: vi.fn(), exportXlsx: vi.fn(), exportPptx: vi.fn(), exportScatterZip: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 7 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useNavigationStore.setState({ session: 'run-a', cycle: 20, exportRestoring: false });
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ useRox: false, backgroundMode: 'none' });
  useAnalysisStore.setState({
    result: { algorithm: 'auto', cycle: 40, assignments: {},
      analysis_context: { result_revision: 'rev-a', cycle: 40, use_rox: false, background: 'none', input_revision: 2 } } as never,
    pending: false, currentInputRevision: 2, inputRevisionRefreshing: false,
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  for (const fn of [exportPdf, exportPptx, exportScatterZip, exportXlsx]) vi.mocked(fn).mockResolvedValue({ blob: new Blob(['x']) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('server exports carry the chosen scatter orientation, live and stored', async () => {
  useSettingsStore.getState().setScatterOrientation('allele2_x');
  const { result: hook } = renderHook(() => useExports());
  await hook.current.exportPDF();
  expect(exportPdf).toHaveBeenLastCalledWith('run-a', false, 'none', 20, 'rev-a', undefined, 'allele2_x');
  await hook.current.exportXLSX();
  expect(exportXlsx).toHaveBeenLastCalledWith('run-a', false, 'none', 20, 'rev-a', undefined, 'allele2_x');
  await hook.current.exportPPTX(['m1'], false);
  expect(exportPptx).toHaveBeenLastCalledWith('run-a', false, 'none', 20, 'rev-a', ['m1'], false, 'allele2_x');
  await hook.current.exportScatterZip();
  expect(exportScatterZip).toHaveBeenLastCalledWith('run-a', false, 'none', 20, 'rev-a', undefined, 'allele2_x');
  await hook.current.exportStored('pdf');
  expect(exportPdf).toHaveBeenLastCalledWith('run-a', false, 'none', 40, 'rev-a', undefined, 'allele2_x');
  await hook.current.exportStored('xlsx');
  expect(exportXlsx).toHaveBeenLastCalledWith('run-a', false, 'none', 40, 'rev-a', undefined, 'allele2_x');
});
