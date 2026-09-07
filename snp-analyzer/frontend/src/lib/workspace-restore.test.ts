import { beforeEach, expect, it } from 'vitest';
import { restoreSettings } from './workspace-restore';
import { writeViewCache } from './session-view-cache';
import { useSettingsStore } from '@/stores/settings-store';
import type { AnalysisContext } from '@/types/api';

const context: AnalysisContext = { schema_version: 1, result_revision: 'r', analysed_at: '', cycle: 40,
  use_rox: true, normalization_applied: true, background: 'none', algorithm: 'kmeans',
  parameters: { n_clusters: 5, threshold_config: { ntc_threshold: 0.2, allele1_ratio_max: 0.3, allele2_ratio_min: 0.7 } }, regions: [], input_revision: 0 };
beforeEach(() => { sessionStorage.clear(); useSettingsStore.getState().resetToDefaults(); });
it('prefers the owner/session cache over context and unrelated global settings including false', () => {
  const cached = { ...useSettingsStore.getState(), useRox: false, ntcThreshold: 0.8 };
  writeViewCache('u', 's', cached);
  useSettingsStore.setState({ useRox: true, ntcThreshold: 999 });
  expect(restoreSettings('u', 's', context, { has_rox: true, background_modes: ['none'] }, 2).settings)
    .toMatchObject({ useRox: false, ntcThreshold: 0.8, clusterAlgorithm: 'threshold' });
});
it('uses stored context then data defaults, never another session global preference', () => {
  useSettingsStore.setState({ ntcThreshold: 999, backgroundMode: 'pre_read' });
  expect(restoreSettings('u', 's', context, { has_rox: true }, 2).settings)
    .toMatchObject({ useRox: true, ntcThreshold: 0.2, nClusters: 5, clusterAlgorithm: 'kmeans' });
  expect(restoreSettings('u', 'other', null, { has_rox: false }, 4).settings)
    .toMatchObject({ useRox: false, ntcThreshold: 0.1, backgroundMode: 'none', ploidy: 4 });
});
it('rejects cached modes unsupported by this data and falls back with a reason', () => {
  writeViewCache('u', 's', { ...useSettingsStore.getState(), backgroundMode: 'pre_read' });
  expect(restoreSettings('u', 's', context, { has_rox: false, background_modes: ['none'] }, 2))
    .toMatchObject({ settings: { useRox: false, backgroundMode: 'none' }, reasons: ['cache:unsupported'] });
});
