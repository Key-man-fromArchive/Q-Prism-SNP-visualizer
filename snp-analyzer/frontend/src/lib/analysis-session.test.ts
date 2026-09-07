import { beforeEach, expect, it, vi } from 'vitest';
import { getCluster, getMarkers, getPloidy, getSessionInfo } from './api';
import { loadAnalysisSession } from './analysis-session';
import { useAnalysisStore } from '@/stores/analysis-store';

vi.mock('./api', () => ({ getCluster: vi.fn(), getMarkers: vi.fn(), getPloidy: vi.fn(), getSessionInfo: vi.fn() }));
const info = { session_id: 's', instrument: 'test', allele2_dye: 'VIC', num_wells: 1, num_cycles: 3,
  cycles: [0, 10, 40], has_rox: false, data_windows: null, suggested_cycle: null, well_groups: null,
  input_revision: 0, analysis_status: 'idle' as const, analysis_pending: false };
const missing = { algorithm: null, cycle: 0, assignments: {}, input_revision: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  useAnalysisStore.getState().setSession('s', 'u');
  vi.mocked(getCluster).mockResolvedValue(missing);
  vi.mocked(getMarkers).mockResolvedValue({ markers: [] });
  vi.mocked(getPloidy).mockResolvedValue({ ploidy: 2 });
  vi.mocked(getSessionInfo).mockResolvedValue(info);
});
it('waits for marker discovery before declaring a missing result ready', async () => {
  let resolve!: (value: { markers: [] }) => void;
  vi.mocked(getMarkers).mockReturnValue(new Promise(done => { resolve = done; }));
  const completed = vi.fn();
  const pending = loadAnalysisSession().then(completed);
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  resolve({ markers: [] });
  await pending;
  expect(completed).toHaveBeenCalledWith({ markers: [], ploidy: 2, hasCompletedResult: false, info });
});
it('recognizes completed empty assignments and never treats a load failure as missing', async () => {
  vi.mocked(getCluster).mockResolvedValue({ ...missing, algorithm: 'auto' });
  expect(await loadAnalysisSession()).toMatchObject({ hasCompletedResult: true });
  vi.mocked(getCluster).mockRejectedValue(new Error('forbidden'));
  expect(await loadAnalysisSession()).toBeNull();
  expect(useAnalysisStore.getState().status).toBe('failed');
  expect(useAnalysisStore.getState().result?.algorithm).toBe('auto');
});
it('discards a loaded session after an owner switch', async () => {
  let resolve!: (value: typeof missing) => void;
  vi.mocked(getCluster).mockReturnValue(new Promise(done => { resolve = done; }));
  const pending = loadAnalysisSession();
  useAnalysisStore.getState().setSession('s', 'another-owner');
  resolve(missing);
  expect(await pending).toBeNull();
  expect(useAnalysisStore.getState().result).toBeNull();
});
it('retains the old result but takes the newer input revision from a parallel metadata read', async () => {
  vi.mocked(getCluster).mockResolvedValue({ ...missing, algorithm: 'auto', input_revision: 0 });
  vi.mocked(getSessionInfo).mockResolvedValue({ ...info, input_revision: 1 });
  await loadAnalysisSession();
  expect(useAnalysisStore.getState().result?.input_revision).toBe(0);
  expect(useAnalysisStore.getState().currentInputRevision).toBe(1);
});
it('does not regress a newer result envelope revision to older parallel metadata', async () => {
  vi.mocked(getCluster).mockResolvedValue({ ...missing, algorithm: 'auto', input_revision: 2 });
  vi.mocked(getSessionInfo).mockResolvedValue({ ...info, input_revision: 1 });
  expect(await loadAnalysisSession()).not.toBeNull();
  expect(useAnalysisStore.getState().currentInputRevision).toBe(2);
});
it.each([{ cycles: [] }, { cycles: [-1] }, { cycles: [NaN] }])('rejects unusable actual cycle lists $cycles', async ({ cycles }) => {
  vi.mocked(getSessionInfo).mockResolvedValue({ ...info, cycles });
  expect(await loadAnalysisSession()).toBeNull();
  expect(useAnalysisStore.getState().status).toBe('failed');
});
it('rejects invalid metadata revisions instead of declaring readiness', async () => {
  vi.mocked(getSessionInfo).mockResolvedValue({ ...info, input_revision: -1 });
  expect(await loadAnalysisSession()).toBeNull();
});
