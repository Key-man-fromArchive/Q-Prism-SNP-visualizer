import { beforeEach, expect, it, vi } from 'vitest';
import { runImportJob } from './import-job';
import { useUploadJobStore } from '@/stores/upload-job-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import type { ImportParseResponse } from '@/types/api';
beforeEach(() => {
  useSessionStore.getState().reset(); useUploadJobStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
});
it('retains only mapped filename and unknown outcome without retrying the request', async () => {
  const request = vi.fn().mockRejectedValue(new TypeError('private URL'));
  expect(await runImportJob('one.csv', request)).toEqual({ reason: 'response_lost' });
  expect(request).toHaveBeenCalledOnce();
  expect(useUploadJobStore.getState().jobs[0]).toMatchObject({ filename: 'one.csv', stage: 'unknown', reason: 'response_lost' });
  expect(JSON.stringify(useUploadJobStore.getState().jobs)).not.toContain('private');
});
it('retains a known successful result and rejects a late response after same-owner session replacement', async () => {
  const response = { session_id: 'new', instrument: 'Synthetic', num_wells: 96, num_cycles: 40,
    allele2_dye: 'VIC', has_rox: false, suggested_cycle: 40, data_windows: null, well_groups: null } as ImportParseResponse;
  expect(await runImportJob('ok.csv', async () => response)).toEqual({ response });
  let resolve!: (value: ImportParseResponse) => void;
  const result = runImportJob('late.csv', () => new Promise(done => { resolve = done; }));
  useSessionStore.getState().reset(); resolve(response);
  expect(await result).toBeNull();
  expect(useUploadJobStore.getState().pending).toBe(false);
});
