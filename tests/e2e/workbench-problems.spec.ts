/// <reference lib="dom" />
/**
 * The Workbench's Problems panel (AD-38; 8.9) in a real browser, on the real
 * `project-commands-node` runner: in a fixture project, Problems first asks
 * for trust; then a declared `node fail.js` command (which prints a
 * TypeScript error for `src/a.ts:12` and exits 1) runs, its failure shows
 * as `src/a.ts:12`, and the live region says it finished. Clicking the item
 * opens the viewer on `src/a.ts` with line 12 highlighted. Ask the agent to
 * fix this opens the project's chat with the failure, its `file:line` and
 * its output in the composer, and sends nothing. Axe finds nothing and a
 * 390px page has no sideways scroll.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { composer, startChat, withChatServer } from './chat-server.js';

const SOURCE = Array.from({ length: 40 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join('\n') + '\n';
const FAIL = [
  "console.log(\"src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\");",
  "console.log('TOKEN=e2e-problems-secret-8c1d');",
  'process.exitCode = 1;',
].join('\n');

/** Nothing scrolls sideways. */
async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

async function expectAxeClean(page: Page, at: string) {
  const axe = await new AxeBuilder({ page }).include('[data-testid="workspace-workbench-page"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`), at).toEqual([]);
}

test('Problems asks for trust, runs a declared command, links its failure to the viewer at its line, and Ask fills the chat without sending', async ({ page }) => {
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { wsId, url: chatUrl } = await startChat(page, repo);
      await page.goto(`${server.url}/w/${wsId}/workbench`);
      await page.getByTestId('workbench-panel-problems').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench\\?panel=problems$`));
      await expect(page.getByTestId('workbench-panel-problems')).toHaveAttribute('aria-current', 'page');

      // Not trusted yet: the prompt, and nothing else.
      await expect(page.getByTestId('problems-trust')).toContainText("Problems runs this project's own commands");
      await expectAxeClean(page, 'trust');
      await page.getByTestId('problems-trust-allow').click();
      await expect(page.getByTestId('problems-empty')).toHaveText('No test or lint command yet.');

      // A command that needs a shell is refused in plain words.
      await page.getByTestId('problems-add').click();
      await page.getByTestId('problems-command-name').fill('Deploy');
      await page.getByTestId('problems-command-input').fill('node fail.js && rm -rf x');
      await page.getByTestId('problems-save-command').click();
      await expect(page.getByTestId('problems-save-error')).toContainText('without a shell');

      // The declared command.
      await page.getByTestId('problems-command-name').fill('Check');
      await page.getByTestId('problems-command-input').fill('node fail.js');
      await page.getByTestId('problems-save-command').click();
      const row = page.getByTestId('problems-command');
      await expect(row.getByTestId('problems-command-text')).toHaveText('node fail.js');

      await row.getByTestId('problems-run').click();
      const item = row.getByTestId('problems-item');
      await expect(item).toHaveCount(1);
      await expect(row.getByTestId('problems-result')).toHaveText('Failed: 1 failure');
      await expect(page.getByTestId('problems-announcement')).toHaveText('Check finished: 1 failure');
      const link = item.getByRole('link', { name: 'src/a.ts:12' });
      await expect(link).toHaveAttribute('title', 'Open src/a.ts at line 12');

      // The output, masked.
      await row.getByTestId('problems-show-output').click();
      await expect(row.getByTestId('problems-output')).toContainText('TOKEN=[redacted]');
      await expect(row.getByTestId('problems-output')).not.toContainText('e2e-problems-secret-8c1d');

      await expectAxeClean(page, 'problems');
      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoSidewaysScroll(page);
      await expectAxeClean(page, 'problems at 390px');
      await page.setViewportSize({ width: 1440, height: 900 });

      // The item opens the viewer at its line.
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench\\?`));
      await expect(page.getByTestId('code-view-path')).toHaveText('src/a.ts');
      const target = page.locator('[data-testid="code-line"][data-line="12"]');
      await expect(target).toHaveAttribute('data-highlighted', 'true');
      await expect(target).toBeInViewport();

      // Ask the agent to fix this: the chat's composer has the failure, and nothing was sent.
      await page.goto(`${server.url}/w/${wsId}/workbench?panel=problems`);
      await page.getByTestId('problems-ask').click();
      await expect(page).toHaveURL(chatUrl);
      const draft = composer(page);
      await expect(draft).toHaveValue(/^Fix this failure from node fail\.js:\n\nsrc\/a\.ts:12 TS2322: Type 'string' is not assignable to type 'number'\./);
      // With the output line it came from.
      await expect(draft).toHaveValue(/\n\nsrc\/a\.ts\(12,5\): error TS2322: Type 'string' is not assignable to type 'number'\.$/);
      await expect(page.getByTestId('message-user')).toHaveCount(0);
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    },
    { files: { 'src/a.ts': SOURCE, 'fail.js': FAIL, '.git/config': '[core]\n' } },
  );
});
