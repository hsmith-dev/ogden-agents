/**
 * The Local model's endpoint routes (epic 14 story 14.3; E14-R2, E14-R6):
 * the OpenAI-compatible servers the user sets up in Settings, Agents. Under
 * `/api/v1`, behind the gate (a tab token and a matching `Origin` on a write;
 * AD-15). Routes call core's `LocalEndpoints` and never write themselves
 * (AD-11). Only the server ever calls an endpoint, never the page.
 *
 * A key goes to core once (to the keychain, AD-16) and is never answered,
 * logged or evented: these routes are `no-store`, bodies are read with a
 * small limit, and only codes reach the log. A host that is not this
 * computer is refused until the user confirmed it (409
 * `endpoint_confirmation_required`); the confirmation is bound to the host.
 */
import { CoreError, EndpointConfirmationRequiredError, NotFoundError, SecretsUnavailableError, ValidationError, type LocalEndpoints } from '@ogden-agents/core';
import { API_ROUTES, LocalEndpointId, LocalEndpointResponse, LocalEndpointsResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

/** Largest body read: a label, an address and a key (at most 1000 characters) with room. */
const MAX_BODY_BYTES = 8 * 1024;

const noStore = (c: Context) => c.header('Cache-Control', 'no-store');
const tooLarge = (c: Context) => apiError(c, 413, 'invalid_request', 'The request is too large.');

export interface LocalEndpointRoutesOptions {
  localEndpoints?: LocalEndpoints | undefined;
  log: Logger;
}

export function registerLocalEndpointRoutes(app: Hono, { localEndpoints, log }: LocalEndpointRoutesOptions): void {
  if (localEndpoints === undefined) {
    app.get(API_ROUTES.localEndpoints, notImplemented);
    app.post(API_ROUTES.localEndpoints, notImplemented);
    app.patch(API_ROUTES.localEndpoint, notImplemented);
    app.delete(API_ROUTES.localEndpoint, notImplemented);
    app.put(API_ROUTES.localEndpointKey, notImplemented);
    app.delete(API_ROUTES.localEndpointKey, notImplemented);
    app.post(API_ROUTES.localEndpointConfirm, notImplemented);
    app.put(API_ROUTES.localEndpointDefault, notImplemented);
    return;
  }
  const endpoints = localEndpoints;

  const idOf = (c: Context): LocalEndpointId | undefined => {
    const parsed = LocalEndpointId.safeParse(c.req.param('endpointId'));
    return parsed.success ? parsed.data : undefined;
  };
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', 'That server is not set up.');
    if (error instanceof EndpointConfirmationRequiredError) return apiError(c, 409, 'endpoint_confirmation_required', error.message, { host: error.host });
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof SecretsUnavailableError) {
      log.warn('the keychain is unavailable', { code: typeof error.cause === 'string' ? error.cause : 'unknown' });
      return apiError(c, 503, 'secrets_unavailable', error.message);
    }
    log.error('local endpoint request failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'internal_error', "Ogden Agents couldn't save that. Try again.");
  };
  const list = () => LocalEndpointsResponse.parse({ endpoints: endpoints.list(), defaultEndpointId: endpoints.defaultEndpointId() });
  const limit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });

  app.get(API_ROUTES.localEndpoints, (c) => {
    noStore(c);
    return c.json(list());
  });

  app.post(API_ROUTES.localEndpoints, limit, async (c) => {
    noStore(c);
    // The body is parsed by core, which owns the rules; the key in it is never read here.
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
    }
    try {
      const endpoint = await endpoints.add(body);
      log.info('local endpoint added', { loopback: endpoint.loopback, hasKey: endpoint.keySaved });
      return c.json(LocalEndpointResponse.parse({ endpoint }), 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.patch(API_ROUTES.localEndpoint, limit, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', 'That server is not set up.');
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
    }
    try {
      return c.json(LocalEndpointResponse.parse({ endpoint: endpoints.update(id, body) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.delete(API_ROUTES.localEndpoint, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', 'That server is not set up.');
    try {
      await endpoints.remove(id);
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.put(API_ROUTES.localEndpointKey, limit, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', 'That server is not set up.');
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
    }
    try {
      return c.json(LocalEndpointResponse.parse({ endpoint: await endpoints.setKey(id, body) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.delete(API_ROUTES.localEndpointKey, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', 'That server is not set up.');
    try {
      return c.json(LocalEndpointResponse.parse({ endpoint: await endpoints.removeKey(id) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.post(API_ROUTES.localEndpointConfirm, limit, async (c) => {
    noStore(c);
    const id = idOf(c);
    if (id === undefined) return apiError(c, 404, 'not_found', 'That server is not set up.');
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
    }
    try {
      return c.json(LocalEndpointResponse.parse({ endpoint: endpoints.confirm(id, body) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.put(API_ROUTES.localEndpointDefault, limit, async (c) => {
    noStore(c);
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
    }
    try {
      endpoints.setDefault(body);
      return c.json(list());
    } catch (error) {
      return refusal(c, error);
    }
  });
}
