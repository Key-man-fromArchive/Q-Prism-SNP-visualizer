import type { Page } from '@playwright/test';

/** Persists `expertMode` in the app's settings storage before any page script
 *  runs, so a spec that drives the technical controls (threshold edit, group
 *  tools, amplification curves, the full results grid, QC refresh) sees the
 *  same screen the default view showed before expert mode existed. Call it in
 *  a `test.beforeEach`, before the first navigation. */
export async function enableExpertMode(page: Page) {
  await page.addInitScript(() => {
    const key = 'snp-analyzer-settings';
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) ?? '{}') as { state?: object };
      window.localStorage.setItem(key, JSON.stringify({ state: { ...stored.state, expertMode: true }, version: 2 }));
    } catch {
      // Unreadable storage leaves the default (basic) view; the spec will say so.
    }
  });
}
