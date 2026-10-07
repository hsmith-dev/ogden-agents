/**
 * The agent setup and onboarding routes (story 2.3 contracts): the agents and
 * their state, installing one, signing in with the user's own account, an
 * API key, and whether Welcome is done. Under `/api/v1`, behind the gate
 * (AD-15). Routes call core's agent setup use-case and never write
 * themselves (AD-11).
 *
 * Story 9.1 fills the agents list and sign-in (with its pasted code),
 * story 9.2 the API key and story 9.3 Install, which never reads the body.
 * Story 9.5 fills onboarding (whether Welcome is done) through core's
 * onboarding use-case; without one it answers 501 and reads no body.
 *
 * The sign-in answers are `no-store`: the start carries the sign-in URL,
 * which never enters an event or a log line (AD-15), and the code route
 * takes a code that is never logged, evented, stored or echoed (AD-16). The
 * API key routes are `no-store` too: the key goes to core once and is never
 * logged, echoed or returned; only codes reach the log (AD-16).
 */
import {
  AgentBusyError,
  ApiKeyRefusedError,
  CoreError,
  NotFoundError,
  SecretsUnavailableError,
  SignInNotPendingError,
  ValidationError,
  type AgentLinkedCommands,
  type AgentSetup,
  type Onboarding,
} from '@ogden-agents/core';
import { resolveLinkedCommand } from '@ogden-agents/adapters';
import {
  AgentId,
  AgentSetupStatus,
  AgentsResponse,
  API_ROUTES,
  OnboardingState,
  SetApiKeyRequest,
  SetLinkedCommandRequest,
  SignInCodeRequest,
  SignInResponse,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readBody } from './request-input.js';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface AgentSetupRoutesOptions {
  /** Core's agent setup use-case over every supported agent (it owns the API keys' store, AD-16). */
  agentSetup?: AgentSetup | undefined;
  /** Core's onboarding use-case (9.5): whether Welcome is done; without it those routes answer 501. */
  onboarding?: Onboarding | undefined;
  /**
   * Each agent's linked command (epic 12, entry 12), over `core.agentLinkedCommands`; without it the linked-command
   * routes answer 501 and no `AgentSetupStatus` ever carries `linkedCommand`.
   */
  agentLinkedCommands?: AgentLinkedCommands | undefined;
  log: Logger;
}

/** Largest sign-in code body read (a code is at most 512 characters). */
const MAX_CODE_BODY_BYTES = 4 * 1024;
/** Largest API key body read (a key is at most 1000 characters). */
const MAX_API_KEY_BODY_BYTES = 4 * 1024;
/** Largest linked-command body read (a command line, a folder path and a modest set of environment variables). */
const MAX_LINKED_COMMAND_BODY_BYTES = 16 * 1024;
/** Largest onboarding body read (`{"welcomeCompleted":false}` is 26 bytes). */
const MAX_ONBOARDING_BODY_BYTES = 1024;

const NO_SUCH_AGENT = 'There is no such agent.';
const NOT_PENDING = 'No sign-in is waiting for a code. Start signing in again.';
const COULD_NOT_CHECK = "Ogden Agents couldn't check your agents. Try again.";
const COULD_NOT_SIGN_IN = "Ogden Agents couldn't start signing in. Try again.";
const COULD_NOT_SAVE_KEY = "Ogden Agents couldn't save the API key. Try again.";
const COULD_NOT_REMOVE_KEY = "Ogden Agents couldn't remove the API key. Try again.";
const COULD_NOT_INSTALL = "Ogden Agents couldn't start the install. Try again.";
const COULD_NOT_UNINSTALL = "Ogden Agents couldn't uninstall that. Try again.";
const COULD_NOT_SIGN_OUT = "Ogden Agents couldn't sign out. Try again.";
const COULD_NOT_SAVE_WELCOME = "Ogden Agents couldn't save that. Try again.";
const COULD_NOT_READ_WELCOME = "Ogden Agents couldn't check whether Welcome is done. Try again.";
const COULD_NOT_SAVE_LINKED_COMMAND = "Ogden Agents couldn't save that command. Try again.";
const COULD_NOT_REMOVE_LINKED_COMMAND = "Ogden Agents couldn't remove that command. Try again.";

const noStore = (c: Context) => c.header('Cache-Control', 'no-store');

export function registerAgentSetupRoutes(app: Hono, options: AgentSetupRoutesOptions): void {
  const { agentSetup, onboarding, agentLinkedCommands, log } = options;

  registerOnboardingRoutes(app, onboarding, log);

  if (agentSetup === undefined) {
    app.get(API_ROUTES.agents, notImplemented);
    app.post(API_ROUTES.agentInstall, notImplemented);
    app.delete(API_ROUTES.agentInstall, notImplemented);
    app.post(API_ROUTES.agentSignOut, notImplemented);
    // Never reads the body: a key sent here is not parsed or logged.
    app.put(API_ROUTES.agentApiKey, (c) => {
      noStore(c);
      return notImplemented(c);
    });
    app.delete(API_ROUTES.agentApiKey, (c) => {
      noStore(c);
      return notImplemented(c);
    });
    app.post(API_ROUTES.agentSignIn, (c) => {
      noStore(c);
      return notImplemented(c);
    });
    app.delete(API_ROUTES.agentSignIn, notImplemented);
    app.post(API_ROUTES.agentSignInCode, (c) => {
      noStore(c);
      return notImplemented(c);
    });
    app.put(API_ROUTES.agentLinkedCommand, (c) => {
      noStore(c);
      return notImplemented(c);
    });
    app.delete(API_ROUTES.agentLinkedCommand, (c) => {
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

  /**
   * `status`, with its agent's linked command merged in from
   * `core.agentLinkedCommands` (epic 12, entry 12): never part of what a
   * port's own `status()` reports, and only for an agent whose own status
   * already says it supports one.
   */
  const withLinkedCommand = (status: AgentSetupStatus): AgentSetupStatus => {
    if (agentLinkedCommands === undefined || status.supportsLinkedCommand !== true) return status;
    const linkedCommand = agentLinkedCommands.get(status.agentId);
    return linkedCommand === undefined ? status : { ...status, linkedCommand };
  };

  /** Core's refusals as API errors. Only codes are logged, never a URL, a code or a key. */
  const refusal = (c: Context, error: unknown, fallback: string): Response => {
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
    if (error instanceof SignInNotPendingError) return apiError(c, 409, 'sign_in_not_pending', NOT_PENDING);
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof ApiKeyRefusedError) return apiError(c, 400, 'api_key_refused', error.message);
    if (error instanceof AgentBusyError) return apiError(c, 409, 'agent_busy', error.message);
    if (error instanceof SecretsUnavailableError) {
      log.warn('the keychain is unavailable', { code: typeof error.cause === 'string' ? error.cause : 'unknown' });
      return apiError(c, 503, 'secrets_unavailable', error.message);
    }
    log.error('agent setup request failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'agent_setup_failed', fallback);
  };

  // `GET` → `AgentsResponse`: every supported agent's install and sign-in state.
  app.get(API_ROUTES.agents, async (c) => {
    try {
      const agents = (await agentSetup.list()).map(withLinkedCommand);
      return c.json(AgentsResponse.parse({ agents }));
    } catch (error) {
      return refusal(c, error, COULD_NOT_CHECK);
    }
  });

  // `POST` → 202 `AgentSetupStatus`: starts installing, or answers with the install already running (or done).
  app.post(API_ROUTES.agentInstall, async (c) => {
    const agentId = agentIdOf(c);
    if (agentId === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
    try {
      const { started, agent } = await agentSetup.install(agentId);
      log.info('agent install requested', { agentId, started, install: agent.install });
      return c.json(AgentSetupStatus.parse(withLinkedCommand(agent)), 202);
    } catch (error) {
      return refusal(c, error, COULD_NOT_INSTALL);
    }
  });

  // `DELETE` → 200 `AgentSetupStatus`: uninstalls (epic 6 entry 7); 409 `agent_busy` with plain words when it can't now.
  app.delete(API_ROUTES.agentInstall, async (c) => {
    const agentId = agentIdOf(c);
    if (agentId === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
    try {
      const agent = await agentSetup.uninstall(agentId);
      log.info('agent uninstalled', { agentId });
      return c.json(AgentSetupStatus.parse(agent));
    } catch (error) {
      return refusal(c, error, COULD_NOT_UNINSTALL);
    }
  });

  // `POST` → 200 `AgentSetupStatus`: signs out of the user's own account (epic 6 entry 7). Reads no body.
  app.post(API_ROUTES.agentSignOut, async (c) => {
    const agentId = agentIdOf(c);
    if (agentId === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
    try {
      const agent = await agentSetup.signOut(agentId);
      log.info('agent signed out', { agentId });
      return c.json(AgentSetupStatus.parse(withLinkedCommand(agent)));
    } catch (error) {
      return refusal(c, error, COULD_NOT_SIGN_OUT);
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

  // `PUT SetApiKeyRequest` → 204, `no-store`: checked with the agent's provider, then kept in the keychain only.
  app.put(
    API_ROUTES.agentApiKey,
    async (c, next) => {
      noStore(c);
      await next();
    },
    bodyLimit({ maxSize: MAX_API_KEY_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That is too long to be an API key.') }),
    async (c) => {
      const agentId = agentIdOf(c);
      if (agentId === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
      const body = await readBody(c, SetApiKeyRequest);
      if (!body.ok) return body.response;
      try {
        await agentSetup.setApiKey(agentId, body.value.apiKey);
        log.info('agent API key saved', { agentId });
        return c.body(null, 204);
      } catch (error) {
        return refusal(c, error, COULD_NOT_SAVE_KEY);
      }
    },
  );

  // `DELETE` → 204, `no-store`: removes the key; idempotent.
  app.delete(API_ROUTES.agentApiKey, async (c) => {
    noStore(c);
    const agentId = agentIdOf(c);
    if (agentId === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
    try {
      await agentSetup.deleteApiKey(agentId);
      log.info('agent API key removed', { agentId });
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error, COULD_NOT_REMOVE_KEY);
    }
  });

  // `PUT SetLinkedCommandRequest` → 204, sent `Cache-Control: no-store` (epic 12, entry 12; its `env` can carry
  // secret-like values, as `agentApiKey` does): links the agent to a command line the user already installs and
  // manages, in place of Ogden Agents' own managed install. Resolved to an absolute, runnable path
  // (`resolveLinkedCommand`) before anything is persisted; a refusal there is plain words, nothing saved.
  app.put(
    API_ROUTES.agentLinkedCommand,
    bodyLimit({ maxSize: MAX_LINKED_COMMAND_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That command is too long.') }),
    async (c) => {
      noStore(c);
      const agentId = agentIdOf(c);
      if (agentId === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
      if (agentLinkedCommands === undefined) return notImplemented(c);
      const body = await readBody(c, SetLinkedCommandRequest);
      if (!body.ok) return body.response;
      let agents: AgentSetupStatus[];
      try {
        agents = await agentSetup.list();
      } catch (error) {
        return refusal(c, error, COULD_NOT_SAVE_LINKED_COMMAND);
      }
      const agent = agents.find((candidate) => candidate.agentId === agentId);
      if (agent === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
      if (agent.supportsLinkedCommand !== true) return apiError(c, 400, 'invalid_request', `${agent.displayName} can't be linked to a command you manage yourself.`);
      const resolved = resolveLinkedCommand(body.value, process.env);
      if (!resolved.ok) return apiError(c, 400, 'invalid_request', resolved.reason);
      try {
        agentLinkedCommands.set(agentId, body.value);
        log.info('agent linked command saved', { agentId });
        return c.body(null, 204);
      } catch (error) {
        return refusal(c, error, COULD_NOT_SAVE_LINKED_COMMAND);
      }
    },
  );

  // `DELETE` → 204, sent `Cache-Control: no-store` (epic 12, entry 12): clears the agent's linked command;
  // idempotent. The next chat start resolves the managed install again.
  app.delete(API_ROUTES.agentLinkedCommand, async (c) => {
    noStore(c);
    const agentId = agentIdOf(c);
    if (agentId === undefined) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
    if (agentLinkedCommands === undefined) return notImplemented(c);
    try {
      const agents = await agentSetup.list();
      if (!agents.some((candidate) => candidate.agentId === agentId)) return apiError(c, 404, 'not_found', NO_SUCH_AGENT);
      agentLinkedCommands.set(agentId, null);
      log.info('agent linked command removed', { agentId });
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error, COULD_NOT_REMOVE_LINKED_COMMAND);
    }
  });
}

/** `GET` → `OnboardingState`; `PATCH OnboardingState` → `OnboardingState` (9.5). Only codes reach the log. */
function registerOnboardingRoutes(app: Hono, onboarding: Onboarding | undefined, log: Logger): void {
  if (onboarding === undefined) {
    app.get(API_ROUTES.onboarding, notImplemented);
    app.patch(API_ROUTES.onboarding, notImplemented);
    return;
  }

  app.get(API_ROUTES.onboarding, (c) => {
    try {
      return c.json(OnboardingState.parse(onboarding.get()));
    } catch (error) {
      log.error('reading onboarding failed', { code: (error as NodeJS.ErrnoException).code ?? (error instanceof CoreError ? error.code : 'unexpected') });
      return apiError(c, 500, 'internal_error', COULD_NOT_READ_WELCOME);
    }
  });

  app.patch(
    API_ROUTES.onboarding,
    bodyLimit({ maxSize: MAX_ONBOARDING_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'The request is too large.') }),
    async (c) => {
      const body = await readBody(c, OnboardingState);
      if (!body.ok) return body.response;
      try {
        const state = onboarding.set(body.value);
        log.info('onboarding saved', state);
        return c.json(OnboardingState.parse(state));
      } catch (error) {
        if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
        log.error('saving onboarding failed', { code: (error as NodeJS.ErrnoException).code ?? (error instanceof CoreError ? error.code : 'unexpected') });
        return apiError(c, 500, 'internal_error', COULD_NOT_SAVE_WELCOME);
      }
    },
  );
}
