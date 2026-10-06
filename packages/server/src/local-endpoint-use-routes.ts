/**
 * Using the Local model's endpoints (epic 14 story 14.4): the presets, Test
 * connection and Detect. Under `/api/v1`, behind the gate. Only the server
 * calls an endpoint (AD-15; the CSP is unchanged). Test connection goes
 * through core, which refuses a host nobody confirmed before anything is
 * called (409 `endpoint_confirmation_required`). Detect probes only
 * 127.0.0.1 and localhost on the presets' ports, once, when pressed, and reads no body.
 */
import { CoreError, EndpointConfirmationRequiredError, NotFoundError, SecretsUnavailableError, type LocalModels } from '@ogden-agents/core';
import { API_ROUTES, LocalEndpointDetectResponse, LocalEndpointId, LocalEndpointPresetsResponse, LocalEndpointTestResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface EndpointPresetData {
  id: string;
  label: string;
  baseUrl: string;
  downloadUrl: string;
}

export interface LocalEndpointUseRoutesOptions {
  localModels?: LocalModels | undefined;
  presets: readonly EndpointPresetData[];
  log: Logger;
}

const noStore = (c: Context) => c.header('Cache-Control', 'no-store');

export function registerLocalEndpointUseRoutes(app: Hono, { localModels, presets, log }: LocalEndpointUseRoutesOptions): void {
  app.get(API_ROUTES.localEndpointPresets, (c) => c.json(LocalEndpointPresetsResponse.parse({ presets })));
  if (localModels === undefined) {
    app.post(API_ROUTES.localEndpointTest, notImplemented);
    app.post(API_ROUTES.localEndpointDetect, notImplemented);
    return;
  }
  const models = localModels;

  app.post(API_ROUTES.localEndpointTest, async (c) => {
    noStore(c);
    const id = LocalEndpointId.safeParse(c.req.param('endpointId'));
    if (!id.success) return apiError(c, 404, 'not_found', 'That server is not set up.');
    try {
      return c.json(LocalEndpointTestResponse.parse(await models.test(id.data)));
    } catch (error) {
      if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', 'That server is not set up.');
      if (error instanceof EndpointConfirmationRequiredError) return apiError(c, 409, 'endpoint_confirmation_required', error.message, { host: error.host });
      if (error instanceof SecretsUnavailableError) return apiError(c, 503, 'secrets_unavailable', error.message);
      log.error('testing a local endpoint failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
      return apiError(c, 500, 'internal_error', "Ogden Agents couldn't test that server. Try again.");
    }
  });

  app.post(API_ROUTES.localEndpointDetect, async (c) => {
    noStore(c);
    try {
      const found = await models.detect(presets);
      log.info('local server detect ran', { found: found.length });
      return c.json(LocalEndpointDetectResponse.parse({ found }));
    } catch (error) {
      log.error('detecting local servers failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
      return apiError(c, 500, 'internal_error', "Ogden Agents couldn't look for servers. Try again.");
    }
  });
}
