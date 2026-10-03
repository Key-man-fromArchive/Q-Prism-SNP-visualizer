import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { useSettingsStore } from '@/stores/settings-store';

const BODY = { fam: { min: 10, max: 90 }, allele2: { min: 5, max: 50 }, reads: 3 };

afterEach(() => {
  vi.unstubAllGlobals();
  api.clearAxisBoundsCache();
});

describe('getAxisBounds', () => {
  it('requests the contract URL and caches by session, use_rox and background', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(BODY))));
    vi.stubGlobal('fetch', fetcher);
    const first = await api.getAxisBounds('s1', true, 'none');
    await api.getAxisBounds('s1', true, 'none');
    expect(first).toEqual(BODY);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('/api/data/s1/axis-bounds?use_rox=true&background=none');
    await api.getAxisBounds('s1', false, 'none');
    await api.getAxisBounds('s2', true, 'none');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failure', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(BODY)));
    vi.stubGlobal('fetch', fetcher);
    await expect(api.getAxisBounds('s1', true, 'none')).rejects.toBeTruthy();
    await expect(api.getAxisBounds('s1', true, 'none')).resolves.toEqual(BODY);
  });
});

describe('axisScope setting', () => {
  it('defaults to plate and can be set to marker', () => {
    expect(useSettingsStore.getState().axisScope).toBe('plate');
    useSettingsStore.getState().setAxisScope('marker');
    expect(useSettingsStore.getState().axisScope).toBe('marker');
    useSettingsStore.getState().setAxisScope('plate');
  });
});
