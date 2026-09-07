import { expect, it } from 'vitest';
import { createAnalysisStore } from './analysis-store';

const result = { algorithm: 'auto', cycle: 20, assignments: { A1: 'Unknown' }, input_revision: 0 };
it('ignores obsolete and previous-session responses and retains results on latest failure', () => {
  const store = createAnalysisStore();
  store.getState().setSession('s', 'u');
  const load = store.getState().beginRequest('load');
  const first = store.getState().beginRequest('analysis');
  expect(store.getState().accept(load, result)).toBe(false);
  expect(store.getState().accept(first, result)).toBe(true);
  const older = store.getState().beginRequest('analysis');
  const latest = store.getState().beginRequest('analysis');
  expect(store.getState().fail(latest, new Error('offline'))).toBe(true);
  expect(store.getState().accept(older, result)).toBe(false);
  expect(store.getState()).toMatchObject({ status: 'failed', result, currentInputRevision: 0 });
  store.getState().setSession('s', 'another-user');
  expect(store.getState().accept(latest, result)).toBe(false);
  expect(store.getState().result).toBeNull();
  expect(store.getState().currentInputRevision).toBeNull();
});
it('does not let duplicate completions or a late load replace a new request', () => {
  const store = createAnalysisStore(); store.getState().setSession('s', 'u');
  const ticket = store.getState().beginRequest('load');
  expect(store.getState().accept(ticket, result)).toBe(true);
  expect(store.getState().accept(ticket, { ...result, cycle: 40 })).toBe(false);
  const request = store.getState().beginRequest('analysis');
  expect(store.getState().status).toBe('computing');
  store.getState().clear();
  expect(store.getState().fail(request, new Error())).toBe(false);
});
it('tracks mutation revisions monotonically and rejects delayed old-revision loads', () => {
  const store = createAnalysisStore(); store.getState().setSession('s', 'u');
  const initial = store.getState().beginRequest('load'); store.getState().accept(initial, result);
  const load = store.getState().beginRequest('load');
  expect(store.getState().updateInputRevision('s', 'u', 2)).toBe(true);
  expect(store.getState().updateInputRevision('s', 'u', 1)).toBe(false);
  expect(store.getState().updateInputRevision('s', 'other', 9)).toBe(false);
  expect(store.getState().accept(load, result)).toBe(false);
  expect(store.getState().result).toEqual(result);
  expect(store.getState().currentInputRevision).toBe(2);
});
it('a read while analysis runs does not supersede its completion or clear local pending', () => {
  const store = createAnalysisStore(); store.getState().setSession('s', 'u');
  const analysis = store.getState().beginRequest('analysis');
  const load = store.getState().beginRequest('load');
  expect(store.getState().accept(load, { ...result, analysis_status: 'completed', analysis_pending: false })).toBe(true);
  expect(store.getState().status).toBe('computing');
  expect(store.getState().pending).toBe(true);
  expect(store.getState().accept(analysis, { ...result, cycle: 40 })).toBe(true);
  expect(store.getState().result?.cycle).toBe(40);
});
it('settles an obsolete current analysis without publishing its old input result', () => {
  const store = createAnalysisStore(); store.getState().setSession('s', 'u');
  const initial = store.getState().beginRequest('load'); store.getState().accept(initial, result);
  const analysis = store.getState().beginRequest('analysis');
  store.getState().updateInputRevision('s', 'u', 1);
  expect(store.getState().accept(analysis, { ...result, cycle: 40 })).toBe(false);
  expect(store.getState()).toMatchObject({ pending: false, localPending: false, status: 'failed', result });
});
it('keeps server pending/latest failure independent of retained result and unknown revisions', () => {
  const store = createAnalysisStore();
  expect(() => store.getState().beginRequest('load')).toThrow('No active');
  store.getState().setSession('s', 'u');
  const missing = store.getState().beginRequest('load');
  store.getState().accept(missing, { algorithm: null, cycle: 0, assignments: {} });
  expect(store.getState()).toMatchObject({ status: 'idle', result: null, currentInputRevision: null });
  const pending = store.getState().beginRequest('load');
  store.getState().accept(pending, { ...result, analysis_pending: true });
  expect(store.getState()).toMatchObject({ status: 'computing', pending: true, localPending: false });
  const failed = store.getState().beginRequest('load');
  store.getState().accept(failed, { ...result, analysis_status: 'failed', analysis_pending: false });
  expect(store.getState()).toMatchObject({ status: 'failed', pending: false, result });
});
