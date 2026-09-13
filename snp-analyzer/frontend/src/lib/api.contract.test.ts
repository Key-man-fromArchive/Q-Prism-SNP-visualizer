import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { useAuthStore } from '@/stores/auth-store';

afterEach(() => vi.unstubAllGlobals());

describe('API error contract', () => {
  it('uses absolute QC zero while preserving omitted QC mode', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetcher);
    await api.getQc('s', 0, false, 'none');
    await api.getQc('s');
    expect(fetcher.mock.calls[0][0]).toContain('cycle=0&cycle_mode=absolute');
    expect(fetcher.mock.calls[1][0]).not.toContain('cycle_mode');
  });
  it('sends absolute mode for selected zero but preserves omitted read defaults', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ algorithm: 'auto', cycle: 0, assignments: {} }))));
    vi.stubGlobal('fetch', fetcher);
    await api.getScatter('s', 0);
    await api.getPlate('s', 0);
    await api.getScatter('s');
    await api.runClustering('s', { algorithm: 'auto', cycle: 0, n_clusters: 4 });
    expect(fetcher.mock.calls[0][0]).toContain('cycle=0&cycle_mode=absolute');
    expect(fetcher.mock.calls[1][0]).toContain('cycle=0&cycle_mode=absolute');
    expect(fetcher.mock.calls[2][0]).not.toContain('cycle_mode');
    expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({ cycle: 0, cycle_mode: 'absolute' });
  });
  const detail = { code: 'INPUT_REVISION_CONFLICT', message: 'Refresh', current_input_revision: 2 };
  it('rejects malformed result data instead of claiming a completed result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ algorithm: 'auto', assignments: 'invalid', cycle: 20 }))));
    await expect(api.getCluster('s')).rejects.toThrow('Invalid clustering response');
  });
  it('keeps missing cluster wire response distinct without fabricating context', async () => {
    const missing = { algorithm: null, cycle: 0, assignments: {}, input_revision: 0, analysis_status: 'idle', analysis_pending: false };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(missing))));
    await expect(api.getCluster('s')).resolves.toEqual(missing);
  });
  it('checks actual POST cluster responses and session info without adding revision to reads', async () => {
    const response = { algorithm: 'auto', cycle: 20, assignments: {}, input_revision: 2 };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(response)))));
    await expect(api.runClustering('s', { algorithm: 'auto', cycle: 20, n_clusters: 4 })).resolves.toEqual(response);
    await api.getSessionInfo('s');
    await api.setWellTypes('s', { wells: [], well_type: 'Unknown', expected_input_revision: 2 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...response, algorithm: null }))));
    await expect(api.runClustering('s', { algorithm: 'auto', cycle: 20, n_clusters: 4 })).rejects.toThrow('Invalid clustering response');
  });
  for (const [name, call] of [
    ['JSON', () => api.getCluster('s')], ['CSV', () => api.exportCsv('s')],
    ['PDF', () => api.exportPdf('s')], ['XLSX', () => api.exportXlsx('s')],
  ] as const) {
    it(`${name} preserves structured errors and class identity`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 409 })));
      const error = await call().catch((value: unknown) => value);
      expect(error).toBeInstanceOf(api.ApiError);
      expect(error).toMatchObject({ status: 409, code: detail.code, detail, message: 'Refresh', payload: { detail } });
    });
  }
  it('preserves legacy string errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Forbidden' }), { status: 403 })));
    await expect(api.getCluster('s')).rejects.toMatchObject({ status: 403, message: 'Forbidden', code: null });
  });
  it('P18-AUTH-401: leaves a valid session alone on 403 (permission, not auth, failure)', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Forbidden' }), { status: 403 })));
    await expect(api.getCluster('s')).rejects.toMatchObject({ status: 403 });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
  it('preserves nonJSON payload and clears auth on blob 401', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Expired', { status: 401 })));
    await expect(api.exportCsv('s')).rejects.toMatchObject({ status: 401, payload: 'Expired' });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
  it('retains import mapping 422 as a return value', async () => {
    const payload = { status: 'validation_failed', issues: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 422 })));
    await expect(api.previewImportFile(new File(['x'], 'x.csv'))).resolves.toEqual(payload);
  });
  it('retains valid unsupported-analysis 409 as import domain data', async () => {
    const payload = { status: 'unsupported_analysis_mode', reason_code: 'mode', assay_mode: 'wt_mt1_mt2', message: 'Unsupported' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 409 })));
    const request = { preview_id: 'p', mapping: { assay_mode: 'wt_mt' as const, normalization_mode: 'none' as const,
      channel_roles: {}, delimiter: null, decimal_separator: null, header_row: null, first_data_row: null,
      well_column: null, cycle_column: null, sample_column: null, target_column: null, dye_column: null,
      role_column: null, rfu_column: null, rfu_columns: {} } };
    await expect(api.parseImportPreview(request)).resolves.toEqual(payload);
  });
  it('retains HTTP status and clears auth when error body is unreadable', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    const response = new Response('', { status: 401 });
    vi.spyOn(response, 'text').mockRejectedValue(new Error('Disconnected'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(api.getCluster('s')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
  it('never returns malformed import text as a mapping result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>failure</html>', { status: 422 })));
    await expect(api.previewImportFile(new File(['x'], 'x.csv'))).rejects.toBeInstanceOf(api.ApiError);
  });
  it('sends explicit false/zero and revision on exports', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('csv'));
    vi.stubGlobal('fetch', fetcher);
    await api.exportCsv('s', 0, false, 'none', 'revision');
    expect(fetcher.mock.calls[0][0]).toContain('cycle=0&cycle_mode=absolute&use_rox=false&background=none&result_revision=revision');
  });
  it('sends mutation revisions in bodies and DELETE query', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetcher);
    await api.setPloidy('s', 4, 0);
    await api.bulkSetWellTypes('s', {}, 0);
    await api.saveMarkers('s', [], 0);
    await api.updateMarker('s', 'm', { name: 'x' }, 0);
    await api.attachMarkerCatalog('s', 'm', 'c', 0);
    for (const call of fetcher.mock.calls) expect(JSON.parse(call[1].body)).toHaveProperty('expected_input_revision', 0);
    await api.deleteWellTypes('s', 0);
    await api.deleteMarkers('s', 0);
    for (const call of fetcher.mock.calls.slice(-2)) expect(call[0]).toContain('expected_input_revision=0');
  });
  it('retains report argument order and ASG explicit settings', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetcher);
    await api.exportPdf('s', false, 'none', 0, 'r');
    await api.exportXlsx('s', false, 'none', 0, 'r');
    for (const call of fetcher.mock.calls) expect(call[0]).toContain('cycle=0&cycle_mode=absolute&use_rox=false&background=none&result_revision=r');
    await api.saveAsgResult('s', 0, false, 'none', 'r');
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ session_id: 's', selected_cycle: 0, cycle_mode: 'absolute', use_rox: false, background: 'none', result_revision: 'r' });
  });
});
