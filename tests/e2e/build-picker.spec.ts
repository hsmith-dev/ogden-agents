/// <reference lib="dom" />
/**
 * The Build picker and the default build agent in a real browser (epic 17, entry 8): with Claude Code and Codex both able
 * to build, Build on a ready card opens the dialog (nothing starts), each agent says how it would build here and why,
 * a Codex build is the one the person watches (every request a card) and ends ready for review, and the project's
 * default build agent is chosen in Workspace settings. Codex is its fake personality with its key from the
 * environment, a fixed sandbox answer for Claude Code, real `git`; no real agent, keychain or network.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BMAD_FILES, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { fixedSandbox } from '../fixtures/fixed-sandbox.ts';
import { createPlanFileTicketStore } from '../fixtures/plan-file-ticket-store.ts';
import { API_ROUTES, FAKE_CODEX, serverModule } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const TICKETS = [{ ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN }];
const FILES = {
  ...FAKE_BMAD_FILES,
  '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n',
  ...FAKE_BUILD_REPO_FILES,
  // Codex finds the build skill where it reads skills, committed in the project.
  '.agents/skills/bmad-build-auto/SKILL.md': '# Build\n',
};
const KEY = `sk-proj-${'E'.repeat(40)}2468`;

test('Build opens the picker with two agents, a Codex build is watched through cards, and the default build agent is set in Workspace settings', async ({ page }) => {
  test.setTimeout(120_000);
  const store = createPlanFileTicketStore(TICKETS);
  const server = await serverModule();
  const bmadSource = server.createMemoryBmadSource({ ready: true });
  const setup = server.createMemoryAgentSetup({ agentId: 'codex', displayName: 'Codex', installed: true, auth: 'needs_sign_in' });
  const codex = {
    agent: server.createCodexAgent({ dataDir: process.cwd(), server: () => ({ command: process.execPath, args: [FAKE_CODEX] }) }),
    setup: { ...setup, status: async () => ({ ...(await setup.status()), subscription: 'signed_out' as const }), apiKey: { envName: 'CODEX_API_KEY', check: () => undefined, verify: async () => 'ok' as const } },
  };
  await withChatServer(
    page,
    async ({ server: running, dataDir, repo }) => {
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
      const wsId = ((await (await call('POST', API_ROUTES.workspaces, { path: repo })).json()) as { workspace: { id: string } }).workspace.id;
      expect((await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
      expect((await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);

      // The default build agent is chosen per project in Workspace settings.
      await page.goto(`${running.url}/w/${wsId}/settings`);
      const setting = page.getByTestId('default-build-agent');
      await expect(setting).toBeVisible();
      await expect(page.getByTestId('default-build-agent-automatic')).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('#default-build-agent-codex-description')).toContainText('Builds with you watching');
      await page.getByTestId('default-build-agent-codex').click();
      await expect(page.getByTestId('default-build-agent-saved')).toBeVisible();
      await page.getByTestId('default-build-agent-automatic').click();
      await expect(page.getByTestId('default-build-agent-automatic')).toHaveAttribute('aria-checked', 'true');

      // Build asks which agent: nothing is written yet.
      await page.goto(`${running.url}/w/${wsId}/board`);
      await page.getByRole('button', { name: 'Build this story 1.1' }).click();
      const dialog = page.getByTestId('build-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Build 1.1 with which agent?');
      await expect(page.getByTestId('build-agent-claude-code')).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('#build-agent-codex-description')).toContainText("Codex's own sandbox hasn't been checked on this computer yet");
      expect(existsSync(join(dataDir, 'w'))).toBe(false);

      // Codex builds with the person watching: a card for each write, then ready for review.
      await page.getByTestId('build-agent-codex').click();
      await expect(dialog).toContainText("Codex can't build unattended on this computer yet.");
      await page.getByRole('button', { name: 'Build with me watching' }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
      const card = page.getByTestId('permission-card');
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Allow once' }).click();
      await expect(page.getByTestId('permission-record')).toHaveCount(1);
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Deny' }).click();
      await expect(page.getByTestId('build-run-header')).toHaveAttribute('data-outcome', 'verified');
      // The run is Codex's.
      const runs = (await (await call('GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json()) as { runs: Array<{ agent: string | null }> };
      expect(runs.runs.map((run) => run.agent)).toEqual(['codex']);
    },
    {
      files: FILES,
      extra: {
        ticketStore: store as never,
        bmadSource,
        codex: codex as never,
        sandbox: fixedSandbox({ available: true, kind: 'test' }),
        extraAgentEnv: { CODEX_API_KEY: KEY, FAKE_ACP_CHUNK_DELAY_MS: '1' },
      },
    },
  );
});
