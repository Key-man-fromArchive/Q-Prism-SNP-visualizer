import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CycleControl } from './CycleControl';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useNavigationStore } from '@/stores/navigation-store';

beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.setState({ sessionId: 'synthetic', sessionInfo: {
    session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'HEX',
    num_cycles: 3, num_wells: 1, has_rox: false, data_windows: null,
    suggested_cycle: 2, well_groups: null,
  } });
  useSelectionStore.setState({ currentCycle: 0, isPlaying: false });
  const generation = useNavigationStore.getState().beginRestore('synthetic');
  useNavigationStore.getState().setAvailableCycles([1, 2, 3]);
  useNavigationStore.getState().complete(generation, { reasons: [], value: {
    session: 'synthetic', tab: 'analysis', surface: 'analysis', marker: null, cycle: 2,
  } });
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

// P21-BACKGROUND: playback must not keep advancing (and therefore keep
// driving downstream per-cycle fetches, e.g. MultiMarkerAnalysisPanel's
// scatter fetch) while the Results surface isn't the active top-level tab --
// `AnalysisWorkspace` only CSS-hides this component, it never unmounts it,
// so its `setInterval` would otherwise keep firing for a screen nobody can
// see. `isPlaying` itself is left untouched so returning to the tab resumes
// immediately, with no extra click required.
it('pauses cycle advancement while the workspace is not the active top-level tab, and resumes on return without re-clicking play', () => {
  render(<CycleControl />);
  act(() => useSelectionStore.getState().setPlaying(true));
  act(() => vi.advanceTimersByTime(500));
  expect(useSelectionStore.getState().currentCycle).toBe(3);
  act(() => useNavigationStore.setState({ tab: 'settings' }));
  act(() => vi.advanceTimersByTime(2000));
  expect(useSelectionStore.getState().currentCycle).toBe(3);
  expect(useSelectionStore.getState().isPlaying).toBe(true);
  act(() => useNavigationStore.setState({ tab: 'analysis' }));
  act(() => vi.advanceTimersByTime(500));
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

it('styles the active window button through --color-on-primary, not a hardcoded white (P6-S2-T1)', () => {
  useSessionStore.setState({ sessionId: 'synthetic', sessionInfo: {
    session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'HEX',
    num_cycles: 3, num_wells: 1, has_rox: false,
    data_windows: [
      { name: 'Pre-read', start_cycle: 1, end_cycle: 1 },
      { name: 'Amplification', start_cycle: 2, end_cycle: 3 },
    ],
    suggested_cycle: 2, well_groups: null,
  } });
  const generation = useNavigationStore.getState().beginRestore('synthetic');
  useNavigationStore.getState().setAvailableCycles([1, 2, 3]);
  useNavigationStore.getState().complete(generation, { reasons: [], value: {
    session: 'synthetic', tab: 'analysis', surface: 'analysis', marker: null, cycle: 2,
  } });
  render(<CycleControl />);
  const active = screen.getByText('Amplification');
  expect(active.className).toContain('text-on-primary');
  expect(active.className).not.toMatch(/\btext-white\b/);
});
