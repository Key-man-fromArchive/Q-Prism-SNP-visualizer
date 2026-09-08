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

function stubPlateGeometry() {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 12; col += 1) {
      const id = `${String.fromCharCode(65 + row)}${col + 1}`;
      const well = screen.getByTestId(`well-${id}`);
      vi.spyOn(well, 'getBoundingClientRect').mockReturnValue({
        left: col * 20, top: row * 20, width: 18, height: 18,
        right: col * 20 + 18, bottom: row * 20 + 18,
        x: col * 20, y: row * 20, toJSON: () => ({}),
      } as DOMRect);
    }
  }
}

it('shows a blue marquee and selects wells by forward pointer rectangle without text selection', async () => {
  render(<PlateSetupTab />);
  await waitFor(() => expect(screen.getByTestId('well-A1')).toBeVisible());
  stubPlateGeometry();

  const grid = screen.getByTestId('plate-setup-grid');
  expect(grid).toHaveClass('select-none');
  const firstWell = screen.getByTestId('well-A1');
  fireEvent.pointerDown(firstWell, { button: 0, pointerId: 11, pointerType: 'mouse', clientX: 5, clientY: 5 });
  fireEvent.pointerMove(grid, { pointerId: 11, pointerType: 'mouse', clientX: 42, clientY: 42 });

  const marquee = screen.getByTestId('plate-setup-marquee');
  expect(marquee).toHaveStyle({ display: 'block' });
  expect(marquee.style.border).toContain('rgb(37, 99, 235)');

  fireEvent.pointerUp(grid, { pointerId: 11, pointerType: 'mouse', clientX: 42, clientY: 42 });
  expect(screen.getByTestId('selection-count')).toHaveTextContent('4');
});

it('starts in grid whitespace, supports reverse selection, and clears on an empty marquee', async () => {
  render(<PlateSetupTab />);
  await waitFor(() => expect(screen.getByTestId('well-A1')).toBeVisible());
  stubPlateGeometry();
  const grid = screen.getByTestId('plate-setup-grid');

  fireEvent.pointerDown(grid, { button: 0, pointerId: 12, pointerType: 'mouse', clientX: 42, clientY: 42 });
  fireEvent.pointerMove(grid, { pointerId: 12, pointerType: 'mouse', clientX: 5, clientY: 5 });
  fireEvent.pointerUp(grid, { pointerId: 12, pointerType: 'mouse', clientX: 5, clientY: 5 });
  expect(screen.getByTestId('selection-count')).toHaveTextContent('4');

  fireEvent.pointerDown(grid, { button: 0, pointerId: 13, pointerType: 'mouse', clientX: 90, clientY: 90 });
  fireEvent.pointerMove(grid, { pointerId: 13, pointerType: 'mouse', clientX: 100, clientY: 100 });
  fireEvent.pointerUp(grid, { pointerId: 13, pointerType: 'mouse', clientX: 100, clientY: 100 });
  expect(screen.queryByTestId('selection-count')).not.toBeInTheDocument();
});

it('preserves the baseline for an empty Ctrl marquee and cancels cleanly after capture', async () => {
  render(<PlateSetupTab />);
  await waitFor(() => expect(screen.getByTestId('well-A1')).toBeVisible());
  stubPlateGeometry();
  const grid = screen.getByTestId('plate-setup-grid') as HTMLDivElement;
  const capture = vi.fn();
  const hasCapture = vi.fn().mockReturnValue(true);
  const releaseCapture = vi.fn();
  grid.setPointerCapture = capture;
  grid.hasPointerCapture = hasCapture;
  grid.releasePointerCapture = releaseCapture;
  const firstWell = screen.getByTestId('well-A1');
  fireEvent.pointerDown(firstWell, { button: 0, pointerId: 14, pointerType: 'mouse', clientX: 5, clientY: 5 });
  fireEvent.pointerUp(grid, { pointerId: 14, pointerType: 'mouse', clientX: 5, clientY: 5 });

  fireEvent.pointerDown(grid, { button: 0, pointerId: 18, pointerType: 'mouse', clientX: 5, clientY: 5 });
  fireEvent.pointerMove(grid, { pointerId: 18, pointerType: 'mouse', clientX: 42, clientY: 42 });
  expect(screen.getByTestId('selection-count')).toHaveTextContent('4');
  fireEvent.pointerCancel(grid, { pointerId: 18, pointerType: 'mouse' });
  expect(screen.getByTestId('selection-count')).toHaveTextContent('1');

  fireEvent.pointerDown(grid, { button: 0, ctrlKey: true, pointerId: 15, pointerType: 'mouse', clientX: 90, clientY: 90 });
  fireEvent.pointerMove(grid, { pointerId: 15, pointerType: 'mouse', clientX: 100, clientY: 100 });
  expect(capture).toHaveBeenCalledWith(15);
  expect(screen.getByTestId('selection-count')).toHaveTextContent('1');
  fireEvent.pointerCancel(grid, { pointerId: 15, pointerType: 'mouse' });
  expect(releaseCapture).toHaveBeenCalledWith(15);
  expect(screen.getByTestId('plate-setup-marquee')).toHaveStyle({ display: 'none' });
});

it('does not arm selection from a right-click on a well', async () => {
  render(<PlateSetupTab />);
  await waitFor(() => expect(screen.getByTestId('well-A1')).toBeVisible());
  const well = screen.getByTestId('well-A1');
  fireEvent.pointerDown(well, { button: 2, pointerId: 16, pointerType: 'mouse', clientX: 5, clientY: 5 });
  fireEvent.pointerMove(screen.getByTestId('plate-setup-grid'), { pointerId: 16, pointerType: 'mouse', clientX: 42, clientY: 42 });
  expect(screen.queryByTestId('selection-count')).not.toBeInTheDocument();
  expect(screen.getByTestId('plate-setup-marquee')).toHaveStyle({ display: 'none' });
});

it('keeps touch wells tap-and-scroll friendly instead of taking marquee capture', async () => {
  render(<PlateSetupTab />);
  await waitFor(() => expect(screen.getByTestId('well-A1')).toBeVisible());
  const well = screen.getByTestId('well-A1');
  const grid = screen.getByTestId('plate-setup-grid');
  fireEvent.pointerDown(well, { button: 0, pointerId: 17, pointerType: 'touch', clientX: 5, clientY: 5 });
  fireEvent.pointerMove(grid, { pointerId: 17, pointerType: 'touch', clientX: 100, clientY: 100 });
  expect(screen.getByTestId('selection-count')).toHaveTextContent('1');
  expect(screen.getByTestId('plate-setup-marquee')).toHaveStyle({ display: 'none' });
});
