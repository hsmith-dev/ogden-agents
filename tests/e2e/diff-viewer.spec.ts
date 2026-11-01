/// <reference lib="dom" />
/**
 * The diff viewer in a real browser (story 8.3): a fixture build's Review
 * shows each changed file as its own section, the file list jumps to it,
 * and the layout switch shows Inline and Side by side at 1280px with no
 * sideways scroll and no axe violations; at 390px it is Inline with the
 * reason and still no sideways scroll. A chat edit row opens its file's
 * section inline, and the highlighter's code loads only then, never with the
 * first page.
 *
 * Real `git`; a ticket store that reads and writes the plan files (no uv);
 * a fixed sandbox answer; no real `claude`, keychain or network.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BMAD_FILES, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { fixedSandbox } from '../fixtures/fixed-sandbox.ts';
import { createPlanFileTicketStore } from '../fixtures/plan-file-ticket-store.ts';
import { API_ROUTES, serverModule } from '../support.js';
import { send, startChat, withChatServer } from './chat-server.js';
import { expectNoHorizontalOverflow, storedToken } from './tab.js';

const FILES = { ...FAKE_BMAD_FILES, '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n', ...FAKE_BUILD_REPO_FILES };

async function expectNoAxeViolations(page: Page) {
  const axe = await new AxeBuilder({ page }).include('[data-testid="review-changes"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** The built UI's assets, as the server serves them. */
const ASSETS = fileURLToPath(new URL('../../dist/web/assets/', import.meta.url));

/**
 * The highlighter's chunks as the build emits them: `lezer-*.js` and every
 * chunk that imports it (`@lezer/lr` and each grammar, named `dist-*.js`
 * after their packages' files, like some unrelated chunks).
 */
function highlighterChunks(): Set<string> {
  const names = readdirSync(ASSETS).filter((name) => name.endsWith('.js'));
  const core = names.filter((name) => /^lezer-[\w-]+\.js$/.test(name));
  expect(core).toHaveLength(1);
  const grammars = names.filter((name) => name !== core[0] && readFileSync(join(ASSETS, name), 'utf8').includes(`"./${core[0]}"`));
  // @lezer/lr and the nine grammars.
  expect(grammars.length).toBeGreaterThanOrEqual(9);
  return new Set([...core, ...grammars]);
}

/** Every request made for one of the highlighter's chunks. */
const lezerRequests = (page: Page) => {
  const chunks = highlighterChunks();
  const seen: string[] = [];
  page.on('request', (request) => {
    const name = new URL(request.url()).pathname.split('/').pop() ?? '';
    if (chunks.has(name)) seen.push(name);
  });
  return seen;
};

test('Review shows each file in the diff viewer: the list jumps, both layouts fit 1280px, Inline at 390px, no axe violations', async ({ page }) => {
  test.setTimeout(90_000);
  const store = createPlanFileTicketStore([{ ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN }]);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      fixtureGit(repo, 'init', '-q', '--initial-branch=main');
      fixtureGit(repo, 'config', 'core.autocrlf', 'false');
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
      await page.getByRole('button', { name: 'Build this story 1.1' }).click();
      await expect(page.getByTestId('build-run-outcome')).toHaveText('Ready for review', { timeout: 60_000 });

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByTestId('build-run-review').click();
      await expect(page.getByTestId('review-outcome')).toHaveText('Ready for review');
      await page.getByText('Show the code changes (2 files)').click();

      const viewer = page.getByTestId('diff-viewer');
      const sections = viewer.getByTestId('diff-file');
      await expect(sections).toHaveCount(2);
      const built = viewer.locator('[data-diff-file="src/built-1.1.txt"]');
      await expect(built).toContainText('Added');
      await expect(built.getByRole('table', { name: 'Changes in src/built-1.1.txt' })).toContainText('Added line 1: Built 1.1 by the fake agent.');

      // The file list jumps: it moves focus to the file's header and scrolls it into view.
      const list = page.getByTestId('review-files');
      await list.getByRole('button', { name: /src\/built-1\.1\.txt/ }).click();
      await expect(built.getByRole('button', { name: 'src/built-1.1.txt' })).toBeFocused();
      await expect(built).toBeInViewport();

      // Inline at 1280px.
      await expect(viewer).toHaveAttribute('data-layout', 'inline');
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);

      // Side by side at 1280px: the removed and added sides on one row.
      await page.getByTestId('diff-layout-split').click();
      await expect(viewer).toHaveAttribute('data-layout', 'split');
      await expect(built.locator('table')).toHaveAttribute('data-layout', 'split');
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);

      // The choice is remembered; at 390px the viewer is Inline with the reason, and nothing scrolls sideways.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(viewer).toHaveAttribute('data-layout', 'inline');
      await expect(page.getByTestId('diff-layout-narrow')).toHaveText('Side by side needs a wider window.');
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.reload();
      await page.getByText('Show the code changes (2 files)').click();
      await expect(page.getByTestId('diff-viewer')).toHaveAttribute('data-layout', 'split');

      // n / p and j / k move through the open diff.
      const firstHunk = page.locator('[data-diff-nav="hunk"]').first();
      await firstHunk.focus();
      await page.keyboard.press('j');
      await expect(page.locator('[data-diff-nav="line"]').first()).toBeFocused();
      await page.keyboard.press('n');
      await expect(page.locator('[data-diff-nav="hunk"]').nth(1)).toBeFocused();
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }) } },
  );
});

test("a chat edit row opens its file's section inline, and only then loads the highlighter", async ({ page }) => {
  const lezer = lezerRequests(page);
  await withChatServer(page, async ({ repo }) => {
    await startChat(page, repo);
    await send(page, 'tools');
    await expect(page.getByTestId('message-agent')).toContainText('Changed src/a.ts.');
    // The first page and the transcript: no highlighter code.
    expect(lezer).toEqual([]);

    await page.getByTestId('tool-call-group').click();
    await page.getByTestId('tool-call-row').nth(3).getByRole('button').click();
    const detail = page.getByTestId('tool-call-detail');
    const section = detail.getByTestId('diff-file');
    await expect(section).toHaveCount(1);
    await expect(section).toHaveAttribute('data-diff-file', 'src/a.ts');
    await expect(detail.getByTestId('diff-viewer')).toHaveAttribute('data-layout', 'inline');
    await expect(detail.locator('[data-slot="diff-toolbar"]')).toHaveCount(0);
    await expect(detail.getByRole('table', { name: 'Changes in src/a.ts' })).toBeVisible();
    // A TypeScript file: the highlighter loads, and its keywords take the keyword colour.
    await expect.poll(() => lezer.length).toBeGreaterThan(0);
    await expect(detail.locator('[data-mark="added"] .text-syntax-keyword').first()).toHaveText('export');
  });
});
