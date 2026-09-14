import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeApiBasePath, runtimeAssetPath, runtimeMountPath, trimTrailingSlash } from './runtime-paths';

// P26-BRAND-PATH: production is mounted under a sub-path (e.g.
// VITE_APP_BASE_PATH=/snp-analyze/), which Vite exposes at runtime as
// import.meta.env.BASE_URL. These functions are the single place that
// resolves that mount path, so a bug here silently breaks every asset link
// and API call the app makes. There was no direct test for them before this
// fix -- only the component-level symptom (UploadZone's brand images) was
// covered, and even that missed the four unwrapped literals.

afterEach(() => {
  vi.unstubAllEnvs();
  history.replaceState(null, '', '/');
});

describe('trimTrailingSlash', () => {
  it('removes one or more trailing slashes', () => {
    expect(trimTrailingSlash('/snp-analyze/')).toBe('/snp-analyze');
    expect(trimTrailingSlash('/snp-analyze///')).toBe('/snp-analyze');
  });

  it('leaves a value with no trailing slash unchanged', () => {
    expect(trimTrailingSlash('/snp-analyze')).toBe('/snp-analyze');
  });
});

describe('runtimeMountPath', () => {
  it('trims a configured BASE_URL down to a bare mount path', () => {
    vi.stubEnv('BASE_URL', '/snp-analyze/');
    expect(runtimeMountPath()).toBe('/snp-analyze');
  });

  it('returns "" for the default root BASE_URL, falling back to the pathname', () => {
    vi.stubEnv('BASE_URL', '/');
    history.replaceState(null, '', '/');
    expect(runtimeMountPath()).toBe('');
  });

  it('falls back to the first pathname segment when BASE_URL is "/"', () => {
    vi.stubEnv('BASE_URL', '/');
    history.replaceState(null, '', '/snp-analyze/upload?x=1');
    expect(runtimeMountPath()).toBe('/snp-analyze');
  });

  it('ignores reserved first segments (api, assets, templates) in the pathname fallback', () => {
    vi.stubEnv('BASE_URL', '/');
    history.replaceState(null, '', '/api/sessions');
    expect(runtimeMountPath()).toBe('');
  });

  it('treats a bare "./" BASE_URL the same as the default root', () => {
    vi.stubEnv('BASE_URL', './');
    history.replaceState(null, '', '/snp-analyze/');
    expect(runtimeMountPath()).toBe('/snp-analyze');
  });
});

describe('runtimeAssetPath', () => {
  it('leaves an asset path unprefixed when the app is mounted at the root', () => {
    vi.stubEnv('BASE_URL', '/');
    history.replaceState(null, '', '/');
    expect(runtimeAssetPath('/brand/qprism-wide.png')).toBe('/brand/qprism-wide.png');
  });

  it('prefixes an asset path with the runtime mount path', () => {
    vi.stubEnv('BASE_URL', '/snp-analyze/');
    expect(runtimeAssetPath('/brand/qprism-wide.png')).toBe('/snp-analyze/brand/qprism-wide.png');
  });

  it('normalizes an input path regardless of a leading slash', () => {
    vi.stubEnv('BASE_URL', '/snp-analyze/');
    expect(runtimeAssetPath('brand/qprism-wide.png')).toBe('/snp-analyze/brand/qprism-wide.png');
  });
});

describe('runtimeApiBasePath', () => {
  it('derives /api under the runtime mount path by default', () => {
    vi.stubEnv('BASE_URL', '/snp-analyze/');
    expect(runtimeApiBasePath()).toBe('/snp-analyze/api');
  });

  it('honors an explicit VITE_API_BASE_PATH override', () => {
    vi.stubEnv('BASE_URL', '/snp-analyze/');
    vi.stubEnv('VITE_API_BASE_PATH', '/custom/api/');
    expect(runtimeApiBasePath()).toBe('/custom/api');
  });
});
