import { API_ROUTES } from '@ogden-agents/shared';
import { errorMessage, UNREACHABLE } from '@/api/http';
import { tabAuth, type TabAuth } from '@/auth/tab-token';

/**
 * Asks the local server to stop cleanly (AD-3: it runs until Quit). A
 * same-origin POST with this tab's token, so the browser sends the `Origin`
 * the gate checks.
 *
 * Only the Quit confirmation calls this, so it always sends `force: true`:
 * the user has read that running agents stop too. Resolves once the server
 * has accepted; throws an error with a plain message if it refused or could
 * not be reached.
 */
export async function quitServer(auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<void> {
  let response: Response;
  try {
    response = await auth.fetch(API_ROUTES.serverQuit, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
  } catch {
    throw new Error(UNREACHABLE);
  }
  if (response.status !== 202) throw new Error(await errorMessage(response, `Ogden Agents didn't quit (error ${response.status}). Try again.`));
}

/**
 * A fresh single-use launch link for New tab: opening it gives the new tab
 * its own token. Throws an error with a plain message if the server refused
 * or could not be reached.
 */
export async function requestNewTabLink(auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<string> {
  let response: Response;
  try {
    response = await auth.fetch(API_ROUTES.launchCodes, { method: 'POST' });
  } catch {
    throw new Error(UNREACHABLE);
  }
  const body = (await response.json().catch(() => ({}))) as { launchUrl?: unknown };
  if (response.status !== 201 || typeof body.launchUrl !== 'string') {
    throw new Error(`Couldn't open a new tab (error ${response.status}). Try again.`);
  }
  return body.launchUrl;
}
