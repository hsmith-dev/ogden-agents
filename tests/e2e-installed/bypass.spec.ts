/**
 * Proof that each gate check detects a missing gate: every check in
 * `gate-checks.ts`, sent through a fixture that takes the gate out of the way
 * (`gate-bypass.ts`), must reach its route and get exactly the route's own
 * success status. That is the status the check would see if the gate were
 * gone, and it isn't the refusal `gate.spec.ts` requires, so the check would
 * fail. Any other status (a 502 from the fixture, a 404, a 500) means the
 * fixture is broken, not that the check detected anything, and fails here too.
 */
import { expect, test } from '@playwright/test';
import { exchange, launchLink, readLauncherToken } from '../support.js';
import { startGateBypass, type GateBypass } from './gate-bypass.js';
import { GATE_CHECKS, type GateTarget } from './gate-checks.js';
import { installed } from './installed.js';

let bypass: GateBypass;
let target: GateTarget;

test.beforeAll(async () => {
  const { url, dataDir } = installed();
  const tabToken = await exchange(await launchLink(url, dataDir));
  bypass = await startGateBypass(url, { tabToken, launcherToken: readLauncherToken(dataDir) });
  target = { url: bypass.url, tabToken };
});

test.afterAll(async () => {
  await bypass?.close();
});

for (const check of GATE_CHECKS) {
  test(`without the gate, reaches its route (${check.open}, not ${check.refused}): ${check.name}`, async () => {
    const status = await check.send(target);
    expect(status, status === check.refused ? 'the fixture did not bypass the gate' : 'the fixture is broken: neither the route nor a refusal answered').toBe(
      check.open,
    );
  });
}
