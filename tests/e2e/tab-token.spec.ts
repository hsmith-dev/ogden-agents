/// <reference lib="dom" />
/**
 * The per-tab token in a real browser (story 2.1, AD-15 as amended): the
 * launch link is `/#c=<code>`; the boot script strips it and exchanges the
 * code over POST, so the token never appears in any URL or history entry; a
 * reload keeps it; New tab opens a second connected tab with its own
 * token; a bookmark, a wrong token or an old cookie shows "Open Ogden
 * Agents"; and the Content-Security-Policy is in force with no inline script.
 */
import { expect, test, type Page } from '@playwright/test';
import { API_ROUTES } from '../support.js';
import { launchLink, openConnected, sharedUrl as url } from './tab.js';

const TOKEN_KEY = 'ogden-agents.tab-token';

const connected = (page: Page) =>
  expect(page.locator('aside[data-slot="sidebar"]').getByTestId('server-status')).toHaveAttribute('data-status', 'connected');

const storedToken = (page: Page) => page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY);

test.use({ viewport: { width: 1440, height: 900 } });

test('launch: /#c=<code> is exchanged over POST; the token never appears in any URL, request URL or history entry, and no cookie is set', async ({ page, context }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  // Every URL this tab ever had or asked for: navigations (including history API
  // changes, which Playwright reports as frame navigations), requests and redirects.
  const urls: string[] = [];
  page.on('framenavigated', (frame) => urls.push(frame.url()));
  page.on('request', (request) => urls.push(request.url()));
  page.on('response', (response) => {
    const location = response.headers()['location'];
    if (location !== undefined) urls.push(location);
  });
  const exchanged = page.waitForResponse((response) => response.url().endsWith(API_ROUTES.tabExchange));

  const link = await launchLink();
  expect(link).toMatch(/\/#c=[A-Za-z0-9_-]{43}$/);
  await page.goto(link);
  const exchange = await exchanged;
  expect(exchange.request().method()).toBe('POST');
  expect(exchange.request().postDataJSON()).toEqual({ code: new URL(link).hash.slice('#c='.length) });
  const { token } = (await exchange.json()) as { token: string };
  await expect(page).toHaveURL(`${url()}/`);
  await connected(page);
  expect(await storedToken(page)).toBe(token);

  // Nowhere in any URL, and the history holds only the stripped entry: going
  // back leaves the app (to the blank page the tab started on).
  urls.push(await page.evaluate(() => window.location.href));
  for (const seen of urls) expect(seen).not.toContain(token);
  expect(urls.some((seen) => seen.includes('#c='))).toBe(true);
  expect(await page.evaluate(() => window.location.hash)).toBe('');
  expect(await page.evaluate(() => document.cookie)).toBe('');
  expect(await context.cookies()).toEqual([]);
  expect(violations).toEqual([]);
  await page.goBack();
  expect(page.url()).toBe('about:blank');
});

test('the socket offers ogden.v1 and the token subprotocol, and the server answers with ogden.v1 only', async ({ page }) => {
  await openConnected(page);
  await connected(page);
  const protocol = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const token = sessionStorage.getItem('ogden-agents.tab-token')!;
        const ws = new WebSocket(`ws://${window.location.host}/ws`, ['ogden.v1', `ogden.auth.${token}`]);
        ws.onopen = () => {
          resolve(ws.protocol);
          ws.close();
        };
        ws.onerror = () => reject(new Error('refused'));
      }),
  );
  expect(protocol).toBe('ogden.v1');
});

test('reload: the same tab stays connected, on the same path, with the same token', async ({ page }) => {
  await openConnected(page, '/settings/appearance');
  await connected(page);
  const token = await storedToken(page);
  await page.reload();
  await expect(page).toHaveURL(`${url()}/settings/appearance`);
  await connected(page);
  expect(await storedToken(page)).toBe(token);
});

test('New tab in the sidebar footer opens a second connected tab with its own token', async ({ page, context }) => {
  await openConnected(page);
  await connected(page);
  const first = await storedToken(page);

  const opened = context.waitForEvent('page');
  await page.locator('aside[data-slot="sidebar"]').getByRole('button', { name: 'New tab' }).click();
  const second = await opened;
  await expect(second).toHaveURL(`${url()}/`);
  await connected(second);
  const token = await storedToken(second);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(token).not.toBe(first);
  // The first tab is still connected with its own.
  await connected(page);
  expect(await storedToken(page)).toBe(first);
  // The new tab can't reach back into the first one.
  expect(await second.evaluate(() => window.opener)).toBeNull();
});

test('bookmark: a plain URL in a fresh tab of a connected browser shows "Open Ogden Agents"', async ({ page, context }) => {
  await openConnected(page);
  await connected(page);
  const fresh = await context.newPage();
  await fresh.goto(`${url()}/settings/appearance`);
  await expect(fresh.getByTestId('open-ogden-agents').getByRole('heading', { name: 'Open Ogden Agents' })).toBeVisible();
  expect(await storedToken(fresh)).toBeNull();
});

test('wrong token: a tampered token is refused, forgotten, and the tab shows the launch state', async ({ page }) => {
  await openConnected(page);
  await connected(page);
  await page.evaluate((key) => {
    const token = sessionStorage.getItem(key)!;
    sessionStorage.setItem(key, (token[0] === 'A' ? 'B' : 'A') + token.slice(1));
  }, TOKEN_KEY);
  await page.reload();
  await expect(page.getByTestId('open-ogden-agents').getByRole('heading', { name: 'Open Ogden Agents' })).toBeVisible();
  expect(await storedToken(page)).toBeNull();
});

test('cookie only: an old session cookie opens nothing', async ({ page, context }) => {
  const { hostname, port } = new URL(url());
  await context.addCookies([
    { name: `ogden_session_${port}`, value: `AAAAAAAAAAAAAAAAAAAAAA.${Math.floor(Date.now() / 1000) + 3600}.${'A'.repeat(43)}`, domain: hostname, path: '/' },
  ]);
  await page.goto(url());
  await expect(page.getByTestId('open-ogden-agents')).toBeVisible();
  const api = await page.evaluate(async (path) => (await fetch(path)).status, API_ROUTES.tabCheck);
  expect(api).toBe(401);
  // Nor does a /ws upgrade that carries only the cookie, with or without ogden.v1.
  for (const protocols of [[], ['ogden.v1']]) {
    const outcome = await page.evaluate(
      (offer) =>
        new Promise<string>((resolve) => {
          const ws = new WebSocket(`ws://${window.location.host}/ws`, offer);
          ws.onopen = () => {
            resolve('open');
            ws.close();
          };
          ws.onclose = () => resolve('refused');
        }),
      protocols,
    );
    expect(outcome, JSON.stringify(protocols)).toBe('refused');
  }
});

test('CSP: the policy is in force, allows the app, and blocks inline script', async ({ page }) => {
  const response = await page.goto(await launchLink());
  const policy = (await response!.allHeaders())['content-security-policy'];
  expect(policy).toContain("script-src 'self'");
  expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  await connected(page);

  const blocked = await page.evaluate(
    () =>
      new Promise<{ ran: boolean; violated: string | undefined }>((resolve) => {
        let violated: string | undefined;
        document.addEventListener('securitypolicyviolation', (event) => (violated = event.violatedDirective));
        const script = document.createElement('script');
        script.textContent = 'window.__inlineRan = true;';
        document.head.append(script);
        setTimeout(() => resolve({ ran: (window as unknown as { __inlineRan?: boolean }).__inlineRan === true, violated }), 100);
      }),
  );
  expect(blocked.ran).toBe(false);
  expect(blocked.violated).toMatch(/^script-src/);
});
