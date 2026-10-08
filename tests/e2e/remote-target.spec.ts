/// <reference lib="dom" />
/**
 * Choosing a confirmed remote machine as a chat or build target, in a real
 * browser (CAP-24, epic 19 story 19.7, the epic's own closing proof).
 * Stories 19.1-19.6 built the whole mechanism; nothing before this story
 * ever constructed the real production capability, exposed a REST field
 * for it, or gave the user a way to choose a machine at all.
 *
 * Against `startServer(dataDir, 0, { remoteHost: hosts, secrets })` (19.3's
 * own pattern, `createMemoryRemoteHostPort()`): add a machine and confirm
 * its host key (over REST -- the add/confirm UI itself is
 * `remote-machines.spec.ts`'s own proof), pick it in the chat composer
 * (`MachinePicker`, beside the agent picker) and send a message, then pick
 * it in the Build dialog for an attended build and approve. The real
 * fake-agent fixture (`fake-acp-agent.mjs`) runs both times through the
 * fake remote host's own real local `sh -c` -- never a scripted stand-in --
 * so this is the first test in the whole epic where an agent's process
 * genuinely runs somewhere else and the result is pulled back for real.
 */
import { expect, test } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BMAD_FILES, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { fixedSandbox } from '../fixtures/fixed-sandbox.ts';
import { createPlanFileTicketStore } from '../fixtures/plan-file-ticket-store.ts';
import { API_ROUTES, serverModule } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const TICKETS = [{ ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN }];
const FILES = { ...FAKE_BMAD_FILES, '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n', ...FAKE_BUILD_REPO_FILES };

test('a confirmed remote machine runs a chat and an attended build, pulled back and approved', async ({ page }) => {
  test.setTimeout(150_000);
  const store = createPlanFileTicketStore(TICKETS);
  const { createMemoryBmadSource, createMemoryRemoteHostPort, createMemorySecretStore } = await serverModule();
  const bmadSource = createMemoryBmadSource({ ready: true });
  const hosts = createMemoryRemoteHostPort();
  const secrets = createMemorySecretStore();

  await withChatServer(
    page,
    async ({ server, repo }) => {
      fixtureGit(repo, 'init', '-q', '--initial-branch=main');
      fixtureGit(repo, 'config', 'core.autocrlf', 'false');
      fixtureGit(repo, 'config', 'user.name', 'Fixture');
      fixtureGit(repo, 'config', 'user.email', 'fixture@example.com');
      fixtureGit(repo, 'add', '-A');
      fixtureGit(repo, 'commit', '-q', '--no-verify', '-m', 'The fixture');

      const origin = new URL(page.url()).origin;
      const token = await storedToken(page);
      const call = (method: string, path: string, body?: unknown) =>
        fetch(`${origin}${path}`, {
          method,
          headers: { authorization: `Bearer ${token!}`, origin, 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

      // Add and confirm a machine over REST (19.3's own UI is proven in remote-machines.spec.ts; this test's own
      // ground is the two real targets, chat and build, not the Settings page).
      hosts.setFingerprint('bench.local', 22, 'fp-e2e-remote-target');
      const added = (await (await call('POST', API_ROUTES.remoteMachines, { host: 'bench.local', port: 22, username: 'ada', label: 'Build bench' })).json()) as {
        machine: { id: string };
      };
      const machineId = added.machine.id;
      const confirmed = await call('POST', apiPath(API_ROUTES.remoteMachineHostKeyConfirm, { machineId }), { fingerprint: 'fp-e2e-remote-target', confirm: true });
      expect(confirmed.status).toBe(200);

      const wsId = ((await (await call('POST', API_ROUTES.workspaces, { path: repo })).json()) as { workspace: { id: string } }).workspace.id;

      // --- Chat (CAP-24, epic 19 story 19.7: a plain chat targeting a remote machine for the first time) ---

      // A chat already exists so the header's pickers show (the empty project's own composer, mirrored by every
      // other chat spec, has no machine choice: the same place AgentPicker itself is never offered there either).
      await page.goto(`${origin}/w/${wsId}`);
      const firstComposer = page.getByRole('textbox', { name: 'Message Claude Code' });
      await firstComposer.fill('hello local');
      await firstComposer.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_`));

      await page.goto(`${origin}/w/${wsId}`);
      await page.getByTestId('machine-picker').click();
      await page.locator(`[data-testid="machine-option"][data-machine="${machineId}"]`).click();
      await expect(page.getByTestId('machine-picker')).toContainText('Build bench');
      await page.getByTestId('new-chat').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_`));
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

      const remoteComposer = page.getByRole('textbox', { name: 'Message Claude Code' });
      await remoteComposer.fill('session-start');
      await remoteComposer.press('Enter');
      // The remote chat's own cwd (this story's design call: the machine's own home directory, never the
      // workspace's folder, which names nothing on the remote machine) -- proof the agent really ran elsewhere,
      // through the fake remote host's real local `sh -c`, not a scripted stand-in.
      await expect(page.getByTestId('message-agent').last()).toContainText('"cwd":"."');
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

      // --- Build (CAP-24, epic 19 story 19.7: the real route and dialog reach 19.6's own attended-remote path) ---

      expect((await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
      expect((await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);

      await page.goto(`${origin}/w/${wsId}/board`);
      await page.getByRole('button', { name: 'Build this story 1.1' }).click();

      const dialog = page.getByTestId('build-dialog');
      await expect(dialog).toBeVisible();
      const machinePicker = dialog.getByTestId('build-machine-picker');
      await expect(machinePicker).toBeVisible();
      await dialog.getByTestId(`build-machine-${machineId}`).click();
      await dialog.getByRole('button', { name: 'Build with me watching' }).click();

      // Attended (19.6's scope decision): every tool call is a card, exactly as a local attended build's.
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Za-z_]+$`));
      const card = page.getByTestId('permission-card');
      await expect(card).toBeVisible();
      await expect(card).toContainText('built-1.1.txt');
      await card.getByRole('button', { name: 'Allow once' }).click();
      await expect(page.getByTestId('permission-card')).toBeVisible();
      await page.getByTestId('permission-card').getByRole('button', { name: 'Deny' }).click();

      await expect(page.getByTestId('build-run-header')).toHaveAttribute('data-outcome', 'verified', { timeout: 30_000 });
      await expect(page.getByRole('textbox', { name: 'Message Claude Code' })).toHaveCount(0);

      await page.getByTestId('build-run-review').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/review/1\\.1$`));
      await expect(page.getByTestId('review-outcome')).toHaveText('Ready for review');
      await expect(page.getByTestId('review-approve')).toBeEnabled();
      await page.getByTestId('review-approve').click();
      await expect(page.getByTestId('review-merged')).toBeVisible();
      await expect(page.getByTestId('review-approve')).toHaveCount(0);

      // One merge commit on main with the remote build's own change, the ticket done.
      expect(fixtureGit(repo, 'show', `HEAD:${FAKE_BUILD_PLAN}`)).toMatch(/^status: done$/m);
      expect(fixtureGit(repo, 'status', '--porcelain').trim()).toBe('');
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: false, reason: 'The test sandbox is unavailable.', choices: ['attended', 'install_docker', 'other_agent'] }), remoteHost: hosts, secrets } },
  );
});
