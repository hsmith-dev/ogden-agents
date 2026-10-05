import {
  applyBmadPieceChoice,
  BMAD_METHOD_PRESELECTED_PIECES,
  FIRST_PROJECT_CHOICE_PIECES,
  type AgentSetupStatus,
  type BmadPiece,
  type BmadPieceAvailability,
  type FirstProjectChoice,
  type OnboardingState,
} from '@ogden-agents/shared';

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

/**
 * The agent Welcome shows selected (epic 6, entry 6): the one chosen (the
 * user's pick, else the kept default for new projects) while it is listed,
 * else the first supported one.
 */
export function selectedAgent(agents: readonly AgentSetupStatus[] | undefined, chosen?: string | undefined): AgentSetupStatus | undefined {
  return agents?.find((agent) => agent.agentId === chosen) ?? agents?.[0];
}

/** Whether Welcome asks which agent to use (epic 6, entry 6): only when there is more than one; Claude Code alone asks nothing. */
export const asksAgentChoice = (agents: readonly AgentSetupStatus[] | undefined): boolean => (agents?.length ?? 0) > 1;

/** One line under an agent in Welcome's choice: its setup, in the agent card's words. */
export function agentSetupWords(agent: AgentSetupStatus): string {
  if (agent.install === 'installing') return `Installing ${agent.displayName}`;
  if (agent.install !== 'installed') return 'Not installed';
  // An agent with only an API key has no sign in (Codex; user decision, 2026-10-05).
  if (agent.apiKeyOnly === true) return agent.auth === 'signed_in' ? 'Installed, using your API key' : 'Installed, needs an API key';
  return agent.auth === 'signed_in' ? 'Installed, signed in' : agent.auth === 'signing_in' ? 'Signing in' : 'Installed, needs sign-in';
}

/** After a project is added: the shortcut step while the server still offers it, else finish. */
export function stepAfterProject(offerPending: boolean | undefined): WelcomeStep | 'finish' {
  return offerPending === true ? 'shortcut' : 'finish';
}

/**
 * Where finishing or skipping goes: the new project's Plan when it was added
 * with Planning on (Flow 1 step 5, story 4.6), else its Chats, or Projects
 * when none was added.
 */
export function exitTarget(
  workspaceId: string | undefined,
  pieces: readonly BmadPiece[] | undefined = undefined,
): { to: '/w/$wsId' | '/w/$wsId/plan'; params: { wsId: string } } | { to: '/' } {
  if (workspaceId === undefined) return { to: '/' };
  return { to: pieces?.includes('planning') === true ? '/w/$wsId/plan' : '/w/$wsId', params: { wsId: workspaceId } };
}

/**
 * Where finishing goes, from the pieces the added project actually has
 * (story 4.6 review): Welcome's answer or, when it wasn't asked, the
 * New-project defaults the server applied. `loadPieces` reads them (the
 * project's settings); if it fails, the project's Chats.
 */
export async function resolveExitTarget(
  workspaceId: string | undefined,
  loadPieces: (workspaceId: string) => Promise<readonly BmadPiece[]>,
): Promise<ReturnType<typeof exitTarget>> {
  if (workspaceId === undefined) return exitTarget(undefined);
  const pieces = await loadPieces(workspaceId).catch(() => undefined);
  return exitTarget(workspaceId, pieces);
}

/** Whether `/` sends this tab to Welcome: only once onboarding has loaded as not done (never while loading or on an error). */
export function redirectsToWelcome(state: { welcomeCompleted: boolean } | undefined): boolean {
  return state?.welcomeCompleted === false;
}

/**
 * Whether the project step asks "Simple chats or BMad Method?" (10.4): only
 * once both are known, while no answer is kept and no project exists, so a
 * user from before epic 10 or one reopening Welcome with projects is never
 * asked.
 */
export function asksFirstProjectChoice(onboarding: Pick<OnboardingState, 'firstProjectChoice'> | undefined, projectCount: number | undefined): boolean {
  return onboarding !== undefined && onboarding.firstProjectChoice === undefined && projectCount === 0;
}

/** The pieces BMad Method can start with on this install: its preselected ones that are available, each with what it needs (all available). */
export function bmadMethodPieces(availability: readonly BmadPieceAvailability[] | undefined): BmadPiece[] {
  const available = new Set((availability ?? []).filter((entry) => entry.available).map((entry) => entry.piece));
  let pieces: BmadPiece[] = [];
  for (const piece of BMAD_METHOD_PRESELECTED_PIECES) {
    if (!available.has(piece)) continue;
    const next = applyBmadPieceChoice(pieces, piece, true).pieces;
    if (next.every((each) => available.has(each))) pieces = next;
  }
  return pieces;
}

/** The pieces the first project starts with for Welcome's answer (the app-wide default is not changed by it). */
export function firstProjectPieces(choice: FirstProjectChoice, availability: readonly BmadPieceAvailability[] | undefined): BmadPiece[] {
  return choice === 'bmad_method' ? bmadMethodPieces(availability) : [...FIRST_PROJECT_CHOICE_PIECES.simple_chats];
}
