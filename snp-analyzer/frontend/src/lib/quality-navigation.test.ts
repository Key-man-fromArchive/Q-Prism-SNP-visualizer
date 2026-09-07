import { beforeEach, expect, it, vi } from 'vitest';
import { getCluster, getMarkers, getSessionInfo } from './api';
import { navigateQualityTarget, restoreQualityNavigation, returnFromQuality } from './quality-navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { QualityTarget } from './quality-target';

vi.mock('./api', () => ({ getCluster: vi.fn(), getMarkers: vi.fn(), getSessionInfo: vi.fn() }));
const target: QualityTarget = { session: 's', well: 'A1', source: 'curve', basis: 'unversioned',
  cycle: 0, useRox: false, inputRevision: null, resultRevision: null, marker: null };
const info = { session_id: 's', instrument: 'test', allele2_dye: 'VIC', num_wells: 2, num_cycles: 3,
  cycles: [0, 10, 40], well_ids: ['A1', 'P24'], has_rox: false, data_windows: null,
  suggested_cycle: null, well_groups: null, input_revision: 2,
  analysis_status: 'completed' as const, analysis_pending: false };
beforeEach(() => {
  vi.resetAllMocks();
  useSettingsStore.setState({ useRox: false, backgroundMode: 'none' });
  useAuthStore.setState({ user: { id: 'u', username: 'tester', role: 'admin', display_name: null } });
  useSessionStore.setState({ sessionId: 's', entryGeneration: 1 });
  useNavigationStore.getState().clear();
  useNavigationStore.setState({ session: 's', cycle: 40, status: 'ready' });
  useSelectionStore.setState({ selectedGroup: 'keep', focusSelectedWells: true, selectedWell: null, selectedWells: [] });
  vi.mocked(getSessionInfo).mockResolvedValue(info);
  vi.mocked(getMarkers).mockResolvedValue({ markers: [] });
  vi.mocked(getCluster).mockResolvedValue({ algorithm: 'auto', cycle: 40, assignments: {} });
});
it('rejects a stale curve normalization basis rather than changing the current preference', async () => {
  useSettingsStore.setState({ useRox: true });
  expect(await navigateQualityTarget(target)).toBe(false);
  expect(useSettingsStore.getState().useRox).toBe(true);
  expect(useSelectionStore.getState().selectedWell).toBeNull();
});
it('does not depend on saved genotype availability for unversioned curve navigation', async () => {
  vi.mocked(getCluster).mockRejectedValue(new Error('No genotype result'));
  expect(await navigateQualityTarget(target)).toBe(true);
  expect(getCluster).not.toHaveBeenCalled();
});
it('rejects an NTC target when background changes while authorized metadata is pending', async () => {
  let resolve!: (value: typeof info) => void;
  vi.mocked(getSessionInfo).mockReturnValue(new Promise(done => { resolve = done; }));
  const ntc = { ...target, source: 'ntc' as const, basis: 'current-input' as const, inputRevision: 2,
    resultRevision: null, background: 'none' as const };
  const pending = navigateQualityTarget(ntc);
  useSettingsStore.setState({ backgroundMode: 'channel_min' });
  resolve(info);
  expect(await pending).toBe(false);
  expect(useNavigationStore.getState().qualityTarget).toBeNull();
  expect(useSettingsStore.getState().backgroundMode).toBe('channel_min');
});
it('checks current authorized metadata before selecting and preserves user filters', async () => {
  expect(await navigateQualityTarget(target)).toBe(true);
  expect(useNavigationStore.getState()).toMatchObject({ tab: 'analysis', surface: 'analysis', cycle: 0, qualityTarget: target });
  expect(useSelectionStore.getState()).toMatchObject({ selectedWell: 'A1', selectedGroup: 'keep', focusSelectedWells: true });
});
it('returns to the original view and selection without touching filters or reentering the session', async () => {
  useNavigationStore.setState({ tab: 'quality', cycle: 40 });
  useSelectionStore.setState({ selectedWell: 'P24', selectedWells: ['P24'] });
  await navigateQualityTarget(target);
  expect(await returnFromQuality()).toBe(true);
  expect(useNavigationStore.getState()).toMatchObject({ tab: 'quality', cycle: 40, qualityTarget: null });
  expect(useSelectionStore.getState()).toMatchObject({ selectedWell: 'P24', selectedGroup: 'keep', focusSelectedWells: true });
  expect(useSessionStore.getState().entryGeneration).toBe(1);
});
it('restores a same-entry non-target history location without admission reset', async () => {
  await navigateQualityTarget(target);
  expect(await restoreQualityNavigation(null, '?session=s&tab=quality&cycle=40')).toBe(true);
  expect(useNavigationStore.getState()).toMatchObject({ tab: 'quality', cycle: 40, qualityTarget: null });
  expect(useSessionStore.getState().entryGeneration).toBe(1);
});
it('routes partitioned unassigned wells to setup without changing marker definitions', async () => {
  vi.mocked(getMarkers).mockResolvedValue({ markers: [{ id: 'm', name: 'M', wells: ['P24'], ploidy: 2 }] });
  expect(await navigateQualityTarget(target)).toBe(true);
  expect(useNavigationStore.getState().surface).toBe('plate');
});
it('rejects unavailable wells with a safe state and leaves selection unchanged', async () => {
  expect(await navigateQualityTarget({ ...target, well: 'A2' })).toBe(false);
  expect(useNavigationStore.getState().qualityError).toBe('unavailable');
  expect(useSelectionStore.getState().selectedWell).toBeNull();
});
it('ignores a late response after same-SID reentry', async () => {
  let resolve!: (value: typeof info) => void;
  vi.mocked(getSessionInfo).mockReturnValue(new Promise(done => { resolve = done; }));
  const pending = navigateQualityTarget(target);
  useSessionStore.setState({ entryGeneration: 2 });
  resolve(info);
  expect(await pending).toBe(false);
  expect(useNavigationStore.getState().qualityTarget).toBeNull();
});
it('only applies the latest consecutive jump and never discloses raw request failures', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(getSessionInfo).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const old = navigateQualityTarget(target);
  expect(await navigateQualityTarget({ ...target, well: 'P24' })).toBe(true);
  reject(new Error('private response'));
  expect(await old).toBe(false);
  expect(useNavigationStore.getState()).toMatchObject({ qualityError: null, qualityTarget: { well: 'P24' }, qualityNavigating: false });
});
