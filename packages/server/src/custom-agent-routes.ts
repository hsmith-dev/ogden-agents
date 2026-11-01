/**
 * The custom agent route (epic 21, story 21.1; CAP-27, E21-R1, E21-R2): the
 * user registers an ACP agent they bring by its name and command line, and it
 * joins the agent registry live, without a restart. Under `/api/v1`, behind
 * the gate (AD-15). The command is resolved (`resolveLinkedCommand`: absolute,
 * runnable, never through a shell) before anything is saved, and again at
 * every chat start by the agent's own launch. Story 21.2 keeps them (core's
 * `custom_agents` rows), changes and removes them; an optional API key goes to
 * the keychain once and is never answered, logged or evented (AD-16), so
 * these routes are `no-store`.
 */
import { resolveLinkedCommand } from '@ogden-agents/adapters';
import { AgentError, CoreError, NotFoundError, SecretsUnavailableError, ValidationError } from '@ogden-agents/core';
import { API_ROUTES, CustomAgentCreateRequest, CustomAgentListResponse, CustomAgentResponse, CustomAgentTestRequest, CustomAgentTestResponse, CustomAgentUpdateRequest, customAgentTestLines, type AgentId, type CustomAgent, type CustomAgentAdvertised } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { readBody } from './request-input.js';

/** What the routes need of the server's wiring. Each change reaches the live registry before it returns. */
export interface CustomAgents {
  /** Whether `agentId` is taken: a registered agent's (a built-in's or a custom one's), or one a stored chat still names. */
  isRegistered(agentId: AgentId): boolean;
  /** The environment a chat with `agentId` starts with (AD-16): where a bare command is looked up. */
  env(agentId: AgentId): Readonly<Record<string, string>>;
  /** Every stored custom agent. */
  list(): CustomAgent[];
  /** Stores and registers it. Rejects with core's errors (`ValidationError`, `SecretsUnavailableError`). */
  create(agentId: AgentId, request: CustomAgentCreateRequest): Promise<CustomAgent>;
  /** Changes it and registers it again. Rejects `NotFoundError`, `ValidationError`, `SecretsUnavailableError`. */
  update(agentId: AgentId, request: CustomAgentUpdateRequest): Promise<CustomAgent>;
  /** Unregisters it and removes it and its key. Rejects `NotFoundError`, `SecretsUnavailableError`. */
  remove(agentId: AgentId): Promise<void>;
  /** Starts `request`'s command once with its typed key and reports what it advertised (story 21.3). Keeps nothing. Rejects `AgentError`. */
  test(request: CustomAgentTestRequest): Promise<CustomAgentAdvertised>;
  /** The same for a saved agent, with its own command and key. Rejects `NotFoundError`, `AgentError`. */
  testSaved(agentId: AgentId): Promise<CustomAgentAdvertised>;
}

export interface CustomAgentRoutesOptions {
  customAgents?: CustomAgents | undefined;
  log: Logger;
}

/** Largest body read: a 40-character name, a 1000-character command line and a key, with room for JSON escapes. */
const MAX_CUSTOM_AGENT_BODY_BYTES = 16 * 1024;
/** The longest slug: `custom-` and a `-<n>` suffix still fit an agent id's 64 characters. */
const MAX_SLUG_LENGTH = 48;
const COULD_NOT_SAVE = "Ogden Agents couldn't save that agent. Try again.";
const noStore = (c: Context) => c.header('Cache-Control', 'no-store');

/** The kebab-case slug of `name`: letters and digits, accents dropped, everything else a single `-`; `agent` when nothing is left. */
export function customAgentSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? 'agent' : slug;
}

/** `custom-<slug>`, else `custom-<slug>-2`, `-3`… : the first no agent has yet. */
export function customAgentId(name: string, isRegistered: (agentId: AgentId) => boolean): AgentId {
  const base = `custom-${customAgentSlug(name)}`;
  if (!isRegistered(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!isRegistered(candidate)) return candidate;
  }
}

export function registerCustomAgentRoutes(app: Hono, options: CustomAgentRoutesOptions): void {
  const { customAgents, log } = options;
  if (customAgents === undefined) {
    app.get(API_ROUTES.customAgents, notImplemented);
    app.post(API_ROUTES.customAgents, notImplemented);
    app.patch(API_ROUTES.customAgent, notImplemented);
    app.delete(API_ROUTES.customAgent, notImplemented);
    app.post(API_ROUTES.customAgentsTest, notImplemented);
    app.post(API_ROUTES.customAgentTest, notImplemented);
    return;
  }
  const limit = bodyLimit({ maxSize: MAX_CUSTOM_AGENT_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.') });
  // Ids picked for a create still saving its key: a second create of the same name meanwhile gets the next one.
  const pending = new Set<AgentId>();
  const taken = (agentId: AgentId) => pending.has(agentId) || customAgents.isRegistered(agentId);
  const stored = (agentId: string | undefined) => customAgents.list().find((agent) => agent.agentId === agentId);
  const notFound = (c: Context) => apiError(c, 404, 'custom_agent_not_found', 'That agent is not added.');
  const refusal = (c: Context, error: unknown, agentId: AgentId): Response => {
    if (error instanceof NotFoundError) return notFound(c);
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof SecretsUnavailableError) {
      log.warn('the keychain is unavailable', { code: typeof error.cause === 'string' ? error.cause : 'unknown' });
      return apiError(c, 503, 'secrets_unavailable', error.message);
    }
    log.error('custom agent request failed', { agentId, code: error instanceof CoreError ? error.code : error instanceof Error ? error.name : 'unexpected' });
    return apiError(c, 500, 'internal_error', COULD_NOT_SAVE);
  };
  /** The command resolved against the agent's own chat environment, as its chat start will (AD-16); a refusal is the plain reason. */
  const resolve = (agentId: AgentId, commandLine: string) => resolveLinkedCommand({ command: commandLine }, customAgents.env(agentId));

  /** Test's answer, or the agent's own failure in one sentence; neither the command line nor a key is logged. */
  // One Test at a time per saved agent, and one for unsaved commands: repeated presses never pile up agent processes.
  const probing = new Set<string>();
  const tested = async (c: Context, agentId: AgentId | undefined, work: () => Promise<CustomAgentAdvertised>): Promise<Response> => {
    const slot = agentId ?? '';
    if (probing.has(slot)) return apiError(c, 409, 'custom_agent_test_running', 'A test of this agent is still running. Wait for it to finish.');
    probing.add(slot);
    try {
      const advertised = await work();
      log.info('custom agent tested', { ...(agentId === undefined ? {} : { agentId }), resume: advertised.resume, load: advertised.load });
      return c.json(CustomAgentTestResponse.parse({ advertised, lines: customAgentTestLines(advertised) }));
    } catch (error) {
      if (error instanceof AgentError) {
        log.info('custom agent test failed', { ...(agentId === undefined ? {} : { agentId }), code: error.code });
        return apiError(c, 422, 'custom_agent_test_failed', error.message, { reason: error.code });
      }
      return refusal(c, error, agentId ?? 'custom-agent-test');
    } finally {
      probing.delete(slot);
    }
  };

  // Test before saving: the typed command and key, started once; nothing is kept. Static, so it is matched before `:agentId`.
  app.post(API_ROUTES.customAgentsTest, limit, async (c) => {
    noStore(c);
    const body = await readBody(c, CustomAgentTestRequest);
    if (!body.ok) return body.response;
    const request = body.value;
    // Refused as Save refuses it, before anything starts.
    const resolved = resolve('custom--test', request.commandLine);
    if (!resolved.ok) return apiError(c, 400, 'custom_agent_command_invalid', resolved.reason);
    return tested(c, undefined, () => customAgents.test(request));
  });

  app.post(API_ROUTES.customAgentTest, async (c) => {
    noStore(c);
    const agentId = c.req.param('agentId');
    if (stored(agentId) === undefined) return notFound(c);
    const id = agentId as AgentId;
    return tested(c, id, () => customAgents.testSaved(id));
  });

  app.get(API_ROUTES.customAgents, (c) => {
    noStore(c);
    return c.json(CustomAgentListResponse.parse({ agents: customAgents.list() }));
  });

  // `POST CustomAgentCreateRequest` → 201 `CustomAgentResponse`: resolved first; a refusal keeps nothing.
  app.post(API_ROUTES.customAgents, limit, async (c) => {
    noStore(c);
    const body = await readBody(c, CustomAgentCreateRequest);
    if (!body.ok) return body.response;
    const { displayName, commandLine } = body.value;
    const agentId = customAgentId(displayName, taken);
    const resolved = resolve(agentId, commandLine);
    if (!resolved.ok) return apiError(c, 400, 'custom_agent_command_invalid', resolved.reason);
    pending.add(agentId);
    try {
      const agent = await customAgents.create(agentId, body.value);
      // The command line is the user's own and may carry anything: only the id and the program are logged, never a key.
      log.info('custom agent added', { agentId, command: resolved.resolved.command, hasKey: agent.hasKey });
      return c.json(CustomAgentResponse.parse({ agent }), 201);
    } catch (error) {
      return refusal(c, error, agentId);
    } finally {
      pending.delete(agentId);
    }
  });

  app.patch(API_ROUTES.customAgent, limit, async (c) => {
    noStore(c);
    const agentId = c.req.param('agentId');
    if (stored(agentId) === undefined) return notFound(c);
    const id = agentId as AgentId;
    const body = await readBody(c, CustomAgentUpdateRequest);
    if (!body.ok) return body.response;
    if (body.value.commandLine !== undefined) {
      const resolved = resolve(id, body.value.commandLine);
      if (!resolved.ok) return apiError(c, 400, 'custom_agent_command_invalid', resolved.reason);
    }
    try {
      const agent = await customAgents.update(id, body.value);
      log.info('custom agent changed', { agentId: id, hasKey: agent.hasKey });
      return c.json(CustomAgentResponse.parse({ agent }));
    } catch (error) {
      return refusal(c, error, id);
    }
  });

  app.delete(API_ROUTES.customAgent, async (c) => {
    noStore(c);
    const agentId = c.req.param('agentId');
    if (stored(agentId) === undefined) return notFound(c);
    const id = agentId as AgentId;
    try {
      await customAgents.remove(id);
      log.info('custom agent removed', { agentId: id });
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error, id);
    }
  });
}
