import { describe, expect, it } from 'vitest';
import { completeThresholdConfig, withDosageMax } from './threshold-config';
import type { ThresholdConfig } from '@/types/api';

describe('completeThresholdConfig', () => {
  it('fills in the backend defaults so a one-field update is still valid', () => {
    const config = completeThresholdConfig(null, { dosage_max: 3 });
    expect(config).toEqual({
      ntc_threshold: 0.1,
      ntc_fam_max: null,
      ntc_allele2_max: null,
      allele1_ratio_max: 0.4,
      allele2_ratio_min: 0.6,
      boundaries: null,
      offset: 0,
      dosage_max: 3,
    });
  });

  it('keeps every field the marker already had', () => {
    const existing: ThresholdConfig = {
      ntc_threshold: 0.25,
      ntc_fam_max: 5040,
      ntc_allele2_max: 2710,
      allele1_ratio_max: 0.35,
      allele2_ratio_min: 0.65,
      boundaries: [0.6, 0.3],
      offset: 1,
      dosage_max: 4,
    };
    expect(completeThresholdConfig(existing)).toEqual(existing);
  });

  it('lets an override win over what was there', () => {
    const existing = completeThresholdConfig(null, { boundaries: [0.5] });
    const next = completeThresholdConfig(existing, { boundaries: null });
    expect(next.boundaries).toBeNull();
  });
});

describe('withDosageMax', () => {
  it('declares a ceiling on a marker that had no config at all', () => {
    expect(withDosageMax(null, 3)?.dosage_max).toBe(3);
  });

  it('leaves a marker with nothing configured configless', () => {
    // An undeclared ceiling must stay ABSENT rather than becoming a
    // defaults-shaped record: the backend distinguishes "not declared" (fall
    // back to the organism's ploidy) from any declared value.
    expect(withDosageMax(null, null)).toBeNull();
  });

  it('clears the ceiling without disturbing the rest', () => {
    const existing = completeThresholdConfig(null, {
      dosage_max: 3,
      ntc_fam_max: 5040,
      boundaries: [0.5],
    });
    const cleared = withDosageMax(existing, null);
    expect(cleared?.dosage_max).toBeNull();
    expect(cleared?.ntc_fam_max).toBe(5040);
    expect(cleared?.boundaries).toEqual([0.5]);
  });

  it('0 is a real ceiling, not the same as undeclared', () => {
    // Guards the null-vs-falsy distinction: `!dosageMax` would treat a
    // deliberate 0 as "hand it back to the full ladder".
    expect(withDosageMax(null, 0)?.dosage_max).toBe(0);
  });
});
