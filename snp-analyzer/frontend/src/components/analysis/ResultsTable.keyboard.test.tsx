import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ResultsTable } from './ResultsTable';
import { useDataStore } from '@/stores/data-store';
import { useSelectionStore } from '@/stores/selection-store';
import * as genotype from '@/lib/genotype';
import { useLanguageStore } from '@/stores/language-store';
vi.mock('@/hooks/use-well-filter', () => ({ useWellFilter: () => ({ visibleRows: ['A'], visibleCols: [1, 2] }) }));
it('exposes result cells as a roving grid with names, selection and a live count', () => {
  useDataStore.setState({ scatterPoints: [{ well: 'A1', norm_fam: 1, norm_allele2: 2, raw_fam: 1, raw_allele2: 2, raw_rox: null, sample_name: null, auto_cluster: 'NTC', manual_type: null, confidence: 0.9 }] });
  useSelectionStore.getState().clearSelection();
  render(<ResultsTable />);
  const cell = screen.getByRole('gridcell', { name: /A1.*NTC/ });
  cell.focus();
  fireEvent.keyDown(cell, { key: ' ' });
  expect(cell.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('status').textContent).toContain('1');
  fireEvent.keyDown(cell, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: /A2/ }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(useSelectionStore.getState().selectedWells).toEqual([]);
});
it('uses black text on exact Het green #10b981 without changing the genotype background', () => {
  useLanguageStore.getState().setLanguage('en');
  const info = genotype.wellInfo('Heterozygous', 2, false);
  vi.spyOn(genotype, 'wellInfo').mockReturnValue({ ...info, color: '#10b981' });
  useDataStore.setState({ scatterPoints: [{ well: 'A1', norm_fam: 1, norm_allele2: 2,
    raw_fam: 1, raw_allele2: 2, raw_rox: null, sample_name: null, auto_cluster: 'Heterozygous', manual_type: null }] });
  render(<ResultsTable />);
  const cell = screen.getByRole('gridcell', { name: /A1.*Heterozygous/ });
  expect(cell.style.backgroundColor).toBe('rgb(16, 185, 129)');
  expect(cell.style.color).toBe('rgb(0, 0, 0)');
  vi.restoreAllMocks();
});
