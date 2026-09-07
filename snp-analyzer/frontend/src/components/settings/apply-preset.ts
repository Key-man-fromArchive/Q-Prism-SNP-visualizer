import type { BackgroundMode, PresetSettings } from '@/types/api';
import type { useSettingsStore } from '@/stores/settings-store';

type PresetTarget = Pick<ReturnType<typeof useSettingsStore.getState>,
  'setUseRox' | 'setBackgroundMode' | 'setFixAxis' | 'setXMin' | 'setXMax' |
  'setYMin' | 'setYMax' | 'setClusterAlgorithm' | 'setNtcThreshold' |
  'setAllele1RatioMax' | 'setAllele2RatioMin' | 'setNClusters'>;

function applyPlotSettings(settings: PresetSettings, target: PresetTarget): void {
  if (settings.fix_axis !== undefined) target.setFixAxis(settings.fix_axis);
  if (settings.x_min !== undefined) target.setXMin(settings.x_min);
  if (settings.x_max !== undefined) target.setXMax(settings.x_max);
  if (settings.y_min !== undefined) target.setYMin(settings.y_min);
  if (settings.y_max !== undefined) target.setYMax(settings.y_max);
}

function applyThresholdSettings(settings: PresetSettings, target: PresetTarget): void {
  if (settings.ntc_threshold !== undefined) target.setNtcThreshold(settings.ntc_threshold);
  if (settings.allele1_ratio_max !== undefined) target.setAllele1RatioMax(settings.allele1_ratio_max);
  if (settings.allele2_ratio_min !== undefined) target.setAllele2RatioMin(settings.allele2_ratio_min);
  if (settings.n_clusters !== undefined) target.setNClusters(settings.n_clusters);
}

/** Reject unsupported algorithms before invoking any setter; skip unavailable backgrounds. */
export function applyPreset(
  settings: PresetSettings, allowedBackgrounds: readonly BackgroundMode[], target: PresetTarget,
): boolean {
  const algorithm = settings.algorithm;
  if (algorithm !== undefined && algorithm !== 'threshold' && algorithm !== 'kmeans') return false;
  if (settings.use_rox !== undefined) target.setUseRox(settings.use_rox);
  if (settings.background !== undefined && allowedBackgrounds.includes(settings.background)) {
    target.setBackgroundMode(settings.background);
  }
  applyPlotSettings(settings, target);
  if (algorithm !== undefined) target.setClusterAlgorithm(algorithm);
  applyThresholdSettings(settings, target);
  return true;
}
