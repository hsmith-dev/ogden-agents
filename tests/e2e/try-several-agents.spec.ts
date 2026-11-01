/// <reference lib="dom" />
/**
 * Try with several agents (epic 27, 27.8; CAP-35) in a real browser, with a
 * fixture repo and two fake agents: the draft's Agent chip opens the
 * dialog with the draft's text, Start makes a worktree chat per agent and
 * opens the Try page with both side by side; each agent writes its file in
 * its own copy. Keep this one keeps the first; the other's copy is put
 * away (its branch kept, nothing merged into the main checkout) and reads
 * "Not kept" with Restore, which brings its file back. No axe violation on
 * the page; at 390px the columns stack and nothing scrolls sideways.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { TRIAL_LINE_TEXT, TRIAL_NOT_KEPT_TEXT, TRIAL_KEPT_TEXT } from '../../packages/shared/src/where-work-runs.ts';
import { API_ROUTES, fakeSecondAgent } from '../support.js';
import { tabRest, withChatServer } from './chat-server.js';
import { expectNoHorizontalOverflow } from './tab.js';

interface SessionBody {
  session: { id: string; worktreePath: string | null; branch: string | null };
}

async function noAxeViolations(page: Page, selector: string) {
  const axe = await new AxeBuilder({ page }).include(selector).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('one task, two agents side by side; keep one, the other is put away, and Restore brings it back', async ({ page }) => {
  const agents = [await fakeSecondAgent({ agentId: 'fake-a', displayName: 'Fake A' }), await fakeSecondAgent({ agentId: 'fake-b', displayName: 'Fake B' })];
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      writeFileSync(join(repo, 'README.md'), '# Fixture\n');
      git(repo, 'init', '--quiet', '--initial-branch=main');
      git(repo, 'config', 'user.name', 'Fixture');
      git(repo, 'config', 'user.email', 'fixture@example.com');
      git(repo, 'config', 'core.autocrlf', 'false');
      git(repo, 'add', '-A');
      git(repo, 'commit', '--quiet', '--no-verify', '-m', 'The fixture');
      const mainHead = git(repo, 'rev-parse', 'HEAD');
      const call = await tabRest(page);
      const wsId = (await call<{ workspace: { id: string } }>('POST', API_ROUTES.workspaces, { path: repo })).workspace.id;

      // The draft's text, then the Agent chip's Try with several agents...
      await page.goto(`${server.url}/w/${wsId}/new`);
      const composer = page.getByRole('textbox', { name: /^Message / });
      await composer.fill('write-doc result.md');
      await page.getByTestId('agent-picker').click();
      await page.getByTestId('agent-try-several').click();
      const dialog = page.getByTestId('try-dialog');
      await expect(dialog).toContainText(TRIAL_LINE_TEXT);
      await expect(page.getByTestId('try-task')).toHaveValue('write-doc result.md');
      await expect(page.getByTestId('try-retention')).toBeVisible();
      for (const box of await page.getByTestId('try-agent').all()) {
        const agentId = await box.getAttribute('data-agent');
        const checked = (await box.getAttribute('data-state')) === 'checked';
        if (checked !== (agentId === 'fake-a' || agentId === 'fake-b')) await box.click();
      }
      await noAxeViolations(page, '[data-testid="try-dialog"]');
      await page.getByTestId('try-start').click();

      // The Try page: one column per agent, each in its own copy.
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/try/try_[0-9A-Z]+$`));
      const columns = page.getByTestId('try-column');
      await expect(columns).toHaveCount(2);
      await expect(columns.first()).toHaveAttribute('data-agent', 'fake-a');
      await expect(columns.nth(1)).toHaveAttribute('data-agent', 'fake-b');
      for (const column of [columns.first(), columns.nth(1)]) {
        await expect(column.getByTestId('try-column-state')).toHaveAttribute('data-state', 'idle', { timeout: 20_000 });
        await expect(column.getByTestId('try-column-changes')).toHaveText(/^\+[1-9]\d* -\d+$/);
        await expect(column.getByTestId('try-open-chat')).toBeVisible();
        await expect(column.getByTestId('try-review-changes')).toBeVisible();
      }
      const ids = await Promise.all([columns.first(), columns.nth(1)].map((column) => column.getAttribute('data-session')));
      const [kept, other] = await Promise.all(ids.map(async (sesId) => (await call<SessionBody>('GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId: sesId! }))).session));
      expect(kept!.branch).not.toBe(other!.branch);
      for (const session of [kept!, other!]) expect(existsSync(join(session.worktreePath!, 'result.md'))).toBe(true);
      await noAxeViolations(page, '[data-testid="try-page"]');
      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(page);
      // Stacked: the second column is below the first.
      const [firstBox, secondBox] = await Promise.all([columns.first().boundingBox(), columns.nth(1).boundingBox()]);
      expect(secondBox!.y).toBeGreaterThan(firstBox!.y + firstBox!.height - 1);
      await page.setViewportSize({ width: 1280, height: 800 });

      // Keep the first: asked once, the others put away by default.
      await columns.first().getByTestId('try-keep').click();
      const confirm = page.getByTestId('trial-keep-confirm');
      await expect(confirm).toHaveAttribute('data-choice', 'put_away');
      await noAxeViolations(page, '[data-testid="trial-keep-confirm"]');
      await page.getByTestId('trial-keep-confirm-button').click();
      await expect(confirm).toHaveCount(0);
      await expect(columns.first().getByTestId('try-column-outcome')).toHaveText(TRIAL_KEPT_TEXT);
      await expect(columns.nth(1).getByTestId('try-column-outcome')).toHaveText(TRIAL_NOT_KEPT_TEXT);
      await expect.poll(() => existsSync(other!.worktreePath!), { timeout: 20_000 }).toBe(false);
      expect(existsSync(join(kept!.worktreePath!, 'result.md'))).toBe(true);
      // Nothing merged: the main checkout is as it was, and the other's branch is kept.
      expect(git(repo, 'rev-parse', 'HEAD')).toBe(mainHead);
      expect(git(repo, 'status', '--porcelain')).toBe('');
      expect(git(repo, 'branch', '--list', other!.branch!)).not.toBe('');
      await noAxeViolations(page, '[data-testid="try-page"]');

      // Restore the other: its copy back with its file.
      await columns.nth(1).getByTestId('try-restore').click();
      await expect(columns.nth(1).getByTestId('try-restore')).toHaveCount(0);
      expect(readFileSync(join(other!.worktreePath!, 'result.md'), 'utf8').length).toBeGreaterThan(0);
      // The chat links back to its try.
      await columns.nth(1).getByTestId('try-open-chat').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/${other!.id}$`));
      await expect(page.getByTestId('session-try-link')).toBeVisible();
    },
    { extra: { extraAgents: agents } },
  );
});
