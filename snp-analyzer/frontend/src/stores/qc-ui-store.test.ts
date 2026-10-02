import { beforeEach, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_QC_SETTINGS } from '@/lib/amplification-qc';
import { useSessionStore } from '@/stores/session-store';
import { useQcUiStore, useSessionQc } from './qc-ui-store';

beforeEach(() => {
  window.localStorage.clear();
  useQcUiStore.setState({ bySession: {} });
  useSessionStore.setState({ sessionId: 'A' });
});

it('keeps a setting changed in session A for A only; session B stays on defaults', () => {
  const a = renderHook(() => useSessionQc());
  act(() => { a.result.current.setSettings({ enabled: false, famThreshold: 2 }); a.result.current.setOpen(true); });
  expect(a.result.current.settings).toMatchObject({ enabled: false, famThreshold: 2 });
  act(() => useSessionStore.setState({ sessionId: 'B' }));
  expect(a.result.current.settings).toEqual(DEFAULT_QC_SETTINGS);
  expect(a.result.current.open).toBe(false);
  act(() => useSessionStore.setState({ sessionId: 'A' }));
  expect(a.result.current.settings.enabled).toBe(false);
  expect(a.result.current.open).toBe(true);
});

it('survives a reload: the value is read back from localStorage', async () => {
  const a = renderHook(() => useSessionQc());
  act(() => a.result.current.setSettings({ enabled: false }));
  const saved = window.localStorage.getItem('snp-analyzer-qc-by-session')!;
  useQcUiStore.setState({ bySession: {} });
  window.localStorage.setItem('snp-analyzer-qc-by-session', saved);
  await useQcUiStore.persist.rehydrate();
  const again = renderHook(() => useSessionQc());
  expect(again.result.current.settings.enabled).toBe(false);
});
