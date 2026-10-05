/**
 * What an ACP agent's adapter gives the shared client beside its descriptor
 * (E6-R3), and the shared reasons and mode helpers (moved out of
 * `acp-agent.ts` by story 6.9 to keep it under 600 lines), re-exported from
 * `acp-agent.ts`.
 */
import type * as acp from '@agentclientprotocol/sdk';
import type { AgentDescriptor, AgentSandbox, AgentTerminalResume, ProtectedPaths } from '@ogden-agents/core';
import { PERMISSION_MODES, type PermissionMode } from '@ogden-agents/shared';
import type { AcpToolInputPaths } from './tool-paths.js';

/** The plain reasons the UI shows for an agent, by its product name. */
export function acpReasons(displayName: string) {
  return {
    notSetUp: `${displayName} isn't set up for Ogden Agents on this computer yet.`,
    couldNotStart: `${displayName} couldn't start. Try again.`,
    stopped: `${displayName} stopped unexpectedly. Send your message again to restart it.`,
    signIn: `${displayName} needs you to sign in again.`,
    failed: `${displayName} stopped with an error. Try again.`,
    noSuchMode: `${displayName} doesn't offer that permission mode here.`,
    couldNotSwitchMode: `${displayName} couldn't switch its permission mode.`,
    noSuchModel: `${displayName} doesn't offer that model here.`,
    couldNotSwitchModel: `${displayName} couldn't switch its model.`,
    usageLimit: `${displayName} has reached its usage limit. Continue this chat with another agent while it cools down, or try again later.`,
  } as const;
}

/** How to start the agent's ACP process. */
export interface AcpLaunch {
  /** The program, by absolute path (never looked up on `PATH` by the client). */
  command: string;
  args: readonly string[];
  /**
   * Variables the agent's own launch adds to core's environment (AD-16). Core's
   * own variables always win: a launch can add, never drop or change one.
   */
  addEnv?: Readonly<Record<string, string>> | undefined;
  /** What the "starting" log line says about it (paths, never the environment). */
  logFields?: Record<string, unknown> | undefined;
}

/** What is an agent's own, beside its descriptor (E6-R3). */
export interface AcpAgentQuirks {
  /**
   * How to start it in `cwd` with core's environment (AD-16). Throws an
   * {@link AgentError} (`agent_unavailable`) when it isn't set up.
   */
  launch(input: { cwd: string; env: Readonly<Record<string, string>> }): AcpLaunch;
  /**
   * The `_meta` its `session/new`, `resume` and `load` take to keep core's
   * protected paths guarded for the session's life (Auto only), and an
   * unattended build session's sandbox (story 5.2; never both absent).
   * Without it a session doesn't protect paths, and core keeps it out of
   * Auto; an agent without it can't run a build session.
   */
  sessionMeta?: ((protectedPaths: ProtectedPaths | undefined, sandbox?: AgentSandbox | undefined) => Record<string, unknown> | undefined) | undefined;
  /** The raw-input fields of its tools that name paths. */
  toolInputPaths: AcpToolInputPaths;
  /** Its session modes that ask as much as Ask (or more); any other, known or not, asks less. */
  askingModeIds: readonly string[];
  /** Its own CLI on its sessions (CAP-5), when that CLI can resume them. */
  terminalResume?: AgentTerminalResume | undefined;
  /**
   * The sign-in method to `authenticate` with once `initialize` answered and
   * before any session is opened (an agent that refuses sessions until a
   * client picks one, such as an API key method whose key is in `env`), or
   * `undefined` to open sessions as they are. Never sees anything but core's
   * environment; never logged.
   */
  authMethod?: ((input: { env: Readonly<Record<string, string>>; initialized: acp.InitializeResponse }) => string | undefined) | undefined;
  /** The raw-input fields of its shell tools that hold the command a card shows, first found wins. Default `['command']`. */
  commandFields?: readonly string[] | undefined;
  /** How it is asked to run an installed skill (`AgentPort.skillInvocation`, story 4.1): its own command syntax; the shared client adds none. */
  skillInvocation: (skill: string, idea?: string) => string;
}

/** A skill run as a slash command, the idea as its argument: `/name` or `/name idea` (an adapter's `skillInvocation`, stories 4.1, 4.2). */
export function slashSkillInvocation(skill: string, idea?: string): string {
  return idea === undefined || idea === '' ? `/${skill}` : `/${skill} ${idea}`;
}

export interface AcpAgentOptions {
  /** Called with protocol notes, for the log. Never includes the environment, stderr or the agent's messages. */
  onDiagnostic?: ((message: string, fields?: Record<string, unknown>) => void) | undefined;
  /** Default `START_TIMEOUT_MS` (`acp-agent.ts`). */
  startTimeoutMs?: number | undefined;
}

/** The Ogden mode an agent's session mode is, or `other`. */
export function acpModeOf(modeIds: AgentDescriptor['permissionModes'], modeId: string): PermissionMode | 'other' {
  return PERMISSION_MODES.find((mode) => modeIds[mode] === modeId) ?? 'other';
}

/** Whether a session mode asks less than Ask (so core tells the agent Ask). An unknown one does, to be safe. */
export function acpAsksLessThanAsk(askingModeIds: readonly string[], modeId: string): boolean {
  return !askingModeIds.includes(modeId);
}
