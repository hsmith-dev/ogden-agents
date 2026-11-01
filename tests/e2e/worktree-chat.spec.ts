/// <reference lib="dom" />
/**
 * Worktree chats with a branch badge (epic 27, 27.3; CAP-35): a chat
 * started from the composer with Worktree shows `ogden/chat/<ses>` in its
 * header and beside Worktree on its Location chip; the fake agent's
 * `write-doc` lands only in the copy; the badge opens the Workbench rooted
 * at the copy (its tree lists the new file, the project's doesn't have it);
 * Delete chat confirms once, names the copy with its uncommitted changes, and removes its folder, git's
 * record and its branch, opening the new-chat draft. No axe violation in
 * the header or the dialog; at 390px the page never scrolls sideways.
 * Hand off (27.4): a this-folder chat's uncommitted file moves to its own
 * worktree and back from the Location chip, confirmed once, intact both
 * times, with a "Moved to" divider each time.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES } from '../support.js';
import { composer, tabRest, withChatServer } from './chat-server.js';
import { expectNoHorizontalOverflow } from './tab.js';

interface SessionBody {
  session: { id: string; worktreePath: string | null; branch: string | null };
}

async function noAxeViolations(page: Page, selector: string) {
  const axe = await new AxeBuilder({ page }).include(selector).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('a worktree chat shows its branch, writes only in its copy, opens the Workbench there, and Delete chat removes the copy', async ({ page }) => {
  await withChatServer(page, async ({ server, repo }) => {
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

    // Started from the composer with Worktree.
    await page.goto(`${server.url}/w/${wsId}/new`);
    await page.getByTestId('location-chip').click();
    await page.getByTestId('location-worktree').click();
    await composer(page).fill('write-doc notes.md');
    await composer(page).press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
    await expect(page.getByTestId('transcript')).toContainText('Wrote notes.md.');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    const sesId = new URL(page.url()).pathname.split('/').at(-1)!;
    const { session } = await call<SessionBody>('GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId }));
    const branch = `ogden/chat/${sesId}`;
    expect(session.branch).toBe(branch);
    const copy = session.worktreePath!;
    expect(existsSync(join(copy, 'notes.md'))).toBe(true);
    expect(existsSync(join(repo, 'notes.md'))).toBe(false);

    // The badge in the header and the branch on the Location chip.
    const badge = page.getByTestId('worktree-badge');
    await expect(badge).toContainText(branch);
    await expect(page.getByTestId('setup-row').getByTestId('location-branch')).toHaveText(branch);
    await noAxeViolations(page, 'header');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // The badge opens the Workbench rooted at the copy.
    await badge.click();
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench\\?session=${sesId}$`));
    await expect(page.getByTestId('file-row-notes.md')).toBeVisible();
    await page.goto(`${server.url}/w/${wsId}/workbench`);
    await expect(page.getByTestId('file-row-README.md')).toBeVisible();
    await expect(page.getByTestId('file-row-notes.md')).toHaveCount(0);

    // Delete chat: one confirmation names the copy with its uncommitted file, and removes it.
    await page.goto(`${server.url}/w/${wsId}/s/${sesId}`);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await page.getByTestId('session-menu').click();
    await page.getByTestId('session-menu-delete').click();
    const dialog = page.getByTestId('delete-chat-confirm');
    await expect(dialog).toContainText(branch);
    await expect(dialog).toContainText('any changes not committed');
    await noAxeViolations(page, '[data-testid="delete-chat-confirm"]');
    expect(existsSync(copy)).toBe(true);
    await page.getByTestId('delete-chat-confirm-button').click();
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/new$`));
    expect(existsSync(copy)).toBe(false);
    expect(existsSync(join(repo, '.git', 'worktrees', basename(copy)))).toBe(false);
    expect(git(repo, 'branch', '--list', branch)).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect((await call<{ sessions: unknown[] }>('GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).sessions).toEqual([]);
  });
});

test('Hand off moves a chat and its edit to its own worktree and back, with a divider each time', async ({ page }) => {
  await withChatServer(page, async ({ server, repo }) => {
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

    // A chat in this folder whose agent leaves an uncommitted file.
    await page.goto(`${server.url}/w/${wsId}/new`);
    await composer(page).fill('write-doc notes.md');
    await composer(page).press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
    await expect(page.getByTestId('transcript')).toContainText('Wrote notes.md.');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    const sesId = new URL(page.url()).pathname.split('/').at(-1)!;
    const branch = `ogden/chat/${sesId}`;
    const edit = readFileSync(join(repo, 'notes.md'), 'utf8');

    // Move to its own worktree: confirmed once.
    const chip = page.getByTestId('setup-row').getByTestId('location-chip');
    await chip.click();
    await expect(page.getByTestId('location-hand-off')).toContainText('Move to its own worktree');
    await page.getByTestId('location-hand-off').click();
    const dialog = page.getByTestId('hand-off-confirm');
    await expect(dialog).toContainText('Move this chat?');
    await noAxeViolations(page, '[data-testid="hand-off-confirm"]');
    await page.getByTestId('hand-off-confirm-button').click();
    await expect(dialog).toHaveCount(0);
    await expect(chip).toHaveAttribute('data-location', 'worktree');
    await expect(page.getByTestId('worktree-badge')).toContainText(branch);
    await expect(page.getByTestId('location-changed-marker')).toHaveText([`Moved to its own worktree: ${branch}`]);
    const { session } = await call<SessionBody>('GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId }));
    const copy = session.worktreePath!;
    expect(readFileSync(join(copy, 'notes.md'), 'utf8')).toBe(edit);
    expect(existsSync(join(repo, 'notes.md'))).toBe(false);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // And back to this folder: the edit intact, the clean copy gone.
    await chip.click();
    await expect(page.getByTestId('location-hand-off')).toContainText('Move to this folder');
    await page.getByTestId('location-hand-off').click();
    await page.getByTestId('hand-off-confirm-button').click();
    await expect(chip).toHaveAttribute('data-location', 'this_folder');
    await expect(page.getByTestId('worktree-badge')).toHaveCount(0);
    await expect(page.getByTestId('location-changed-marker')).toHaveText([`Moved to its own worktree: ${branch}`, 'Moved to this folder']);
    expect(readFileSync(join(repo, 'notes.md'), 'utf8')).toBe(edit);
    expect(existsSync(copy)).toBe(false);
    expect(git(repo, 'branch', '--list', branch)).toBe('');
    await noAxeViolations(page, '[data-testid="transcript"]');
  });
});
