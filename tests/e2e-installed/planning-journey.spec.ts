/// <reference lib="dom" />
/**
 * Epic 4's journey against the installed package, in Chromium (story 4.13):
 * from a project with BMad Method off to a ticketed epic on a live board,
 * using only the UI and the fake agent, on a server of its own started by the
 * installed `ogden` launcher, with its own data folder, home folder and the
 * fake agent. BMad Method comes from a local fixture tarball through the
 * `OGDEN_AGENTS_TEST_BMAD_SOURCE` hook (the upstream fixture plus a test-only
 * spec skill, checked against a fixture lock's hash), and its real `setup.py`
 * and `tickets.py` run through uv with the provisioned Python, offline: no
 * network, no real agent, account or keychain.
 *
 * 1. BMad off: a project added with every piece off shows Chats only, `g b`
 *    does nothing, Plan says the feature is off, the server refuses its
 *    catalog (`feature_off`; with the AD-22 guard removed, this fails), and
 *    nothing is written.
 * 2. Set up from the UI: Planning on in an empty repo sets BMad Method up with
 *    its steps, then "Ready to plan."; `_bmad/` and the skills are written,
 *    from the fixture (the hook is in use, the source is its commit).
 * 3. Trust: turning Board on asks to run the project's scripts; Cancel leaves
 *    it off, Allow turns it on.
 * 4. Plan: Start from an idea opens a planning session whose first message
 *    invokes the entry action with the idea.
 * 5. Document cards: the brief the agent writes shows a card with Open and
 *    "Turn this brief into a spec"; the spec's card offers "Turn this spec
 *    into tickets", which opens the ticket session on the spec.
 * 6. The agent writes a ticket tree; the board shows its cards. An agent's
 *    plan-file write moves a card live, highlighted (with the
 *    `ticket.changed` emit removed, this step fails).
 * 7. Status from the board: Move to In progress lands in the plan file; a Done
 *    ticket moves out only after "Reopen this ticket?".
 * 8. Scripts changed after the trust (a planted `config_utils.py`): the
 *    Board runs nothing and asks again ("…scripts changed. Run them?");
 *    allowed, they run. A module copied in while the server runs shows on
 *    Plan, with New.
 * 9. Reduced mode: a plain upstream repo with Board on but not trusted is
 *    refused (409 `scripts_not_trusted`) and its Board asks for the trust
 *    (with the trust gate removed, this step fails); trusted, its Plan shows
 *    the notice, and Upgrade this project ends with it gone.
 * 10. Quit: the BMad-off repo is unchanged.
 *
 * Skipped outside CI when uv or its managed Python 3.12 is missing (CI
 * provisions both).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { PLAIN_OLDER_FILES } from '../fixtures/bmad-plain/plain-repos.js';
import { FIXTURE_COMMIT } from '../fixtures/bmad-upstream-source.js';
import { API_ROUTES, requestQuit } from '../support.js';
import { send } from '../e2e/chat-server.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { bmadServer, uvReady, waitForExit, type BmadServer, type Launched } from './installed.js';

test.skip(!uvReady(), 'needs uv and its managed Python 3.12 on PATH (CI provisions both)');

const servers: BmadServer[] = [];

test.afterEach(async ({}, testInfo) => {
  // On a failure, the server's warnings (codes only: the log never holds a path or a secret) say what failed inside it.
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

/** The trust dialog's title (`SCRIPT_TRUST_TITLE`; `planning-setup.ts` has imports this runner can't load). */
const TRUST_TITLE = "Run this project's BMad Method scripts?";
/** The prompt's title when they changed since (`SCRIPT_TRUST_CHANGED_TITLE`, story 4.13). */
const SCRIPTS_CHANGED_TITLE = "This project's BMad Method scripts changed. Run them?";
/** Plan's reduced-mode notice when the project's skills have no plain labels (entry 4.11). */
const PLAIN_LABELS_TEXT = "This project's BMad Method has actions Ogden Agents doesn't know";
const IDEA = 'A shared todo list for my family';
/** A new planning session starts its agent first: on a Windows runner that has taken over 15 s. */
const AGENT_START = { timeout: 60_000 };
/**
 * An agent's write reaching the board: the agent's turn, the watch's debounce and confirming read, then the
 * refetch. A loaded Windows runner once took over 15 s (CI run 37211439697; no read or watch failed).
 */
const LIVE = { timeout: 45_000 };
/**
 * The board's own write reaching a card: no optimistic move, so `tickets.py mark` and then the tickets' refetch,
 * two `uv` runs in a row. A loaded Windows runner took 7.9 s and 8.7 s for them (CI run 37247699282).
 */
const BOARD_WRITE = { timeout: 45_000 };
const BRIEF = '_bmad-output/briefs/brief-todo.md';
const SPEC = '_bmad-output/specs/spec-todo.md';
const EPIC = '_bmad-output/initiative-todo/epic-todo';

/** The ticket tree the agent writes: the active initiative, one epic of two stories (1.2 after 1.1), and 1.1's plan (in progress). */
const TREE: Readonly<Record<string, string>> = {
  '_bmad/custom/config.user.toml': '[core]\nactive_initiative = "initiative-todo"\n',
  '_bmad-output/initiative-todo/tickets.toml': '[[epic]]\nid = 1\nslug = "epic-todo"\ntitle = "The todo list"\n',
  [`${EPIC}/epic-todo.md`]: '---\ntype: epic\ntitle: "The todo list"\nparent: initiative-todo\nafter: []\n---\n\n# The todo list\n',
  [`${EPIC}/tickets.toml`]: '[[entry]]\nid = 1\ntype = "story"\ntitle = "Add a todo"\nafter = []\n\n[[entry]]\nid = 2\ntype = "story"\ntitle = "Tick a todo off"\nafter = [1]\n',
  [`${EPIC}/story-add-a-todo-plan.md`]: plan('Add a todo', 1, 'in-progress'),
};

function plan(title: string, ticket: number, status: string): string {
  return `---\ntitle: "${title}"\ntype: "feature"\nticket: ${ticket}\nstatus: "${status}"\n---\n`;
}

/** The fake agent's command that writes `content` at `path` (inside the session's folder). */
const writeFile = (path: string, content: string) => `write-file ${path} ${Buffer.from(content, 'utf8').toString('base64')}`;

const state = (page: Page) => page.getByTestId('session-state');
const switchIn = (page: Page, label: string) => page.getByRole('switch', { name: label, exact: true });
const card = (page: Page, ref: string) => page.locator(`[data-testid="ticket-card"][data-ref="${ref}"]`);

/** A request to the server with the tab's own token, as the page makes it. */
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

/** Adds the project at `path` through the REST API (the app-wide default applies: every piece off); its id. */
async function addProject(page: Page, path: string): Promise<string> {
  const response = await api(page, 'POST', API_ROUTES.workspaces, { path });
  if (!response.ok) throw new Error(`POST workspaces returned ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

/** Sends `text` in the open session and waits for the turn to end. */
async function say(page: Page, text: string) {
  const replies = page.getByTestId('message-agent');
  const before = await replies.count();
  await send(page, text);
  await expect(replies).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(state(page)).toHaveAttribute('data-state', 'idle', { timeout: 30_000 });
}

/** Sends `text` to a session through the REST API (the page stays where it is), as another tab would. */
async function sayThroughApi(page: Page, wsId: string, sesId: string, text: string) {
  const response = await api(page, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text });
  expect(response.status).toBe(202);
}

/** The text of every plan file in the epic folder whose frontmatter names ticket `id`. */
function planOf(repo: string, id: number): string {
  const folder = join(repo, ...EPIC.split('/'));
  for (const name of readdirSync(folder)) {
    if (!name.endsWith('.md')) continue;
    const text = readFileSync(join(folder, name), 'utf8');
    if (new RegExp(`^ticket: "?${id}"?$`, 'm').test(text)) return text;
  }
  return '';
}

/** Quits the server as the UI does, and waits for its process to exit. */
async function quit(page: Page, launched: Launched) {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
}

test('from BMad off to a ticketed epic on a live board, on the installed package', async ({ page }) => {
  // A real setup and Upgrade through uv, three planning sessions and a board.
  test.setTimeout(420_000);
  const server = bmadServer('journey-planning', { bmadSource: true });
  servers.push(server);
  const off = server.addRepo({ bmad: false, prefix: 'off-repo-' });
  const empty = server.addRepo({ bmad: false, prefix: 'empty-repo-' });
  const plain = server.addRepo({ bmad: false, files: PLAIN_OLDER_FILES, prefix: 'plain-older-' });
  const offHash = off.hash();

  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  const url = launched.url;

  await test.step('BMad off: Chats only, no Plan or Board, and nothing written', async () => {
    const offId = await addProject(page, off.path);
    await page.goto(`${url}/w/${offId}/plan`);
    await expect(page.getByTestId('plan-feature-off')).toContainText('off in this project');
    await expect(page.getByTestId('workspace-tabs').getByRole('link')).toHaveText(['Chats']);
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    await expect(page).toHaveURL(new RegExp(`/w/${offId}/plan$`));
    // The server refuses Plan's catalog while Planning is off (AD-22; with the guard removed, this fails).
    const refused = await api(page, 'GET', apiPath(API_ROUTES.workspaceCatalog, { wsId: offId }));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('feature_off');
    expect(existsSync(join(off.path, '_bmad'))).toBe(false);
    expect(off.hash()).toBe(offHash);
  });

  const wsId = await addProject(page, empty.path);

  await test.step('set up from the UI: Planning on in an empty repo, its steps, then Ready to plan.', async () => {
    await page.goto(`${url}/w/${wsId}/settings`);
    const planning = switchIn(page, 'Planning');
    await planning.click();
    await expect(planning).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('bmad-setup-steps')).toBeVisible();
    await expect(page.getByTestId('bmad-setup-done')).toHaveText('Ready to plan.', { timeout: 120_000 });
    expect(existsSync(join(empty.path, '_bmad', 'config.toml'))).toBe(true);
    expect(existsSync(join(empty.path, '.claude', 'skills', 'bmad-spec', 'SKILL.md'))).toBe(true);
    // It came from the local fixture, never GitHub: the server says the hook is in use, and the source is the fixture's commit.
    const log = readFileSync(join(server.install.dataDir, 'logs', 'server.log'), 'utf8');
    expect(log).toMatch(/"msg":"test hooks in use".*"bmadSource":true/);
    expect(await (await api(page, 'GET', API_ROUTES.bmadSource)).text()).toContain(FIXTURE_COMMIT);
  });

  await test.step("turning Board on asks to trust the project's scripts: Cancel leaves it off, Allow turns it on", async () => {
    const board = switchIn(page, 'Board');
    await board.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(TRUST_TITLE);
    await page.getByTestId('script-trust-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(board).toHaveAttribute('aria-checked', 'false');
    await board.click();
    await expect(dialog).toContainText(TRUST_TITLE);
    await page.getByTestId('script-trust-confirm').click();
    await expect(dialog).toHaveCount(0);
    await expect(board).toHaveAttribute('aria-checked', 'true');
    // On is shown at once (optimistic); the switch is disabled until the save lands. Leaving the page before that
    // aborts the PATCH (Windows CI runs 37247766553 and 37247659244: Plan then had no Board tab).
    await expect(board).toBeEnabled();
  });

  await test.step('Plan: Start from an idea opens a planning session on the entry action', async () => {
    await page.goto(`${url}/w/${wsId}/plan`);
    await expect(page.getByTestId('workspace-tabs').getByRole('link')).toHaveText(['Chats', 'Plan', 'Board']);
    await expect(page.getByTestId('reduced-mode-notice')).toHaveCount(0);
    const input = page.getByLabel('Your idea', { exact: true });
    await input.fill(IDEA);
    await input.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
    await expect(page.getByTestId('message-user').first()).toHaveText(`/bmad-product-brief ${IDEA}`, AGENT_START);
    await expect(page.getByTestId('message-agent').first()).toContainText(`command=/bmad-product-brief ${IDEA}`, AGENT_START);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
  });

  await test.step('document cards: the brief, then the spec, each with Open and its next step, up to the ticket session', async () => {
    await say(page, `write-doc ${BRIEF}`);
    const brief = page.getByRole('region', { name: 'Document brief-todo.md' });
    await expect(brief.getByRole('button', { name: 'Open' })).toBeVisible();
    await brief.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('dialog', { name: 'brief-todo.md' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await brief.getByRole('button', { name: 'Turn this brief into a spec' }).click();
    await expect(page.getByTestId('message-user').first()).toHaveText(`/bmad-spec ${BRIEF}`, AGENT_START);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');

    await say(page, `write-doc ${SPEC}`);
    const spec = page.getByRole('region', { name: 'Document spec-todo.md' });
    await expect(spec.getByRole('button', { name: 'Open' })).toBeVisible();
    await spec.getByRole('button', { name: 'Turn this spec into tickets' }).click();
    await expect(page.getByTestId('message-user').first()).toHaveText(`/bmad-ticket ${SPEC}`, AGENT_START);
    await expect(page.getByTestId('message-agent').first()).toContainText(`command=/bmad-ticket ${SPEC}`, AGENT_START);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
  });

  // The ticket session, for the agent's later writes.
  const ticketSession = /\/s\/(ses_[0-9A-Z]+)$/.exec(page.url())![1]!;

  await test.step('the agent writes the tickets; the board shows them, and a plan it writes moves a card live', async () => {
    for (const [path, content] of Object.entries(TREE)) await say(page, writeFile(path, content));
    await page.goto(`${url}/w/${wsId}/board`);
    await expect(page.getByTestId('ticket-card')).toHaveCount(2, { timeout: 30_000 });
    await expect(card(page, '1.1')).toHaveAttribute('data-column', 'in_progress');
    await expect(card(page, '1.2')).toHaveAttribute('data-column', 'draft');

    // The agent, in its session, writes 1.2's plan as ready: the watcher's ticket.changed moves the card here.
    await sayThroughApi(page, wsId, ticketSession, writeFile(`${EPIC}/story-tick-a-todo-off-plan.md`, plan('Tick a todo off', 2, 'ready-for-dev')));
    await expect(card(page, '1.2')).toHaveAttribute('data-column', 'ready', LIVE);
    await expect(card(page, '1.2')).toHaveAttribute('data-highlighted', 'true');
    // Ready, but 1.1 is still in progress.
    await expect(card(page, '1.2')).toContainText('Waits for 1.1');
  });

  await test.step('status from the board: Move to In progress lands in the plan file; Done reopens only after confirming', async () => {
    await page.getByRole('button', { name: 'Change status of 1.2 Tick a todo off' }).click();
    await page.getByRole('menuitem', { name: 'Move to In progress' }).click();
    await expect(card(page, '1.2')).toHaveAttribute('data-column', 'in_progress', BOARD_WRITE);
    await expect.poll(() => planOf(empty.path, 2)).toMatch(/^status: "?in-progress"?$/m);

    // The agent marks 1.1 done (Ogden never offers Done).
    await sayThroughApi(page, wsId, ticketSession, writeFile(`${EPIC}/story-add-a-todo-plan.md`, plan('Add a todo', 1, 'done')));
    await expect(card(page, '1.1')).toHaveAttribute('data-column', 'done', LIVE);
    await page.getByRole('button', { name: 'Change status of 1.1 Add a todo' }).click();
    await expect(page.getByRole('menuitem', { name: 'Move to Done' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Move to Ready' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Reopen this ticket?' });
    await expect(confirm).toContainText('It moves to Ready');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(card(page, '1.1')).toHaveAttribute('data-column', 'done');
    expect(planOf(empty.path, 1)).toMatch(/^status: "?done"?$/m);

    await page.getByRole('button', { name: 'Change status of 1.1 Add a todo' }).click();
    await page.getByRole('menuitem', { name: 'Move to Ready' }).click();
    await confirm.getByRole('button', { name: 'Reopen' }).click();
    await expect(card(page, '1.1')).toHaveAttribute('data-column', 'ready', BOARD_WRITE);
    await expect.poll(() => planOf(empty.path, 1)).toMatch(/^status: "?ready-for-dev"?$/m);
  });

  await test.step("scripts changed after the trust (story 4.13): the Board doesn't run them and asks again; allowed, they run", async () => {
    const marker = join(server.home, 'planted-ran');
    const script = join(empty.path, '_bmad', 'scripts', 'config_utils.py');
    // Appended: the real script starts with a `from __future__` import, which must stay first.
    writeFileSync(script, `${readFileSync(script, 'utf8')}\nopen(${JSON.stringify(marker)}, "w").write("ran")\n`);
    // A watch read the last step's mark set off may have passed its check just before the plant and still be
    // running (the check-then-run window, logged in deferred-work.md): let it end, then count only what follows.
    await page.waitForTimeout(4_000);
    rmSync(marker, { force: true });
    await page.goto(`${url}/w/${wsId}/board`);
    const prompt = page.getByTestId('script-trust-prompt');
    await expect(prompt).toHaveAttribute('data-changed', 'true');
    await expect(prompt).toContainText(SCRIPTS_CHANGED_TITLE);
    await expect(page.getByTestId('ticket-card')).toHaveCount(0);
    expect(existsSync(marker)).toBe(false);
    await page.getByTestId('script-trust-allow').click();
    await expect(page.getByTestId('ticket-card')).toHaveCount(2, BOARD_WRITE);
    expect(existsSync(marker)).toBe(true);
  });

  await test.step('a module copied in while the server runs shows on Plan, with New', async () => {
    const files: Record<string, string> = {
      '.claude/skills/bmod-extra/bmod.toml': '[bmod]\ncode = "extra"\nversion = "1.0.0"\nskills = ["extra-helper"]\n',
      '.claude/skills/bmod-extra/SKILL.md': "---\nname: bmod-extra\ndescription: 'The extra module.'\n---\n",
      '.claude/skills/extra-helper/SKILL.md': "---\nname: extra-helper\ndescription: 'Help with the extra things.'\n---\n",
    };
    for (const [path, content] of Object.entries(files)) {
      const file = join(empty.path, ...path.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    await page.goto(`${url}/w/${wsId}/plan`);
    await expect(page.locator('[data-skill="extra-helper"]')).toContainText('Help with the extra things.');
    await expect(page.locator('[data-skill="extra-helper"]').getByTestId('skill-new')).toHaveText('New');
  });

  await test.step('trust and reduced mode: an untrusted Board is refused and asks; a plain upstream repo shows the notice, and Upgrade ends with it gone', async () => {
    const plainId = await addProject(page, plain.path);
    expect((await api(page, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: plainId }), { bmadPieces: ['planning', 'board'] })).ok).toBe(true);
    // Not trusted yet: the server refuses to run the project's scripts, and the Board asks (with the trust gate removed, this fails).
    const refused = await api(page, 'GET', apiPath(API_ROUTES.workspaceTickets, { wsId: plainId }));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('scripts_not_trusted');
    await page.goto(`${url}/w/${plainId}/board`);
    await expect(page.getByTestId('script-trust-prompt')).toContainText(TRUST_TITLE);
    expect((await api(page, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: plainId }))).ok).toBe(true);
    await page.goto(`${url}/w/${plainId}/plan`);
    const notice = page.getByTestId('reduced-mode-notice');
    await expect(notice).toContainText(PLAIN_LABELS_TEXT);
    await notice.getByRole('button', { name: 'Upgrade this project' }).click();
    await page.getByRole('alertdialog', { name: 'Upgrade this project?' }).getByRole('button', { name: 'Upgrade', exact: true }).click();
    await expect(notice).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByLabel('Your idea', { exact: true })).toBeVisible();
  });

  await test.step('quit: the BMad-off repo is unchanged', async () => {
    await quit(page, launched);
    expect(off.hash()).toBe(offHash);
  });
});
