import { describe, expect, it } from 'vitest';
import { alleleLegend, alleleSummary, displayGenotype, parseAlleleLabelInputs } from './genotype';
import type { MarkerRegion } from '@/types/api';

const named: MarkerRegion = {
  id: 'm', name: 'M', wells: ['A1'], ploidy: 2, allele_labels: { fam: 'WT', allele2: 'MT' },
};
const hexa: MarkerRegion = { ...named, ploidy: 6 };

describe('displayGenotype', () => {
  it('names diploid calls with the FAM-side name first', () => {
    expect(displayGenotype('Allele 1 Homo', named)).toBe('WT/WT');
    expect(displayGenotype('Heterozygous', named)).toBe('WT/MT');
    expect(displayGenotype('Allele 2 Homo', named)).toBe('MT/MT');
  });

  it('keeps the existing wording without a marker or names', () => {
    expect(displayGenotype('Heterozygous')).toBe('Heterozygous');
    expect(displayGenotype('Heterozygous', null)).toBe('Heterozygous');
    expect(displayGenotype('Allele 1 Homo', { ...named, allele_labels: null })).toBe('Allele 1 Homo');
    expect(displayGenotype('Allele 1 Homo', { ...named, allele_labels: undefined })).toBe('Allele 1 Homo');
  });

  it('leaves non-genotype assignments untouched', () => {
    expect(displayGenotype('NTC', named)).toBe('NTC');
    expect(displayGenotype('Undetermined', named)).toBe('Undetermined');
  });

  it('keeps allele-count strings for polyploid markers', () => {
    expect(displayGenotype('AAAABB', hexa)).toBe('AAAABB');
  });
});

describe('alleleLegend', () => {
  it('explains the letters of a polyploid marker', () => {
    expect(alleleLegend(hexa, 'VIC')).toBe('A = WT (FAM), B = MT (VIC)');
    expect(alleleLegend(hexa, 'HEX')).toBe('A = WT (FAM), B = MT (HEX)');
  });

  it('is absent for diploid, unnamed or missing markers', () => {
    expect(alleleLegend(named, 'VIC')).toBeNull();
    expect(alleleLegend({ ...hexa, allele_labels: null }, 'VIC')).toBeNull();
    expect(alleleLegend(null, 'VIC')).toBeNull();
  });
});

describe('alleleSummary', () => {
  it('pairs each dye with its name', () => {
    expect(alleleSummary({ fam: 'WT', allele2: 'MT' }, 'HEX')).toBe('FAM · WT / HEX · MT');
  });
  it('is null without names', () => {
    expect(alleleSummary(null, 'VIC')).toBeNull();
  });
});

describe('parseAlleleLabelInputs', () => {
  it('clears when both are blank', () => {
    expect(parseAlleleLabelInputs('  ', '')).toEqual({ ok: true, value: null });
  });
  it('trims and returns a pair', () => {
    expect(parseAlleleLabelInputs(' WT ', 'MT')).toEqual({ ok: true, value: { fam: 'WT', allele2: 'MT' } });
  });
  it('rejects one-sided, overlong and control-character names', () => {
    expect(parseAlleleLabelInputs('WT', '').ok).toBe(false);
    expect(parseAlleleLabelInputs('', 'MT').ok).toBe(false);
    expect(parseAlleleLabelInputs('x'.repeat(33), 'MT').ok).toBe(false);
    expect(parseAlleleLabelInputs('W\u0007T', 'MT').ok).toBe(false);
  });
  it('accepts exactly 32 characters', () => {
    expect(parseAlleleLabelInputs('x'.repeat(32), 'MT').ok).toBe(true);
  });
});
