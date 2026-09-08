import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MarkerCatalogTab } from './MarkerCatalogTab';
import { listMarkerCatalog, copyMarkerCatalogEntry } from '@/lib/api';
import { useLanguageStore } from '@/stores/language-store';
import { useAuthStore } from '@/stores/auth-store';
import type { MarkerCatalogEntry } from '@/types/api';
vi.mock('@/lib/api', () => ({ listMarkerCatalog: vi.fn(), createMarkerCatalogEntry: vi.fn(), updateMarkerCatalogEntry: vi.fn(), deleteMarkerCatalogEntry: vi.fn(), copyMarkerCatalogEntry: vi.fn() }));
const entry: MarkerCatalogEntry = {
  id: 'm', owner_user_id: 'u', name: 'Synthetic assay', target_gene: null, snp_id: null, allele1_base: null, allele2_base: null,
  chemistry: null, default_ploidy: 2, color: null, expected_dosage_classes: null, interpretation_notes: '', asg_target_id: null,
  created_at: null, updated_at: null, dosage_trust: 'putative',
  calibration: { controls_present: false, amplification_verified: false, defined_ratio_points: [], notes: '', verified_at: null },
  validation: { status: 'none', ground_truth_method: null, n_compared: 0, concordance: null, notes: '' },
};
beforeEach(() => { vi.clearAllMocks(); useLanguageStore.setState({ language: 'en' }); vi.mocked(listMarkerCatalog).mockResolvedValue({ entries: [entry] }); });
it.each(['calibration', 'validation'])('rejects incomplete %s evidence before editing', async key => {
  vi.mocked(listMarkerCatalog).mockResolvedValueOnce({ entries: [{ ...entry, [key]: {} }] });
  render(<MarkerCatalogTab />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load data');
  expect(screen.queryByTestId('catalog-entry-row')).not.toBeInTheDocument();
});
it('distinguishes copy success with failed refresh while retaining the old list', async () => {
  vi.mocked(copyMarkerCatalogEntry).mockResolvedValue(entry);
  render(<MarkerCatalogTab />); await screen.findByText('Synthetic assay');
  vi.mocked(listMarkerCatalog).mockRejectedValueOnce(new Error('private server detail'));
  fireEvent.click(screen.getByTestId('catalog-copy-button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('The change succeeded');
  expect(screen.getByText('Synthetic assay')).toBeInTheDocument();
});
it('replaces an old owner list instead of publishing a held response', async () => {
  let resolve!: (value: { entries: MarkerCatalogEntry[] }) => void;
  vi.mocked(listMarkerCatalog).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue({ entries: [] });
  render(<MarkerCatalogTab />);
  await act(async () => { useAuthStore.getState().clearAuth(); resolve({ entries: [entry] }); });
  expect(screen.queryByText('Synthetic assay')).not.toBeInTheDocument();
});
