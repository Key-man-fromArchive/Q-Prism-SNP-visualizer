// @TASK P20-STALE-DATA - shared loading/ready/error status keyed to a
// request identity (e.g. well + normalization + background), so a panel
// never shows a previous identity's data as if it belonged to the current
// one while a request is in flight or after it failed.
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { expect, it } from 'vitest';
import { useRequestStatus } from './use-request-status';

it('starts loading and resets to loading whenever the key changes', () => {
  const view = renderHook(({ key }) => useRequestStatus(key), { initialProps: { key: 'a' } });
  expect(view.result.current.status).toBe('loading');

  act(() => view.result.current.setStatus('ready'));
  expect(view.result.current.status).toBe('ready');

  view.rerender({ key: 'b' });
  expect(view.result.current.status).toBe('loading');
  expect(view.result.current.error).toBeNull();
});

it('clears a previous error when the key changes', () => {
  const view = renderHook(({ key }) => useRequestStatus(key), { initialProps: { key: 'a' } });
  act(() => {
    view.result.current.setStatus('error');
    view.result.current.setError('boom');
  });
  expect(view.result.current.status).toBe('error');
  expect(view.result.current.error).toBe('boom');

  view.rerender({ key: 'a2' });
  expect(view.result.current.status).toBe('loading');
  expect(view.result.current.error).toBeNull();
});

it('does not reset status when the key stays the same across a rerender', () => {
  const view = renderHook(({ key }) => useRequestStatus(key), { initialProps: { key: 'a' } });
  act(() => view.result.current.setStatus('ready'));
  view.rerender({ key: 'a' });
  expect(view.result.current.status).toBe('ready');
});
