/**
 * The agent setup and onboarding routes (story 2.3 stubs; onboarding 9.1 to
 * 9.5 fill them): the agents and their state, installing one, signing in
 * with the user's own account, an API key, and whether Welcome is done.
 * Under `/api/v1`, behind the gate (AD-15).
 *
 * Until their stories ship each answers 501 `not_implemented`. None reads
 * the body: an API key sent to the stub is never parsed or logged (AD-16).
 * The sign-in answer is `no-store` even as a stub, since the real one
 * carries the sign-in URL, which never enters an event (AD-15).
 */
import type { AgentSetupPort, SecretStorePort } from '@ogden-agents/core';
import { API_ROUTES } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface AgentSetupRoutesOptions {
  /** One per supported agent. */
  agentSetup?: readonly AgentSetupPort[] | undefined;
  /** Where API keys are kept (AD-16). */
  secrets?: SecretStorePort | undefined;
  log: Logger;
}

const noStore = (c: Context) => {
  c.header('Cache-Control', 'no-store');
  return notImplemented(c);
};

export function registerAgentSetupRoutes(app: Hono, options: AgentSetupRoutesOptions): void {
  // `GET` → `AgentsResponse` (9.1).
  app.get(API_ROUTES.agents, notImplemented);
  // `POST` → 202 `AgentSetupStatus` (9.3).
  app.post(API_ROUTES.agentInstall, notImplemented);
  // `POST` → `SignInResponse`, `no-store`; `DELETE` → 204 cancels (9.2).
  app.post(API_ROUTES.agentSignIn, noStore);
  app.delete(API_ROUTES.agentSignIn, notImplemented);
  // `PUT SetApiKeyRequest` → 204; `DELETE` → 204 (9.4). The body is never read here.
  app.put(API_ROUTES.agentApiKey, notImplemented);
  app.delete(API_ROUTES.agentApiKey, notImplemented);
  // `GET` and `PATCH` → `OnboardingState` (9.5).
  app.get(API_ROUTES.onboarding, notImplemented);
  app.patch(API_ROUTES.onboarding, notImplemented);
}
