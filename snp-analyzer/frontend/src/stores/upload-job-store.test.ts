import { expect, it } from 'vitest';
import { createUploadJobStore } from './upload-job-store';

it('keeps only immutable whitelisted metadata for each file across UI reads', () => {
  const store = createUploadJobStore();
  const names = ['run-one.eds', 'run-two.eds'];
  const batch = store.getState().begin('owner', names)!;
  names[0] = 'modified';
  store.getState().update(batch, 0, { stage: 'uploading' });
  store.getState().update(batch, 0, { stage: 'success', sessionId: 'sid-1' });
  store.getState().update(batch, 1, { stage: 'unknown', reason: 'response_lost' });
  const jobs = store.getState().jobs;
  expect(jobs.map(job => [job.filename, job.stage, job.sessionId])).toEqual([
    ['run-one.eds', 'success', 'sid-1'], ['run-two.eds', 'unknown', null],
  ]);
  expect(Object.keys(jobs[0]).sort()).toEqual(['batch', 'filename', 'id', 'reason', 'sessionId', 'stage']);
  expect(Object.isFrozen(jobs[0])).toBe(true);
  expect(store.getState().ownerId).toBe('owner');
  expect(createUploadJobStore().getState().jobs).toEqual([]);
});
it('rejects duplicate active batches and drops late outcomes after logout or owner replacement', () => {
  const store = createUploadJobStore();
  const old = store.getState().begin('old-owner', ['private.eds'])!;
  expect(store.getState().begin('old-owner', ['duplicate.eds'])).toBeNull();
  store.getState().reset();
  const current = store.getState().begin('new-owner', ['new.eds'])!;
  store.getState().update(old, 0, { stage: 'success', sessionId: 'private-sid' });
  store.getState().finish(old);
  expect(store.getState().jobs.map(job => job.filename)).toEqual(['new.eds']);
  expect(store.getState().pending).toBe(true);
  store.getState().finish(current);
  expect(store.getState().pending).toBe(false);
  expect(JSON.stringify(store.getState())).not.toContain('private');
});
it('preserves completed summaries when a later same-owner batch starts but clears on new owner', () => {
  const store = createUploadJobStore();
  const first = store.getState().begin('u', ['one.eds'])!;
  store.getState().update(first, 0, { stage: 'failed', reason: 'server' });
  store.getState().finish(first);
  store.getState().begin('u', ['two.eds']);
  expect(store.getState().jobs).toHaveLength(2);
  store.getState().begin('other', ['other.eds']);
  expect(store.getState().jobs.map(job => job.filename)).toEqual(['other.eds']);
});
