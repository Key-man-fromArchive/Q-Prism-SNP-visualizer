import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlateView } from './PlateView';
import { PlateLegend } from './PlateLegend';
import { getPlate } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';
import en from '@/locales/en';
import type { AlleleLabels, PlateWell } from '@/types/api';

vi.mock('@/lib/api', () => ({ getPlate: vi.fn() }));

const NAMES: AlleleLabels = { fam: 'WT', allele2: 'MT' };

function well(id: string): PlateWell {
  return {
    well: id, row: 0, col: 0, norm_fam: 1, norm_allele2: 1, ratio: 0.5,
    sample_name: null, auto_cluster: null, manual_type: 'Allele 1 Homo',
  };
}

beforeEach(() => {
  useLanguageStore.getState().setLanguage('en');
  useSettingsStore.setState({ showManualTypes: true, showAutoCluster: true });
});

it('legend uses the canonical wording when named and unnamed markers share a call', () => {
  const byWell = new Map<string, AlleleLabels | null>([['A1', NAMES], ['A2', null]]);
  render(<PlateLegend wells={[well('A1'), well('A2')]} showManualTypes showAutoCluster ploidy={2} dark={false}
    alleleLabels={NAMES} labelsByWell={byWell} />);
  const list = screen.getByRole('list', { name: en.plateLegendAria });
  expect(list).not.toHaveTextContent('WT/WT');
  expect(list).toHaveTextContent('2');
});

it('legend uses names when every counted well has the same names', () => {
  const byWell = new Map<string, AlleleLabels | null>([['A1', NAMES], ['A2', { ...NAMES }]]);
  render(<PlateLegend wells={[well('A1'), well('A2')]} showManualTypes showAutoCluster ploidy={2} dark={false}
    labelsByWell={byWell} />);
  expect(screen.getByRole('list', { name: en.plateLegendAria })).toHaveTextContent('WT/WT');
});

it('names only the wells of the marker that has them', async () => {
  vi.mocked(getPlate).mockResolvedValue({ cycle: 0, allele2_dye: 'VIC', wells: [well('A1'), well('A2')] });
  useSessionStore.setState({ sessionId: 'mixed' });
  const byWell = new Map<string, AlleleLabels | null>([['A1', NAMES], ['A2', null]]);
  const view = render(<PlateView alleleLabels={NAMES} wellAlleleLabels={byWell} />);
  await act(async () => { await Promise.resolve(); });
  const a1 = view.container.querySelector<HTMLElement>('[data-well="A1"]')!;
  const a2 = view.container.querySelector<HTMLElement>('[data-well="A2"]')!;
  expect(a1.title).toContain('WT/WT');
  expect(a1.getAttribute('aria-label')).toContain('WT/WT');
  expect(a2.title).not.toContain('WT/WT');
  expect(a2.getAttribute('aria-label')).not.toContain('WT/WT');
  expect(screen.getByRole('list', { name: en.plateLegendAria })).not.toHaveTextContent('WT/WT');
});
