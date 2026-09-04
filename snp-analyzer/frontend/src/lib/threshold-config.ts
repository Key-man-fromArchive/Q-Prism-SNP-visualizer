// The per-marker threshold config, and the defaults the backend applies when a
// field is absent.
//
// `ThresholdConfig` requires the three diploid cutoffs, so a caller that only
// wants to set ONE field (a dosage ceiling, an NTC quadrant) still has to send
// a complete object. These defaults mirror app/models.py::ThresholdConfig, and
// live here so the literals are written down once instead of being re-typed as
// `?? 0.1` / `?? 0.4` / `?? 0.6` at every call site.
import type { ThresholdConfig } from '@/types/api';

export const THRESHOLD_DEFAULTS = {
  ntc_threshold: 0.1,
  allele1_ratio_max: 0.4,
  allele2_ratio_min: 0.6,
} as const;

/** Fill in whatever `existing` does not specify. */
export function completeThresholdConfig(
  existing: ThresholdConfig | null | undefined,
  overrides: Partial<ThresholdConfig> = {}
): ThresholdConfig {
  return {
    ntc_threshold: existing?.ntc_threshold ?? THRESHOLD_DEFAULTS.ntc_threshold,
    ntc_fam_max: existing?.ntc_fam_max ?? null,
    ntc_allele2_max: existing?.ntc_allele2_max ?? null,
    allele1_ratio_max: existing?.allele1_ratio_max ?? THRESHOLD_DEFAULTS.allele1_ratio_max,
    allele2_ratio_min: existing?.allele2_ratio_min ?? THRESHOLD_DEFAULTS.allele2_ratio_min,
    boundaries: existing?.boundaries ?? null,
    offset: existing?.offset ?? 0,
    dosage_max: existing?.dosage_max ?? null,
    ...overrides,
  };
}

/** Set (or clear, with null) the assay's dosage ceiling, leaving every other
 *  field as it was. Clearing it means "the full ladder", which is the same
 *  thing as never having declared one. */
export function withDosageMax(
  existing: ThresholdConfig | null | undefined,
  dosageMax: number | null
): ThresholdConfig | null {
  // Nothing else was configured and nothing is being declared: keep the marker
  // free of a config object entirely, so an undeclared ceiling stays absent
  // rather than becoming a defaults-shaped record the caller cannot tell apart.
  if (dosageMax === null && !existing) return null;
  return completeThresholdConfig(existing, { dosage_max: dosageMax });
}
