import type { BackgroundMode } from '@/types/api';

export type CalculationView = {
  useRox: boolean; backgroundMode: BackgroundMode; clusterAlgorithm: 'threshold' | 'kmeans';
  ntcThreshold: number; allele1RatioMax: number; allele2RatioMin: number; nClusters: number; ploidy: number;
};
export type CachedView = { settings: CalculationView | null; reason: 'cache:invalid' | 'cache:unavailable' | null };
const prefix = 'qprism:view:1:';
function ownerPrefix(owner: string) { return `${prefix}${encodeURIComponent(owner)}:`; }
export function viewCacheKey(owner: string, session: string) { return `${ownerPrefix(owner)}${encodeURIComponent(session)}`; }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function integer(value: unknown, min: number, max: number): value is number {
  return finite(value, min, max) && Number.isInteger(value);
}
function isBackground(value: unknown): value is BackgroundMode {
  return value === 'none' || value === 'pre_read' || value === 'channel_min';
}
function isAlgorithm(value: unknown): value is CalculationView['clusterAlgorithm'] {
  return value === 'threshold' || value === 'kmeans';
}
function thresholds(value: Record<string, unknown>) {
  return finite(value.ntcThreshold, 0, Number.MAX_VALUE)
    && finite(value.allele1RatioMax, 0, 1) && finite(value.allele2RatioMin, 0, 1)
    && value.allele1RatioMax <= value.allele2RatioMin;
}
export function isCalculationView(value: unknown): value is CalculationView {
  if (!isRecord(value)) return false;
  return typeof value.useRox === 'boolean' && isBackground(value.backgroundMode)
    && isAlgorithm(value.clusterAlgorithm) && thresholds(value)
    && integer(value.nClusters, 1, 96) && integer(value.ploidy, 2, 8);
}
/** Copy explicitly: never persist a Zustand store or server context wholesale. */
export function calculationView(value: CalculationView): CalculationView {
  return { useRox: value.useRox, backgroundMode: value.backgroundMode, clusterAlgorithm: value.clusterAlgorithm,
    ntcThreshold: value.ntcThreshold, allele1RatioMax: value.allele1RatioMax, allele2RatioMin: value.allele2RatioMin,
    nClusters: value.nClusters, ploidy: value.ploidy };
}
export function readViewCache(owner: string, session: string): CachedView {
  let raw: string | null;
  try { raw = sessionStorage.getItem(viewCacheKey(owner, session)); }
  catch { return { settings: null, reason: 'cache:unavailable' }; }
  if (raw === null) return { settings: null, reason: null };
  try {
    const value: unknown = JSON.parse(raw);
    if (isRecord(value) && value.version === 1 && isCalculationView(value.settings)) {
      return { settings: calculationView(value.settings), reason: null };
    }
  } catch { /* Malformed JSON uses the same safe fallback as an obsolete schema. */ }
  return { settings: null, reason: 'cache:invalid' };
}
export function writeViewCache(owner: string, session: string, value: unknown): boolean {
  if (!isCalculationView(value)) return false;
  try {
    sessionStorage.setItem(viewCacheKey(owner, session), JSON.stringify({ version: 1, settings: calculationView(value) }));
    return true;
  } catch { return false; }
}
export function clearOwnerViewCache(owner: string): void {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
    for (const key of keys) if (key?.startsWith(ownerPrefix(owner))) sessionStorage.removeItem(key);
  } catch { /* Storage denial cannot prevent logout and in-memory invalidation. */ }
}
