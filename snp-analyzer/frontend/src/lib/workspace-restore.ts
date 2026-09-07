import type { AnalysisContext, UploadResponse } from '@/types/api';
import { calculationView, isCalculationView, isRecord, readViewCache, type CalculationView } from './session-view-cache';

type RunConstraints = Pick<UploadResponse, 'has_rox' | 'background_modes'>;
function defaults(info: RunConstraints, ploidy: number): CalculationView {
  return { useRox: Boolean(info.has_rox), backgroundMode: 'none', clusterAlgorithm: 'threshold',
    ntcThreshold: 0.1, allele1RatioMax: 0.4, allele2RatioMin: 0.6, nClusters: 4, ploidy };
}
function contextSettings(context: AnalysisContext | null, fallback: CalculationView): CalculationView {
  if (!context) return fallback;
  const parameters = context.parameters;
  const thresholds = isRecord(parameters.threshold_config) ? parameters.threshold_config : {};
  const candidate = { ...fallback, useRox: context.use_rox, backgroundMode: context.background,
    clusterAlgorithm: context.algorithm === 'kmeans' ? 'kmeans' : 'threshold',
    nClusters: parameters.n_clusters ?? fallback.nClusters,
    ntcThreshold: thresholds.ntc_threshold ?? fallback.ntcThreshold,
    allele1RatioMax: thresholds.allele1_ratio_max ?? fallback.allele1RatioMax,
    allele2RatioMin: thresholds.allele2_ratio_min ?? fallback.allele2RatioMin };
  return isCalculationView(candidate) ? calculationView(candidate) : fallback;
}
function supported(settings: CalculationView, info: RunConstraints): boolean {
  return !info.background_modes || info.background_modes.includes(settings.backgroundMode);
}
function constrain(settings: CalculationView, info: RunConstraints): CalculationView {
  return { ...settings, useRox: Boolean(info.has_rox) && settings.useRox,
    backgroundMode: supported(settings, info) ? settings.backgroundMode : 'none' };
}
/** No global settings are read: a previous run cannot become this run's defaults. */
export function restoreSettings(owner: string, session: string, context: AnalysisContext | null, info: RunConstraints, ploidy: number) {
  const cached = readViewCache(owner, session);
  const fallback = constrain(contextSettings(context, defaults(info, ploidy)), info);
  if (!cached.settings) return { settings: fallback, reasons: cached.reason ? [cached.reason] : [] };
  if (!supported(cached.settings, info)) return { settings: fallback, reasons: ['cache:unsupported'] };
  return { settings: constrain(cached.settings, info), reasons: [] };
}
