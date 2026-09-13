import { expect, test, type Page } from '@playwright/test';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { ADMIN_PASSWORD, ADMIN_USERNAME } from './helpers';

/**
 * This spec owns a small, real HTTP reverse proxy rather than relying on a
 * baseURL suffix. The browser therefore sees the deployment exactly as an
 * ASG nginx mount would: `/snp-analyze` is present in every browser URL, but
 * the upstream FastAPI app receives `/`, `/api/...`, and `/templates/...`.
 */
const MOUNT = '/snp-analyze';
const LAUNCH_TOKEN = 'synthetic-launch-token-never-rendered';

type MountedProxy = { origin: string; close: () => Promise<void> };
let mountedProxy: MountedProxy;

function upstreamOrigin(): URL {
  return new URL(process.env.E2E_BASE_URL || 'http://localhost:8002');
}

function mountedUrl(path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${mountedProxy.origin}${MOUNT}${suffix}`;
}

function mountedApiUrl(path: string): string {
  return `${mountedProxy.origin}${MOUNT}${path.startsWith('/') ? path : `/${path}`}`;
}

function forwardHeaders(request: IncomingMessage, upstream: URL): Record<string, string | string[] | undefined> {
  const headers = { ...request.headers } as Record<string, string | string[] | undefined>;
  headers.host = upstream.host;
  headers['x-forwarded-prefix'] = MOUNT;
  headers['x-forwarded-proto'] = 'http';
  delete headers.connection;
  return headers;
}

function rewriteMountedHtml(body: Buffer): Buffer {
  const html = body
    .toString('utf8')
    .replaceAll('src="/assets/', `src="${MOUNT}/assets/`)
    .replaceAll('href="/assets/', `href="${MOUNT}/assets/`);
  return Buffer.from(html);
}

function syntheticAuthResponse(
  request: IncomingMessage,
  response: import('node:http').ServerResponse,
  strippedPath: string,
): boolean {
  const mode = request.headers['x-p5-auth-mode'];
  if (typeof mode !== 'string') return false;

  let status = 404;
  let body: Record<string, unknown> = { detail: 'synthetic auth route not configured' };
  if (strippedPath === '/api/auth/config' && request.method === 'GET') {
    status = 200;
    body = {
      auth_mode: mode.startsWith('asg-') ? 'asg_launch' : 'local',
      asg_home_url: `${MOUNT}/designer/`,
    };
  } else if (strippedPath === '/api/auth/asg-launch' && request.method === 'POST' && mode === 'asg-denial') {
    status = 403;
    body = { detail: 'synthetic launch rejected' };
  } else if (strippedPath === '/api/auth/asg-launch' && request.method === 'POST' && mode === 'asg-success') {
    status = 200;
    body = {
      user: { id: 'synthetic-asg-user', username: 'synthetic@example.test', display_name: 'Synthetic ASG', role: 'user' },
      linked_context: {
        target_type: 'design_run_item',
        target_id: 'synthetic-target',
        context: { marker_id: 'synthetic-marker' },
        scope: ['snp:read', 'snp:save_result'],
        expires_at: null,
      },
    };
  } else if (strippedPath === '/api/auth/asg-launch-cookie' && request.method === 'POST' && mode === 'asg-cookie-save') {
    status = 200;
    body = {
      user: { id: 'admin', username: ADMIN_USERNAME, display_name: 'Mounted operator', role: 'admin' },
      linked_context: {
        target_type: 'marker',
        target_id: 'synthetic-target',
        context: { marker_id: 'synthetic-marker' },
        scope: ['snp:save_result'],
        expires_at: null,
      },
    };
  } else {
    return false;
  }

  const payload = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(payload.length) };
  if (status === 200 && mode === 'asg-success') {
    headers['set-cookie'] = 'snp_auth=synthetic-auth-cookie; Path=/snp-analyze; HttpOnly; SameSite=Lax';
  }
  response.writeHead(status, headers);
  response.end(payload);
  return true;
}

async function startMountedProxy(): Promise<MountedProxy> {
  const upstream = upstreamOrigin();
  const server: Server = createServer((request, response) => {
    const incoming = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (incoming.pathname !== MOUNT && !incoming.pathname.startsWith(`${MOUNT}/`)) {
      response.writeHead(404).end();
      return;
    }

    const strippedPath = incoming.pathname.slice(MOUNT.length) || '/';
    if (syntheticAuthResponse(request, response, strippedPath)) return;
    const proxyRequest = httpRequest({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      method: request.method,
      path: `${strippedPath}${incoming.search}`,
      headers: forwardHeaders(request, upstream),
    }, upstreamResponse => {
      const chunks: Buffer[] = [];
      upstreamResponse.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      upstreamResponse.on('end', () => {
        const contentType = String(upstreamResponse.headers['content-type'] || '');
        const body = contentType.includes('text/html') ? rewriteMountedHtml(Buffer.concat(chunks)) : Buffer.concat(chunks);
        const headers = { ...upstreamResponse.headers };
        delete headers['content-length'];
        delete headers['transfer-encoding'];
        delete headers.connection;
        headers['content-length'] = String(body.length);
        response.writeHead(upstreamResponse.statusCode || 502, headers);
        response.end(body);
      });
    });
    proxyRequest.on('error', error => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(`mounted proxy upstream error: ${error.message}`);
    });
    request.pipe(proxyRequest);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mounted proxy did not expose a TCP address');

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function assertMountedRequest(url: string, suffix: string): void {
  expect(new URL(url).pathname).toBe(`${MOUNT}${suffix}`);
}

function apiRequests(requests: string[]): URL[] {
  return requests.map(value => new URL(value)).filter(url => url.pathname.startsWith(`${MOUNT}/api/`));
}

function artifactBytes(root: string): Buffer[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = `${root}/${entry.name}`;
    return entry.isDirectory() ? artifactBytes(path) : [readFileSync(path)];
  });
}

async function loginAtMount(page: Page): Promise<void> {
  await page.goto(mountedUrl());
  await expect(page.locator('#username')).toBeVisible();
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('#file-input')).toBeAttached();
}

async function assertLaunchSecretConsumed(page: Page, secret: string): Promise<void> {
  const state = await page.evaluate(() => ({
    url: window.location.href,
    html: document.documentElement.outerHTML,
    body: document.body.innerText,
    launchStorage: window.sessionStorage.getItem('__asg_launch_token'),
    fallback: window.__ASG_LAUNCH_TOKEN__ ?? null,
  }));
  expect(state.url).not.toContain(secret);
  expect(state.html).not.toContain(secret);
  expect(state.body).not.toContain(secret);
  expect(state.launchStorage).toBeNull();
  expect(state.fallback).toBeNull();
}

test.describe('P5 ASG mounted-path compatibility', () => {
  test.beforeAll(async () => { mountedProxy = await startMountedProxy(); });
  test.afterAll(async () => { await mountedProxy.close(); });

  test('serves Vite assets and auth config through a proxy-stripped mount', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));

    await page.goto(mountedUrl());
    await expect(page.locator('#username')).toBeVisible();

    const assets = requests.map(value => new URL(value)).filter(url => url.pathname.startsWith(`${MOUNT}/assets/`));
    expect(assets.length).toBeGreaterThan(0);
    const config = apiRequests(requests).find(url => url.pathname.endsWith('/api/auth/config'));
    expect(config).toBeDefined();
    assertMountedRequest(config!.toString(), '/api/auth/config');
    expect(requests.some(value => new URL(value).pathname === '/api/auth/config')).toBeFalsy();
  });

  test('keeps local login cookie, API calls, template href, and download under the mount', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));

    await loginAtMount(page);
    const cookies = await page.context().cookies(mountedUrl());
    const authCookie = cookies.find(cookie => cookie.name === 'snp_auth');
    expect(authCookie).toBeDefined();
    expect(authCookie!.value).toBeTruthy();
    expect(await page.locator('body').innerText()).not.toContain(authCookie!.value);

    const template = page.getByRole('link', { name: /RDES (amplification|증폭) TSV/i });
    const templatePath = '/templates/qprism-rdes-amplification-template.tsv';
    await expect(template).toHaveAttribute('href', `${MOUNT}${templatePath}`);
    const [download] = await Promise.all([page.waitForEvent('download'), template.click()]);
    expect(download.suggestedFilename()).toBe('qprism-rdes-amplification-template.tsv');
    expect(download.url()).toBe(mountedUrl(templatePath));

    const loginRequest = apiRequests(requests).find(url => url.pathname.endsWith('/api/auth/login'));
    expect(loginRequest).toBeDefined();
    assertMountedRequest(loginRequest!.toString(), '/api/auth/login');
    expect(apiRequests(requests).every(url => url.pathname.startsWith(`${MOUNT}/api/`))).toBeTruthy();
    expect(requests.some(value => new URL(value).pathname.startsWith('/api/'))).toBeFalsy();
  });

  test('shows local denial and ASG launch denial without exposing launch credentials', async ({ page }) => {
    await page.goto(mountedUrl());
    await page.locator('#username').fill(`synthetic-denial-${Date.now()}`);
    await page.locator('#password').fill('synthetic-invalid-password');
    const denied = page.waitForResponse(response => response.url() === mountedApiUrl('/api/auth/login'));
    await page.locator('form button[type="submit"]').click();
    expect((await denied).status()).toBe(401);
    // The local-login hook intentionally keeps the login surface mounted after
    // a denial (the response body is not copied into the page).
    await expect(page.locator('#username')).toBeVisible();

    expect(page.url()).toBe(mountedUrl());

    // Use a genuinely new document for the ASG denial so no pending local-auth
    // bootstrap subscriber can race the new launch bootstrap.
    const asgContext = await page.context().browser()!.newContext();
    const asgPage = await asgContext.newPage();

    await asgContext.setExtraHTTPHeaders({ 'x-p5-auth-mode': 'asg-denial' });

    await asgPage.goto(mountedUrl(`/?token=${encodeURIComponent(LAUNCH_TOKEN)}&tab=project#anchor`));
    await expect(asgPage.getByRole('heading', { name: /session expired|로그인이 필요/i })).toBeVisible();
    await assertLaunchSecretConsumed(asgPage, LAUNCH_TOKEN);
    expect(asgPage.url()).toBe(mountedUrl('/?tab=project#anchor'));
    expect(await asgPage.locator('body').innerText()).not.toContain('synthetic launch rejected');
    await asgContext.close();
  });

  test('exchanges an ASG launch once, restores URL state, and removes the launch token', async ({ page }, testInfo) => {
    const requests: string[] = [];
    const consoleMessages: string[] = [];
    page.on('request', request => requests.push(request.url()));
    page.on('console', message => consoleMessages.push(message.text()));
    let launchPosts = 0;

    await page.context().setExtraHTTPHeaders({ 'x-p5-auth-mode': 'asg-success' });
    page.on('request', request => {
      if (request.url().endsWith('/api/auth/asg-launch') && request.method() === 'POST') {
        launchPosts += 1;
        expect(request.postDataJSON()).toEqual({ token: LAUNCH_TOKEN });
      }
    });

    // The synthetic auth route above fakes the exchange without the real
    // backend ever minting the resulting cookie, so the project tab's own
    // session/project list fetches would otherwise reach the real backend
    // with a cookie it never issued and get a real 401 -- which the app's
    // shared apiFetch error path treats as "log the user out" no matter
    // which endpoint reported it (see src/lib/api.ts's responseError). Stub
    // both restored-tab reads so this test verifies the launch exchange
    // itself, not that unrelated backend state happens to accept a
    // synthetic cookie.
    await page.route(mountedApiUrl('/api/sessions'), async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route(mountedApiUrl('/api/projects'), async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [] }) });
    });

    await page.goto(mountedUrl(`/?token=${encodeURIComponent(LAUNCH_TOKEN)}&tab=project#anchor`));
    await expect(page.locator('header')).toBeVisible();
    const restored = new URL(page.url());
    expect(restored.pathname).toBe(`${MOUNT}/`);
    expect(restored.search).toBe('?tab=project');
    expect(restored.hash).toBe('#anchor');
    expect(launchPosts).toBe(1);
    await assertLaunchSecretConsumed(page, LAUNCH_TOKEN);
    expect(consoleMessages.some(message => message.includes(LAUNCH_TOKEN))).toBeFalsy();
    expect(requests.filter(value => value.includes(LAUNCH_TOKEN))).toHaveLength(1);
    expect(testInfo.attachments.map(attachment => attachment.name).join('\n')).not.toContain(LAUNCH_TOKEN);
    expect(artifactBytes(testInfo.outputDir).some(content => content.includes(Buffer.from(LAUNCH_TOKEN)))).toBeFalsy();
  });

  test('keeps ASG save denial retryable without sending a real external POST', async ({ page }) => {
    await loginAtMount(page);
    const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
    await page.locator('#example-select').selectOption('2');
    await analyzed;
    await expect(page.locator('#cycle-slider')).toBeVisible();

    await page.context().setExtraHTTPHeaders({ 'x-p5-auth-mode': 'asg-cookie-save' });

    let saveAttempts = 0;
    await page.route(mountedApiUrl('/api/asg/save-result'), async route => {
      assertMountedRequest(route.request().url(), '/api/asg/save-result');
      saveAttempts += 1;
      if (saveAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'synthetic ASG transport unavailable' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'saved', analysis_run_id: 'synthetic-run' }) });
      }
    });

    await page.reload();
    const saveButton = page.locator('#asg-save-result-btn');
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toHaveAttribute('title', /synthetic ASG transport unavailable/);
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toContainText('Saved');
    expect(saveAttempts).toBe(2);
  });
});
