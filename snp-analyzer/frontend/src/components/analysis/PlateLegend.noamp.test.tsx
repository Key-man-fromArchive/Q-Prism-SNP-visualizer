import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { PlateLegend } from './PlateLegend';
import { NO_AMPLIFICATION } from '@/lib/amplification-qc';
import { useLanguageStore } from '@/stores/language-store';

beforeEach(() => useLanguageStore.getState().setLanguage('en'));

it('lists no-amplification wells with their own legend entry and count', () => {
  const wells = ['A1', 'A2'].map((well, i) => ({ well, row: 0, col: i, norm_fam: 1, norm_allele2: 1, ratio: 0.5,
    sample_name: null, auto_cluster: NO_AMPLIFICATION, manual_type: null }));
  render(<PlateLegend wells={wells} showManualTypes showAutoCluster ploidy={2} dark={false} />);
  expect(screen.getByLabelText('No amplification: 2')).toBeInTheDocument();
});
