import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useWellFilter } from './use-well-filter';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useDataStore } from '@/stores/data-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { ClusteringAlgorithm } from '@/types/api';

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'user', display_name: null }, generation: 1 });
  useSessionStore.setState({ sessionId: 's', entryGeneration: 1, wellGroups: { other: ['A2'] } });
  useSelectionStore.setState({ selectedGroup: 'other', focusSelectedWells: true });
  useSettingsStore.setState({ useRox: false, showEmptyWells: false, backgroundMode: 'none' });
  useDataStore.setState({ plateWells: [], wellTypeAssignments: { P24: 'Omit' } });
  useNavigationStore.setState({ qualityTarget: { session: 's', well: 'P24', cycle: 0,
    source: 'curve', basis: 'unversioned', useRox: false, marker: null, inputRevision: null, resultRevision: null },
    qualityLease: { owner: 'u', auth: 1, entry: 1, token: 1 } });
});
it('temporarily reveals only the requested missing-cycle Omit well without changing any filters', () => {
  const { result } = renderHook(useWellFilter);
  expect(result.current.isWellVisible('P24')).toBe(true);
  expect(result.current.isWellVisible('A2')).toBe(false);
  expect(result.current.visibleRows).toContain('P');
  expect(result.current.visibleCols).toContain(24);
  expect(useSelectionStore.getState().selectedGroup).toBe('other');
  expect(useSelectionStore.getState().focusSelectedWells).toBe(true);
  expect(useSettingsStore.getState().showEmptyWells).toBe(false);
  expect(useDataStore.getState().wellTypeAssignments.P24).toBe('Omit');
  act(() => useNavigationStore.getState().setQualityTarget(null));
  expect(result.current.isWellVisible('P24')).toBe(false);
});
it('removes the exception immediately after normalization changes or session reentry', () => {
  const { result } = renderHook(useWellFilter);
  act(() => useSettingsStore.setState({ useRox: true }));
  expect(result.current.isWellVisible('P24')).toBe(false);
  act(() => { useSettingsStore.setState({ useRox: false }); useSessionStore.setState({ entryGeneration: 2 }); });
  expect(result.current.isWellVisible('P24')).toBe(false);
});
it('removes NTC reveal after an input edit or a replaced displayed result', () => {
  const current = useNavigationStore.getState().qualityTarget!;
  useNavigationStore.setState({ qualityTarget: { ...current, source: 'ntc', basis: 'current-input', inputRevision: 2, resultRevision: null, background: 'none' } });
  useAnalysisStore.setState({ currentInputRevision: 2, result: null });
  const { result } = renderHook(useWellFilter);
  expect(result.current.isWellVisible('P24')).toBe(true);
  act(() => useAnalysisStore.setState({ currentInputRevision: 3 }));
  expect(result.current.isWellVisible('P24')).toBe(false);
  act(() => {
    useAnalysisStore.setState({ currentInputRevision: 2 });
    useSettingsStore.setState({ backgroundMode: 'pre_read' });
  });
  expect(result.current.isWellVisible('P24')).toBe(false);
  act(() => {
    useSettingsStore.setState({ backgroundMode: 'none' });
    useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 0, assignments: {}, analysis_context: {
      schema_version: 1, result_revision: 'new-result', analysed_at: '2026-01-01T00:00:00Z', cycle: 0,
      use_rox: false, normalization_applied: false, background: 'none', algorithm: ClusteringAlgorithm.AUTO,
      parameters: {}, regions: [], input_revision: 2,
    } } });
  });
  expect(result.current.isWellVisible('P24')).toBe(false);
});
