/**
 * The issue tracker routes (CAP-35, epic 27): tracker accounts in
 * Settings, and the issues a chat can start from. Under `/api/v1`, behind
 * the gate (AD-15). Routes call core's `TrackerAccounts` and never write
 * themselves (AD-11). A token is read once from the add request's body,
 * goes to the keychain (AD-16), and is never answered, logged or evented:
 * these routes are `no-store`, bodies are read with a small limit, and
 * only codes reach the log.
 */
import { CoreError, NotFoundError, SecretsUnavailableError, TrackerError, ValidationError, type TrackerAccounts } from '@ogden-agents/core';
import { API_ROUTES, IssueContextResponse, IssuesResponse, TrackerAccountId, TrackerAccountResponse, TrackerAccountsResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

/** Largest body read: a kind, a label, a scope and a token, with room. */
const MAX_BODY_BYTES = 4 * 1024;

const noStore = (c: Context) => c.header('Cache-Control', 'no-store');
const NOT_JSON = Symbol('not json');
async function jsonBody(c: Context): Promise<unknown> {
  try {
    return JSON.parse(await c.req.text()) as unknown;
  } catch {
    return NOT_JSON;
  }
}
const tooLarge = (c: Context) => apiError(c, 413, 'invalid_request', 'The request is too large.');
const NO_ACCOUNT = 'That tracker account is not set up.';

export interface TrackerRoutesOptions {
  trackerAccounts?: TrackerAccounts | undefined;
  log: Logger;
}

export function registerTrackerRoutes(app: Hono, { trackerAccounts, log }: TrackerRoutesOptions): void {
  if (trackerAccounts === undefined) {
    app.get(API_ROUTES.trackerAccounts, notImplemented);
    app.post(API_ROUTES.trackerAccounts, notImplemented);
    app.delete(API_ROUTES.trackerAccount, notImplemented);
    app.get(API_ROUTES.trackerIssues, notImplemented);
    app.get(API_ROUTES.trackerIssueContext, notImplemented);
    return;
  }
  const accounts = trackerAccounts;
  const idOf = (c: Context): TrackerAccountId | undefined => {
    const parsed = TrackerAccountId.safeParse(c.req.param('accountId'));
    return parsed.success ? parsed.data : undefined;
  };
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', NO_ACCOUNT);
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof TrackerError) {
      log.warn('tracker call failed', { code: error.code });
      if (error.failure === 'unauthorized') return apiError(c, 409, 'tracker_unauthorized', error.message);
      if (error.failure === 'not_found') return apiError(c, 404, 'tracker_not_found', error.message);
      return apiError(c, 502, 'tracker_unreachable', error.message);
    }
    if (error instanceof SecretsUnavailableError) {
      log.warn('the keychain is unavailable', { code: typeof error.cause === 'string' ? error.cause : 'unknown' });
      return apiError(c, 503, 'secrets_unavailable', error.message);
    }
    log.error('tracker request failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'internal_error', "Ogden Agents couldn't do that. Try again.");
  };
  const limit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });

  app.get(API_ROUTES.trackerAccounts, (c) => {
    noStore(c);
    return c.json(TrackerAccountsResponse.parse({ accounts: accounts.list() }));
  });

  app.post(API_ROUTES.trackerAccounts, limit, async (c) => {
    noStore(c);
    const body = await jsonBody(c);
    if (body === NOT_JSON) return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
    try {
      const account = await accounts.add(body);
      log.info('tracker account added', { kind: account.kind });
      return c.json(TrackerAccountResponse.parse({ account }), 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.delete(API_ROUTES.trackerAccount, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', NO_ACCOUNT);
    try {
      await accounts.remove(id);
      log.info('tracker account removed');
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.get(API_ROUTES.trackerIssues, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', NO_ACCOUNT);
    const q = c.req.query('q');
    try {
      return c.json(IssuesResponse.parse({ issues: await accounts.issues(id, q === undefined ? {} : { q }) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.get(API_ROUTES.trackerIssueContext, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', NO_ACCOUNT);
    try {
      return c.json(IssueContextResponse.parse(await accounts.issueContext(id, c.req.param('issueKey'))));
    } catch (error) {
      return refusal(c, error);
    }
  });
}
