import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PlateView } from './PlateView';
import { getPlate } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';

vi.mock('@/lib/api', () => ({ getPlate: vi.fn().mockResolvedValue({ cycle: 0, wells: [] }) }));

it('does not retarget native well clicks by capturing the pointer before a drag begins', async () => {
  useSessionStore.setState({ sessionId: 'pointer' });
  const view = render(<PlateView />);
  await act(async () => { await Promise.resolve(); });
  const panel = view.container.querySelector<HTMLElement>('.plate-panel')!;
  const capture = vi.fn();
  panel.setPointerCapture = capture;
  const event = new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 });
  fireEvent(panel, event);
  expect(capture).not.toHaveBeenCalled();
  fireEvent(panel, new MouseEvent('pointermove', { bubbles: true, clientX: 30, clientY: 30 }));
  expect(capture).toHaveBeenCalledTimes(1);
});

it('requests a selected actual zero cycle', async () => {
  useSessionStore.setState({ sessionId: 'zero' });
  useSelectionStore.setState({ currentCycle: 0 });
  render(<PlateView />);
  await waitFor(() => expect(getPlate).toHaveBeenCalledWith('zero', 0, expect.any(Boolean), expect.any(String)));
});
it('reaches a column header from the well entry and exposes a live selection count', async () => {
  const view = render(<PlateView />);
  await act(async () => { await Promise.resolve(); });
  const grid = view.container.querySelector('#plate-grid')!;
  const cell = grid.querySelector<HTMLButtonElement>('[data-well="A1"]')!;
  act(() => cell.focus());
  fireEvent.keyDown(cell, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(grid.querySelector('button[role="columnheader"]'));
  expect(view.container.querySelector('[aria-live="polite"]')).not.toBeNull();
});
it('ignores a plate response after its view unmounts', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getPlate>>) => void;
  vi.mocked(getPlate).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  useSessionStore.setState({ sessionId: 'old' });
  const publish = vi.spyOn(useDataStore.getState(), 'setPlateData');
  const view = render(<PlateView />);
  view.unmount();
  await act(async () => resolve({ cycle: 0, allele2_dye: 'VIC', wells: [] }));
  expect(publish).not.toHaveBeenCalled();
  publish.mockRestore();
});

it.each(['H12', 'P24'])('keeps populated %s plate headers reachable and preserves existing Omit selection', async lastWell => {
  const wells = ['A1', lastWell].map((well, index) => ({ well, row: index, col: index,
    norm_fam: 1, norm_allele2: 2, ratio: 0.5, sample_name: 'synthetic', auto_cluster: 'NTC', manual_type: index === 0 ? 'Omit' : null }));
  vi.mocked(getPlate).mockResolvedValueOnce({ cycle: 0, allele2_dye: 'VIC', wells });
  useSessionStore.setState({ sessionId: `populated-${lastWell}` });
  useSelectionStore.getState().clearSelection();
  const view = render(<PlateView />);
  await act(async () => { await Promise.resolve(); });
  const cell = view.container.querySelector<HTMLButtonElement>('[data-well="A1"]')!;
  act(() => cell.focus());
  fireEvent.keyDown(cell, { key: 'Enter' });
  fireEvent.click(cell);
  expect(useSelectionStore.getState().selectedWells).toEqual(['A1']);
  expect(cell.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(cell, { key: 'ArrowUp' });
  expect(document.activeElement?.getAttribute('role')).toBe('columnheader');
  expect(view.container.querySelectorAll('[role="gridcell"]')).toHaveLength(lastWell === 'H12' ? 96 : 384);
});
