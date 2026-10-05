/// <reference lib="dom" />
/**
 * The Build dialog and attended builds in a real browser (story 5.6): with a
 * sandbox answer of "none" (as Windows gives, building with you watching
 * first), Build on a ready card opens the Build dialog instead of an alert,
 * writing nothing; it names what this computer can use and offers Use
 * another agent (disabled), Install Docker (a link) and Build with me
 * watching, which starts an attended build whose every tool call is a card
 * until the run is ready for review.
 *
 * Real `git`; a ticket store that reads and writes the plan files; a fixed
 * sandbox answer; the fake ACP agent; no real `claude`, keychain or network.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BMAD_FILES, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, FAKE_BUILD_WAITING_PLAN, fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { fixedSandbox } from '../fixtures/fixed-sandbox.ts';
import { createPlanFileTicketStore } from '../fixtures/plan-file-ticket-store.ts';
import { API_ROUTES, serverModule } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN },
  { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN, after: [1] },
];
const FILES = { ...FAKE_BMAD_FILES, '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n', ...FAKE_BUILD_REPO_FILES };

test('with no sandbox, Build opens the dialog with its three choices and Build with me watching runs an attended build through permission cards', async ({ page }) => {
  test.setTimeout(90_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, dataDir, repo }) => {
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

      await page.goto(`${server.url}/w/${wsId}/board`);
      await page.getByRole('button', { name: 'Build 1.1' }).click();

      // The dialog, never an alert; nothing was written.
      const dialog = page.getByTestId('build-dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('board-build-error')).toHaveCount(0);
      await expect(dialog).toContainText("Claude Code can't build unattended on this computer yet.");
      await expect(page.getByTestId('build-dialog-summary')).toHaveText('The test sandbox is unavailable.');
      expect(existsSync(join(dataDir, 'w'))).toBe(false);
      // As Windows gives them: Build with me watching first, where focus lands.
      const choices = await page.getByTestId('build-dialog-choice').evaluateAll((items) => items.map((item) => item.getAttribute('data-choice')));
      expect(choices).toEqual(['attended', 'install_docker', 'other_agent']);
      await expect(page.getByRole('button', { name: 'Build with me watching' })).toBeFocused();
      await expect(page.getByRole('button', { name: 'Use another agent' })).toBeDisabled();
      await expect(page.getByTestId('build-dialog-install-docker')).toHaveAttribute('href', /^https:\/\/docs\.docker\.com\//);

      // Build with me watching: the build session, and each tool call a card.
      await page.getByRole('button', { name: 'Build with me watching' }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
      const card = page.getByTestId('permission-card');
      await expect(card).toBeVisible();
      await expect(card).toContainText('built-1.1.txt');
      await card.getByRole('button', { name: 'Allow once' }).click();
      // The second is the write outside the worktree: denied.
      await expect(page.getByTestId('permission-record')).toHaveCount(1);
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Deny' }).click();
      await expect(page.getByTestId('build-run-header')).toHaveAttribute('data-outcome', 'verified');
      await expect(page.getByRole('textbox', { name: 'Message Claude Code' })).toHaveCount(0);
      // The build ran in its own worktree outside the repo, like any other.
      expect(existsSync(join(dataDir, 'w'))).toBe(true);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: false, reason: 'The test sandbox is unavailable.', choices: ['attended', 'install_docker', 'other_agent'] }) } },
  );
});
