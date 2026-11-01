/// <reference lib="dom" />
/**
 * The Workbench's Files panel (AD-36) in a real browser: from a project's
 * Chats page, the Workbench tab lists the fixture project, and selecting
 * `src/a.ts` shows its lines read-only with line numbers, at desktop and
 * phone widths with no sideways scroll; a protected row shows the protected
 * sentence and no content request is made for it.
 */
import { expect, test, type Page } from '@playwright/test';
import { API_ROUTES } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const SOURCE = 'const a = 1;\n\nexport function add(b: number): number {\n  return a + b;\n}\n';

/** Adds the folder `repo` as a project through the REST API. */
async function addProject(page: Page, repo: string): Promise<string> {
  const origin = new URL(page.url()).origin;
  const response = await fetch(`${origin}${API_ROUTES.workspaces}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await storedToken(page)}`, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ path: repo }),
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

/** Nothing scrolls sideways. */
async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** The lines shown, as text, and their numbers. */
async function shownLines(page: Page) {
  const rows = page.getByTestId('code-line');
  return {
    numbers: await page.getByTestId('code-line-number').allTextContents(),
    text: await rows.evaluateAll((elements) => elements.map((element) => element.lastElementChild?.textContent ?? '')),
  };
}

test('the Workbench tab lists the project and shows src/a.ts read-only with line numbers; a protected row is never requested', async ({ page }) => {
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      const contentRequests: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/files/content')) contentRequests.push(request.url());
      });

      await page.goto(`${server.url}/w/${wsId}`);
      await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Workbench' }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench$`));
      await expect(page.getByRole('heading', { name: 'Workbench', level: 1 })).toBeVisible();
      await expect(page.getByTestId('workbench-panel-files')).toHaveAttribute('aria-current', 'page');

      // The tree: folders first, the protected one with its lock.
      const tree = page.getByTestId('file-tree');
      await expect(tree.getByTestId('file-row-.git')).toHaveAttribute('data-protected', 'true');
      await expect(tree.getByTestId('file-row-README.md')).toBeVisible();

      // A protected row: the sentence, and no content request.
      await tree.getByTestId('file-row-.git').click();
      await expect(page.getByTestId('file-protected')).toHaveText("Protected. Ogden doesn't open this file.");
      expect(contentRequests).toEqual([]);

      // The file: open its folder, then select it.
      await tree.getByTestId('file-row-src').click();
      await tree.getByTestId('file-row-src/a.ts').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench\\?path=src%2Fa\\.ts$`));
      await expect(page.getByTestId('code-view-path')).toHaveText('src/a.ts');
      await expect(page.getByTestId('code-line')).toHaveCount(5);
      expect(await shownLines(page)).toEqual({ numbers: ['1', '2', '3', '4', '5'], text: SOURCE.slice(0, -1).split('\n') });
      expect(contentRequests).toHaveLength(1);
      // Read-only: nothing to type into in the viewer.
      await expect(page.getByTestId('code-view').getByRole('textbox')).toHaveCount(0);
      await expectNoSidewaysScroll(page);

      // At phone width, after a reload (the selection is in the URL), the same lines and no sideways scroll.
      await page.setViewportSize({ width: 375, height: 740 });
      await page.reload();
      await expect(page.getByTestId('code-view-path')).toHaveText('src/a.ts');
      await expect(page.getByTestId('file-row-src/a.ts')).toHaveAttribute('aria-current', 'true');
      expect((await shownLines(page)).numbers).toEqual(['1', '2', '3', '4', '5']);
      await expectNoSidewaysScroll(page);
    },
    { files: { 'src/a.ts': SOURCE, 'README.md': '# Fixture\n', '.git/config': '[core]\n\tbare = false\n' } },
  );
});
