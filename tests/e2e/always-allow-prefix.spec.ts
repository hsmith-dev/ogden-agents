/// <reference lib="dom" />
/**
 * Always allow by how a command starts in a real browser (AD-40, epic 26
 * story 8): the card offers the exact command (selected) and commands
 * starting with Ogden's prefix; arrow keys pick the prefix and `2` saves it;
 * `npm test -- --watch` then runs without a card; a chained command offers no
 * Always allow and says why; the rule is removed in Settings, Projects,
 * Always allow rules, and the next such command asks again. Each test runs
 * its own server.
 */
import { expect, test, type Page } from '@playwright/test';
import { send, startChat, withChatServer } from './chat-server.js';

const replies = (page: Page) => page.getByTestId('message-agent');
const card = (page: Page) => page.getByTestId('permission-card');
const idle = (page: Page) => expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

test('a prefix rule saved with 2 lets npm test -- --watch run; removed in Settings, the next one asks', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const { url: chatUrl } = await startChat(page, repo);
    await send(page, 'permission npm test -- cart');
    await expect(card(page)).toBeVisible();
    const scope = card(page).getByRole('radiogroup', { name: 'What Always allow covers' });
    const exact = scope.getByRole('radio', { name: /^Exactly npm test -- cart in / });
    const prefix = scope.getByRole('radio', { name: /^Commands starting with npm test in / });
    await expect(exact).toHaveAttribute('aria-checked', 'true');
    await expect(prefix).toHaveAttribute('aria-checked', 'false');

    // Arrow keys move within the choice; 2 saves the selected one.
    await exact.focus();
    // Held down as a person would: Radix checks the radio its arrow key moves focus to (after a tick).
    await page.keyboard.down('ArrowDown');
    await expect(prefix).toBeFocused();
    await page.keyboard.up('ArrowDown');
    await expect(prefix).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('2');
    await expect(replies(page)).toContainText('Ran npm test -- cart.');
    await idle(page);
    await expect(page.getByTestId('permission-record').first()).toContainText('Always allowed: commands starting with npm test');

    await send(page, 'permission npm test -- --watch');
    await expect(replies(page).nth(1)).toContainText('Ran npm test -- --watch.');
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId('permission-record').nth(1)).toContainText('Allowed by your Always allow rule: npm test -- --watch');
    await idle(page);

    // Chained: no Always allow, one line says why, and the rule doesn't answer it.
    await send(page, 'permission npm test && npm run deploy');
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Always allow' })).toHaveCount(0);
    await expect(card(page).getByTestId('permission-scope')).toHaveText("Always allow isn't offered for this command, because it runs more than one thing.");
    await card(page).getByRole('button', { name: 'Deny' }).click();
    await expect(replies(page).nth(2)).toContainText('Denied npm test && npm run deploy.');
    await idle(page);

    // Settings, Projects: every project's rules, each with Remove.
    await page.goto(new URL('/settings/always-allow', chatUrl).href);
    await expect(page.getByRole('heading', { name: 'Always allow rules', level: 1 })).toBeVisible();
    const row = page.getByTestId('rule-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Commands starting with npm test in ogden-agents-e2e-repo-');
    await row.getByRole('button', { name: /^Remove Commands starting with npm test in / }).click();
    await expect(page.getByTestId('rules-removed')).toHaveText('Removed. Ogden will ask next time.');
    await expect(page.getByTestId('rules-empty')).toHaveText('No Always allow rules. Ogden asks before each action.');

    await page.goto(chatUrl);
    await idle(page);
    await send(page, 'permission npm test -- --watch');
    await expect(card(page)).toBeVisible();
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'waiting');
  });
});
