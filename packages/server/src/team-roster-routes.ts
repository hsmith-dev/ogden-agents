/**
 * The team roster over REST (epic 15, story 15.5).
 *
 * - `GET /api/v1/workspaces/:wsId/orchestration/roster`: the project's roster as the screen shows it, behind the
 *   Orchestration guard like every orchestration route. A project's roster changes through the workspace settings
 *   route, which asks core's team to check it first ({@link ../workspace-routes}).
 * - `GET` and `PUT /api/v1/settings/team-roster`: the roster new projects start with, an install-level preference
 *   (behind the gate; a `PUT` is state-changing, so the gate has checked its Origin). Core checks every role and
 *   appends `settings.team_roster_default_changed`.
 *
 * Without core's team the routes answer 501 and read no body.
 */
import { CoreError, type Team } from '@ogden-agents/core';
import { API_ROUTES, TeamRosterViewResponse, UpdateTeamRosterDefaultRequest } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { orchestrationRoutes } from './orchestration-routes.js';
import { readBody } from './request-input.js';
import type { OrchestrationFeature } from '@ogden-agents/core';

/** A roster is four small assignees. */
const MAX_BODY_BYTES = 4 * 1024;

export function registerTeamRosterRoutes(app: Hono, { team, orchestration, log }: { team?: Team | undefined; orchestration?: OrchestrationFeature | undefined; log: Logger }): void {
  if (team === undefined) {
    app.get(API_ROUTES.teamRosterDefault, notImplemented);
    app.put(API_ROUTES.teamRosterDefault, notImplemented);
  } else {
    app.get(API_ROUTES.teamRosterDefault, async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json(TeamRosterViewResponse.parse(await team.defaultView()));
    });
    app.put(
      API_ROUTES.teamRosterDefault,
      bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'The request is too large.') }),
      async (c) => {
        const body = await readBody(c, UpdateTeamRosterDefaultRequest);
        if (!body.ok) return body.response;
        try {
          const saved = await team.setDefault(body.value.roster);
          log.info('team roster default saved');
          return c.json(TeamRosterViewResponse.parse(saved));
        } catch (error) {
          // A rule broken is the user's to fix: core's words, nothing written.
          if (error instanceof CoreError && error.code === 'invalid_input') return apiError(c, 400, 'invalid_request', error.message);
          log.error('saving the team roster default failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
          return apiError(c, 500, 'internal_error', "Ogden Agents couldn't save the team. Try again.");
        }
      },
    );
  }
  if (orchestration === undefined) return;
  const routes = orchestrationRoutes(app, { orchestration, log });
  routes.get(API_ROUTES.workspaceTeamRoster, async (c, { workspaceId }) => {
    if (team === undefined) return notImplemented(c);
    c.header('Cache-Control', 'no-store');
    return c.json(TeamRosterViewResponse.parse(await team.view(workspaceId)));
  });
}
