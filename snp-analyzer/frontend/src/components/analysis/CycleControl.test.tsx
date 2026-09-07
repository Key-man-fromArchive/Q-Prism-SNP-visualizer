import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CycleControl } from './CycleControl';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';

beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.setState({ sessionId: 'synthetic', sessionInfo: {
    session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'HEX',
    num_cycles: 3, num_wells: 1, has_rox: false, data_windows: null,
    suggested_cycle: 2, well_groups: null,
  } });
  useSelectionStore.setState({ currentCycle: 0, isPlaying: false });
});
afterEach(() => vi.useRealTimers());

it('plays at 500ms, wraps, and stops when paused', () => {
  render(<CycleControl />);
  expect(useSelectionStore.getState().currentCycle).toBe(2);
  act(() => useSelectionStore.getState().setPlaying(true));
  act(() => vi.advanceTimersByTime(500));
  expect(useSelectionStore.getState().currentCycle).toBe(3);
  act(() => vi.advanceTimersByTime(500));
  expect(useSelectionStore.getState().currentCycle).toBe(1);
  act(() => useSelectionStore.getState().setPlaying(false));
  act(() => vi.advanceTimersByTime(1000));
  expect(useSelectionStore.getState().currentCycle).toBe(1);
});

it('keeps the existing 150ms slider debounce', () => {
  const view = render(<CycleControl />);
  fireEvent.change(view.container.querySelector('input')!, { target: { value: '1' } });
  expect(useSelectionStore.getState().currentCycle).toBe(2);
  act(() => vi.advanceTimersByTime(149));
  expect(useSelectionStore.getState().currentCycle).toBe(2);
  act(() => vi.advanceTimersByTime(1));
  expect(useSelectionStore.getState().currentCycle).toBe(1);
});
