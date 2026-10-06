/**
 * `GET /api/v1/local-endpoints/:endpointId/models` (epic 14 story 14.5): the
 * models an endpoint serves with the size, context length and tool support it
 * reports, cautions in plain words, and the chosen model when the server no
 * longer lists it. Behind the gate; only the server asks the endpoint. Core
 * refuses an unconfirmed host before anything is called.
 */
import { CoreError, EndpointConfirmationRequiredError, NotFoundError, SecretsUnavailableError, type LocalModels } from '@ogden-agents/core';
import { API_ROUTES, LocalEndpointId, LocalEndpointModelsResponse, modelCautions } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

export function registerLocalEndpointModelsRoute(app: Hono, { localModels, log }: { localModels?: LocalModels | undefined; log: Logger }): void {
  if (localModels === undefined) {
    app.get(API_ROUTES.localEndpointModels, notImplemented);
    return;
  }
  app.get(API_ROUTES.localEndpointModels, async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    const id = LocalEndpointId.safeParse(c.req.param('endpointId'));
    if (!id.success) return apiError(c, 404, 'not_found', 'That server is not set up.');
    try {
      const answer = await localModels.models(id.data);
      return c.json(
        LocalEndpointModelsResponse.parse({
          ...answer,
          models: answer.models.map((model) => ({ ...model, cautions: modelCautions(model) })),
        }),
      );
    } catch (error) {
      if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', 'That server is not set up.');
      if (error instanceof EndpointConfirmationRequiredError) return apiError(c, 409, 'endpoint_confirmation_required', error.message, { host: error.host });
      if (error instanceof SecretsUnavailableError) return apiError(c, 503, 'secrets_unavailable', error.message);
      log.error('listing a local endpoint\'s models failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
      return apiError(c, 500, 'internal_error', "Ogden Agents couldn't list that server's models. Try again.");
    }
  });
}
