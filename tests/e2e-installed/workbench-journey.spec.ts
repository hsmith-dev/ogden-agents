/// <reference lib="dom" />
/**
 * Epic 8's Workbench against the installed package, in Chromium (story
 * 8.13), on a server of its own started by the installed `ogden` launcher,
 * with its own data folder, home folder, the fake agent, a fake git repo and
 * a fake `code` in a folder under the suite's extra folder (the
 * `OGDEN_AGENTS_TEST_EDITOR_PATH` hook):
 *
 * 1. One fake agent turn edits two files; its Review changes opens This turn
 *    with both. Of `list.txt`'s two hunks, Revert lines 15 to 20 (Cancel
 *    first, which changes nothing) puts only that hunk back on disk, and
 *    Undo restores the agent's text.
 * 2. A comment on `src/cart.ts` line 2 is sent to the chat, edited in the
 *    composer and sent from there; the agent's next prompt holds
 *    `src/cart.ts:2`, the quoted line, the comment and the edit.
 * 3. Project search finds a word and opens its result at its line.
 * 4. Problems, before trust, shows only the trust prompt; once trusted, a
 *    declared `node fail.js` command (a `node` command, so it runs on
 *    Windows too) fails, and its failure opens the viewer at `src/a.ts:12`.
 *    Ask the agent to fix this fills the chat's draft and sends nothing;
 *    Open in editor hands `-g` and `<real path>/src/a.ts:12:5` to the fake
 *    `code`.
 * 5. Cmd/Ctrl+K finds a file by name and Enter opens it in the viewer.
 *
 * No real agent, editor, account, keychain or network. The server is quit at
 * the end, and its folders removed.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { recordedEditorArgs, writeFakeEditors } from '../fixtures/fake-editors.js';
import { requestQuit } from '../support.js';
import { composer, send, startChat } from '../e2e/chat-server.js';
import { blur, expectConnected, landConnected, paletteKey, storedToken } from '../e2e/tab.js';
import { bmadServer, extraFolder, waitForExit, type BmadServer, type Launched } from './installed.js';

const servers: BmadServer[] = [];

test.afterAll(async () => {
  for (const server of servers) await server.remove();
});

/** An agent's reply, a turn's end or a command's run: Windows runners take far longer than the default. */
const SLOW = { timeout: 60_000 };

const idle = (page: Page) => expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle', SLOW);
const encode = (content: string) => Buffer.from(content).toString('base64');

/** Twenty numbered lines, with `changes` (1-based line: new text) made. */
const numbered = (changes: Record<number, string> = {}): string => `${Array.from({ length: 20 }, (_, index) => changes[index + 1] ?? `line ${index + 1}`).join('\n')}\n`;
/** Forty lines; line 7 holds the word the search finds. */
const SOURCE = Array.from({ length: 40 }, (_, i) => (i === 6 ? 'export const zebraword = 7;' : `export const line${i + 1} = ${i + 1};`)).join('\n') + '\n';
/** The declared command's script: a TypeScript error at `src/a.ts` line 12, column 5, and exit 1. */
const FAIL = ["console.log(\"src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\");", 'process.exitCode = 1;'].join('\n');
/** A detected `test` script: offered only once the project is trusted. */
const PACKAGE_JSON = `${JSON.stringify({ name: 'workbench-shop', private: true, scripts: { test: 'node fail.js' } }, null, 2)}\n`;
const CART = "export const cart: number[] = [];\nexport const total = cart.reduce((sum, item) => sum + Math.round(item), 0);\n";

/** Quits the server as the UI does, and waits for its process to exit. */
async function quit(page: Page, launched: Launched) {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  // A quit while a chat is busy is refused (409 sessions_busy).
  await idle(page);
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
}

test('This turn, a reverted and undone hunk, a comment the agent receives, search, Problems, Open in editor and Cmd/Ctrl+K, on the installed package', async ({ page }) => {
  test.setTimeout(300_000);
  // The editor launcher looks only in this folder (its real path, inside the temp folder): a fake `code` and `cursor`.
  const editors = writeFakeEditors(realpathSync.native(extraFolder('journey-workbench-editors')));
  const server = bmadServer('journey-workbench', { env: { OGDEN_AGENTS_TEST_EDITOR_PATH: editors } });
  servers.push(server);
  const repo = server.addRepo({
    bmad: false,
    git: true,
    prefix: 'workbench-shop-',
    files: { 'README.md': '# Shop\n', 'list.txt': numbered(), 'src/a.ts': SOURCE, 'src/zebra-notes.md': '# Zebra notes\n\nStripes.\n', 'fail.js': FAIL, 'package.json': PACKAGE_JSON },
  });
  const root = realpathSync.native(repo.path);

  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  const chat = await startChat(page, repo.path);
  const edited = numbered({ 2: 'line two, by the agent', 18: 'line eighteen, by the agent' });

  await test.step("a turn edits two files; This turn shows both; one hunk reverted, then Undo", async () => {
    await send(page, `write-file list.txt ${encode(edited)} src/cart.ts ${encode(CART)}`, SLOW);
    await expect(page.getByTestId('turn-changes')).toHaveCount(1, SLOW);
    await idle(page);
    await page.getByTestId('turn-changes').getByRole('link', { name: 'Review changes' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/workbench\\?.*panel=changes`), SLOW);
    await expect(page.getByTestId('workbench-changes')).toHaveAttribute('data-view', 'turn', SLOW);
    const files = page.getByTestId('diff-file-list-item');
    await expect(files).toHaveCount(2, SLOW);
    expect((await files.evaluateAll((items) => items.map((item) => item.getAttribute('data-path')))).sort()).toEqual(['list.txt', 'src/cart.ts']);

    const list = page.locator('[data-testid="diff-file"][data-diff-file="list.txt"]');
    await expect(list.getByTestId('changes-hunk-action')).toHaveCount(2);
    const second = list.getByRole('button', { name: 'Revert lines 15 to 20', exact: true });
    // Cancel changes nothing.
    await second.click();
    const confirm = page.getByTestId('changes-revert-confirm');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    expect(readFileSync(join(root, 'list.txt'), 'utf8')).toBe(edited);

    await second.click();
    await page.getByTestId('changes-revert-confirm-button').click();
    await expect(page.getByTestId('changes-reverted')).toContainText('Reverted lines 15 to 20 in list.txt.', SLOW);
    await expect.poll(() => readFileSync(join(root, 'list.txt'), 'utf8'), SLOW).toBe(numbered({ 2: 'line two, by the agent' }));

    await page.getByTestId('changes-undo').click();
    await expect(page.getByTestId('changes-reverted')).toHaveText('Put back.', SLOW);
    await expect.poll(() => readFileSync(join(root, 'list.txt'), 'utf8'), SLOW).toBe(edited);
  });

  await test.step('a comment on src/cart.ts line 2 goes to the chat, is edited in the composer, and the agent receives it', async () => {
    const table = page.getByRole('table', { name: 'Changes in src/cart.ts' });
    await table.getByRole('button', { name: 'Comment on line 2' }).click();
    await page.getByTestId('diff-comment-input').fill('Round after summing, not per item.');
    await page.getByTestId('diff-comment-save').click();
    await expect(page.getByTestId('comments-bar-title')).toHaveText('Comments to send (1)');

    await page.getByTestId('comments-send').click();
    await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/s/${chat.sesId}`), SLOW);
    const box = composer(page);
    await expect(box).toHaveValue(/^Please address these review comments:/, SLOW);
    const message = await box.inputValue();
    expect(message).toContain('src/cart.ts:2\n> + export const total = cart.reduce((sum, item) => sum + Math.round(item), 0);\nRound after summing, not per item.');

    // Edited in the composer (the `review-echo ` prefix makes the fake agent reply with the prompt it got), then sent.
    await send(page, `review-echo ${message}\nKeep the total in cents.`, SLOW);
    const reply = page.getByTestId('message-agent').last();
    await expect(reply).toContainText('RECEIVED<<review-echo Please address these review comments:', SLOW);
    const received = /RECEIVED<<([\s\S]*?)>>RECEIVED/.exec((await reply.textContent()) ?? '')?.[1] ?? '';
    expect(received).toContain('src/cart.ts:2');
    // The reply is rendered as markdown: the quoted line's text, not its `> +`.
    expect(received).toContain('export const total = cart.reduce((sum, item) => sum + Math.round(item), 0);');
    expect(received).toContain('Round after summing, not per item.');
    expect(received).toContain('Keep the total in cents.');
    await idle(page);
  });

  await test.step('project search opens a result at its line', async () => {
    await page.goto(new URL(`/w/${chat.wsId}/workbench?panel=search`, launched.url).href);
    const field = page.getByLabel('Search the project');
    await expect(field).toBeVisible(SLOW);
    await field.fill('zebraword');
    const results = page.getByTestId('search-results');
    await expect(results.getByTestId('search-file-path')).toHaveText(['src/a.ts'], SLOW);
    await results.getByTestId('search-match').first().click();
    await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/workbench\\?path=src%2Fa\\.ts&line=7$`), SLOW);
    await expect(page.locator('[data-testid="code-line"][data-line="7"]')).toHaveAttribute('data-highlighted', 'true', SLOW);
  });

  await test.step('Problems: only the trust prompt before trust; then a declared node command fails, opens at its line, Ask fills the draft, Open in editor hands file:line to code', async () => {
    await page.goto(new URL(`/w/${chat.wsId}/workbench?panel=problems`, launched.url).href);
    await expect(page.getByTestId('problems-trust')).toContainText("Problems runs this project's own commands", SLOW);
    // The package.json's test script is not offered, and nothing can be added or run, before trust.
    await expect(page.getByTestId('problems-offer')).toHaveCount(0);
    await expect(page.getByTestId('problems-add')).toHaveCount(0);
    await expect(page.getByTestId('problems-command')).toHaveCount(0);
    await page.getByTestId('problems-trust-allow').click();
    // Trusted: the detected script is offered; Not now dismisses it, and nothing is declared.
    await expect(page.getByTestId('problems-offer')).toBeVisible(SLOW);
    await expect(page.getByTestId('problems-offer-script')).toHaveText('test: node fail.js');
    await page.getByTestId('problems-not-now').click();
    await expect(page.getByTestId('problems-offer')).toHaveCount(0);
    await expect(page.getByTestId('problems-empty')).toHaveText('No test or lint command yet.', SLOW);

    await page.getByTestId('problems-add').click();
    await page.getByTestId('problems-command-name').fill('Check');
    await page.getByTestId('problems-command-input').fill('node fail.js');
    await page.getByTestId('problems-save-command').click();
    const row = page.getByTestId('problems-command');
    await expect(row.getByTestId('problems-command-text')).toHaveText('node fail.js', SLOW);
    await row.getByTestId('problems-run').click();
    const item = row.getByTestId('problems-item');
    await expect(item).toHaveCount(1, SLOW);
    await expect(row.getByTestId('problems-result')).toHaveText('Failed: 1 failure', SLOW);

    // Opens the viewer at its line.
    await item.getByRole('link', { name: 'src/a.ts:12' }).click();
    await expect(page.getByTestId('code-view-path')).toHaveText('src/a.ts', SLOW);
    const target = page.locator('[data-testid="code-line"][data-line="12"]');
    await expect(target).toHaveAttribute('data-highlighted', 'true', SLOW);
    await expect(target).toBeInViewport();

    // Open in editor on the failure: the fake `code` gets `-g` and the real path with line and column.
    await page.goto(new URL(`/w/${chat.wsId}/workbench?panel=problems`, launched.url).href);
    await page.getByTestId('problems-item').getByTestId('problems-open-in-editor').click();
    await expect.poll(() => recordedEditorArgs(editors, 'code'), SLOW).toBe(`-g\n${join(root, 'src', 'a.ts')}:12:5\n`);
    expect(recordedEditorArgs(editors, 'cursor')).toBeUndefined();

    // Ask the agent to fix this: the chat's draft, nothing sent.
    await page.getByTestId('problems-ask').click();
    await expect(page).toHaveURL(chat.url, SLOW);
    await expect(composer(page)).toHaveValue(/^Fix this failure from node fail\.js:\n\nsrc\/a\.ts:12 TS2322: /, SLOW);
    // Only the turn that wrote the files and the comments' message.
    await expect(page.getByTestId('message-user')).toHaveCount(2, SLOW);
    await idle(page);
    await composer(page).fill('');
  });

  await test.step('Cmd/Ctrl+K finds a file by name and opens it', async () => {
    await page.goto(new URL(`/w/${chat.wsId}`, launched.url).href);
    await expect(page.getByTestId('workspace-tab-workbench')).toBeVisible(SLOW);
    await blur(page);
    await page.keyboard.press(await paletteKey(page));
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await page.getByRole('combobox').pressSequentially('zebra');
    const files = palette.getByRole('group', { name: 'Files' });
    await expect(files.getByRole('option')).toHaveCount(1, SLOW);
    await expect(files.getByRole('option')).toContainText('zebra-notes.md');
    await expect(files.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/workbench\\?path=src%2Fzebra-notes\\.md$`), SLOW);
    await expect(page.getByTestId('markdown-rendered').getByRole('heading', { name: 'Zebra notes' })).toBeVisible(SLOW);
  });

  await page.goto(chat.url);
  await quit(page, launched);
});
