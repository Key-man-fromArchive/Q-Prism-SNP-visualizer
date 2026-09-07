import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useMarkerScope } from './use-marker-scope';
import { getMarkers } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import type { MarkerRegion } from '@/types/api';
vi.mock('@/lib/api', () => ({ getMarkers: vi.fn() }));
const marker: MarkerRegion = { id: 'm', name: 'M', ploidy: 2, wells: ['A1'], color: '#fff', threshold_config: null };
beforeEach(() => { vi.resetAllMocks(); useSessionStore.setState({ sessionId: 's', entryGeneration: 1 }); });
it('retains a newer reload when the initial marker request resolves last', async () => {
  let resolve!: (value: { markers: MarkerRegion[] }) => void;
  vi.mocked(getMarkers).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue({ markers: [marker] });
  const hook = renderHook(() => useMarkerScope());
  expect(hook.result.current.markerStatus).toBe('loading');
  await act(async () => window.dispatchEvent(new Event('markers-changed')));
  expect(hook.result.current.markers).toEqual([marker]);
  await act(async () => resolve({ markers: [] }));
  expect(hook.result.current.markers).toEqual([marker]);
});
it('invalidates an outstanding reload when a local persisted edit publishes', async () => {
  vi.mocked(getMarkers).mockResolvedValueOnce({ markers: [] });
  const hook = renderHook(() => useMarkerScope());
  await waitFor(() => expect(hook.result.current.markerStatus).toBe('ready'));
  let resolve!: (value: { markers: MarkerRegion[] }) => void;
  vi.mocked(getMarkers).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => window.dispatchEvent(new Event('markers-changed')));
  expect(hook.result.current.markerStatus).toBe('loading');
  act(() => hook.result.current.setMarkers([marker]));
  expect(hook.result.current.markerStatus).toBe('ready');
  await act(async () => resolve({ markers: [] }));
  expect(hook.result.current.markers).toEqual([marker]);
});

it('hides a previously known scope throughout both held assignment and deletion reloads', async () => {
  vi.mocked(getMarkers).mockResolvedValueOnce({ markers: [] });
  const hook = renderHook(() => useMarkerScope());
  await waitFor(() => expect(hook.result.current.markerStatus).toBe('ready'));
  for (const markers of [[marker], []]) {
    let resolve!: (value: { markers: MarkerRegion[] }) => void;
    vi.mocked(getMarkers).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    act(() => window.dispatchEvent(new Event('markers-changed')));
    expect(hook.result.current.markerStatus).toBe('loading');
    await act(async () => resolve({ markers }));
    expect(hook.result.current.markerStatus).toBe('ready');
    expect(hook.result.current.markers).toEqual(markers);
  }
});
it('ignores a response after unmount and exposes load failures as unknown', async () => {
  vi.mocked(getMarkers).mockRejectedValue(new Error('offline'));
  const hook = renderHook(() => useMarkerScope());
  await waitFor(() => expect(hook.result.current.markerStatus).toBe('error'));
  hook.unmount();
});
