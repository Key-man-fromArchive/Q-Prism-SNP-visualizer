import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOwnerViewCache, readViewCache, writeViewCache, viewCacheKey } from './session-view-cache';

const settings = { useRox: false, backgroundMode: 'none', clusterAlgorithm: 'threshold', ntcThreshold: 0.1,
  allele1RatioMax: 0.4, allele2RatioMin: 0.6, nClusters: 4, ploidy: 2 };
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
describe('session calculation cache', () => {
  it('roundtrips false with an explicit whitelist, isolated by owner and session', () => {
    writeViewCache('owner', 'sid', { ...settings, token: 'private', samples: ['private'] });
    expect(readViewCache('owner', 'sid')).toEqual({ settings, reason: null });
    expect(readViewCache('other', 'sid').settings).toBeNull();
    expect(readViewCache('owner', 'other').settings).toBeNull();
    expect(sessionStorage.getItem(viewCacheKey('owner', 'sid'))).not.toContain('private');
  });
  it.each(['{', JSON.stringify({ version: 2, settings }), JSON.stringify({ version: 1, settings: { ...settings, nClusters: -1 } }),
    JSON.stringify({ version: 1, settings: { ...settings, useRox: 'false' } }),
    JSON.stringify({ version: 1, settings: { ...settings, allele1RatioMax: 0.9 } })])('rejects corrupted or invalid cache %s', raw => {
    sessionStorage.setItem(viewCacheKey('owner', 'sid'), raw);
    expect(readViewCache('owner', 'sid')).toEqual({ settings: null, reason: 'cache:invalid' });
  });
  it('clears only the exact owner namespace including escaped identities', () => {
    writeViewCache('a:b', 'sid', settings); writeViewCache('a', 'sid', settings);
    sessionStorage.setItem('asg_launch_token', 'untouched');
    clearOwnerViewCache('a:b');
    expect(readViewCache('a:b', 'sid').settings).toBeNull();
    expect(readViewCache('a', 'sid').settings).toEqual(settings);
    expect(sessionStorage.getItem('asg_launch_token')).toBe('untouched');
  });
  it('treats denied storage as a recoverable fallback', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied'); });
    expect(readViewCache('owner', 'sid')).toEqual({ settings: null, reason: 'cache:unavailable' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
    expect(writeViewCache('owner', 'sid', settings)).toBe(false);
  });
});
