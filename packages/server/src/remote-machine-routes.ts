/**
 * The remote-machine routes (CAP-24, epic 18 story 18.3; AD-26): the
 * machines the user added over SSH, in Settings. Under `/api/v1`, behind
 * the gate (a tab token and a matching `Origin` on a write; AD-15). Routes
 * call core's `RemoteMachines` and never write themselves (AD-11). A
 * machine's SSH private key goes to the keychain once (AD-16) and is never
 * answered, logged or evented: these routes are `no-store`, bodies are
 * read with a small limit, and only codes reach the log.
 */
import { CoreError, NotFoundError, RemoteHostError, ConfirmationRequiredError, SecretsUnavailableError, ValidationError, type RemoteMachines } from '@ogden-agents/core';
import { API_ROUTES, RemoteHostKeyCheckResponse, RemoteMachineId, RemoteMachineResponse, RemoteMachinesResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

/** Largest body read: a host, a username, a label and a fingerprint, with room. */
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

export interface RemoteMachineRoutesOptions {
  remoteMachines?: RemoteMachines | undefined;
  log: Logger;
}

export function registerRemoteMachineRoutes(app: Hono, { remoteMachines, log }: RemoteMachineRoutesOptions): void {
  if (remoteMachines === undefined) {
    app.get(API_ROUTES.remoteMachines, notImplemented);
    app.post(API_ROUTES.remoteMachines, notImplemented);
    app.patch(API_ROUTES.remoteMachine, notImplemented);
    app.delete(API_ROUTES.remoteMachine, notImplemented);
    app.post(API_ROUTES.remoteMachineHostKeyCheck, notImplemented);
    app.post(API_ROUTES.remoteMachineHostKeyConfirm, notImplemented);
    return;
  }
  const machines = remoteMachines;

  const idOf = (c: Context): RemoteMachineId | undefined => {
    const parsed = RemoteMachineId.safeParse(c.req.param('machineId'));
    return parsed.success ? parsed.data : undefined;
  };
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', 'That machine is not set up.');
    if (error instanceof ConfirmationRequiredError) return apiError(c, 400, 'confirmation_required', error.message);
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof RemoteHostError) {
      if (error.code === 'host_key_changed') return apiError(c, 409, 'remote_host_key_changed', error.message, error.details);
      if (error.code === 'host_key_not_confirmed') return apiError(c, 409, 'remote_host_key_not_confirmed', error.message, error.details);
      if (error.code === 'host_timeout') return apiError(c, 504, 'remote_host_timeout', error.message, error.details);
      return apiError(c, 502, 'remote_host_unreachable', error.message, error.details);
    }
    if (error instanceof SecretsUnavailableError) {
      log.warn('the keychain is unavailable', { code: typeof error.cause === 'string' ? error.cause : 'unknown' });
      return apiError(c, 503, 'secrets_unavailable', error.message);
    }
    log.error('remote machine request failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'internal_error', "Ogden Agents couldn't do that. Try again.");
  };
  const list = () => RemoteMachinesResponse.parse({ machines: machines.list() });
  const limit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });

  app.get(API_ROUTES.remoteMachines, (c) => {
    noStore(c);
    return c.json(list());
  });

  app.post(API_ROUTES.remoteMachines, limit, async (c) => {
    noStore(c);
    const body = await jsonBody(c);
    if (body === NOT_JSON) return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
    try {
      const machine = machines.add(body);
      log.info('remote machine added', { port: machine.port });
      return c.json(RemoteMachineResponse.parse({ machine }), 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.patch(API_ROUTES.remoteMachine, limit, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', 'That machine is not set up.');
    const body = await jsonBody(c);
    if (body === NOT_JSON) return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
    try {
      return c.json(RemoteMachineResponse.parse({ machine: machines.rename(id, body) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.delete(API_ROUTES.remoteMachine, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', 'That machine is not set up.');
    try {
      await machines.remove(id);
      log.info('remote machine removed');
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.post(API_ROUTES.remoteMachineHostKeyCheck, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', 'That machine is not set up.');
    try {
      const check = await machines.checkHostKey(id);
      return c.json(RemoteHostKeyCheckResponse.parse(check));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.post(API_ROUTES.remoteMachineHostKeyConfirm, limit, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', 'That machine is not set up.');
    const body = await jsonBody(c);
    if (body === NOT_JSON) return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
    try {
      const machine = await machines.confirmHostKey(id, body);
      log.info('remote machine host key confirmed');
      return c.json(RemoteMachineResponse.parse({ machine }));
    } catch (error) {
      return refusal(c, error);
    }
  });
}
