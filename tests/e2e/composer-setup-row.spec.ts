/// <reference lib="dom" />
/**
 * The composer setup row with Location This folder and Worktree (epic 27,
 * 27.1; CAP-35): in a git project, one chat started from the new-chat draft
 * with This folder and one with Worktree each run the fake agent's
 * `write-doc`; the first file lands in the project, the second only in the
 * worktree, `<data>/cw/<8>` on `ogden/chat/<ses>`, with no dialog. A chat
 * page has no mode picker in its header and the row has Mode, Model and
 * Location chips; at 390px the page doesn't scroll sideways. A plain folder
 * refuses Worktree with a plain sentence under the composer and makes no chat.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES } from '../support.js';
import { composer, tabRest, withChatServer } from './chat-server.js';
import { expectNoHorizontalOverflow } from './tab.js';

interface SessionBody {
  session: { id: string; worktreePath: string | null; branch: string | null };
}

/** Sends `text` from the draft and waits for its chat to open and the agent to say `reply`. */
async function sendFromDraft(page: Page, wsId: string, text: string, reply: string): Promise<string> {
  await composer(page).fill(text);
  await composer(page).press('Enter');
  await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
  await expect(page.getByTestId('transcript')).toContainText(reply);
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

test('This folder and Worktree chats from the composer: each file lands where its chat works, with no dialog', async ({ page }) => {
  await withChatServer(page, async ({ server, dataDir, repo }) => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    writeFileSync(join(repo, 'README.md'), '# Fixture\n');
    git(repo, 'init', '--quiet', '--initial-branch=main');
    git(repo, 'config', 'user.name', 'Fixture');
    git(repo, 'config', 'user.email', 'fixture@example.com');
    git(repo, 'config', 'core.autocrlf', 'false');
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '--no-verify', '-m', 'The fixture');
    const call = await tabRest(page);
    const wsId = (await call<{ workspace: { id: string } }>('POST', API_ROUTES.workspaces, { path: repo })).workspace.id;
    let dialogs = 0;
    page.on('dialog', () => void dialogs++);

    // This folder, the default.
    await page.goto(`${server.url}/w/${wsId}/new`);
    await expect(page.getByTestId('location-chip')).toHaveAttribute('data-location', 'this_folder');
    const first = await sendFromDraft(page, wsId, 'write-doc first.md', 'Wrote first.md.');
    expect((await call<SessionBody>('GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId: first }))).session).toMatchObject({ worktreePath: null, branch: null });
    expect(existsSync(join(repo, 'first.md'))).toBe(true);

    // The chat page: no mode picker in the header; the row has Mode, Model and Location.
    const row = page.getByTestId('setup-row');
    await expect(page.getByRole('banner').getByTestId('permission-mode-picker')).toHaveCount(0);
    for (const chip of ['permission-mode-picker', 'model-picker', 'location-chip']) await expect(row.getByTestId(chip)).toBeVisible();
    await expect(row.getByTestId('location-chip')).toHaveAttribute('data-location', 'this_folder');

    // Worktree.
    await page.goto(`${server.url}/w/${wsId}/new`);
    await page.getByTestId('location-chip').click();
    await page.getByTestId('location-worktree').click();
    await expect(page.getByTestId('location-chip')).toHaveAttribute('data-location', 'worktree');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const second = await sendFromDraft(page, wsId, 'write-doc second.md', 'Wrote second.md.');
    const { session } = await call<SessionBody>('GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId: second }));
    expect(session.branch).toBe(`ogden/chat/${second}`);
    const worktree = session.worktreePath!;
    expect(basename(worktree)).toMatch(/^[a-z2-7]{8}$/);
    expect(dirname(worktree)).toBe(realpathSync.native(join(dataDir, 'cw')));
    expect(existsSync(join(worktree, 'second.md'))).toBe(true);
    expect(existsSync(join(repo, 'second.md'))).toBe(false);
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(`ogden/chat/${second}`);
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    await expect(page.getByTestId('setup-row').getByTestId('location-chip')).toHaveAttribute('data-location', 'worktree');
    expect(dialogs).toBe(0);

    // At phone width the row scrolls inside itself; the page never does.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('setup-row')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.goto(`${server.url}/w/${wsId}/new`);
    await expect(page.getByTestId('setup-row')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test('a plain folder refuses Worktree with a plain sentence under the composer and makes no chat', async ({ page }) => {
  await withChatServer(page, async ({ server, dataDir, repo }) => {
    const call = await tabRest(page);
    const wsId = (await call<{ workspace: { id: string } }>('POST', API_ROUTES.workspaces, { path: repo })).workspace.id;
    await page.goto(`${server.url}/w/${wsId}/new`);
    await page.getByTestId('location-chip').click();
    await page.getByTestId('location-worktree').click();
    await composer(page).fill('hello');
    await composer(page).press('Enter');
    await expect(page.getByTestId('composer-error')).toContainText('A worktree needs this project to be a git repository');
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/new$`));
    expect((await call<{ sessions: unknown[] }>('GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).sessions).toEqual([]);
    expect(existsSync(join(dataDir, 'cw'))).toBe(false);
  });
});
