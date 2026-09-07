import { beforeEach, expect, it } from 'vitest';
import { useSessionStore } from './session-store';
import type { UploadResponse } from '@/types/api';
import { useAnalysisStore } from './analysis-store';

const info: UploadResponse = { session_id: 's', instrument: 'test', allele2_dye: 'VIC', num_wells: 1,
  num_cycles: 40, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null };
beforeEach(() => useSessionStore.getState().reset());
it('defaults existing callers to reopen, never treating missing results as proof of a fresh upload', () => {
  useSessionStore.getState().setSession('s', info);
  expect(useSessionStore.getState().entryReason).toBe('reopen');
  expect(useSessionStore.getState().consumeInitialAnalysis()).toBe(false);
});
it('allows the explicit new-upload initial analysis once, including repeated same-session entries', () => {
  useSessionStore.getState().setSession('s', info, 'fresh');
  expect(useSessionStore.getState().consumeInitialAnalysis()).toBe(true);
  expect(useSessionStore.getState().consumeInitialAnalysis()).toBe(false);
  useSessionStore.getState().setSession('s', info);
  expect(useSessionStore.getState().consumeInitialAnalysis()).toBe(false);
});
it('invalidates old tickets synchronously even when reopening the same session identifier', () => {
  useSessionStore.getState().setSession('s', info);
  useAnalysisStore.getState().setSession('s', 'u');
  const ticket = useAnalysisStore.getState().beginRequest('analysis');
  useSessionStore.getState().setSession('s', info);
  expect(useAnalysisStore.getState().isCurrent(ticket)).toBe(false);
});
