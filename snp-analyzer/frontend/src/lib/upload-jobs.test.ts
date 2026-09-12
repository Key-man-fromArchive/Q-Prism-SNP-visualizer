import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, uploadFile } from './api';
import { MAX_FILES_PER_DROP, MAX_TOTAL_BYTES, runUploadJobs, uploadLimitViolation } from './upload-jobs';
import { useUploadJobStore } from '@/stores/upload-job-store';
import { useAuthStore } from '@/stores/auth-store';
import type { UploadResponse } from '@/types/api';
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), uploadFile: vi.fn() }));
const info: UploadResponse = { session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'VIC',
  num_wells: 96, num_cycles: 40, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null };
beforeEach(() => {
  vi.resetAllMocks(); useUploadJobStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: null, role: 'admin' } });
});
it('retains success/failed/unknown per file and never retries a lost upload response', async () => {
  vi.mocked(uploadFile).mockResolvedValueOnce(info)
    .mockRejectedValueOnce(new ApiError('private server detail', 500, {}))
    .mockRejectedValueOnce(new TypeError('secret network URL'));
  const result = await runUploadJobs(['a.eds', 'b.eds', 'c.eds'].map(name => new File(['synthetic'], name)));
  expect(result).toBeNull();
  expect(uploadFile).toHaveBeenCalledTimes(3);
  expect(useUploadJobStore.getState().jobs.map(job => [job.stage, job.reason, job.sessionId])).toEqual([
    ['success', null, 'synthetic'], ['failed', 'server', null], ['unknown', 'response_lost', null],
  ]);
  expect(JSON.stringify(useUploadJobStore.getState().jobs)).not.toMatch(/private|secret|bytes/);
  expect(useUploadJobStore.getState().pending).toBe(false);
});
it('ignores late success after logout and does not send remaining files for a previous owner', async () => {
  let resolve!: (value: UploadResponse) => void;
  vi.mocked(uploadFile).mockReturnValue(new Promise(done => { resolve = done; }));
  const result = runUploadJobs([new File([], 'one.eds'), new File([], 'two.eds')]);
  useAuthStore.getState().clearAuth();
  resolve(info);
  expect(await result).toBeNull();
  expect(uploadFile).toHaveBeenCalledTimes(1);
  expect(useUploadJobStore.getState().jobs).toEqual([]);
});
it('only returns a known successful single upload and treats malformed success as unknown', async () => {
  vi.mocked(uploadFile).mockResolvedValueOnce(info).mockResolvedValueOnce({} as UploadResponse);
  expect(await runUploadJobs([new File([], 'one.eds')])).toEqual(info);
  expect(await runUploadJobs([new File([], 'two.eds')])).toBeNull();
  expect(useUploadJobStore.getState().jobs[1]).toMatchObject({ stage: 'unknown', reason: 'response_lost' });
});
it('does not publish a partial 200 response that has a session ID but lacks required session fields', async () => {
  vi.mocked(uploadFile).mockResolvedValue({ session_id: 'partial' } as UploadResponse);
  expect(await runUploadJobs([new File([], 'partial.eds')])).toBeNull();
  expect(useUploadJobStore.getState().jobs[0]).toMatchObject({ stage: 'unknown', reason: 'response_lost', sessionId: null });
});

// P5-S2-T1: FileWorkspaceDrawer and UploadZone are two separate upload
// implementations that are not being unified (D-7), but both must reject an
// oversized drop with the same numbers — so both read this one function
// instead of keeping their own count/size thresholds.
describe('uploadLimitViolation', () => {
  it('accepts a drop within both the count and the total-size limit', () => {
    const files = Array.from({ length: MAX_FILES_PER_DROP }, (_, i) => new File(['x'], `f${i}.eds`));
    expect(uploadLimitViolation(files)).toBeNull();
  });
  it('flags a drop with more files than the shared per-drop maximum', () => {
    const files = Array.from({ length: MAX_FILES_PER_DROP + 1 }, (_, i) => new File(['x'], `f${i}.eds`));
    expect(uploadLimitViolation(files)).toBe('too_many_files');
  });
  it('flags a drop whose combined byte size exceeds the shared total-size maximum', () => {
    // A real (MAX_TOTAL_BYTES + 1)-byte buffer would be wasteful to allocate
    // in a test; only `size` matters to the check, so fake it on a tiny file.
    const big = new File(['x'], 'big.eds');
    Object.defineProperty(big, 'size', { value: MAX_TOTAL_BYTES + 1 });
    expect(uploadLimitViolation([big])).toBe('total_too_large');
  });
});
