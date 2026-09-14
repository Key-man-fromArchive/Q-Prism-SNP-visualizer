import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// P26-BRAND-PATH: production is mounted under a sub-path (VITE_APP_BASE_PATH,
// e.g. /snp-analyze/). Vite's `base` config rewrites index.html and every
// bundler-resolved import, but it does NOT rewrite root-absolute string
// literals inside JSX (e.g. `src="/brand/qprism-wide.png"`). Four such
// literals shipped in UploadZone.tsx and broke every brand image once
// deployed under a sub-path. The fix routes every public/ asset reference
// through runtimeAssetPath() (src/lib/runtime-paths.ts). This test scans
// every public/ subdirectory -- not just "brand" -- so adding a new asset
// folder later doesn't require remembering to update this list too.
const SRC = resolve(__dirname, '..');
const PUBLIC_DIR = resolve(__dirname, '../../public');

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'test' || entry.name.endsWith('.test.tsx') || entry.name.endsWith('.test.ts')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const publicSubdirs = readdirSync(PUBLIC_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('no JSX attribute references a public/ subdirectory with a raw root-absolute literal', () => {
  it('has at least one public/ subdirectory to check (sanity check for this test itself)', () => {
    expect(publicSubdirs.length).toBeGreaterThan(0);
  });

  it.each(publicSubdirs)('checks public/%s is only ever reached through runtimeAssetPath()', (subdir) => {
    // Matches src="/brand/...", srcSet="/brand/...", href="/brand/...
    // (and the single/double/backtick-quoted variants), but not
    // href={runtimeAssetPath(...)} or a plain object property like
    // `href: "/templates/..."` (colon, not equals -- those are data that
    // still gets run through runtimeAssetPath() before it reaches the DOM).
    const pattern = new RegExp(`(?:src|srcSet|href)\\s*=\\s*["'\`]/${subdir}/`);
    const offenders: string[] = [];
    for (const file of collectFiles(SRC)) {
      if (pattern.test(readFileSync(file, 'utf-8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
