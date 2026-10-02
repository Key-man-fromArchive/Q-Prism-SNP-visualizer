import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { GenotypeSummary } from './GenotypeSummary';
import { countCalls } from '@/lib/genotype-counts';
import { useLanguageStore } from '@/stores/language-store';

beforeEach(() => useLanguageStore.getState().setLanguage('ko'));

it('counts wells that could not be called as undetermined and controls as excluded', () => {
  const wells = ['A1', 'A2', 'A3', 'A4'];
  const { entries, excluded } = countCalls({ A1: 'NTC', A2: 'Undetermined', A3: 'Heterozygous' }, wells, 2);
  expect(Object.fromEntries(entries.map((e) => [e.label, e.count]))).toEqual({
    'Allele 1 Homo': 0, Heterozygous: 1, 'Allele 2 Homo': 0, Undetermined: 2,
  });
  expect(excluded).toBe(1);
});

it('still renders the summary card when every well is undetermined or a control', () => {
  const { entries, excluded } = countCalls({}, Array.from({ length: 96 }, (_, i) => `W${i}`), 2);
  render(<GenotypeSummary ploidy={2} entries={entries} excluded={excluded} />);
  expect(screen.getByTestId('genotype-counts-card')).toHaveTextContent('지노타입 판정');
  expect(screen.getByTestId('genotype-counts')).toHaveTextContent('96');
});
