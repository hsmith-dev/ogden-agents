/// <reference lib="dom" />
/**
 * Epic 27's where work runs against the installed package, in Chromium
 * (story 27.10), on a server of its own started by the installed `ogden`
 * launcher, with its own data folder, home folder, the fake agent (Claude
 * Code, and Codex through the fake's Codex personality), a fake git repo and
 * the in-memory remote host (the `OGDEN_AGENTS_TEST_REMOTE_HOST` hook):
 *
 * 1. A Worktree chat from the composer: its branch badge, and its port
 *    reaching the fake agent as `PORT`.
 * 2. The agent edits; Commit these changes commits it on the chat's branch.
 * 3. A second edit, uncommitted: Move to this folder carries it (a divider),
 *    the branch with its commit kept; Move to its own worktree reuses that
 *    branch and carries the edit back.
 * 4. Delete chat lists the copy's ignored `.env`, never its `node_modules/`;
 *    the branch with its commit is kept.
 * 5. With the cap at 1, a second worktree chat puts the older idle one away
 *    (branch kept); Restore brings its file back, and the other is put away.
 * 6. Try with several agents: Claude Code and Codex side by side, each in
 *    its own copy; Keep this one, the other put away, then restored.
 * 7. A remote machine on the fake remote host: with the Local model chosen
 *    the Location menu's machine is disabled with the Local model's reason;
 *    with the machine picked first, a Local model send is refused and makes
 *    no chat.
 *
 * No real agent, SSH, key, keychain or network. The server is quit at the
 * end, and its folders removed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { TRIAL_KEPT_TEXT, TRIAL_NOT_KEPT_TEXT, WORKTREE_PUT_AWAY_TEXT } from '../../packages/shared/src/where-work-runs.ts';
import { API_ROUTES, requestQuit, ROOT } from '../support.js';
import { tabRest } from '../e2e/chat-server.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { bmadServer, waitForExit, type BmadServer, type Launched } from './installed.js';

const servers: BmadServer[] = [];

test.afterAll(async () => {
  for (const server of servers) await server.remove();
});

/** An agent's reply, a turn's end, a copy made or put away: Windows runners take far longer than the default. */
const SLOW = { timeout: 60_000 };

/** The Local model's refusal of a remote chat (`LOCAL_ONLY_REASON`), read from its source so the two never drift. */
const LOCAL_ONLY_REASON = (() => {
  const file = join(ROOT, 'packages', 'adapters', 'src', 'acp-opencode', 'opencode-agent.ts');
  const found = /export const LOCAL_ONLY_REASON = '([^']+)';/.exec(readFileSync(file, 'utf8'))?.[1];
  if (found === undefined) throw new Error(`${file}: no \`export const LOCAL_ONLY_REASON = '...';\` line to read the Local model's reason from`);
  return found;
})();

interface SessionBody {
  session: { id: string; worktreePath: string | null; branch: string | null };
}

const idle = (page: Page) => expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle', SLOW);
const composer = (page: Page, agent = 'Claude Code') => page.getByRole('textbox', { name: `Message ${agent}` });
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** Sends `text` in the open chat and waits for the agent's reply to hold `reply` and the turn to end. */
async function say(page: Page, text: string, reply: string) {
  await idle(page);
  await composer(page).fill(text);
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('', SLOW);
  await expect(page.getByTestId('message-agent').last()).toContainText(reply, SLOW);
  await idle(page);
}

/** Quits the server as the UI does, and waits for its process to exit. */
async function quit(page: Page, launched: Launched) {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
}

test('a Worktree chat with its port, a commit, Move to this folder and back, Delete chat, retention and Restore, Try with several agents, and a remote machine, on the installed package', async ({ page }) => {
  test.setTimeout(480_000);
  const server = bmadServer('journey-where-work-runs', { codex: true, env: { OGDEN_AGENTS_TEST_REMOTE_HOST: 'memory' } });
  servers.push(server);
  const repo = server.addRepo({ bmad: false, git: true, prefix: 'where-work-runs-', files: { 'README.md': '# Shop\n' } }).path;
  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  const call = await tabRest(page);
  const wsId = (await call<{ workspace: { id: string } }>('POST', API_ROUTES.workspaces, { path: repo })).workspace.id;
  const at = (path: string) => new URL(path, launched.url).href;
  const session = async (sesId: string) => (await call<SessionBody>('GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId }))).session;

  /** Starts a worktree chat from the composer with `text`; waits for `reply`; its id, copy and branch. */
  async function worktreeChat(text: string, reply: string) {
    await page.goto(at(`/w/${wsId}/new`));
    await page.getByTestId('location-chip').click();
    await page.getByTestId('location-worktree').click();
    await expect(page.getByTestId('location-chip')).toHaveAttribute('data-location', 'worktree');
    await composer(page).fill(text);
    await composer(page).press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`), SLOW);
    await expect(page.getByTestId('message-agent').last()).toContainText(reply, SLOW);
    await idle(page);
    const sesId = new URL(page.url()).pathname.split('/').at(-1)!;
    const found = await session(sesId);
    return { sesId, copy: found.worktreePath!, branch: found.branch! };
  }

  let chat = { sesId: '', copy: '', branch: '' };

  await test.step('a Worktree chat from the composer: its branch badge, and its port reaches the agent as PORT', async () => {
    chat = await worktreeChat('has-env PORT', 'PORT=set ending');
    expect(chat.branch).toBe(`ogden/chat/${chat.sesId}`);
    await expect(page.getByTestId('worktree-badge')).toContainText(chat.branch);
    await expect(page.getByTestId('setup-row').getByTestId('location-branch')).toHaveText(chat.branch);
    const portText = (await page.getByTestId('worktree-port').textContent()) ?? '';
    const port = /^Port (\d+)$/.exec(portText)?.[1];
    expect(port, portText).toBeDefined();
    await expect(page.getByTestId('message-agent').last()).toContainText(`PORT=set ending ${port!.slice(-4)}`);
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  await test.step('the agent edits in the copy; Commit these changes commits it on the chat branch', async () => {
    await say(page, 'write-doc notes.md', 'Wrote notes.md.');
    expect(existsSync(join(chat.copy, 'notes.md'))).toBe(true);
    expect(existsSync(join(repo, 'notes.md'))).toBe(false);
    await page.goto(at(`/w/${wsId}/workbench?session=${chat.sesId}&panel=changes`));
    await page.getByTestId('worktree-commit-message').fill('Add the notes');
    await page.getByTestId('worktree-commit-button').click();
    await expect(page.getByTestId('worktree-committed')).toBeVisible(SLOW);
    expect(git(chat.copy, 'log', '-1', '--format=%s', chat.branch)).toBe('Add the notes');
    expect(git(chat.copy, 'status', '--porcelain')).toBe('');
  });

  await test.step('Move to this folder carries an uncommitted edit, the branch kept; Move to its own worktree reuses it', async () => {
    await page.goto(at(`/w/${wsId}/s/${chat.sesId}`));
    await say(page, 'write-doc draft.md', 'Wrote draft.md.');
    const draft = readFileSync(join(chat.copy, 'draft.md'), 'utf8');
    const oldCopy = chat.copy;
    const chip = page.getByTestId('setup-row').getByTestId('location-chip');

    await chip.click();
    await expect(page.getByTestId('location-hand-off')).toContainText('Move to this folder');
    await page.getByTestId('location-hand-off').click();
    await page.getByTestId('hand-off-confirm-button').click();
    await expect(chip).toHaveAttribute('data-location', 'this_folder', SLOW);
    await expect(page.getByTestId('worktree-badge')).toHaveCount(0);
    await expect(page.getByTestId('location-changed-marker')).toHaveText(['Moved to this folder'], SLOW);
    expect(readFileSync(join(repo, 'draft.md'), 'utf8')).toBe(draft);
    // Only the uncommitted edit: the committed one stays on the branch, which is kept.
    expect(existsSync(join(repo, 'notes.md'))).toBe(false);
    await expect.poll(() => existsSync(oldCopy), SLOW).toBe(false);
    expect(git(repo, 'branch', '--list', chat.branch)).not.toBe('');
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

    await chip.click();
    await expect(page.getByTestId('location-hand-off')).toContainText('Move to its own worktree');
    await page.getByTestId('location-hand-off').click();
    await page.getByTestId('hand-off-confirm-button').click();
    await expect(chip).toHaveAttribute('data-location', 'worktree', SLOW);
    await expect(page.getByTestId('worktree-badge')).toContainText(chat.branch);
    await expect(page.getByTestId('location-changed-marker')).toHaveText(['Moved to this folder', `Moved to its own worktree: ${chat.branch}`], SLOW);
    const back = await session(chat.sesId);
    expect(back.branch).toBe(chat.branch);
    chat = { ...chat, copy: back.worktreePath! };
    // The kept branch again, with its commit, and the edit carried back.
    expect(git(chat.copy, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(chat.branch);
    expect(git(chat.copy, 'log', '-1', '--format=%s')).toBe('Add the notes');
    expect(existsSync(join(chat.copy, 'notes.md'))).toBe(true);
    expect(readFileSync(join(chat.copy, 'draft.md'), 'utf8')).toBe(draft);
    expect(existsSync(join(repo, 'draft.md'))).toBe(false);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  await test.step('Delete chat lists the ignored .env first, not node_modules; the branch with its commit is kept', async () => {
    writeFileSync(join(repo, '.git', 'info', 'exclude'), '.env\nnode_modules/\n');
    writeFileSync(join(chat.copy, '.env'), 'TOKEN=1\n');
    mkdirSync(join(chat.copy, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(chat.copy, 'node_modules', 'left-pad', 'index.js'), 'x\n');
    await page.goto(at(`/w/${wsId}/s/${chat.sesId}`));
    await idle(page);
    await page.getByTestId('session-menu').click();
    await page.getByTestId('session-menu-delete').click();
    const dialog = page.getByTestId('delete-chat-confirm');
    await expect(dialog).toContainText(chat.branch);
    await expect(dialog.getByTestId('copy-ignored-file')).toHaveText(['.env'], SLOW);
    await expect(dialog).not.toContainText('node_modules');
    await page.getByTestId('delete-chat-confirm-button').click();
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/new$`), SLOW);
    await expect.poll(() => existsSync(chat.copy), SLOW).toBe(false);
    expect(git(repo, 'branch', '--list', chat.branch)).not.toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  await test.step('with the cap at 1, a newer worktree chat puts the older idle one away; Restore brings it back and puts the other away', async () => {
    await page.goto(at('/settings/worktrees'));
    const keep = page.getByTestId('worktree-retention-keep');
    await expect(keep).toHaveValue('15', SLOW);
    await keep.fill('1');
    await page.getByTestId('worktree-retention-keep-save').click();
    await expect(page.getByTestId('worktree-retention-keep-saved')).toBeVisible(SLOW);

    const older = await worktreeChat('write-doc older.md', 'Wrote older.md.');
    const newer = await worktreeChat('write-doc newer.md', 'Wrote newer.md.');
    await expect.poll(() => existsSync(older.copy), SLOW).toBe(false);
    expect(existsSync(join(newer.copy, 'newer.md'))).toBe(true);
    expect(git(repo, 'branch', '--list', older.branch)).not.toBe('');

    await page.goto(at(`/w/${wsId}/s/${older.sesId}`));
    await expect(page.getByTestId('worktree-put-away')).toContainText(WORKTREE_PUT_AWAY_TEXT, SLOW);
    await page.getByTestId('worktree-restore').click();
    await expect(page.getByTestId('worktree-put-away')).toHaveCount(0, SLOW);
    expect(readFileSync(join(older.copy, 'older.md'), 'utf8').length).toBeGreaterThan(0);
    expect(git(older.copy, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(older.branch);
    await expect.poll(() => existsSync(newer.copy), SLOW).toBe(false);
    expect(git(repo, 'branch', '--list', newer.branch)).not.toBe('');

    // Back to 15 before the try, so retention doesn't put a trial's copy away.
    await page.goto(at('/settings/worktrees'));
    await expect(keep).toHaveValue('1', SLOW);
    await keep.fill('15');
    await page.getByTestId('worktree-retention-keep-save').click();
    await expect(page.getByTestId('worktree-retention-keep-saved')).toBeVisible(SLOW);
  });

  await test.step('Try with several agents: Claude Code and Codex side by side; Keep this one, the other put away, then restored', async () => {
    const mainHead = git(repo, 'rev-parse', 'HEAD');
    await page.goto(at(`/w/${wsId}/new`));
    await composer(page).fill('write-doc result.md');
    await page.getByTestId('agent-picker').click();
    await page.getByTestId('agent-try-several').click();
    await expect(page.getByTestId('try-dialog')).toBeVisible();
    await expect(page.getByTestId('try-task')).toHaveValue('write-doc result.md');
    for (const box of await page.getByTestId('try-agent').all()) {
      const agentId = await box.getAttribute('data-agent');
      const checked = (await box.getAttribute('data-state')) === 'checked';
      if (checked !== (agentId === 'claude-code' || agentId === 'codex')) await box.click();
    }
    await expect(page.locator('[data-testid="try-agent"][data-state="checked"]')).toHaveCount(2);
    await page.getByTestId('try-start').click();

    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/try/try_[0-9A-Z]+$`), SLOW);
    const columns = page.getByTestId('try-column');
    await expect(columns).toHaveCount(2, SLOW);
    expect((await columns.evaluateAll((items) => items.map((item) => item.getAttribute('data-agent')))).sort()).toEqual(['claude-code', 'codex']);
    for (const column of [columns.first(), columns.nth(1)]) await expect(column.getByTestId('try-column-state')).toHaveAttribute('data-state', 'idle', SLOW);
    const ids = await Promise.all([columns.first(), columns.nth(1)].map((column) => column.getAttribute('data-session')));
    const [kept, other] = await Promise.all(ids.map((sesId) => session(sesId!)));
    expect(kept!.branch).not.toBe(other!.branch);
    expect(kept!.worktreePath).not.toBe(other!.worktreePath);
    for (const each of [kept!, other!]) expect(existsSync(join(each.worktreePath!, 'result.md'))).toBe(true);
    // Each copy its own port.
    const ports = await Promise.all(
      ids.map(async (sesId) => (await call<{ location: { port: number | null } }>('GET', apiPath(API_ROUTES.sessionLocation, { wsId, sesId: sesId! }))).location.port),
    );
    for (const port of ports) expect(typeof port).toBe('number');
    expect(ports[0]).not.toBe(ports[1]);

    await columns.first().getByTestId('try-keep').click();
    await expect(page.getByTestId('trial-keep-confirm')).toHaveAttribute('data-choice', 'put_away');
    await page.getByTestId('trial-keep-confirm-button').click();
    await expect(columns.first().getByTestId('try-column-outcome')).toHaveText(TRIAL_KEPT_TEXT, SLOW);
    await expect(columns.nth(1).getByTestId('try-column-outcome')).toHaveText(TRIAL_NOT_KEPT_TEXT, SLOW);
    await expect.poll(() => existsSync(other!.worktreePath!), SLOW).toBe(false);
    expect(existsSync(join(kept!.worktreePath!, 'result.md'))).toBe(true);
    // Nothing merged: the main checkout as it was, the other's branch kept.
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(mainHead);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'branch', '--list', other!.branch!)).not.toBe('');

    await columns.nth(1).getByTestId('try-restore').click();
    await expect(columns.nth(1).getByTestId('try-restore')).toHaveCount(0, SLOW);
    expect(readFileSync(join(other!.worktreePath!, 'result.md'), 'utf8').length).toBeGreaterThan(0);
  });

  await test.step('a remote machine on the fake remote host refuses the Local model, in the menu and on send', async () => {
    const added = await call<{ machine: { id: string } }>('POST', API_ROUTES.remoteMachines, { host: 'bench.local', port: 22, username: 'ada', label: 'Build bench' });
    const machineId = added.machine.id;
    const { fingerprint } = await call<{ fingerprint: string }>('POST', apiPath(API_ROUTES.remoteMachineHostKeyCheck, { machineId }));
    await call('POST', apiPath(API_ROUTES.remoteMachineHostKeyConfirm, { machineId }), { fingerprint, confirm: true });
    const machineItem = page.locator(`[data-testid="location-machine"][data-machine="${machineId}"]`);
    const sessionsBefore = (await call<{ sessions: unknown[] }>('GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).sessions.length;

    // The Local model chosen: the machine is listed, disabled with the Local model's reason.
    await page.goto(at(`/w/${wsId}/new?agent=local`));
    await expect(page.getByTestId('agent-picker')).toHaveAttribute('data-agent', 'local', SLOW);
    await page.getByTestId('location-chip').click();
    await expect(machineItem).toHaveAttribute('aria-disabled', 'true');
    await expect(machineItem).toContainText(LOCAL_ONLY_REASON);
    await page.keyboard.press('Escape');

    // The machine picked first, then the Local model: the draft says why, and the send is refused with no chat made.
    await page.goto(at(`/w/${wsId}/new?machine=${machineId}&agent=local`));
    await expect(page.getByTestId('location-chip')).toHaveAttribute('data-machine', machineId, SLOW);
    await expect(page.getByTestId('agent-local-only')).toContainText(LOCAL_ONLY_REASON);
    await composer(page, 'Local model').fill('hello');
    await composer(page, 'Local model').press('Enter');
    await expect(page.getByTestId('composer-error')).toContainText(LOCAL_ONLY_REASON, SLOW);
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/new`));
    expect((await call<{ sessions: unknown[] }>('GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).sessions).toHaveLength(sessionsBefore);
  });

  await quit(page, launched);
});
