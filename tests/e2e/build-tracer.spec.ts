/// <reference lib="dom" />
/**
 * Unattended builds' tracer in a real browser (story 5.2): on a fixture git
 * repo with a ready ticket, Unattended builds on and the project trusted,
 * Build on the card opens the read-only build session (no composer; the
 * ticket and the run's outcome in its header), where the fake ACP agent's
 * build streams; the run ends Ready for review; the review page shows the
 * changed files and the diff, and Approve and merge leaves one merge commit
 * on `main` with the change and the plan `done`, after which the board shows
 * the card in Done. With Unattended builds off, `POST …/builds` is 409
 * `feature_off` and nothing exists: no worktree, branch or session.
 *
 * Real `git`; a ticket store that reads and writes the plan files (no uv);
 * a fixed sandbox answer (CI's runners have no working bwrap); no real
 * `claude`, keychain or network.
 */
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BMAD_FILES, FAKE_BUILD_PLAN, FAKE_BUILD_TICKET_FILES, FAKE_BUILD_WAITING_PLAN, fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { createPlanFileTicketStore } from '../fixtures/plan-file-ticket-store.ts';
import { API_ROUTES, serverModule } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN },
  { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN, after: [1] },
];

/** The fixture repo's files: BMad Method set up, the build's tickets and plans. */
const FILES = { ...FAKE_BMAD_FILES, '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n', ...FAKE_BUILD_TICKET_FILES };

const branches = (repo: string) => fixtureGit(repo, 'branch', '--format=%(refname:short)').trim().split('\n').sort();

test('Build on a ready card builds it unattended, the session streams read-only, and Approve merges it: the board shows Done', async ({ page }) => {
  test.setTimeout(90_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, dataDir, repo }) => {
      fixtureGit(repo, 'init', '-q', '--initial-branch=main');
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
      expect((await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] })).status).toBe(200);
      expect((await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);

      // Unattended builds off: refused by core's guard, and nothing exists.
      const off = await call('POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1' });
      expect(off.status).toBe(409);
      expect(((await off.json()) as { error: { code: string } }).error.code).toBe('feature_off');
      expect(existsSync(join(dataDir, 'w'))).toBe(false);
      expect(branches(repo)).toEqual(['main']);
      expect(((await (await call('GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).json()) as { sessions: unknown[] }).sessions).toEqual([]);
      // The board offers no Build with the piece off.
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.locator('[data-testid="ticket-card"][data-ref="1.1"]')).toHaveAttribute('data-column', 'ready');
      await expect(page.getByTestId('ticket-build')).toHaveCount(0);

      expect((await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
      await page.reload();
      const build = page.getByRole('button', { name: 'Build 1.1' });
      await expect(build).toBeVisible();
      await build.click();

      // The read-only build session: its ticket and outcome in the header, no composer.
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
      await expect(page.getByTestId('build-run-ref')).toHaveText('1.1');
      await expect(page.getByTestId('message-user')).toHaveText('/bmad-build-auto ticket 1.1');
      await expect(page.getByTestId('message-agent')).toContainText('Built 1.1.');
      await expect(page.getByRole('textbox', { name: 'Message Claude Code' })).toHaveCount(0);
      await expect(page.getByTestId('build-run-header')).toHaveAttribute('data-outcome', 'verified');
      await expect(page.getByTestId('build-run-outcome')).toHaveText('Ready for review');
      // The worktree is in the data folder, never the repo.
      const worktrees = readdirSync(join(dataDir, 'w'));
      expect(worktrees).toHaveLength(1);
      expect(readdirSync(repo)).not.toContain('w');

      // The review page: the changed files and the diff, then Approve and merge.
      await page.getByTestId('build-run-review').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/review/1\\.1$`));
      await expect(page.getByTestId('review-outcome')).toHaveText('Ready for review');
      await expect(page.getByTestId('review-files')).toContainText('src/built-1.1.txt');
      await expect(page.getByTestId('review-diff')).toContainText('Built 1.1 by the fake agent.');
      const head = fixtureGit(repo, 'rev-parse', 'HEAD').trim();
      await page.getByTestId('review-approve').click();
      await expect(page.getByTestId('review-merged')).toBeVisible();
      await expect(page.getByTestId('review-approve')).toHaveCount(0);

      // One merge commit on main with the change and the plan done; the worktree gone, the branch kept.
      expect(fixtureGit(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
      expect(fixtureGit(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(3);
      expect(fixtureGit(repo, 'rev-parse', 'HEAD^1').trim()).toBe(head);
      expect(fixtureGit(repo, 'show', 'HEAD:src/built-1.1.txt')).toContain('Built 1.1');
      expect(fixtureGit(repo, 'show', `HEAD:${FAKE_BUILD_PLAN}`)).toMatch(/^status: done$/m);
      expect(fixtureGit(repo, 'status', '--porcelain').trim()).toBe('');
      expect(existsSync(join(realpathSync.native(dataDir), 'w', worktrees[0]!))).toBe(false);
      expect(branches(repo)).toEqual(['main', `ogden/${worktrees[0]}/1.1-build-the-thing`]);

      // The board shows it Done.
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.locator('[data-testid="ticket-card"][data-ref="1.1"]')).toHaveAttribute('data-column', 'done');
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: { check: async () => ({ available: true, kind: 'test' }) } } },
  );
});
