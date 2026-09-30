/** The route that stops the server (Quit Ogden Agents). */
export const QUIT_PATH = '/api/server/quit';

/**
 * Asks the local server to stop cleanly (AD-3: it runs until Quit). A
 * same-origin POST, so the browser sends the `Origin` the gate checks.
 *
 * Only the Quit confirmation calls this, so it always sends `force: true`:
 * the user has read that running agents stop too. Resolves once the server
 * has accepted; throws an error with a plain message if it refused or could
 * not be reached.
 */
export async function quitServer(fetchImpl: typeof fetch = fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(QUIT_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
  } catch {
    throw new Error("Couldn't reach Ogden Agents. Check that it is still running, then try again.");
  }
  if (response.status !== 202) {
    let message = `Ogden Agents didn't quit (error ${response.status}). Try again.`;
    try {
      const body = (await response.json()) as { error?: { message?: unknown } };
      if (typeof body.error?.message === 'string') message = body.error.message;
    } catch {
      // Not JSON: keep the plain message.
    }
    throw new Error(message);
  }
}
