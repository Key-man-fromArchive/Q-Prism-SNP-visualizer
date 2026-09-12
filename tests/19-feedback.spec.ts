import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

type FeedbackItem = {
  id: string;
  owner_user_id: string;
  owner_name: string;
  category: string;
  title: string;
  body: string;
  context: Record<string, unknown> | null;
  status: string;
  admin_note: string | null;
  comments: Array<Record<string, unknown>>;
  attachments: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
};

function item(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'fb-1',
    owner_user_id: 'user-2',
    owner_name: 'User Two',
    category: 'bug',
    title: 'Scatter axes flip after reload',
    body: 'Open a CFX plate, reload, the axes swap.',
    context: { page_key: 'analysis', instrument: 'CFX Opus', num_wells: 96, num_cycles: 40 },
    status: 'open',
    admin_note: null,
    comments: [],
    attachments: [],
    created_at: '2026-09-11 04:05:06',
    updated_at: '2026-09-11 04:05:06',
    ...overrides,
  };
}

function stats(overrides: Record<string, unknown> = {}) {
  return {
    total: 1,
    open: 1,
    in_progress: 0,
    resolved: 0,
    closed: 0,
    by_category: { bug: 1 },
    ...overrides,
  };
}

/**
 * Serves the whole /api/feedback surface from memory so the spec exercises the
 * UI contract (payload shape, filters, status writes) without depending on
 * what happens to be in the deployment's DB.
 */
async function mockFeedbackApi(
  page: Page,
  store: {
    items: FeedbackItem[];
    submitted: Array<Record<string, unknown>>;
    patched: Array<{ id: string; body: Record<string, unknown> }>;
  }
) {
  await page.route('**/api/feedback**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/.*\/api\/feedback/, '') || '';
    const method = request.method();

    if (method === 'POST' && path === '') {
      const body = request.postDataJSON();
      store.submitted.push(body);
      await route.fulfill({
        status: 201,
        json: item({ id: 'fb-new', title: String(body.title), category: String(body.category) }),
      });
      return;
    }
    if (method === 'POST' && path.endsWith('/comments')) {
      await route.fulfill({
        status: 201,
        json: {
          id: 'c-1',
          feedback_id: 'fb-1',
          author_user_id: 'admin-1',
          author_name: 'Administrator',
          body: String(request.postDataJSON().body),
          is_admin: true,
          created_at: '2026-09-11 07:00:00',
        },
      });
      return;
    }
    if (method === 'PATCH') {
      const id = path.replace('/', '');
      const body = request.postDataJSON();
      store.patched.push({ id, body });
      const existing = store.items.find((row) => row.id === id) ?? item({ id });
      const updated = { ...existing, ...body };
      store.items = store.items.map((row) => (row.id === id ? updated : row));
      await route.fulfill({ json: updated });
      return;
    }
    if (path === '/stats') {
      await route.fulfill({ json: stats({ total: store.items.length }) });
      return;
    }
    if (path === '/my') {
      await route.fulfill({
        json: { items: store.items, total: store.items.length, page: 1, per_page: 20 },
      });
      return;
    }

    // Admin list, with the status/category filters applied as the server would.
    const status = url.searchParams.get('status');
    const category = url.searchParams.get('category');
    const filtered = store.items.filter(
      (row) => (!status || row.status === status) && (!category || row.category === category)
    );
    await route.fulfill({
      json: { items: filtered, total: filtered.length, page: 1, per_page: 20 },
    });
  });
}

/**
 * Opens the admin-only Feedback tab.
 *
 * With no plate loaded the tab bar sits behind the upload screen, and the app's
 * own way into the session-free tabs (Library, Users, References and now
 * Feedback) is the upload screen's "manage existing sessions & projects" link.
 * This walks that same path rather than loading a plate the spec does not
 * otherwise need. Language-independent: an E2E context may be Korean.
 */
async function openFeedbackTab(page: Page) {
  await page
    .getByRole('button', { name: /manage existing sessions|기존 세션 및 프로젝트 관리/i })
    .click();
  await page.locator('nav button[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: /^(Feedback|피드백)$/ }).click();
}

test('reporter files feedback from any screen and reads it back', async ({ page }) => {
  const store = { items: [] as FeedbackItem[], submitted: [], patched: [] };
  await mockFeedbackApi(page, store);
  await login(page);

  await page.locator('[data-testid="feedback-open"]').click();
  await page.locator('[data-testid="feedback-category-improvement"]').click();
  await page.locator('[data-testid="feedback-title"]').fill('Axes flip after reload');
  await page
    .locator('[data-testid="feedback-body"]')
    .fill('Open a CFX plate, reload the page, the scatter axes swap.');
  await page.locator('[data-testid="feedback-submit"]').click();

  await expect(page.locator('[data-testid="feedback-submitted"]')).toBeVisible();
  expect(store.submitted).toHaveLength(1);
  expect(store.submitted[0]).toMatchObject({
    category: 'improvement',
    title: 'Axes flip after reload',
  });
  // The report carries the tab it was filed from. With no session open the
  // workspace's default stored tab ('results', navigation-store.ts's
  // `initial`) resolves straight through `resolveDisplayTab` -- P3-S1-T1
  // retired the 'analysis' tab id these reports used to carry.
  expect(store.submitted[0].context).toMatchObject({ page_key: 'results' });

  store.items = [item({ id: 'fb-new', title: 'Axes flip after reload', owner_name: 'admin' })];
  await page.locator('[data-testid="feedback-subtab-mine"]').click();
  await expect(page.locator('[data-testid="feedback-my-list"]')).toContainText(
    'Axes flip after reload'
  );
});

test('admin triages feedback from the Feedback tab', async ({ page }) => {
  const store = { items: [item()], submitted: [], patched: [] as Array<{ id: string; body: Record<string, unknown> }> };
  await mockFeedbackApi(page, store);
  await login(page);

  await openFeedbackTab(page);

  const list = page.locator('[data-testid="feedback-admin-list"]');
  await expect(list).toContainText('Scatter axes flip after reload');
  await expect(list).toContainText('User Two');

  // Moving the item through triage writes exactly the new status.
  await page.locator('[data-testid="feedback-status-fb-1"]').selectOption('in_progress');
  await expect.poll(() => store.patched).toHaveLength(1);
  expect(store.patched[0]).toMatchObject({ id: 'fb-1', body: { status: 'in_progress' } });

  // A filter that excludes the only item leaves the empty state, not a stale row.
  await page.locator('[data-testid="feedback-filter-status"]').selectOption('resolved');
  await expect(list).toHaveCount(0);

  await page.locator('[data-testid="feedback-filter-status"]').selectOption('');
  await expect(page.locator('[data-testid="feedback-admin-list"]')).toContainText(
    'Scatter axes flip after reload'
  );
});

test('admin answers a thread and records an internal note', async ({ page }) => {
  const store = { items: [item()], submitted: [], patched: [] as Array<{ id: string; body: Record<string, unknown> }> };
  await mockFeedbackApi(page, store);
  await login(page);

  await openFeedbackTab(page);

  await page.locator('[data-testid="feedback-admin-list"] button[aria-expanded="false"]').click();
  await expect(page.locator('[data-testid="feedback-context-summary"]')).toContainText('CFX Opus');

  const reply = page.getByRole('textbox').first();
  await reply.fill('Fixed in the next build.');
  await page.getByRole('button', { name: /Post reply|답변 등록/ }).click();

  const note = page.locator('textarea').last();
  await note.fill('internal: reproduced on CFX');
  await page.getByRole('button', { name: /Save note|메모 저장/ }).click();

  await expect.poll(() => store.patched.map((entry) => entry.body)).toContainEqual({
    admin_note: 'internal: reproduced on CFX',
  });
});
