import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CycleControl } from './CycleControl';
import { useSessionStore } from '@/stores/session-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSelectionStore } from '@/stores/selection-store';
import type { UploadResponse } from '@/types/api';

const info: UploadResponse = { session_id: 's', instrument: 'test', allele2_dye: 'VIC', num_wells: 1,
  num_cycles: 40, has_rox: false, data_windows: [{ name: 'Amplification', start_cycle: 1, end_cycle: 40 }],
  suggested_cycle: 40, well_groups: null };
beforeEach(() => {
  useSessionStore.getState().setSession('s', info);
  const generation = useNavigationStore.getState().beginRestore('s');
  useNavigationStore.getState().complete(generation, { reasons: [], value: {
    session: 's', tab: 'analysis', surface: 'analysis', marker: null, cycle: 20,
  } });
  useNavigationStore.getState().setAvailableCycles(Array.from({ length: 40 }, (_, index) => index + 1));
});
afterEach(() => vi.useRealTimers());
it('preserves the restored result cycle rather than replacing it with the upload recommendation', () => {
  render(<CycleControl />);
  expect(useNavigationStore.getState().cycle).toBe(20);
  expect(screen.getByRole('slider')).toHaveValue('20');
});
it('cancels a pending slider update when the session is replaced', () => {
  vi.useFakeTimers();
  const view = render(<CycleControl />);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } });
  act(() => useSessionStore.getState().setSession('next', { ...info, session_id: 'next' }));
  view.unmount();
  act(() => vi.advanceTimersByTime(200));
  expect(useNavigationStore.getState().cycle).toBeNull();
  expect(useSelectionStore.getState().isPlaying).toBe(false);
});
it('uses actual sparse cycles including zero instead of filling gaps from a count', () => {
  useSessionStore.setState({ sessionInfo: { ...info, num_cycles: 3, data_windows: null } });
  useNavigationStore.getState().setAvailableCycles([0, 10, 40]);
  useNavigationStore.getState().setCycle(0);
  render(<CycleControl />);
  expect(useNavigationStore.getState().cycle).toBe(0);
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '0');
  act(() => window.dispatchEvent(new CustomEvent('goto-cycle', { detail: 2 })));
  expect(useNavigationStore.getState().cycle).toBe(0);
  act(() => window.dispatchEvent(new CustomEvent('goto-cycle', { detail: 40 })));
  expect(useNavigationStore.getState().cycle).toBe(40);
  act(() => window.dispatchEvent(new CustomEvent('goto-cycle', { detail: 0 })));
  expect(useNavigationStore.getState().cycle).toBe(0);
});
it('keeps playback cadence across unrelated component renders', () => {
  vi.useFakeTimers();
  useSelectionStore.getState().setPlaying(true);
  const view = render(<CycleControl />);
  act(() => vi.advanceTimersByTime(300));
  view.rerender(<CycleControl />);
  act(() => vi.advanceTimersByTime(200));
  expect(useNavigationStore.getState().cycle).toBe(21);
});
it('cancels queued slider and playback writes during restoration', () => {
  vi.useFakeTimers();
  render(<CycleControl />);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } });
  act(() => useNavigationStore.getState().beginRestore('s'));
  act(() => vi.advanceTimersByTime(600));
  expect(useNavigationStore.getState().cycle).toBeNull();
});
