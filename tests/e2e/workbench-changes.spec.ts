/// <reference lib="dom" />
/**
 * The Workbench's Changes panel in a real browser (story 8.4): in a git
 * project, a fake agent turn that writes a file ends with "Changed 1 file
 * +1 -0" and Review changes, which opens the Workbench on This turn showing
 * only that turn's file; the view switch goes to Unstaged (both turns'
 * files, untracked as Added) and Staged (empty), with no axe violations and
 * no sideways scroll at 1440px and at 390px. Story 8.5: one of a fake
 * turn's two hunks is reverted with its one confirmation, on disk only that
 * hunk goes back, and Undo puts it back, with no axe violations and no
 * sideways scroll at 390px.
 *
 * Real `git`; the fake ACP agent; no real `claude`, keychain or network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { send, startChat, withChatServer } from './chat-server.js';
import { expectNoHorizontalOverflow } from './tab.js';

const writeFile = (path: string, content: string) => `write-file ${path} ${Buffer.from(content).toString('base64')}`;

async function expectNoAxeViolations(page: Page) {
  const axe = await new AxeBuilder({ page }).include('[data-testid="workspace-workbench-page"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
}

test("a turn's Changed row opens This turn with only its file; the views switch, at 1440px and 390px", async ({ page }) => {
  test.setTimeout(90_000);
  await withChatServer(
    page,
    async ({ repo }) => {
      fixtureGit(repo, 'init', '-q', '--initial-branch=main');
      fixtureGit(repo, 'config', 'core.autocrlf', 'false');
      fixtureGit(repo, 'add', '-A');
      fixtureGit(repo, 'commit', '-q', '--no-verify', '-m', 'The fixture');
      const { wsId, sesId } = await startChat(page, repo);

      await send(page, writeFile('notes/first.txt', 'one\n'));
      await expect(page.getByTestId('turn-changes')).toHaveCount(1);
      await send(page, writeFile('notes/second.txt', 'two\n'));
      await expect(page.getByTestId('turn-changes')).toHaveCount(2);
      const last = page.getByTestId('turn-changes').last();
      await expect(last.getByTestId('turn-changes-text')).toHaveText('Changed 1 file +1 -0');

      await last.getByRole('link', { name: 'Review changes' }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench\\?.*panel=changes`));
      await expect(page.getByTestId('workbench-panel-changes')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('workbench-changes')).toHaveAttribute('data-view', 'turn');
      await expect(page.getByTestId('changes-turn-picker')).toBeVisible();
      await expect(page.getByTestId('diff-file-list-item')).toHaveCount(1);
      await expect(page.getByTestId('diff-file-list-item')).toHaveAttribute('data-path', 'notes/second.txt');
      await expect(page.getByTestId('diff-viewer')).toContainText('two');
      expect(page.url()).toContain(`session=${sesId}`);
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);

      // The first turn, from the picker.
      await page.getByTestId('changes-turn-picker').click();
      await page.getByTestId('changes-turn-option').last().click();
      await expect(page.getByTestId('diff-file-list-item')).toHaveAttribute('data-path', 'notes/first.txt');

      // Unstaged: both files, new ones as Added; Staged: nothing.
      await page.getByTestId('changes-view-unstaged').click();
      await expect(page.getByTestId('workbench-changes')).toHaveAttribute('data-view', 'unstaged');
      await expect(page.getByTestId('diff-file-list-item')).toHaveCount(2);
      await expect(page.getByTestId('changes-file-list')).toContainText('Added');
      await page.getByTestId('changes-view-staged').click();
      await expect(page.getByTestId('changes-empty')).toHaveText('Nothing staged.');
      await expectNoAxeViolations(page);

      // At phone width, after a reload (the view is in the URL): the same view, no sideways scroll.
      await page.getByTestId('changes-view-turn').click();
      await page.setViewportSize({ width: 390, height: 800 });
      await page.reload();
      await expect(page.getByTestId('workbench-changes')).toHaveAttribute('data-view', 'turn');
      await expect(page.getByTestId('diff-file-list-item')).toHaveCount(1);
      await expect(page.getByTestId('diff-viewer')).toHaveAttribute('data-layout', 'inline');
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    },
    { files: { 'README.md': '# Fixture\n', 'src/a.ts': 'export const a = 1;\n' } },
  );
});

/** Twenty numbered lines, with `changes` (1-based line: new text) made. */
const numbered = (changes: Record<number, string> = {}): string => `${Array.from({ length: 20 }, (_, index) => changes[index + 1] ?? `line ${index + 1}`).join('\n')}\n`;

test("reverts one of a turn's two hunks with its confirmation, and Undo puts it back, at 390px", async ({ page }) => {
  test.setTimeout(90_000);
  await withChatServer(
    page,
    async ({ repo }) => {
      fixtureGit(repo, 'init', '-q', '--initial-branch=main');
      fixtureGit(repo, 'config', 'core.autocrlf', 'false');
      fixtureGit(repo, 'add', '-A');
      fixtureGit(repo, 'commit', '-q', '--no-verify', '-m', 'The fixture');
      await startChat(page, repo);
      const edited = numbered({ 2: 'line two, by the agent', 18: 'line eighteen, by the agent' });
      await send(page, writeFile('list.txt', edited));
      await expect(page.getByTestId('turn-changes')).toHaveCount(1);
      await page.setViewportSize({ width: 390, height: 800 });
      await page.getByTestId('turn-changes').getByRole('link', { name: 'Review changes' }).click();
      await expect(page.getByTestId('workbench-changes')).toHaveAttribute('data-view', 'turn');
      const hunkActions = page.getByTestId('changes-hunk-action');
      await expect(hunkActions).toHaveCount(2);
      await expect(page.getByTestId('changes-file-action')).toHaveAccessibleName('Revert all of list.txt');
      const second = hunkActions.nth(1);
      await expect(second).toHaveAccessibleName(/^Revert lines 15 to 20$/);
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);

      // One confirmation; Cancel changes nothing.
      await second.click();
      const confirm = page.getByTestId('changes-revert-confirm');
      await expect(confirm).toContainText('You can undo it right after, while Changes is open.');
      await expectNoAxeViolations(page);
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      await expect(confirm).toHaveCount(0);
      expect(readFileSync(join(repo, 'list.txt'), 'utf8')).toBe(edited);
      await second.click();
      await page.getByTestId('changes-revert-confirm-button').click();
      await expect(page.getByTestId('changes-reverted')).toContainText('Reverted lines 15 to 20 in list.txt.');
      await expect.poll(() => readFileSync(join(repo, 'list.txt'), 'utf8')).toBe(numbered({ 2: 'line two, by the agent' }));
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);

      await page.getByTestId('changes-undo').click();
      await expect(page.getByTestId('changes-reverted')).toHaveText('Put back.');
      await expect.poll(() => readFileSync(join(repo, 'list.txt'), 'utf8')).toBe(edited);
      await expectNoAxeViolations(page);
    },
    { files: { 'README.md': '# Fixture\n', 'list.txt': numbered() } },
  );
});
