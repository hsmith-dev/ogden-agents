/// <reference lib="dom" />
/**
 * Plain titles and no dead ends in a real browser (26.6, E26-R6): a build
 * session is titled "Build 1.1: <ticket title>" on its sidebar row and in its
 * header, never the skill command; a Runs row opens its run when the row
 * itself is clicked; the Board's epic heading names the epic; the review
 * page has its own current tab and Board is not current. (The pane header's
 * named icon buttons are in panes.spec.ts.)
 *
 * Real `git`; a ticket store that reads and writes the plan files (no uv); a
 * fixed sandbox answer; no real `claude`, keychain or network.
 */
import { expect, test } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BMAD_FILES, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, FAKE_BUILD_WAITING_PLAN, fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { fixedSandbox } from '../fixtures/fixed-sandbox.ts';
import { createPlanFileTicketStore } from '../fixtures/plan-file-ticket-store.ts';
import { API_ROUTES, serverModule } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const EPIC = 'epic-clay-bookings';
const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN, epic: EPIC },
  { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN, after: [1], epic: EPIC },
];
const FILES = { ...FAKE_BMAD_FILES, '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n', ...FAKE_BUILD_REPO_FILES };

async function prepare(page: import('@playwright/test').Page, repo: string) {
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
  return { call, wsId };
}

type Started = { run: { id: string }; session: { id: string } };

test('a build is titled by its ticket, its Runs row opens it, the epic heading names the epic and Review has its own tab', async ({ page }) => {
  test.setTimeout(120_000);
  const store = createPlanFileTicketStore(TICKETS, { epics: [{ slug: EPIC, id: 1 }] });
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      const started = (await (await call('POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1' })).json()) as Started;
      const runUrl = new RegExp(`/w/${wsId}/s/${started.session.id}$`);

      // The build session's name: on its sidebar row and in its header, never the skill command.
      await page.goto(`${server.url}/w/${wsId}/s/${started.session.id}`);
      await expect(page.getByTestId('page-title')).toHaveText('Build 1.1: Build the thing');
      const sidebarRow = page.getByTestId('status-sidebar').locator(`a[href$="/s/${started.session.id}"]`);
      await expect(sidebarRow).toContainText('Build 1.1: Build the thing');
      await expect(page.getByTestId('status-sidebar')).not.toContainText('bmad-build-auto');

      // A Runs row opens its run from the row itself (its phase badge), not only from its button.
      await page.goto(`${server.url}/w/${wsId}/runs`);
      const row = page.locator('[data-testid="run-row"][data-ref="1.1"]');
      await expect(row.getByTestId('run-row-link')).toHaveAccessibleName('Open the build 1.1 Build the thing');
      // The stretched link lies over the badge, so the click lands where the badge is drawn (Playwright's own click would refuse it).
      const badge = (await row.getByTestId('run-row-phase').boundingBox())!;
      await page.mouse.click(badge.x + badge.width / 2, badge.y + badge.height / 2);
      await expect(page).toHaveURL(runUrl);
      // Its buttons keep their own targets: they sit above the row's link.
      await page.goBack();
      await expect(row).toBeVisible();
      await expect(row.getByTestId('run-row-open')).toHaveAttribute('href', new RegExp(`/s/${started.session.id}$`));

      // The Board's epic heading names the epic.
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.locator(`[data-testid="board-epic"][data-epic="${EPIC}"] h2`)).toHaveText('Epic 1: Clay bookings');

      // The review page has its own current tab; Board is not current.
      await page.goto(`${server.url}/w/${wsId}/review/1.1`);
      const review = page.getByTestId('workspace-tab-review');
      await expect(review).toHaveText('Review 1.1');
      await expect(review).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('workspace-tab-board')).not.toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('workspace-tabs').locator('[aria-current="page"]')).toHaveCount(1);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }) } },
  );
});
