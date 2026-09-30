/**
 * The agent setup and onboarding routes (story 2.3 contracts): the agents and
 * their state, installing one, signing in with the user's own account, an
 * API key, and whether Welcome is done. Under `/api/v1`, behind the gate
 * (AD-15). Routes call core's agent setup use-case and never write
 * themselves (AD-11).
 *
 * Story 9.1 fills the agents list and sign-in (with its pasted code). Install
 * (9.3), the API key (9.2) and onboarding (9.5) still answer 501
 * `not_implemented`, and none of those stubs reads the body: an API key sent
 * to one is never parsed or logged (AD-16).
 *
 * The sign-in answers are `no-store`: the start carries the sign-in URL,
 * which never enters an event or a log line (AD-15), and the code route
 * takes a code that is never logged, evented, stored or echoed (AD-16).
 */
import { CoreError, NotFoundError, SignInNotPendingError, ValidationError, type AgentSetup, type SecretStorePort } from '@ogden-agents/core';
import { AgentId, AgentsResponse, API_ROUTES, SignInCodeRequest, SignInResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readBody } from './chat-routes.js';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface AgentSetupRoutesOptions {
  /** Core's agent setup use-case over every supported agent. */
  agentSetup?: AgentSetup | undefined;
  /** Where API keys are kept (AD-16). */
  secrets?: SecretStorePort | undefined;
  log: Logger;
}

/** Largest sign-in code body read (a code is at most 512 characters). */
const MAX_CODE_BODY_BYTES = 4 * 1024;

const NO_SUCH_AGENT = 'There is no such agent.';
const NOT_PENDING = 'No sign-in is waiting for a code. Start signing in again.';
const COULD_NOT_CHECK = "Ogden Agents couldn't check your agents. Try again.";
const COULD_NOT_SIGN_IN = "Ogden Agents couldn't start signing in. Try again.";

const noStore = (c: Context) => c.header('Cache-Control', 'no-store');

export function registerAgentSetupRoutes(app: Hono, options: AgentSetupRoutesOptions): void {
  const { agentSetup, log } = options;

  // `POST` → 202 `AgentSetupStatus` (9.3).
  app.post(API_ROUTES.agentInstall, notImplemented);
  // `PUT SetApiKeyRequest` → 204; `DELETE` → 204 (9.2). The body is never read here.
  app.put(API_ROUTES.agentApiKey, notImplemented);
  app.delete(API_ROUTES.agentApiKey, notImplemented);
  // `GET` and `PATCH` → `OnboardingState` (9.5).
  app.get(API_ROUTES.onboarding, notImplemented);
  app.patch(API_ROUTES.onboarding, notImplemented);

  if (agentSetup === undefined) {
    app.get(API_ROUTES.agents, notImplemented);
    app.post(API_ROUTES.agentSignIn, (c) => {
      noStore(c);
      return notImplemented(c);
    });
    app.delete(API_ROUTES.agentSignIn, notImplemented);
    app.post(API_ROUTES.agentSignInCode, (c) => {
      noStore(c);
      return notImplemented(c);
    });
    return;
  }

  /** The route's `:agentId`, if it is a well-formed agent id. */
  const agentIdOf = (c: Context): string | undefined => {
    const parsed = AgentId.safeParse(c.req.param('agentId'));
    return parsed.success ? parsed.data : undefined;
  };

  /** Core's refusals as API errors. Only codes are logged, never a URL or a code. */
  const refusal = (c: Context, error: unknown, fallback: string): Response => {
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
    if (error instanceof SignInNotPendingError) return apiError(c, 409, 'sign_in_not_pending', NOT_PENDING);
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    log.error('agent setup request failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'agent_setup_failed', fallback);
  };

  // `GET` → `AgentsResponse`: every supported agent's install and sign-in state.
  app.get(API_ROUTES.agents, async (c) => {
    try {
      return c.json(AgentsResponse.parse({ agents: await agentSetup.list() }));
    } catch (error) {
      return refusal(c, error, COULD_NOT_CHECK);
    }
  });

  // `POST` → `SignInResponse`, `no-store`: the URL goes to this tab and nowhere else.
  app.post(API_ROUTES.agentSignIn, async (c) => {
    noStore(c);
    const agentId = agentIdOf(c);
    if (agentId === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
    try {
      const result = await agentSetup.signIn(agentId);
      log.info('agent sign-in requested', { agentId, state: result.state });
      return c.json(SignInResponse.parse(result));
    } catch (error) {
      return refusal(c, error, COULD_NOT_SIGN_IN);
    }
  });

  // `DELETE` → 204: stops a sign-in in progress; idempotent.
  app.delete(API_ROUTES.agentSignIn, async (c) => {
    const agentId = agentIdOf(c);
    if (agentId === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
    try {
      await agentSetup.cancelSignIn(agentId);
      log.info('agent sign-in cancelled', { agentId });
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error, COULD_NOT_SIGN_IN);
    }
  });

  // `POST SignInCodeRequest` → 204, `no-store`: the code is typed into the sign-in and never logged or echoed.
  app.post(
    API_ROUTES.agentSignInCode,
    async (c, next) => {
      noStore(c);
      await next();
    },
    bodyLimit({ maxSize: MAX_CODE_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That is too long to be a sign-in code.') }),
    async (c) => {
      const agentId = agentIdOf(c);
      if (agentId === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
      const body = await readBody(c, SignInCodeRequest);
      if (!body.ok) return body.response;
      try {
        await agentSetup.submitCode(agentId, body.value.code);
        log.info('agent sign-in code sent', { agentId });
        return c.body(null, 204);
      } catch (error) {
        return refusal(c, error, COULD_NOT_SIGN_IN);
      }
    },
  );
}
