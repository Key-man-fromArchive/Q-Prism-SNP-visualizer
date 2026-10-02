import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ResultsTable } from './ResultsTable';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
import type { AlleleLabels } from '@/types/api';

vi.mock('@/hooks/use-well-filter', () => ({ useWellFilter: () => ({ visibleRows: ['A'], visibleCols: [1, 2] }) }));

const point = (well: string) => ({ well, norm_fam: 1, norm_allele2: 2, raw_fam: 1, raw_allele2: 2, raw_rox: null,
  sample_name: null, auto_cluster: 'Allele 1 Homo', manual_type: null });

it('names each well by the marker it belongs to, not by the selected marker', () => {
  useLanguageStore.getState().setLanguage('en');
  useDataStore.setState({ scatterPoints: [point('A1'), point('A2')] });
  const wellAlleleLabels = new Map<string, AlleleLabels | null>([
    ['A1', { fam: 'Red', allele2: 'Blue' }],
    ['A2', { fam: 'Tall', allele2: 'Short' }],
  ]);
  render(<ResultsTable alleleLabels={{ fam: 'Red', allele2: 'Blue' }} wellAlleleLabels={wellAlleleLabels} />);
  expect(screen.getByRole('gridcell', { name: /A1/ })).toHaveTextContent('Red');
  expect(screen.getByRole('gridcell', { name: /A2/ })).toHaveTextContent('Tall');
  expect(screen.getByRole('gridcell', { name: /A2/ })).not.toHaveTextContent('Red');
});

it('falls back to the unnamed call for a well no marker claims', () => {
  useLanguageStore.getState().setLanguage('en');
  useDataStore.setState({ scatterPoints: [point('A1'), point('A2')] });
  render(<ResultsTable alleleLabels={{ fam: 'Red', allele2: 'Blue' }}
    wellAlleleLabels={new Map([['A1', { fam: 'Red', allele2: 'Blue' }]])} />);
  expect(screen.getByRole('gridcell', { name: /A2/ })).not.toHaveTextContent('Red');
});
