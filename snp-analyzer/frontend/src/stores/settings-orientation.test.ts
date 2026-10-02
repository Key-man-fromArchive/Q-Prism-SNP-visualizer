import { beforeEach, expect, it } from 'vitest';
import { useSettingsStore } from './settings-store';

beforeEach(() => {
  useSettingsStore.getState().resetToDefaults();
});

it('defaults scatterOrientation to fam_x (FAM on the x axis, the current view)', () => {
  expect(useSettingsStore.getState().scatterOrientation).toBe('fam_x');
});

it('setScatterOrientation swaps and persists, and resetToDefaults restores fam_x', () => {
  useSettingsStore.getState().setScatterOrientation('allele2_x');
  expect(useSettingsStore.getState().scatterOrientation).toBe('allele2_x');
  expect(window.localStorage.getItem('snp-analyzer-settings')).toContain('"scatterOrientation":"allele2_x"');
  useSettingsStore.getState().resetToDefaults();
  expect(useSettingsStore.getState().scatterOrientation).toBe('fam_x');
});
