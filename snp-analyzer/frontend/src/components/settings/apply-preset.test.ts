import { beforeEach, expect, it } from 'vitest';
import { applyPreset } from './apply-preset';
import { useSettingsStore } from '@/stores/settings-store';

beforeEach(() => useSettingsStore.getState().resetToDefaults());

it('applies each supplied setting, including zero values and false', () => {
  expect(applyPreset({ algorithm: 'kmeans', use_rox: false, background: 'pre_read',
    fix_axis: false, x_min: 0, x_max: 9, y_min: 0, y_max: 8,
    ntc_threshold: 0, allele1_ratio_max: 0.3, allele2_ratio_min: 0.7, n_clusters: 3,
  }, ['none', 'pre_read'], useSettingsStore.getState())).toBe(true);
  expect(useSettingsStore.getState()).toMatchObject({ clusterAlgorithm: 'kmeans', useRox: false,
    backgroundMode: 'pre_read', fixAxis: false, xMin: 0, xMax: 9, yMin: 0, yMax: 8,
    ntcThreshold: 0, allele1RatioMax: 0.3, allele2RatioMin: 0.7, nClusters: 3,
  });
});

it('does not change settings for an empty preset', () => {
  const before = useSettingsStore.getState();
  expect(applyPreset({}, ['none'], before)).toBe(true);
  expect(useSettingsStore.getState()).toEqual(before);
});

it('skips an unavailable background but applies a supported algorithm', () => {
  expect(applyPreset({ algorithm: 'threshold', background: 'pre_read' }, ['none'], useSettingsStore.getState())).toBe(true);
  expect(useSettingsStore.getState().backgroundMode).toBe('none');
});

it('rejects auto before applying any of the other supplied values', () => {
  const before = useSettingsStore.getState();
  expect(applyPreset({ algorithm: 'auto', use_rox: false, x_max: 99 }, ['none'], before)).toBe(false);
  expect(useSettingsStore.getState()).toEqual(before);
});
