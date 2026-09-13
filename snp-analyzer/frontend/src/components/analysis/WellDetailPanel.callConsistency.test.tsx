import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { WellDetailPanel } from './WellDetailPanel';
import { ResultsTable } from './ResultsTable';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';
import { getAmplification } from '@/lib/api';
import en from '@/locales/en';

// @TASK P24-DETAIL-CALL - locks the three-screen agreement that P22's
// investigation found missing: WellDetailPanel used to invent a genotype
// from the raw FAM/allele2 ratio for wells with no manual_type/auto_cluster
// at all, while ResultsTable (and the export snapshot, result_snapshot.py's
// `_row_call`) both leave such a well as "no call". This file renders BOTH
// screens against the exact same scatter point and checks they agree on
// whether a call exists -- so a future regression that reintroduces
// ratio-guessing in only one screen fails here, not just in production.
// @SPEC docs/planning/feedback-2026-09-11/evidence/P22-CALL-LOGIC.md (finding 3)
vi.mock('@/lib/api', () => ({ getAmplification: vi.fn() }));
vi.mock('@/hooks/use-well-filter', () => ({ useWellFilter: () => ({ visibleRows: ['A'], visibleCols: [1] }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'HEX', curves: [] });
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: null, sessionInfo: null });
  useSelectionStore.setState({ selectedWell: 'A1', selectedWells: [] });
  useSettingsStore.setState({ ploidy: 2, showAutoCluster: true, showManualTypes: true });
});

it('agree there is no genotype for a well with no manual_type/auto_cluster, even when the raw ratio looks decisive', () => {
  // Raw ratio 0.8 -- exactly the shape that used to trip WellDetailPanel's
  // removed 0.6/0.4 ratio cut into a fabricated "Allele 1" call.
  const point = { well: 'A1', sample_name: null, norm_fam: 8, norm_allele2: 2,
    raw_fam: 8, raw_allele2: 2, raw_rox: null, auto_cluster: null, manual_type: null };
  useDataStore.setState({ scatterPoints: [point] });

  const detail = render(<WellDetailPanel />);
  const grid = render(<ResultsTable />);

  // Detail panel: explicit "no call" marker, and no genotype text anywhere.
  const genotypeRow = detail.container.querySelector('#detail-content > table')!;
  expect(genotypeRow).toHaveTextContent('—');
  expect(genotypeRow).not.toHaveTextContent(en.genotypeAllele1);
  expect(genotypeRow).not.toHaveTextContent(en.genotypeHeterozygous);

  // ResultsTable: same well, no displayed call either (blank cell, and the
  // accessible description says so explicitly).
  const cell = grid.container.querySelector('[data-well="A1"]')!;
  expect(cell).toHaveAccessibleName(new RegExp(en.chartNoDisplayedCall));
  expect(cell.textContent).not.toMatch(/Het|Hom/);
});

it('agree there IS a genotype for a well with a real auto_cluster call, and it is the same call', () => {
  const point = { well: 'A1', sample_name: null, norm_fam: 1, norm_allele2: 1,
    raw_fam: 1, raw_allele2: 1, raw_rox: null, auto_cluster: 'Heterozygous', manual_type: null, confidence: 0.95 };
  useDataStore.setState({ scatterPoints: [point] });

  const detail = render(<WellDetailPanel />);
  const grid = render(<ResultsTable />);

  expect(detail.container.querySelector('#detail-content > table')).toHaveTextContent(en.genotypeHeterozygous);
  const cell = grid.container.querySelector('[data-well="A1"]')!;
  expect(cell).toHaveAccessibleName(new RegExp(en.wellTypeHeterozygous));
});

it('shows no data for a well missing from the plate entirely, in either screen', () => {
  // A1 is the selected well but has no reading at all (a different well, B1,
  // does) -- distinct from the "no call yet" case above, and from the whole
  // plate being empty (which ResultsTable renders as its own empty state).
  useDataStore.setState({ scatterPoints: [{ well: 'B1', sample_name: null, norm_fam: 1, norm_allele2: 1,
    raw_fam: 1, raw_allele2: 1, raw_rox: null, auto_cluster: 'Heterozygous', manual_type: null }] });
  render(<WellDetailPanel />);
  const grid = render(<ResultsTable />);

  expect(screen.getAllByText(en.noDataForWell('A1'))[0]).toBeVisible();
  const cell = grid.container.querySelector('[data-well="A1"]')!;
  expect(cell).toHaveAccessibleName(new RegExp(en.wellEmptyState));
});
