import { describe, expect, it } from 'vitest';
import { cycleReadText, markerCallLabel } from './chart-semantics';
import { axisTitle } from './scatter-axes';
import en from '@/locales/en';
import type { MarkerRegion, ReadLabel } from '@/types/api';

const reads: Record<number, ReadLabel> = {
  1: { stage: 'pre_read', pcr_cycle: 0, temperature: 25 },
  2: { stage: 'amplification', pcr_cycle: 36, temperature: 40 },
  3: { stage: 'amplification', pcr_cycle: 37, temperature: 40 },
  4: { stage: 'amplification', pcr_cycle: 38, temperature: 40 },
  5: { stage: 'amplification', pcr_cycle: 39, temperature: 40 },
  6: { stage: 'amplification', pcr_cycle: 40, temperature: 40 },
  7: { stage: 'post_read', pcr_cycle: 40, temperature: 25 },
};
const named = { id: 'm', name: 'M', wells: [], ploidy: 2, allele_labels: { fam: 'WT', allele2: 'MT' } } as unknown as MarkerRegion;
const plain = { ...named, allele_labels: null } as MarkerRegion;

describe('cycleReadText', () => {
  it('numbers amplification reads within the amplification block', () => {
    expect(cycleReadText(2, reads, en)).toBe('Amplification 1/5 · PCR 36 · 40°C');
    expect(cycleReadText(6, reads, en)).toBe('Amplification 5/5 · PCR 40 · 40°C');
  });
  it('names pre- and post-reads', () => {
    expect(cycleReadText(1, reads, en)).toContain('Pre-read');
    expect(cycleReadText(7, reads, en)).toContain('Post-read');
  });
  it('is null without read labels or for an unknown cycle', () => {
    expect(cycleReadText(2, null, en)).toBeNull();
    expect(cycleReadText(2, undefined, en)).toBeNull();
    expect(cycleReadText(99, reads, en)).toBeNull();
  });
});

describe('markerCallLabel', () => {
  it('uses allele names for diploid calls, FAM side first', () => {
    expect(markerCallLabel('Allele 1 Homo', en, named)).toBe('WT/WT');
    expect(markerCallLabel('Heterozygous', en, named)).toBe('WT/MT');
    expect(markerCallLabel('Allele 2 Homo', en, named)).toBe('MT/MT');
  });
  it('falls back to the localized call text without names or for non-genotype calls', () => {
    expect(markerCallLabel('Heterozygous', en, plain)).toBe(en.wellTypeHeterozygous);
    expect(markerCallLabel('NTC', en, named)).toBe(en.wellTypeNTC);
    expect(markerCallLabel('Heterozygous', en, undefined)).toBe(en.wellTypeHeterozygous);
  });
});

describe('axisTitle role label', () => {
  it('does not repeat an allele name the role label already carries', () => {
    expect(axisTitle('WT (FAM)', 'WT')).toBe('FAM (WT)');
    expect(axisTitle('MT (VIC)', 'MT', ' / ROX')).toBe('VIC (MT) / ROX');
  });
  it('prefers the dye plus the allele name over the role label', () => {
    expect(axisTitle('MT1 (VIC)', 'MT')).toBe('VIC (MT)');
  });
  it('writes the role label as dye (role) when the marker has no allele name', () => {
    expect(axisTitle('WT (FAM)', undefined)).toBe('FAM (WT)');
    expect(axisTitle('MT1 (VIC)', undefined, ' / ROX')).toBe('VIC (MT1) / ROX');
  });
});

describe('axisTitle', () => {
  it('pairs dye and allele name', () => {
    expect(axisTitle('FAM', 'WT')).toBe('FAM (WT)');
    expect(axisTitle('VIC', 'MT', ' / ROX')).toBe('VIC (MT) / ROX');
  });
  it('keeps the bare dye without a name', () => {
    expect(axisTitle('FAM', undefined)).toBe('FAM');
  });
});
