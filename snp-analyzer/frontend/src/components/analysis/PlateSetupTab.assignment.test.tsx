import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlateSetupTab } from './PlateSetupTab';
import { assignManualWells } from '@/lib/manual-commands';
import { getMarkers } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
vi.mock('@/lib/manual-commands', () => ({ assignManualWells: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(),
  getMarkers: vi.fn().mockResolvedValue({ markers: [] }), getSamples: vi.fn().mockResolvedValue({ samples: {} }),
  getWellTypes: vi.fn().mockResolvedValue({ assignments: { A1: 'Unknown' }, imported_assignments: { A1: 'Unknown' }, manual_assignments: {}, input_revision: 0 }),
  listLayouts: vi.fn().mockResolvedValue({ layouts: [] }), listMarkerCatalog: vi.fn().mockResolvedValue({ entries: [] }),
}));
beforeEach(() => {
  vi.clearAllMocks(); useSessionStore.getState().reset();
  vi.mocked(getMarkers).mockResolvedValue({ markers: [] });
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  useSessionStore.setState({ sessionId: 's' });
  useDataStore.getState().setWellTypeAssignments({});
  useLanguageStore.getState().setLanguage('en');
});
it('routes an entire selected row through the shared command without optimistic type mutation or selection loss', async () => {
  let resolve!: (value: boolean) => void;
  vi.mocked(assignManualWells).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<PlateSetupTab />);
  await waitFor(() => expect(useDataStore.getState().wellTypeAssignments).toEqual({ A1: 'Unknown' }));
  fireEvent.click(screen.getByTestId('row-header-A'));
  fireEvent.click(screen.getByTestId('well-type-ntc'));
  expect(assignManualWells).toHaveBeenCalledWith(Array.from({ length: 12 }, (_, i) => `A${i + 1}`), 'NTC');
  expect(useDataStore.getState().wellTypeAssignments).toEqual({ A1: 'Unknown' });
  await act(async () => resolve(false));
  expect(screen.getByTestId('well-A1')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('well-A12')).toHaveAttribute('aria-pressed', 'true');
});

it('describes zero markers as whole-plate analysis without an unassigned exclusion warning', async () => {
  render(<PlateSetupTab />);
  await waitFor(() => expect(useDataStore.getState().wellTypeAssignments).toEqual({ A1: 'Unknown' }));
  expect(screen.queryByTestId('unassigned-banner')).not.toBeInTheDocument();
  expect(screen.getByTestId('whole-plate-banner')).toHaveTextContent(/whole plate.*one marker/i);
});

it('renders the actual sparse 384 inventory instead of guessing 96 from its two wells', async () => {
  useSessionStore.setState({ sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 2,
    num_cycles: 1, has_rox: false, data_windows: null, suggested_cycle: 0, well_groups: null, well_ids: ['A1', 'P24'] } });
  render(<PlateSetupTab />);
  await waitFor(() => expect(screen.getByTestId('analysis-scope-counts')).toHaveTextContent('Input wells: 2'));
  expect(screen.getByTestId('well-P24')).toBeVisible();
});

it('never claims whole-plate scope while marker metadata is pending or failed', async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(getMarkers).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  render(<PlateSetupTab />);
  expect(screen.queryByTestId('whole-plate-banner')).not.toBeInTheDocument();
  expect(screen.queryByTestId('analysis-scope-counts')).not.toBeInTheDocument();
  await act(async () => reject(new Error('offline')));
  expect(screen.queryByTestId('whole-plate-banner')).not.toBeInTheDocument();
  expect(screen.getByTestId('marker-scope-unavailable')).toBeVisible();
});

it('withdraws the whole-plate announcement immediately while an external marker reload is held', async () => {
  render(<PlateSetupTab />);
  await waitFor(() => expect(screen.getByTestId('whole-plate-banner')).toBeVisible());
  let resolve!: (value: Awaited<ReturnType<typeof getMarkers>>) => void;
  vi.mocked(getMarkers).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => window.dispatchEvent(new Event('markers-changed')));
  expect(screen.queryByTestId('whole-plate-banner')).not.toBeInTheDocument();
  expect(screen.getByTestId('marker-scope-unavailable')).toBeVisible();
  await act(async () => resolve({ markers: [{ id: 'm', name: 'M', wells: ['A1'], ploidy: 2, threshold_config: null }] }));
  expect(screen.queryByTestId('whole-plate-banner')).not.toBeInTheDocument();
  expect(screen.queryByTestId('marker-scope-unavailable')).not.toBeInTheDocument();
});

it('keeps Omit focusable and restores its type through the shared command', async () => {
  useSessionStore.setState({ sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1,
    num_cycles: 1, has_rox: false, data_windows: null, suggested_cycle: 0, well_groups: null, well_ids: ['A1'] } });
  render(<PlateSetupTab />);
  await waitFor(() => expect(useDataStore.getState().wellTypeAssignments).toEqual({ A1: 'Unknown' }));
  act(() => useDataStore.getState().setWellTypeAssignments({ A1: 'Omit' }));
  expect(screen.getByTestId('analysis-scope-counts')).toHaveTextContent('Omit: 1');
  const cell = screen.getByTestId('well-A1');
  act(() => cell.focus());
  expect(cell).toHaveFocus();
  fireEvent.pointerDown(cell, { button: 0 });
  fireEvent.pointerUp(cell);
  vi.mocked(assignManualWells).mockImplementation(async (wells, type) => {
    expect(wells).toEqual(['A1']);
    expect(type).toBe('Unknown');
    useDataStore.getState().setWellTypeAssignments({ A1: type });
    return true;
  });
  fireEvent.click(screen.getByTestId('well-type-sample'));
  await waitFor(() => expect(screen.getByTestId('analysis-scope-counts')).toHaveTextContent('Eligible by marker/type: 1 · Empty: 0 · Omit: 0'));
});

it('shows a blue marquee and selects wells by pointer rectangle without text selection', async () => {
  render(<PlateSetupTab />);
  await waitFor(() => expect(screen.getByTestId('well-A1')).toBeVisible());

  const grid = screen.getByTestId('plate-setup-grid');
  expect(grid).toHaveClass('select-none');
  const firstWell = screen.getByTestId('well-A1');
  fireEvent.pointerDown(firstWell, { button: 0, pointerId: 11, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(grid, { pointerId: 11, clientX: 100, clientY: 100 });

  const marquee = screen.getByTestId('plate-setup-marquee');
  expect(marquee).toHaveStyle({ display: 'block' });
  expect(marquee.style.border).toContain('rgb(37, 99, 235)');

  fireEvent.pointerUp(grid, { pointerId: 11, clientX: 100, clientY: 100 });
  expect(screen.getByTestId('selection-count')).toHaveTextContent('96');
});
