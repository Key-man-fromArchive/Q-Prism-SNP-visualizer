import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { PlateLegend } from './PlateLegend';
import { callAppearance } from '@/lib/chart-semantics';
import en from '@/locales/en';
import { useLanguageStore } from '@/stores/language-store';
import type { PlateWell } from '@/types/api';

beforeEach(() => useLanguageStore.getState().setLanguage('en'));

function well(overrides: Partial<PlateWell>): PlateWell {
  return {
    well: 'A1', row: 0, col: 0, norm_fam: 1, norm_allele2: 1, ratio: 0.5,
    sample_name: null, auto_cluster: null, manual_type: null, ...overrides,
  };
}

it('lists only calls actually present on the plate, with the same color/glyph/label as callAppearance', () => {
  const wells = [
    well({ well: 'A1', manual_type: 'Allele 1 Homo' }),
    well({ well: 'A2', manual_type: 'Allele 1 Homo' }),
    well({ well: 'B1', manual_type: 'Heterozygous' }),
    well({ well: 'B2' }), // no manual/auto call at all
  ];
  render(<PlateLegend wells={wells} showManualTypes showAutoCluster ploidy={2} dark={false} />);

  const list = screen.getByRole('list', { name: en.plateLegendAria });
  const items = screen.getAllByRole('listitem');
  // Allele 2 Homo, NTC, Undetermined, etc. never occur on this plate -- must not appear.
  expect(items).toHaveLength(2);

  const hom1 = callAppearance('Allele 1 Homo', 2, false, en);
  const het = callAppearance('Heterozygous', 2, false, en);
  expect(list).toHaveTextContent(hom1.label);
  expect(list).toHaveTextContent(het.label);

  const hom1Item = screen.getByLabelText(`${hom1.description}: 2`);
  expect(hom1Item).toHaveTextContent('2');
  expect(hom1Item).toHaveTextContent(hom1.glyph);
  expect(hom1Item.querySelector('[aria-hidden="true"]')).toHaveStyle({ backgroundColor: hom1.bgColor });

  const hetItem = screen.getByLabelText(`${het.description}: 1`);
  expect(hetItem).toHaveTextContent('1');
});

it('does not render an entry for a genotype absent from the plate', () => {
  const wells = [well({ manual_type: 'Heterozygous' })];
  render(<PlateLegend wells={wells} showManualTypes showAutoCluster ploidy={2} dark={false} />);
  expect(screen.queryByText(en.wellTypeAllele1Homo)).not.toBeInTheDocument();
  expect(screen.queryByText('NTC')).not.toBeInTheDocument();
});

it('renders nothing when no well on the plate has a displayed call', () => {
  const wells = [well({ manual_type: null, auto_cluster: null })];
  const { container } = render(<PlateLegend wells={wells} showManualTypes showAutoCluster ploidy={2} dark={false} />);
  expect(container).toBeEmptyDOMElement();
});

it('renders nothing for an empty plate', () => {
  const { container } = render(<PlateLegend wells={[]} showManualTypes showAutoCluster ploidy={2} dark={false} />);
  expect(container).toBeEmptyDOMElement();
});

it('follows ploidy: a higher-ploidy dosage label replaces the diploid trio', () => {
  const wells = [well({ manual_type: 'AAAB' })]; // dosage 3 of ploidy 4
  render(<PlateLegend wells={wells} showManualTypes showAutoCluster ploidy={4} dark={false} />);
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(1);
  const appearance = callAppearance('AAAB', 4, false, en);
  expect(items[0]).toHaveTextContent(appearance.label);
  expect(screen.queryByText(en.wellTypeHeterozygous)).not.toBeInTheDocument();
});

it('respects showManualTypes/showAutoCluster the same way the plate cells do', () => {
  const wells = [well({ manual_type: 'Allele 1 Homo', auto_cluster: 'Heterozygous' })];
  render(<PlateLegend wells={wells} showManualTypes={false} showAutoCluster ploidy={2} dark={false} />);
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(1);
  expect(items[0]).toHaveTextContent(callAppearance('Heterozygous', 2, false, en).label);
});

it('counts every well carrying the same call', () => {
  const wells = ['A1', 'A2', 'A3'].map((w) => well({ well: w, manual_type: 'NTC' }));
  render(<PlateLegend wells={wells} showManualTypes showAutoCluster ploidy={2} dark={false} />);
  expect(screen.getByLabelText(`${en.wellTypeNTC}: 3`)).toBeInTheDocument();
});
