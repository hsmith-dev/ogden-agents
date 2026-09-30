/**
 * The security gate of the installed server (AD-15): every check in
 * `gate-checks.ts` (no tab token, a foreign Origin or Host, the launcher
 * endpoint without its token) is refused with exactly the gate's status.
 * Positive controls first, so a refusal can't come from a server that refuses
 * everything. `bypass.spec.ts` proves each of these checks fails without the gate.
 */
import { expect, test } from '@playwright/test';
import { API_ROUTES, exchange, launchLink, readLauncherToken } from '../support.js';
import { GATE_CHECKS, upgrade, type GateTarget } from './gate-checks.js';
import { installed } from './installed.js';

let target: GateTarget;

test.beforeAll(async () => {
  const { url, dataDir } = installed();
  // A tab token the way a tab gets one: a launch link from the launcher handshake, exchanged over POST.
  target = { url, tabToken: await exchange(await launchLink(url, dataDir)) };
});

test('positive controls: the tab token, the page Origin and the launcher token are accepted', async () => {
  const { url, tabToken } = target;
  expect((await fetch(`${url}${API_ROUTES.tabCheck}`, { headers: { authorization: `Bearer ${tabToken}` } })).status).toBe(204);
  const opened = await upgrade(url, ['ogden.v1', `ogden.auth.${tabToken}`], { origin: url });
  expect(opened).toEqual({ status: 101, protocol: 'ogden.v1' });
  const hello = await fetch(`${url}/launcher/hello`, { headers: { 'x-ogden-launcher-token': readLauncherToken(installed().dataDir) } });
  expect(hello.status).toBe(200);
  // The page itself loads without a token (it holds no user data), with the CSP.
  const page = await fetch(url);
  expect(page.status).toBe(200);
  expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
});

for (const check of GATE_CHECKS) {
  test(`refused (${check.refused}): ${check.name}`, async () => {
    expect(await check.send(target)).toBe(check.refused);
  });
}
