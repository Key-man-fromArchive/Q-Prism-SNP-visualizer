import { render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UploadZone } from './UploadZone';
import { getSessions } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useUploadJobStore } from '@/stores/upload-job-store';
import { useFileWorkspaceStore } from '@/stores/file-workspace-store';
import { useLanguageStore } from '@/stores/language-store';

// P26-BRAND-PATH: production is mounted under /snp-analyze/
// (VITE_APP_BASE_PATH), which surfaces at runtime as
// import.meta.env.BASE_URL. UploadZone's brand images used bare
// `src="/brand/..."` literals, which Vite's `base` config cannot rewrite
// (it only rewrites index.html and bundler-resolved imports), so every
// brand image 404'd once deployed under that sub-path. This asserts the
// rendered <img>/<source> tags carry the runtime mount prefix instead.

vi.mock('@/lib/api', () => ({ getSessions: vi.fn(), loadExample: vi.fn(), uploadFile: vi.fn(), previewImportFile: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  useLanguageStore.setState({ language: 'en' });
  useSessionStore.getState().reset();
  useUploadJobStore.getState().reset();
  useFileWorkspaceStore.setState({ open: false, triggers: {} });
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  vi.mocked(getSessions).mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  history.replaceState(null, '', '/');
});

it('prefixes every brand image with the runtime mount path when built for a sub-path deployment', () => {
  vi.stubEnv('BASE_URL', '/snp-analyze/');
  const { container } = render(<UploadZone />);

  const imgSrcs = Array.from(container.querySelectorAll('img')).map((img) => img.getAttribute('src'));
  expect(imgSrcs).toEqual(
    expect.arrayContaining([
      '/snp-analyze/brand/qprism-wide.png',
      '/snp-analyze/brand/qprism-hero.jpg',
      '/snp-analyze/brand/invirustech.png',
    ]),
  );

  const source = container.querySelector('picture source');
  expect(source?.getAttribute('srcset')).toBe('/snp-analyze/brand/qprism-wide.webp');
});

it('leaves brand image paths unprefixed for the default root deployment', () => {
  vi.stubEnv('BASE_URL', '/');
  history.replaceState(null, '', '/');
  const { container } = render(<UploadZone />);

  const imgSrcs = Array.from(container.querySelectorAll('img')).map((img) => img.getAttribute('src'));
  expect(imgSrcs).toEqual(
    expect.arrayContaining([
      '/brand/qprism-wide.png',
      '/brand/qprism-hero.jpg',
      '/brand/invirustech.png',
    ]),
  );

  const source = container.querySelector('picture source');
  expect(source?.getAttribute('srcset')).toBe('/brand/qprism-wide.webp');
});
