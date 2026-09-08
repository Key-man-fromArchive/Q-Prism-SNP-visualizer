import { isRecord } from '@/lib/recovery-payload';

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
function runIdentity(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && ['session_id', 'instrument', 'allele2_dye'].every(key => typeof value[key] === 'string');
}
function scatterRun(value: unknown): boolean {
  if (!runIdentity(value) || !Array.isArray(value.points)) return false;
  return finite(value.cycle) && finite(value.num_wells) && value.points.every(point =>
    isRecord(point) && typeof point.well === 'string' && finite(point.norm_fam) && finite(point.norm_allele2));
}
function statsRun(value: unknown): boolean {
  return runIdentity(value) && ['n_wells', 'mean_fam', 'mean_allele2', 'std_fam', 'std_allele2'].every(key => finite(value[key]));
}
export function validComparison(scatter: unknown, stats: unknown): boolean {
  if (!isRecord(scatter) || !isRecord(stats) || !isRecord(stats.correlation)) return false;
  const correlation = stats.correlation;
  return [scatter.run1, scatter.run2].every(scatterRun) && [stats.run1, stats.run2].every(statsRun)
    && finite(correlation.n_matched_wells)
    && ['fam_r', 'allele2_r'].every(key => correlation[key] === null || finite(correlation[key]));
}
