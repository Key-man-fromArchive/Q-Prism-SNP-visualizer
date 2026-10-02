import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlateSetupTab } from './PlateSetupTab';
import { getMarkers, updateMarker } from '@/lib/api';
import type { MarkerRegion } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';

vi.mock('@/lib/manual-commands', () => ({ assignManualWells: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(),
  getMarkers: vi.fn(), getSamples: vi.fn().mockResolvedValue({ samples: {} }), updateMarker: vi.fn(),
  getWellTypes: vi.fn().mockResolvedValue({ assignments: {}, imported_assignments: {}, manual_assignments: {}, input_revision: 0 }),
  listLayouts: vi.fn().mockResolvedValue({ layouts: [] }), listMarkerCatalog: vi.fn().mockResolvedValue({ entries: [] }),
}));

const base: MarkerRegion = { id: 'm1', name: 'Marker 1', wells: ['A1'], ploidy: 2, threshold_config: null };

async function openEditor(marker: MarkerRegion) {
  vi.mocked(getMarkers).mockResolvedValue({ markers: [marker] });
  render(<PlateSetupTab />);
  await screen.findByTestId('marker-card');
  fireEvent.click(screen.getByRole('button', { name: 'Edit marker' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'HEX',
    num_wells: 1, num_cycles: 1, has_rox: false, data_windows: null, suggested_cycle: 0, well_groups: null, well_ids: ['A1'] } });
  useDataStore.getState().setWellTypeAssignments({});
  useLanguageStore.getState().setLanguage('en');
});

it('shows imported allele names on the marker card with the session dye', async () => {
  vi.mocked(getMarkers).mockResolvedValue({ markers: [{ ...base, allele_labels: { fam: 'WT', allele2: 'MT' } }] });
  render(<PlateSetupTab />);
  expect(await screen.findByTestId('marker-card-alleles')).toHaveTextContent('FAM · WT / HEX · MT');
});

it('shows no allele line when the marker has no names', async () => {
  vi.mocked(getMarkers).mockResolvedValue({ markers: [base] });
  render(<PlateSetupTab />);
  await screen.findByTestId('marker-card');
  expect(screen.queryByTestId('marker-card-alleles')).not.toBeInTheDocument();
});

it('prefills the two name fields from the marker and keeps them reachable by keyboard', async () => {
  await openEditor({ ...base, allele_labels: { fam: 'WT', allele2: 'MT' } });
  const fam = screen.getByLabelText('Allele 1 name (FAM)');
  const second = screen.getByLabelText('Allele 2 name (VIC/HEX)');
  expect(fam).toHaveValue('WT');
  expect(second).toHaveValue('MT');
  expect(fam).toHaveAttribute('type', 'text');
  expect(fam).not.toHaveAttribute('tabindex', '-1');
  expect(second).not.toHaveAttribute('tabindex', '-1');
});

it('saves typed names through updateMarker', async () => {
  const saved = { ...base, allele_labels: { fam: 'WT', allele2: 'MT' } };
  vi.mocked(updateMarker).mockImplementation(async () => {
    vi.mocked(getMarkers).mockResolvedValue({ markers: [saved] });
    return { markers: [saved], input_revision: 1 };
  });
  await openEditor(base);
  fireEvent.change(screen.getByLabelText('Allele 1 name (FAM)'), { target: { value: ' WT ' } });
  fireEvent.change(screen.getByLabelText('Allele 2 name (VIC/HEX)'), { target: { value: 'MT' } });
  fireEvent.click(screen.getByTestId('marker-form-save'));
  await waitFor(() => expect(updateMarker).toHaveBeenCalledWith('s', 'm1', { allele_labels: { fam: 'WT', allele2: 'MT' } }));
  expect(await screen.findByTestId('marker-card-alleles')).toHaveTextContent('FAM · WT / HEX · MT');
});

it('clears names with null via the Clear button', async () => {
  vi.mocked(updateMarker).mockImplementation(async () => {
    vi.mocked(getMarkers).mockResolvedValue({ markers: [base] });
    return { markers: [base], input_revision: 2 };
  });
  await openEditor({ ...base, allele_labels: { fam: 'WT', allele2: 'MT' } });
  fireEvent.click(screen.getByTestId('marker-allele-clear'));
  expect(screen.getByLabelText('Allele 1 name (FAM)')).toHaveValue('');
  fireEvent.click(screen.getByTestId('marker-form-save'));
  await waitFor(() => expect(updateMarker).toHaveBeenCalledWith('s', 'm1', { allele_labels: null }));
  await waitFor(() => expect(screen.queryByTestId('marker-card-alleles')).not.toBeInTheDocument());
});

it('does not save a one-sided pair', async () => {
  await openEditor(base);
  fireEvent.change(screen.getByLabelText('Allele 1 name (FAM)'), { target: { value: 'WT' } });
  expect(screen.getByLabelText('Allele 2 name (VIC/HEX)')).toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(screen.getByTestId('marker-form-save'));
  expect(updateMarker).not.toHaveBeenCalled();
});

it('does not call updateMarker when the names are unchanged', async () => {
  await openEditor({ ...base, allele_labels: { fam: 'WT', allele2: 'MT' } });
  fireEvent.click(screen.getByTestId('marker-form-save'));
  await Promise.resolve();
  expect(updateMarker).not.toHaveBeenCalled();
});
