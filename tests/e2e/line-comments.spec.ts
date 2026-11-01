/// <reference lib="dom" />
/**
 * Line comments in a real browser (story 8.6): a fake agent turn changes two
 * files; in This turn the user comments on a line of one and a Shift range
 * of the other, the bar reads Comments to send (2), and Send to Claude Code
 * opens the chat with one composed message in its composer. The test sends
 * it (prefixed `review-echo `, so the fake agent replies with the prompt it
 * got): the agent's one prompt names both `path:line`s with their quotes. No
 * axe violations and no sideways scroll at 390px.
 *
 * Real `git`; the fake ACP agent; no real `claude`, keychain or network.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { composer, send, startChat, withChatServer } from './chat-server.js';
import { expectNoHorizontalOverflow } from './tab.js';

const encode = (content: string) => Buffer.from(content).toString('base64');

async function expectNoAxeViolations(page: Page) {
  const axe = await new AxeBuilder({ page }).include('[data-testid="workspace-workbench-page"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('comments on two files go to the chat as one message, edited in its composer and sent from there, at 390px', async ({ page }) => {
  test.setTimeout(90_000);
  await withChatServer(
    page,
    async ({ repo }) => {
      fixtureGit(repo, 'init', '-q', '--initial-branch=main');
      fixtureGit(repo, 'config', 'core.autocrlf', 'false');
      fixtureGit(repo, 'add', '-A');
      fixtureGit(repo, 'commit', '-q', '--no-verify', '-m', 'The fixture');
      const { wsId, sesId } = await startChat(page, repo);
      await page.setViewportSize({ width: 390, height: 800 });

      const totals = 'export const a = 1;\nexport const total = lines.map(round).sum();\n';
      const styles = '.cart {\n  color: red;\n  margin: 0;\n}\n';
      await send(page, `write-file src/a.ts ${encode(totals)} src/cart.css ${encode(styles)}`);
      await expect(page.getByTestId('turn-changes')).toHaveCount(1);
      await page.getByTestId('turn-changes').getByRole('link', { name: 'Review changes' }).click();
      await expect(page.getByTestId('workbench-changes')).toHaveAttribute('data-view', 'turn');
      await expect(page.getByTestId('diff-file-list-item')).toHaveCount(2);

      // A line of src/a.ts.
      const aTable = page.getByRole('table', { name: 'Changes in src/a.ts' });
      await aTable.getByRole('button', { name: 'Comment on line 2' }).click();
      await page.getByTestId('diff-comment-input').fill('Round after summing, not per line.');
      await page.getByTestId('diff-comment-save').click();
      // A range of src/cart.css: line 2, then Shift with line 4.
      const cssTable = page.getByRole('table', { name: 'Changes in src/cart.css' });
      await cssTable.getByRole('button', { name: 'Comment on line 2' }).click();
      await page.getByTestId('diff-comment-cancel').click();
      await cssTable.getByRole('button', { name: 'Comment on line 4' }).click({ modifiers: ['Shift'] });
      await expect(page.getByTestId('diff-comment-field')).toContainText('Your comment on lines 2 to 4');
      await page.getByTestId('diff-comment-input').fill('Use the existing formatPrice helper.');
      await page.getByTestId('diff-comment-save').click();

      await expect(page.getByTestId('comments-bar-title')).toHaveText('Comments to send (2)');
      await expect(page.getByTestId('comments-bar-item')).toHaveText([/src\/a\.ts:2/, /src\/cart\.css:2-4/]);
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);

      // A reload keeps them.
      await page.reload();
      await expect(page.getByTestId('comments-bar-title')).toHaveText('Comments to send (2)');
      await expect(page.getByTestId('diff-comment')).toHaveCount(2);

      await page.getByTestId('comments-send').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/${sesId}`));
      const box = composer(page);
      await expect(box).toHaveValue(/^Please address these review comments:/);
      const message = await box.inputValue();
      expect(message).toContain('src/a.ts:2\n> + export const total = lines.map(round).sum();\nRound after summing, not per line.');
      expect(message).toContain('src/cart.css:2-4\n> +   color: red;\n> +   margin: 0;\n> + }\nUse the existing formatPrice helper.');
      await expectNoHorizontalOverflow(page);

      // The user edits it and sends it from the composer.
      await box.fill(`review-echo ${message}`);
      await box.press('Enter');
      await expect(box).toHaveValue('');
      const reply = page.getByTestId('message-agent').last();
      await expect(reply).toContainText('RECEIVED<<review-echo Please address these review comments:');
      const received = /RECEIVED<<([\s\S]*?)>>RECEIVED/.exec((await reply.textContent()) ?? '')?.[1] ?? '';
      expect(received).toContain('src/a.ts:2');
      expect(received).toContain('src/cart.css:2-4');
      // Both quotes and both comments (the reply is rendered as markdown, so each quoted line's text, not its `> +`).
      expect(received).toContain('export const total = lines.map(round).sum();');
      expect(received).toContain('color: red;');
      expect(received).toContain('margin: 0;');
      expect(received).toContain('Round after summing, not per line.');
      expect(received).toContain('Use the existing formatPrice helper.');

      // Handed over: the bar is gone.
      await page.goBack();
      await expect(page.getByTestId('workbench-changes')).toBeVisible();
      await expect(page.getByTestId('comments-bar')).toHaveCount(0);
    },
    { files: { 'README.md': '# Fixture\n', 'src/a.ts': 'export const a = 1;\n' } },
  );
});
