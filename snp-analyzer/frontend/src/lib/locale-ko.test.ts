import { expect, it } from 'vitest';
import en from '@/locales/en';
import ko from '@/locales/ko';
import { callAppearance, windowLabel } from '@/lib/chart-semantics';

it('en and ko define the same keys', () => {
  expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
});

it('ko has no untranslated "dosage" wording in user-facing strings', () => {
  const texts: string[] = [];
  for (const [key, value] of Object.entries(ko)) {
    if (typeof value === 'string') texts.push(value);
    else if (typeof value === 'function') {
      const sample = (value as (...args: number[]) => unknown)(1, 2, 3, 4);
      if (typeof sample === 'string') texts.push(sample);
    } else throw new Error(`unexpected ${key}`);
  }
  expect(texts.filter((s) => /dosage|copy/i.test(s))).toEqual([]);
});

it('window names are translated for display only', () => {
  expect(windowLabel('Pre-read', ko)).toBe('프리리드');
  expect(windowLabel('Amplification', ko)).toBe('증폭');
  expect(windowLabel('Post-read', ko)).toBe('포스트리드');
  expect(windowLabel('Pre-read', en)).toBe('Pre-read');
  expect(windowLabel('Custom', ko)).toBe('Custom');
});

it('plate legend short call labels come from the locale', () => {
  const label = (key: string, t: typeof en) => callAppearance(key, 2, false, t).label;
  expect(label('Allele 1 Homo', en)).toBe('Hom-1');
  expect(label('Heterozygous', en)).toBe('Het');
  expect(label('Allele 2 Homo', en)).toBe('Hom-2');
  expect(label('Allele 1 Homo', ko)).toBe('동형 1');
  expect(label('Heterozygous', ko)).toBe('이형');
  expect(label('Allele 2 Homo', ko)).toBe('동형 2');
});
