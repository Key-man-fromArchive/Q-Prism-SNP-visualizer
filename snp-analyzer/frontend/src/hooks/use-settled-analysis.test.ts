import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSettledAnalysis } from './use-settled-analysis';

afterEach(() => vi.useRealTimers());
it('does not analyze changes observed during restoration on the first ready transition', () => {
  vi.useFakeTimers();
  const analyze = vi.fn();
  const { rerender } = renderHook(({ input, ready }) => useSettledAnalysis('same-session', input, false, analyze, ready), {
    initialProps: { input: '20', ready: false },
  });
  rerender({ input: '40', ready: false });
  rerender({ input: '40', ready: true });
  act(() => vi.advanceTimersByTime(220));
  expect(analyze).not.toHaveBeenCalled();
  rerender({ input: '41', ready: true });
  act(() => vi.advanceTimersByTime(220));
  expect(analyze).toHaveBeenCalledTimes(1);
});
it('skips first ready, coalesces changes, pauses playback, and ignores the previous session timer', () => {
  vi.useFakeTimers();
  const analyze = vi.fn();
  const { rerender } = renderHook(({ identity, input, paused }) => useSettledAnalysis(identity, input, paused, analyze), {
    initialProps: { identity: 's:1', input: '20', paused: false },
  });
  act(() => vi.advanceTimersByTime(500));
  expect(analyze).not.toHaveBeenCalled();
  rerender({ identity: 's:1', input: '21', paused: false });
  act(() => vi.advanceTimersByTime(100));
  rerender({ identity: 's:1', input: '22', paused: false });
  act(() => vi.advanceTimersByTime(219));
  expect(analyze).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(analyze).toHaveBeenCalledTimes(1);
  rerender({ identity: 's:1', input: '30', paused: true });
  act(() => vi.advanceTimersByTime(500));
  expect(analyze).toHaveBeenCalledTimes(1);
  rerender({ identity: 's:1', input: '30', paused: false });
  act(() => vi.advanceTimersByTime(220));
  expect(analyze).toHaveBeenCalledTimes(2);
  rerender({ identity: 's:1', input: '40', paused: false });
  rerender({ identity: 's:2', input: '40', paused: false });
  act(() => vi.advanceTimersByTime(220));
  expect(analyze).toHaveBeenCalledTimes(2);
});

it('consumes an export-restoration input change so unpausing cannot analyse the restored view', () => {
  vi.useFakeTimers();
  const analyze = vi.fn();
  const { rerender } = renderHook(({ input, paused, consume }) =>
    useSettledAnalysis('same-session', input, paused, analyze, true, consume), {
    initialProps: { input: 'cycle:20', paused: true, consume: true },
  });
  // Stored PNG switches the view while automatic analysis is intentionally held.
  rerender({ input: 'cycle:40', paused: true, consume: true });
  rerender({ input: 'cycle:40', paused: false, consume: false });
  act(() => { vi.advanceTimersByTime(260); });
  expect(analyze).not.toHaveBeenCalled();

  // A genuine later edit still uses the normal settled scheduler.
  rerender({ input: 'cycle:41', paused: false, consume: false });
  act(() => { vi.advanceTimersByTime(260); });
  expect(analyze).toHaveBeenCalledTimes(1);
});
