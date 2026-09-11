import { beforeEach, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/stores/session-store';
import type { UploadResponse } from '@/types/api';

vi.mock('@/lib/api', () => ({ getSessionInfo: vi.fn(async (id: string) => info(id)) }));

function info(id: string): UploadResponse {
  return {
    session_id: id, raw_filename: `${id}.pcrd`, well_ids: [], instrument: 'CFX Opus', allele2_dye: 'HEX',
    num_wells: 96, num_cycles: 40, has_rox: false, data_windows: null, suggested_cycle: 40,
    background_modes: ['none'], well_groups: null,
  } as UploadResponse;
}

function setLocation(search: string) {
  window.history.replaceState(null, '', `/${search}`);
}

beforeEach(() => {
  useSessionStore.getState().clearWorkspace();
  setLocation('');
});

it('keeps every uploaded plate on the bench, not just the active one', () => {
  const store = useSessionStore.getState();
  store.setSession('a', info('a'), 'fresh');
  store.addOpenSession('b');
  store.setSession('c', info('c'), 'fresh');

  expect(useSessionStore.getState().openSessionIds).toEqual(['a', 'b', 'c']);
  expect(useSessionStore.getState().sessionId).toBe('c');
});

it('returns a reopened plate to where it was left, not to its defaults', async () => {
  const store = useSessionStore.getState();
  store.setSession('a', info('a'), 'fresh');
  // The history writer keeps the URL in step with navigation; this stands in
  // for the operator having moved to cycle 32 on the analysis surface.
  setLocation('?session=a&tab=analysis&surface=analysis&cycle=32');
  store.setSession('b', info('b'), 'fresh');

  expect(useSessionStore.getState().restoreQuery).toBeNull();

  await useSessionStore.getState().loadSession('a');

  expect(useSessionStore.getState().sessionId).toBe('a');
  expect(useSessionStore.getState().restoreQuery).toContain('cycle=32');
});

it('forgets a plate that was closed or deleted elsewhere', async () => {
  const store = useSessionStore.getState();
  store.setSession('a', info('a'), 'fresh');
  setLocation('?session=a&cycle=12');
  store.setSession('b', info('b'), 'fresh');

  useSessionStore.getState().closeOpenSession('a');
  expect(useSessionStore.getState().openSessionIds).toEqual(['b']);
  expect(useSessionStore.getState().sessionQueries).not.toHaveProperty('a');

  useSessionStore.getState().addOpenSession('a');
  await useSessionStore.getState().loadSession('a');
  // Reopened from scratch: the closed plate's position is not resurrected.
  expect(useSessionStore.getState().restoreQuery).toBeNull();
});

it('drops plates the server no longer has', () => {
  const store = useSessionStore.getState();
  store.setSession('a', info('a'), 'fresh');
  store.addOpenSession('gone');

  useSessionStore.getState().syncOpenSessions(['a']);

  expect(useSessionStore.getState().openSessionIds).toEqual(['a']);
});

it('takes every plate off the bench when the workspace is cleared', () => {
  const store = useSessionStore.getState();
  store.setSession('a', info('a'), 'fresh');
  store.addOpenSession('b');

  useSessionStore.getState().clearWorkspace();

  expect(useSessionStore.getState().openSessionIds).toEqual([]);
  expect(useSessionStore.getState().sessionId).toBeNull();
});
