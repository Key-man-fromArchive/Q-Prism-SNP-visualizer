// Run the frontend on 127.0.0.1:5178, then run this file with node.
// All API requests are fulfilled here; no backend or database is used.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../snp-analyzer/frontend/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const evidence = fileURLToPath(new URL('.', import.meta.url));

const sessions = [
  { session_id: 'mock-1', raw_filename: 'plate_20260914_1.pcrd', instrument: 'QuantStudio 5', num_wells: 96, num_cycles: 40, uploaded_at: '2026-09-14 04:00:00' },
  { session_id: 'mock-2', raw_filename: 'plate_20260911_1.pcrd', instrument: 'CFX Opus', num_wells: 384, num_cycles: 40, uploaded_at: '2026-09-11 04:00:00' },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 768]) for (const theme of ['light', 'dark']) for (const lang of ['ko', 'en']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: 'Asia/Seoul' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ theme, lang }) => {
      localStorage.setItem('snp-analyzer-dark-mode', String(theme === 'dark'));
      localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: lang }, version: 0 }));
    }, { theme, lang });
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      const data = path === '/api/auth/config' ? { auth_mode: 'local' } :
        path === '/api/auth/me' ? { user: { id: 'mock-user', username: 'researcher', display_name: 'Researcher', role: 'admin' } } :
        path === '/api/sessions' ? sessions : path === '/api/projects' ? { projects: [] } :
        path === '/api/version' ? { version: '1.2.0', commit: 'mock', built_at: null } : [];
      return route.fulfill({ status: 200, json: data });
    });
    await page.goto('http://127.0.0.1:5178/?tab=project');
    const heading = page.getByRole('heading', { name: lang === 'ko' ? '세션' : 'Sessions', exact: true });
    await expect(heading).toBeVisible();
    // Icon renders next to the title, is decorative, and the accessible name is unchanged.
    const icon = heading.locator('svg');
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    await expect(heading).toHaveAccessibleName(lang === 'ko' ? '세션' : 'Sessions');
    // Existing controls next to the title still there, and the title row doesn't overflow.
    await expect(page.getByRole('button', { name: lang === 'ko' ? '표' : 'Table', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: lang === 'ko' ? '달력' : 'Calendar', exact: true })).toBeVisible();
    const panel = page.locator('.panel').filter({ has: heading });
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (lang === 'ko') {
      await panel.screenshot({ path: `${evidence}P31-SESSION-ICON-${width}-${theme}.png` });
    }
    expect(errors).toEqual([]);
    await page.close();
    console.log(`${width} ${theme} ${lang}: icon rendered, aria-hidden, accessible name unchanged, no overflow`);
  }
} finally { await browser.close(); }
