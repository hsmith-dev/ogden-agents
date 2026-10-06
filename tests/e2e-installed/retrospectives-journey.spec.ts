/// <reference lib="dom" />
/**
 * Epic 7's journey against the installed package, in Chromium (story 7.7):
 * from a finished epic to a lesson the next build carries, using only the UI
 * and the fake agent, on a server of its own started by the installed `ogden`
 * launcher, with its own data folder, home folder and the fake agent. BMad
 * Method comes from the local fixture tarball (the `OGDEN_AGENTS_TEST_BMAD_SOURCE`
 * hook); its real `setup.py` and `tickets.py` run through uv, offline. No real
 * agent, account or keychain. The live checks with Claude Code are the
 * user's (RELEASING.md).
 *
 * 1. A Simple project (every piece off) shows nothing of retrospectives: the
 *    server refuses the look-back route (`feature_off`: the route's guard and
 *    the use-case's own are each proved in the core and server tests) and
 *    nothing is written.
 * 2. Set up from the UI, Board (asking the trust) and Retrospectives on.
 * 3. A finished epic offers "Look back on it?" with Not now (kept across a
 *    reload) and the header's Look back on this epic opens a planning session
 *    on the retrospective skill and the epic's folder; the fake agent writes
 *    the retrospective, its card shows, and the board shows its verdict chip.
 * 4. The card's "Add the lessons to AGENTS.md" opens a session in which the
 *    agent writes the pitfall; "Turn the action items into tickets" opens a
 *    ticket session in which the agent writes a new entry, which reaches the
 *    board (Ogden writes no ticket).
 * 5. Save the lessons for later builds makes one local commit of exactly
 *    AGENTS.md and the retrospective; a worktree made after it carries the
 *    pitfall; a repeat has nothing to save.
 * 6. With Retrospectives off again the board shows no action, offer or
 *    verdict, and the routes refuse with `feature_off`.
 * 7. A plain upstream repo (no ticket tree) with Retrospectives on is in
 *    reduced mode: the look-back is refused with `reduced_mode`, and its
 *    board shows the reduced-mode notice with no Look back button (the
 *    look-back's own sentence, for a board that loads, is in the DOM tests).
 * 8. Quit: the Simple project's repo is unchanged.
 *
 * Skipped outside CI when uv or its managed Python 3.12 is missing (CI
 * provisions both).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { PLAIN_OLDER_FILES } from '../fixtures/bmad-plain/plain-repos.js';
import { API_ROUTES, requestQuit } from '../support.js';
import { send } from '../e2e/chat-server.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { bmadServer, uvReady, waitForExit, type BmadServer, type Launched } from './installed.js';

test.skip(!uvReady(), 'needs uv and its managed Python 3.12 on PATH (CI provides both)');

const servers: BmadServer[] = [];

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  for (const server of servers) {
    try {
      const lines = readFileSync(join(server.install.dataDir, 'logs', 'server.log'), 'utf8').split('\n');
      console.log(lines.filter((line) => /"level":"(warn|error)"/.test(line)).join('\n'));
    } catch {
      // No log yet.
    }
  }
});

test.afterAll(async () => {
  for (const server of servers) await server.remove();
});

const TRUST_TITLE = "Run this project's BMad Method scripts?";
/** A new planning session starts its agent first: on a Windows runner that has taken over 15 s. */
const AGENT_START = { timeout: 60_000 };
/** An agent's write reaching the board: the turn, the watch's debounce and confirming read, then the refetch. */
const LIVE = { timeout: 45_000 };
const EPIC = '_bmad-output/initiative-todo/epic-todo';
const RETRO = `${EPIC}/epic-todo-retrospective.md`;
const PITFALL = 'Run the fake check before you say a fake change is done.';

const plan = (title: string, ticket: number, status: string) => `---\ntitle: "${title}"\ntype: "feature"\nticket: ${ticket}\nstatus: "${status}"\n---\n`;

/** A finished epic: two stories, each `done`. */
const FINISHED: Readonly<Record<string, string>> = {
  '_bmad/custom/config.user.toml': '[core]\nactive_initiative = "initiative-todo"\n',
  '_bmad-output/initiative-todo/tickets.toml': '[[epic]]\nid = 1\nslug = "epic-todo"\ntitle = "The todo list"\n',
  [`${EPIC}/epic-todo.md`]: '---\ntype: epic\ntitle: "The todo list"\nparent: initiative-todo\nafter: []\n---\n\n# The todo list\n',
  [`${EPIC}/tickets.toml`]: '[[entry]]\nid = 1\ntype = "story"\ntitle = "Add a todo"\nafter = []\n\n[[entry]]\nid = 2\ntype = "story"\ntitle = "Tick a todo off"\nafter = [1]\n',
  [`${EPIC}/story-add-a-todo-plan.md`]: plan('Add a todo', 1, 'done'),
  [`${EPIC}/story-tick-a-todo-off-plan.md`]: plan('Tick a todo off', 2, 'done'),
};

const writeFile = (path: string, content: string) => `write-file ${path} ${Buffer.from(content, 'utf8').toString('base64')}`;
const state = (page: Page) => page.getByTestId('session-state');
const switchIn = (page: Page, label: string) => page.getByRole('switch', { name: label, exact: true });
const card = (page: Page, ref: string) => page.locator(`[data-testid="ticket-card"][data-ref="${ref}"]`);

async function api(page: Page, method: string, path: string, body?: unknown): Promise<Response> {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token; connect it first');
  return fetch(`${origin}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function addProject(page: Page, path: string): Promise<string> {
  const response = await api(page, 'POST', API_ROUTES.workspaces, { path });
  if (!response.ok) throw new Error(`POST workspaces returned ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

async function say(page: Page, text: string) {
  const replies = page.getByTestId('message-agent');
  const before = await replies.count();
  await send(page, text);
  await expect(replies).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(state(page)).toHaveAttribute('data-state', 'idle', { timeout: 30_000 });
}

const lookBackPath = (wsId: string) => apiPath(API_ROUTES.workspaceEpicLookBack, { wsId, epic: 'epic-todo' });
const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

async function quit(page: Page, launched: Launched) {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
}

test('from a finished epic to a lesson the next build carries, on the installed package', async ({ page }) => {
  test.setTimeout(420_000);
  const server = bmadServer('journey-retrospectives', { bmadSource: true });
  servers.push(server);
  const simple = server.addRepo({ bmad: false, prefix: 'simple-repo-' });
  const project = server.addRepo({ bmad: false, prefix: 'retro-repo-' });
  const plain = server.addRepo({ bmad: false, files: PLAIN_OLDER_FILES, prefix: 'plain-older-' });
  const simpleHash = simple.hash();
  // No hook of the machine's own git config runs, and no signing: only the fixture's own commits.
  const noHooks = join(server.home, 'no-hooks');
  mkdirSync(noHooks, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', `core.hooksPath=${noHooks}`, '-c', 'commit.gpgsign=false', ...args], { cwd: project.path, encoding: 'utf8' });

  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  const url = launched.url;

  await test.step('a Simple project shows nothing of retrospectives: the look-back is refused and nothing is written', async () => {
    const simpleId = await addProject(page, simple.path);
    await page.goto(`${url}/w/${simpleId}`);
    await expect(page.getByTestId('workspace-tabs').getByRole('link')).toHaveText(['Chats']);
    // The guard comes first (AD-22).
    const refused = await api(page, 'POST', lookBackPath(simpleId));
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe('feature_off');
    expect(simple.hash()).toBe(simpleHash);
  });

  const wsId = await addProject(page, project.path);

  await test.step('set up from the UI, then Board (asking the trust) and Retrospectives on', async () => {
    await page.goto(`${url}/w/${wsId}/settings`);
    await switchIn(page, 'Planning').click();
    await expect(page.getByTestId('bmad-setup-done')).toHaveText('Ready to plan.', { timeout: 120_000 });
    const board = switchIn(page, 'Board');
    await board.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(TRUST_TITLE);
    await page.getByTestId('script-trust-confirm').click();
    await expect(board).toHaveAttribute('aria-checked', 'true');
    await expect(board).toBeEnabled();
    const retros = switchIn(page, 'Retrospectives');
    await expect(retros).toBeEnabled();
    await retros.click();
    await expect(retros).toHaveAttribute('aria-checked', 'true');
    await expect(retros).toBeEnabled();
  });

  await test.step('the finished epic is committed with an AGENTS.md', async () => {
    for (const [path, content] of Object.entries({ ...FINISHED, 'AGENTS.md': '# Project instructions\n\n- Keep it small.\n' })) {
      const file = join(project.path, ...path.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    git('init', '--quiet', '--initial-branch=main');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.com');
    git('config', 'core.autocrlf', 'false');
    git('add', '-A');
    git('commit', '--quiet', '--no-verify', '-m', 'The finished epic');
    expect(git('status', '--porcelain').trim()).toBe('');
  });

  let lookBackUrl = '';
  await test.step('the offer, Not now across a reload, the look-back, the retrospective card and its verdict chip', async () => {
    await page.goto(`${url}/w/${wsId}/board`);
    await expect(page.getByTestId('ticket-card')).toHaveCount(2, { timeout: 60_000 });
    const offer = page.getByTestId('board-look-back-offer');
    await expect(offer).toContainText('Every ticket in this epic is done. Look back on it?');
    await page.getByTestId('board-look-back-dismiss').click();
    await expect(offer).toHaveCount(0);
    // The offer waits for the server's answer, so wait for it before saying the offer stays hidden.
    const offersRead = page.waitForResponse((response) => response.url().includes('/look-back-offers') && response.request().method() === 'GET');
    await page.reload();
    await offersRead;
    await expect(page.getByTestId('board-look-back')).toHaveText('Look back on this epic');
    await expect(page.getByTestId('board-look-back-offer')).toHaveCount(0);

    await page.getByTestId('board-look-back').click();
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
    lookBackUrl = page.url();
    await expect(page.getByTestId('message-user').first()).toHaveText(`/bmad-retrospective ${EPIC}`, AGENT_START);
    const retro = page.getByTestId('document-card');
    await expect(retro).toHaveAttribute('data-path', RETRO, AGENT_START);
    await expect(retro.getByTestId('retrospective-step')).toHaveText(['Add the lessons to AGENTS.md', 'Turn the action items into tickets'], AGENT_START);
    expect(existsSync(join(project.path, ...RETRO.split('/')))).toBe(true);

    await page.goto(`${url}/w/${wsId}/board`);
    await expect(page.getByTestId('board-retrospective-verdict')).toHaveText('Accepted with open items, 2026-10-05', LIVE);
  });

  await test.step('the lessons go into AGENTS.md through the agent, and an action item becomes a ticket the agent writes', async () => {
    await page.goto(lookBackUrl);
    await page.getByTestId('retrospective-step').first().click();
    await expect(page.getByTestId('message-user').first()).toHaveText(`/bmad-project-context ${RETRO}`, AGENT_START);
    await expect.poll(() => readFileSync(join(project.path, 'AGENTS.md'), 'utf8'), AGENT_START).toContain(PITFALL);

    await page.goto(lookBackUrl);
    await page.getByTestId('retrospective-step').nth(1).click();
    await expect(page.getByTestId('message-user').first()).toHaveText(`/bmad-ticket ${RETRO}`, AGENT_START);
    await expect(state(page)).toHaveAttribute('data-state', 'idle', AGENT_START);
    // The agent (not Ogden Agents) writes the new entry; the board shows it.
    await say(
      page,
      writeFile(`${EPIC}/tickets.toml`, `${FINISHED[`${EPIC}/tickets.toml`]}\n[[entry]]\nid = 3\ntype = "story"\ntitle = "Check the fake thing"\nafter = []\n`),
    );
    await page.goto(`${url}/w/${wsId}/board`);
    await expect(page.getByTestId('ticket-card')).toHaveCount(3, LIVE);
    await expect(card(page, '1.3')).toHaveAttribute('data-column', 'draft');
  });

  await test.step('Save the lessons for later builds: one local commit of exactly AGENTS.md and the retrospective, which the next worktree carries', async () => {
    const before = git('rev-parse', 'HEAD').trim();
    await page.goto(lookBackUrl);
    await page.getByTestId('retrospective-save').click();
    await expect(page.getByTestId('retrospective-save-note')).toHaveText('Saved. Later builds will follow these lessons.', AGENT_START);
    expect(git('rev-list', '--count', `${before}..HEAD`).trim()).toBe('1');
    expect(git('show', '--name-only', '--pretty=format:', 'HEAD').split('\n').filter(Boolean).sort()).toEqual(['AGENTS.md', RETRO].sort());
    // The agent's new ticket entry stays uncommitted: only the two paths were committed.
    const left = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).map((line) => line.slice(3));
    expect(left).toContain(`${EPIC}/tickets.toml`);
    expect(left).not.toContain('AGENTS.md');
    expect(left).not.toContain(RETRO);
    // The commit holds the pitfall, so a worktree made from it carries it (that Ogden's runner branches from the checkout's last commit, and that approve tolerates an unsaved AGENTS.md, are proved in the core tests of epic 5 and story 7.5; the real build is a live check).
    // Under the server's own folder, which the suite's teardown removes.
    const worktree = join(server.home, 'next-build-worktree');
    rmSync(worktree, { recursive: true, force: true });
    git('worktree', 'add', '-q', worktree, 'HEAD');
    try {
      expect(readFileSync(join(worktree, 'AGENTS.md'), 'utf8')).toContain(PITFALL);
    } finally {
      git('worktree', 'remove', '--force', worktree);
    }
    await page.getByTestId('retrospective-save').click();
    await expect(page.getByTestId('retrospective-error')).toHaveText('There is nothing new to save: the lessons are already saved.');
  });

  await test.step('with Retrospectives off again the board shows none of it, and the routes refuse', async () => {
    expect((await api(page, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['planning', 'board'] })).ok).toBe(true);
    await page.goto(`${url}/w/${wsId}/board`);
    await expect(page.getByTestId('ticket-card')).toHaveCount(3, LIVE);
    await expect(page.getByTestId('board-look-back')).toHaveCount(0);
    await expect(page.getByTestId('board-look-back-offer')).toHaveCount(0);
    await expect(page.getByTestId('board-retrospective-verdict')).toHaveCount(0);
    expect(await errorCode(await api(page, 'POST', lookBackPath(wsId)))).toBe('feature_off');
    expect(await errorCode(await api(page, 'POST', apiPath(API_ROUTES.workspaceRetrospectiveSave, { wsId, epic: 'epic-todo' })))).toBe('feature_off');
    expect(await errorCode(await api(page, 'GET', apiPath(API_ROUTES.workspaceLookBackOffers, { wsId })))).toBe('feature_off');
    // Nothing was written for it: the checkout holds only the agent's own ticket entry.
    expect(git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).map((line) => line.slice(3))).toEqual([`${EPIC}/tickets.toml`]);
  });

  await test.step('a plain upstream repo (no ticket tree) is in reduced mode: the look-back is refused', async () => {
    const plainId = await addProject(page, plain.path);
    expect((await api(page, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: plainId }), { bmadPieces: ['planning', 'board', 'retrospectives'] })).ok).toBe(true);
    expect((await api(page, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: plainId }))).ok).toBe(true);
    const refused = await api(page, 'POST', apiPath(API_ROUTES.workspaceEpicLookBack, { wsId: plainId, epic: 'epic-todo' }));
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe('reduced_mode');
    await page.goto(`${url}/w/${plainId}/board`);
    await expect(page.getByTestId('board-look-back')).toHaveCount(0);
    await expect(page.getByTestId('reduced-mode-notice')).toBeVisible();
  });

  await test.step('quit: the Simple project is unchanged', async () => {
    await quit(page, launched);
    expect(simple.hash()).toBe(simpleHash);
  });
});
