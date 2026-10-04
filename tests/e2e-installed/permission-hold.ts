/**
 * The permission hold, as the chat journey checks it and the hold proof
 * proves it (story 2.13): after "permission" is sent under the default
 * caution level, the agent's `npm test` must not run while no one answers.
 * The card shows, the session waits, and no "Ran npm test." reply appears.
 */
import { expect, type Page } from '@playwright/test';

/** What `expectHeld` throws when the command ran before anyone decided. The hold proof requires exactly this. */
export const RAN_WITHOUT_DECISION = 'npm test ran without a decision: the permission hold did not hold';

/** How long no one answers before the check is satisfied that nothing runs. */
const UNANSWERED_MS = 1_500;

const ranReply = (page: Page) => page.getByTestId('message-agent').filter({ hasText: 'Ran npm test.' });

/** Throws {@link RAN_WITHOUT_DECISION} if the command's "Ran" reply is on the page. */
async function expectNotRun(page: Page): Promise<void> {
  if ((await ranReply(page).count()) > 0) throw new Error(RAN_WITHOUT_DECISION);
}

/**
 * Checks that the open chat, just sent "permission", holds `npm test` for a
 * decision: first whichever comes first, the card or the command's reply
 * (the reply fails at once), then the card and the `waiting` state, and
 * still no reply after a while with no answer.
 */
export async function expectHeld(page: Page): Promise<void> {
  const card = page.getByTestId('permission-card');
  await expect(card.or(ranReply(page)).first()).toBeVisible();
  await expectNotRun(page);

  await expect(card).toContainText('Claude Code wants to run a command');
  await expect(card.getByTestId('permission-command')).toHaveText('npm test');
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'waiting');

  // No one answers: nothing runs, and the session keeps waiting.
  await page.waitForTimeout(UNANSWERED_MS);
  await expectNotRun(page);
  await expect(card).toBeVisible();
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'waiting');
}
