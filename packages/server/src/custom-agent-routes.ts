/**
 * The custom agent route (epic 21, story 21.1; CAP-27, E21-R1, E21-R2): the
 * user registers an ACP agent they bring by its name and command line, and it
 * joins the agent registry live, without a restart. Under `/api/v1`, behind
 * the gate (AD-15). The command is resolved (`resolveLinkedCommand`: absolute,
 * runnable, never through a shell) before anything is registered, and again
 * at every chat start by the agent's own launch. Registrations last until the
 * server stops (entry 21.2 keeps them).
 */
import { resolveLinkedCommand } from '@ogden-agents/adapters';
import { API_ROUTES, CustomAgentCreateRequest, CustomAgentCreateResponse, type AgentId } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { readBody } from './request-input.js';

/** What the route needs of the server's wiring. */
export interface CustomAgents {
  /** Whether `agentId` is already a registered agent's (a built-in's or a custom one's). */
  isRegistered(agentId: AgentId): boolean;
  /** The environment a chat with `agentId` starts with (AD-16): where a bare command is looked up. */
  env(agentId: AgentId): Readonly<Record<string, string>>;
  /** Registers the agent, live. Throws (a wiring bug) when the registry refuses it. */
  add(input: { agentId: AgentId; displayName: string; commandLine: string }): void;
}

export interface CustomAgentRoutesOptions {
  customAgents?: CustomAgents | undefined;
  log: Logger;
}

/** Largest body read: a 40-character name and a 1000-character command line, with room for JSON escapes. */
const MAX_CUSTOM_AGENT_BODY_BYTES = 16 * 1024;
/** The longest slug: `custom-` and a `-<n>` suffix still fit an agent id's 64 characters. */
const MAX_SLUG_LENGTH = 48;
const COULD_NOT_REGISTER = "Ogden Agents couldn't add that agent. Try again.";

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
    app.post(API_ROUTES.customAgents, notImplemented);
    return;
  }

  // `POST CustomAgentCreateRequest` → 201 `CustomAgentCreateResponse`: resolved first; a refusal registers nothing.
  app.post(
    API_ROUTES.customAgents,
    bodyLimit({ maxSize: MAX_CUSTOM_AGENT_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That command is too long.') }),
    async (c) => {
      const body = await readBody(c, CustomAgentCreateRequest);
      if (!body.ok) return body.response;
      const { displayName, commandLine } = body.value;
      // No await from here to `add`: the id picked is still free when it is registered.
      const agentId = customAgentId(displayName, (id) => customAgents.isRegistered(id));
      const resolved = resolveLinkedCommand({ command: commandLine }, customAgents.env(agentId));
      if (!resolved.ok) return apiError(c, 400, 'custom_agent_command_invalid', resolved.reason);
      try {
        customAgents.add({ agentId, displayName, commandLine });
      } catch (error) {
        log.error('custom agent could not be registered', { agentId, reason: error instanceof Error ? error.message : 'unexpected' });
        return apiError(c, 500, 'internal_error', COULD_NOT_REGISTER);
      }
      // The command line is the user's own and may carry anything: only the id and the program are logged.
      log.info('custom agent registered', { agentId, command: resolved.resolved.command });
      return c.json(CustomAgentCreateResponse.parse({ agentId }), 201);
    },
  );
}
