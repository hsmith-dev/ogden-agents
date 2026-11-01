/// <reference lib="dom" />
/**
 * Worktree retention and Restore (epic 27, 27.6; CAP-35): with Settings,
 * Projects, Worktrees at 1, a second worktree chat puts the first (idle)
 * one away: its copy is gone, its branch kept, and its chat says "This
 * chat's copy was put away to save space." with Restore and a composer that
 * takes no message. Restore brings the copy back with the file the agent
 * wrote, on its branch. No axe violation in the settings page or the
 * notice; at 390px neither scrolls sideways.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { WORKTREE_PUT_AWAY_COMPOSER_TEXT, WORKTREE_PUT_AWAY_NOT_KEPT_TEXT, WORKTREE_PUT_AWAY_TEXT } from '../../packages/shared/src/where-work-runs.ts';
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

/** Starts a worktree chat from the composer and has the fake agent write `file`; its id and copy. */
async function worktreeChat(page: Page, url: string, wsId: string, file: string, call: Awaited<ReturnType<typeof tabRest>>) {
  await page.goto(`${url}/w/${wsId}/new`);
  await page.getByTestId('location-chip').click();
  await page.getByTestId('location-worktree').click();
  await composer(page).fill(`write-doc ${file}`);
  await composer(page).press('Enter');
  await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
  await expect(page.getByTestId('transcript')).toContainText(`Wrote ${file}.`);
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
  const sesId = new URL(page.url()).pathname.split('/').at(-1)!;
  const { session } = await call<SessionBody>('GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId }));
  return { sesId, copy: session.worktreePath!, branch: session.branch! };
}

test('with the cap at 1, a second worktree chat puts the first away, and Restore brings its file back', async ({ page }) => {
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

    // Settings, Projects, Worktrees: keep 1.
    await page.goto(`${server.url}/settings/worktrees`);
    const keep = page.getByTestId('worktree-retention-keep');
    await expect(keep).toHaveValue('15');
    await expect(page.getByTestId('worktree-retention-not-kept')).toHaveText(WORKTREE_PUT_AWAY_NOT_KEPT_TEXT);
    await keep.fill('1');
    await page.getByTestId('worktree-retention-keep-save').click();
    await expect(page.getByTestId('worktree-retention-keep-saved')).toBeVisible();
    await noAxeViolations(page, '[data-testid="worktrees-settings-page"]');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const first = await worktreeChat(page, server.url, wsId, 'first.md', call);
    expect(existsSync(join(first.copy, 'first.md'))).toBe(true);
    const second = await worktreeChat(page, server.url, wsId, 'second.md', call);

    // The first, idle, is put away: its copy gone, its branch kept.
    await expect.poll(() => existsSync(first.copy), { timeout: 20_000 }).toBe(false);
    expect(existsSync(second.copy)).toBe(true);
    expect(git(repo, 'branch', '--list', first.branch)).not.toBe('');

    await page.goto(`${server.url}/w/${wsId}/s/${first.sesId}`);
    const notice = page.getByTestId('worktree-put-away');
    await expect(notice).toContainText(WORKTREE_PUT_AWAY_TEXT);
    await expect(page.getByTestId('composer')).toContainText(WORKTREE_PUT_AWAY_COMPOSER_TEXT);
    await noAxeViolations(page, '[data-testid="worktree-put-away"]');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Restore: the copy back on its branch with the agent's file.
    await page.getByTestId('worktree-restore').click();
    await expect(notice).toHaveCount(0);
    expect(readFileSync(join(first.copy, 'first.md'), 'utf8').length).toBeGreaterThan(0);
    expect(git(first.copy, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(first.branch);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    // Restoring went over the cap again: the other chat (idle) is put away now.
    await expect.poll(() => existsSync(second.copy), { timeout: 20_000 }).toBe(false);
  });
});
