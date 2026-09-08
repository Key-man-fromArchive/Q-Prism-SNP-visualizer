import { describe, expect, it } from 'vitest';
import { chartCategory, chartPointState, contrastRatio, callLabel, callAppearance, compositeColor } from './chart-semantics';
import { genotypeLabels } from './genotype';
import en from '@/locales/en';
import ko from '@/locales/ko';

describe('presentation-only chart semantics', () => {
  it('measures actual opaque and composited chart fills on both themes for every dosage/control', () => {
    expect(chartCategory('Allele 1 Homo', 2, false).color).toBe('#2563eb');
    for (const dark of [false, true]) {
      expect(new Set(['Allele 1 Homo', 'Heterozygous', 'Allele 2 Homo'].map(key => chartCategory(key, 2, dark).color)).size).toBe(3);
    }
    for (const dark of [false, true]) {
      const surface = dark ? '#1a1d27' : '#ffffff';
      for (const ploidy of [2, 4, 6, 8]) {
        for (const key of [...genotypeLabels(ploidy), 'NTC', 'Unknown', 'Positive Control', 'Undetermined', 'Empty', 'Omit', 'Unassigned']) {
          const info = chartCategory(key, ploidy, dark);
          expect(contrastRatio(compositeColor(info.color, surface, info.opacity), surface), `${dark}/${key}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
    expect(compositeColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('localizes call names without confusing them with well addresses', () => {
    expect(callLabel('Allele 1 Homo', en)).toBe(en.wellTypeAllele1Homo);
    expect(callLabel('NTC', ko)).toBe(ko.wellTypeNTC);
    expect(callLabel('AAAB', ko)).toBe('AAAB');
  });
  it('provides unambiguous cell calls and contrasting text without changing labels', () => {
    expect(callAppearance(null, 2, false, en)).toMatchObject({ label: '', bgColor: 'transparent' });
    for (const dark of [false, true]) {
      for (const ploidy of [2, 3, 4, 5, 6, 7, 8]) for (const key of [...genotypeLabels(ploidy), 'NTC', 'Positive Control', 'Unknown', 'Undetermined', 'Empty', 'Omit', 'Unassigned']) {
        const appearance = callAppearance(key, ploidy, dark, en);
        expect(appearance.label).not.toMatch(/^A[12]$/);
        expect(contrastRatio(appearance.textColor, appearance.bgColor)).toBeGreaterThanOrEqual(4.5);
        expect(appearance.description).toBe(callLabel(key, en));
      }
    }
  });
  for (const dark of [false, true]) {
    it(`distinguishes diploid calls and controls without color (${dark})`, () => {
      const keys = ['Allele 1 Homo', 'Heterozygous', 'Allele 2 Homo', 'NTC', 'Positive Control', 'Unknown', 'Undetermined', 'Empty', 'Omit', 'Unassigned'];
      const categories = keys.map(key => chartCategory(key, 2, dark));
      expect(new Set(categories.map(item => item.symbol)).size).toBe(keys.length);
      for (const item of categories) {
        expect(item.label).not.toMatch(/^A[12]$/);
        expect(contrastRatio(item.stroke, dark ? '#1a1d27' : '#ffffff')).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(item.text, dark ? '#1a1d27' : '#ffffff')).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`keeps selection and warning redundant without changing category (${dark})`, () => {
      const ordinary = chartPointState(false, false, dark);
      const selected = chartPointState(true, false, dark);
      const flagged = chartPointState(false, true, dark);
      expect(selected.width).toBeGreaterThan(ordinary.width);
      expect(selected.textKey).toBe('selected');
      expect(flagged.textKey).toBe('flagged');
      expect(flagged.width).toBeGreaterThan(ordinary.width);
    });
  }
  it('preserves higher-ploidy assignment labels and dosage-specific symbols', () => {
    const labels = ['BBBB', 'ABBB', 'AABB', 'AAAB', 'AAAA'];
    const categories = labels.map(key => chartCategory(key, 4, false));
    expect(categories.map(item => item.label)).toEqual(labels);
    expect(new Set(categories.map(item => item.symbol)).size).toBe(5);
  });
});
