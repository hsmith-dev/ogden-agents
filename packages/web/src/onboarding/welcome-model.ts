import type { AgentSetupStatus } from '@ogden-agents/shared';

/**
 * Welcome's rules (onboarding 9.5), kept pure so they are tested without a
 * browser. Readiness is derived from the agent's status, never stored.
 */

export type WelcomeStep = 'agent' | 'project' | 'shortcut';

/** Ready to work: installed, and signed in with the user's account or with an API key in use (both report `signed_in`). */
export function agentReady(agent: AgentSetupStatus | undefined): boolean {
  return agent !== undefined && agent.install === 'installed' && agent.auth === 'signed_in';
}

/**
 * Whether the agent step moves on by itself: only on the change to ready
 * while the step is shown, never on arrival (`previous` is `undefined` until
 * the agent's status is first seen), so a returning user sees their card and
 * **Continue**.
 */
export function advancesOnReady(previous: boolean | undefined, now: boolean): boolean {
  return previous === false && now;
}

/** The agent Welcome shows selected: the first supported one (there is one today). */
export function selectedAgent(agents: readonly AgentSetupStatus[] | undefined): AgentSetupStatus | undefined {
  return agents?.[0];
}

/** After a project is added: the shortcut step while the server still offers it, else finish. */
export function stepAfterProject(offerPending: boolean | undefined): WelcomeStep | 'finish' {
  return offerPending === true ? 'shortcut' : 'finish';
}

/** Where finishing or skipping goes: the new project's Chats, or Projects when none was added. */
export function exitTarget(workspaceId: string | undefined): { to: '/w/$wsId'; params: { wsId: string } } | { to: '/' } {
  return workspaceId === undefined ? { to: '/' } : { to: '/w/$wsId', params: { wsId: workspaceId } };
}

/** Whether `/` sends this tab to Welcome: only once onboarding has loaded as not done (never while loading or on an error). */
export function redirectsToWelcome(state: { welcomeCompleted: boolean } | undefined): boolean {
  return state?.welcomeCompleted === false;
}
